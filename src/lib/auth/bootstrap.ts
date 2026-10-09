import { and, eq, isNull, sql } from "drizzle-orm";
import { db, type DbClient, type DbTransaction } from "../../db";
import {
  authAccounts,
  authEmailOtps,
  authPasswordSetupTokens,
  authSessions,
  employees,
  employeesGeneralInfo,
  employeesOtherReferences,
} from "../../db/schema";
import { generateEmployeeNoTx } from "../../utils/generateEmployeeNo";
import { ADMIN_EMPLOYEE_TYPE } from "@/utils/employeeCode";
import { hashPassword, normalizeEmail } from "./crypto";
import { setAccountGroupsTx, setManagerDepartmentsTx } from "./group-sync";
import { AUTH_GROUP_KEYS, getDefaultGroupForConfidentialityLevel, type AuthGroupKey } from "./permissions";
import {
  acquireAccountLifecycleLockTx,
  assertNotRemovingLastSystemAdminTx,
  countActiveEffectiveAccountsInGroupsTx,
} from "./lifecycle";

// TEMP_DISABLED_NO_DOMAIN:
// import {
//   createOnboardingOtpRecordTx,
//   deliverOnboardingOtpEmail,
// } from "./onboarding";

export type BootstrapAdminLevel = "Managerial" | "Supervisory";

type ExistingEmployeeRecord = {
  employeeId: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  confidentialityLevel: "Rank and File" | "Supervisory" | "Managerial" | null;
  email: string | null;
  accountId: string | null;
};

type BootstrapAccountStatus = "PendingSetup" | "Active" | "Locked" | "Disabled";
type BootstrapSource = "promoted-existing" | "created-new";

export type BootstrapFirstAdminArgs = {
  email: string;
  level?: BootstrapAdminLevel;
  firstName?: string;
  lastName?: string;
  tempPassword: string;
};

export type BootstrapFirstAdminResult = {
  source: BootstrapSource;
  email: string;
  employeeId: string;
  accountStatus: BootstrapAccountStatus;
  confidentialityLevel: BootstrapAdminLevel;
};

async function findAuthAccountByEmail(email: string, database: DbClient) {
  return database.query.authAccounts.findFirst({
    where: eq(authAccounts.email, normalizeEmail(email)),
  });
}

async function findEmployeeClaimByEmail(email: string, database: DbClient): Promise<ExistingEmployeeRecord | null> {
  const normalizedEmail = normalizeEmail(email);

  const [record] = await database
    .select({
      employeeId: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      confidentialityLevel: employeesGeneralInfo.confidentialityLevel,
      email: employeesOtherReferences.email,
      accountId: authAccounts.id,
    })
    .from(employees)
    .innerJoin(
      employeesOtherReferences,
      eq(employees.id, employeesOtherReferences.employeeId),
    )
    .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
    .leftJoin(authAccounts, eq(authAccounts.employeeId, employees.id))
    .where(
      and(
        isNull(employees.deletedAt),
        isNull(employeesOtherReferences.deletedAt),
        sql`LOWER(${employeesOtherReferences.email}) = ${normalizedEmail}`,
      ),
    )
    .limit(1);

  return record ?? null;
}

async function revokeAccountSessionsTx(tx: DbClient, accountId: string, now = new Date()) {
  await tx
    .update(authSessions)
    .set({ revokedAt: now })
    .where(and(eq(authSessions.accountId, accountId), isNull(authSessions.revokedAt)));
}

async function revokeAccountArtifactsTx(tx: DbClient, accountId: string, now = new Date()) {
  await revokeAccountSessionsTx(tx, accountId, now);
  await tx.delete(authEmailOtps).where(eq(authEmailOtps.accountId, accountId));
  await tx.delete(authPasswordSetupTokens).where(eq(authPasswordSetupTokens.accountId, accountId));
}

function normalizeRequiredName(value: string | undefined, fieldName: string) {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required when creating a new admin profile.`);
  }

  return normalized;
}

function normalizeRequiredTempPassword(value: string | undefined) {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error("Temporary password is required.");
  }

  if (normalized.length < 5) {
    throw new Error("Temporary password must be at least 5 characters.");
  }

  return normalized;
}

export type UpsertAdminAccountWithTemporaryPasswordArgs = {
  email: string;
  level?: BootstrapAdminLevel;
  firstName?: string;
  lastName?: string;
  tempPassword: string;
  groupKey?: AuthGroupKey;
  departmentIds?: number[];
};

export async function upsertAdminAccountWithTemporaryPassword(
  args: UpsertAdminAccountWithTemporaryPasswordArgs,
  transaction?: DbTransaction,
): Promise<BootstrapFirstAdminResult> {
  const normalizedEmail = normalizeEmail(args.email);
  const confidentialityLevel = args.level ?? "Managerial";
  const tempPassword = normalizeRequiredTempPassword(args.tempPassword);
  const passwordHash = await hashPassword(tempPassword);

  const groupKey = args.groupKey ?? getDefaultGroupForConfidentialityLevel(confidentialityLevel)!;
  const run = async (tx: DbTransaction): Promise<BootstrapFirstAdminResult> => {
    await acquireAccountLifecycleLockTx(tx);
    const existingEmployee = await findEmployeeClaimByEmail(normalizedEmail, tx);
    const accountByEmail = await findAuthAccountByEmail(normalizedEmail, tx);

    if (
      existingEmployee &&
      accountByEmail &&
      accountByEmail.employeeId !== existingEmployee.employeeId
    ) {
      throw new Error("That email is already linked to a different auth account.");
    }

    if (!existingEmployee && accountByEmail) {
      throw new Error(
        "That email is already linked to an auth account without a matching employee profile.",
      );
    }

    const now = new Date();

    if (existingEmployee) {
      const existingAccount = existingEmployee.accountId
        ? await tx.query.authAccounts.findFirst({
            where: eq(authAccounts.id, existingEmployee.accountId),
          })
        : null;
      if (existingAccount) {
        await assertNotRemovingLastSystemAdminTx({
          tx, accountId: existingAccount.id, nextGroupKey: groupKey,
        });
      }
      await tx
        .insert(employeesGeneralInfo)
        .values({
          employeeId: existingEmployee.employeeId,
          confidentialityLevel,
        })
        .onConflictDoUpdate({
          target: [employeesGeneralInfo.employeeId],
          set: {
            confidentialityLevel,
          },
        });

      await tx
        .insert(employeesOtherReferences)
        .values({
          employeeId: existingEmployee.employeeId,
          email: normalizedEmail,
        })
        .onConflictDoUpdate({
          target: [employeesOtherReferences.employeeId],
          set: {
            email: normalizedEmail,
          },
        });

      if (existingAccount) {
        await tx
          .update(authAccounts)
          .set({
            email: normalizedEmail,
            passwordHash,
            mustSetPassword: true,
            lastLoginAt: null,
            updatedAt: now,
          })
          .where(eq(authAccounts.id, existingAccount.id));

        await revokeAccountArtifactsTx(tx, existingAccount.id, now);
        await setAccountGroupsTx(tx, existingAccount.id, [groupKey]);
        await setManagerDepartmentsTx(tx, existingAccount.id, args.departmentIds ?? []);
      } else {
        const [createdAccount] = await tx
          .insert(authAccounts)
          .values({
            employeeId: existingEmployee.employeeId,
            email: normalizedEmail,
            passwordHash,
            status: "Active",
            mustSetPassword: true,
          })
          .returning({ id: authAccounts.id });

        await setAccountGroupsTx(tx, createdAccount.id, [groupKey]);
        await setManagerDepartmentsTx(tx, createdAccount.id, args.departmentIds ?? []);
      }

      // TEMP_DISABLED_NO_DOMAIN:
      // const otpRecord = await createOnboardingOtpRecordTx(tx, accountId);

      return {
        source: "promoted-existing" as const,
        email: normalizedEmail,
        employeeId: existingEmployee.employeeId,
        accountStatus: existingAccount?.status ?? "Active",
        confidentialityLevel,
      };
    }

    const firstName = normalizeRequiredName(args.firstName, "First name");
    const lastName = normalizeRequiredName(args.lastName, "Last name");
    const employeeNo = await generateEmployeeNoTx(tx, ADMIN_EMPLOYEE_TYPE);

    const [employee] = await tx
      .insert(employees)
      .values({
        employeeType: ADMIN_EMPLOYEE_TYPE,
        employeeNo,
        firstName,
        lastName,
      })
      .returning({ id: employees.id });

    await tx.insert(employeesGeneralInfo).values({
      employeeId: employee.id,
      confidentialityLevel,
    });

    await tx.insert(employeesOtherReferences).values({
      employeeId: employee.id,
      email: normalizedEmail,
    });

    const [createdAccount] = await tx
      .insert(authAccounts)
      .values({
        employeeId: employee.id,
        email: normalizedEmail,
        passwordHash,
        status: "Active",
        mustSetPassword: true,
      })
      .returning({ id: authAccounts.id });

    await setAccountGroupsTx(tx, createdAccount.id, [groupKey]);
    await setManagerDepartmentsTx(tx, createdAccount.id, args.departmentIds ?? []);

    // TEMP_DISABLED_NO_DOMAIN:
    // const otpRecord = await createOnboardingOtpRecordTx(tx, createdAccount.id);

    return {
      source: "created-new" as const,
      email: normalizedEmail,
      employeeId: employee.id,
      accountStatus: "Active" as const,
      confidentialityLevel,
    };
  };
  return transaction ? run(transaction) : db.transaction(run);
}

export async function bootstrapFirstAdmin(
  args: BootstrapFirstAdminArgs,
): Promise<BootstrapFirstAdminResult> {
  return db.transaction(async (tx) => {
    await acquireAccountLifecycleLockTx(tx);
    if (await countActiveEffectiveAccountsInGroupsTx(tx, [AUTH_GROUP_KEYS.SYSTEM_ADMIN, AUTH_GROUP_KEYS.HR_ADMIN]) > 0) {
      throw new Error(
        "An active admin already exists. Use /access-management to create later admin accounts.",
      );
    }
    return upsertAdminAccountWithTemporaryPassword(args, tx);
  });
}

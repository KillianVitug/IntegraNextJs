"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { db } from "@/db";
import {
  authAccountPermissionGroups,
  authAccounts,
  authEmailOtps,
  authPermissionGroups,
  authPasswordSetupTokens,
  authSessions,
  authTemporaryPasswordReveals,
  employees,
  employeesGeneralInfo,
} from "@/db/schema";
import {
  createTemporaryPassword,
  encryptSecret,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from "@/lib/auth/crypto";
import { authConfig, getTempPasswordRevealKey } from "@/lib/auth/config";
import type { AuthActionState } from "@/lib/auth/action-state";
import {
  consumePasswordSetupToken,
  createPasswordSetupToken,
  createSession,
  assignDefaultAccountGroupTx,
  findAuthAccountByEmail,
  findEmployeeClaimByEmail,
  getRoleForAccount,
  getRedirectForRole,
  logout,
  requirePermission,
  revokeAccountArtifactsTx,
  setManagerDepartmentsTx,
  setAccountGroupsTx,
} from "@/lib/auth/server";
import { recordAdminAuditEvent } from "@/lib/admin";
import {
  AUTH_GROUP_KEYS,
  AUTH_PERMISSIONS,
  type AuthGroupKey,
  isAuthGroupKey,
} from "@/lib/auth/permissions";
import { upsertAdminAccountWithTemporaryPassword } from "@/lib/auth/bootstrap";

type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

const claimEmployeeAccountSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

const resetAccountPasswordSchema = z
  .object({
    accountId: z.string().uuid(),
    tempPassword: z
      .string()
      .min(5, "Use at least 5 characters for the temporary password."),
    confirmTempPassword: z.string(),
  })
  .refine((values) => values.tempPassword === values.confirmTempPassword, {
    path: ["confirmTempPassword"],
    message: "The temporary passwords do not match.",
  });

type TemporaryPasswordPurpose = "employee_claim" | "admin_reset";

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}

function getTempPasswordRevealExpiresAt(now = new Date()) {
  return addDays(now, authConfig.tempPasswordRevealTtlDays);
}

async function createTemporaryPasswordRevealTx(args: {
  tx: DbExecutor;
  accountId: string;
  purpose: TemporaryPasswordPurpose;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const tempPassword = createTemporaryPassword();
  const passwordHash = await hashPassword(tempPassword);
  const encrypted = encryptSecret(tempPassword, getTempPasswordRevealKey());

  await args.tx
    .update(authTemporaryPasswordReveals)
    .set({ revealedAt: now })
    .where(
      and(
        eq(authTemporaryPasswordReveals.accountId, args.accountId),
        isNull(authTemporaryPasswordReveals.revealedAt),
      ),
    );

  await args.tx.insert(authTemporaryPasswordReveals).values({
    accountId: args.accountId,
    encryptedPassword: encrypted.encryptedValue,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    purpose: args.purpose,
    expiresAt: getTempPasswordRevealExpiresAt(now),
  });

  return passwordHash;
}

const setPasswordSchema = z
  .object({
    email: z.string().trim().email("Enter a valid email address."),
    setupToken: z.string().trim().min(10, "The setup token is invalid."),
    password: z
      .string()
      .min(5, "Use at least 5 characters for the permanent password."),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords do not match.",
  });

const passwordLoginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

const adminAccountSchema = z
  .object({
    email: z.string().trim().email("Enter a valid email address."),
    groupKey: z.enum(["SYSTEM_ADMIN", "HR_ADMIN", "MANAGER"]),
    departmentIds: z.array(z.coerce.number().int().positive()).default([]),
    firstName: z.string().trim(),
    lastName: z.string().trim(),
    tempPassword: z
      .string()
      .min(5, "Use at least 5 characters for the temporary password."),
    confirmTempPassword: z.string(),
  })
  .refine((values) => values.tempPassword === values.confirmTempPassword, {
    path: ["confirmTempPassword"],
    message: "The temporary passwords do not match.",
  });

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

const accountIdSchema = z.object({
  accountId: z.string().uuid(),
});

const accountGroupSchema = z.object({
  accountId: z.string().uuid(),
  groupKey: z.enum(["SYSTEM_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE"]),
  departmentIds: z.array(z.coerce.number().int().positive()).default([]),
});

const accountStatusSchema = z.object({
  accountId: z.string().uuid(),
  status: z.enum(["Active", "Locked", "Disabled"]),
});

function formDataToValues(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

function buildValidationState(error: ZodError): AuthActionState {
  return {
    status: "error",
    message: "Check the highlighted fields and try again.",
    fieldErrors: error.flatten().fieldErrors,
  };
}

function getConfidentialityForAdminGroup(
  groupKey: "SYSTEM_ADMIN" | "HR_ADMIN" | "MANAGER",
) {
  return groupKey === AUTH_GROUP_KEYS.SYSTEM_ADMIN ? "Managerial" : "Supervisory";
}

function formDataWithDepartmentIds(formData: FormData) {
  return {
    ...formDataToValues(formData),
    departmentIds: formData.getAll("departmentIds"),
  };
}

export async function claimEmployeeAccountAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  try {
    const values = claimEmployeeAccountSchema.parse(formDataToValues(formData));
    const normalizedEmail = normalizeEmail(values.email);
    const employee = await findEmployeeClaimByEmail(normalizedEmail);
    const genericClaimMessage =
      "If the email is eligible, the account claim has been submitted. A System Admin can provide the temporary password from Access Management.";

    if (!employee || employee.confidentialityLevel !== "Rank and File") {
      return {
        status: "success",
        message: genericClaimMessage,
      };
    }

    const existingAccount = employee.accountId
      ? await db.query.authAccounts.findFirst({
          where: eq(authAccounts.id, employee.accountId),
        })
      : null;

    if (existingAccount) {
      const existingRole = await getRoleForAccount(existingAccount.id);
      const shouldRegenerateTemporaryPassword =
        existingRole === "EMPLOYEE" &&
        existingAccount.status === "Active" &&
        existingAccount.mustSetPassword;

      if (!shouldRegenerateTemporaryPassword) {
        return {
          status: "success",
          message: genericClaimMessage,
        };
      }
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      if (existingAccount) {
        const passwordHash = await createTemporaryPasswordRevealTx({
          tx,
          accountId: existingAccount.id,
          purpose: "employee_claim",
          now,
        });

        await tx
          .update(authAccounts)
          .set({
            email: normalizedEmail,
            passwordHash,
            status: "Active",
            mustSetPassword: true,
            lastLoginAt: null,
            updatedAt: now,
          })
          .where(eq(authAccounts.id, existingAccount.id));

        await revokeAccountArtifactsTx(tx, existingAccount.id, now);
        await assignDefaultAccountGroupTx(
          tx,
          existingAccount.id,
          employee.confidentialityLevel,
        );

        await recordAdminAuditEvent({
          actorUserId: existingAccount.id,
          entityType: "auth_account",
          entityId: existingAccount.id,
          action: "employee_account_claim_temp_password_generated",
          details: {
            email: normalizedEmail,
            source: "claim_existing_pending",
          },
          database: tx,
        });

        return;
      }

      const [createdAccount] = await tx
        .insert(authAccounts)
        .values({
          employeeId: employee.employeeId,
          email: normalizedEmail,
          status: "Active",
          mustSetPassword: true,
        })
        .returning({ id: authAccounts.id });

      const passwordHash = await createTemporaryPasswordRevealTx({
        tx,
        accountId: createdAccount.id,
        purpose: "employee_claim",
        now,
      });

      await tx
        .update(authAccounts)
        .set({
          passwordHash,
          updatedAt: now,
        })
        .where(eq(authAccounts.id, createdAccount.id));

      await assignDefaultAccountGroupTx(
        tx,
        createdAccount.id,
        employee.confidentialityLevel,
      );

      await recordAdminAuditEvent({
        actorUserId: createdAccount.id,
        entityType: "auth_account",
        entityId: createdAccount.id,
        action: "employee_account_claim_created",
        details: {
          email: normalizedEmail,
          source: "claim_new",
        },
        database: tx,
      });
    });

    return {
      status: "success",
      message: genericClaimMessage,
    };
  } catch (error) {
    if (error instanceof ZodError) {
      return buildValidationState(error);
    }

    console.error(error);
    return {
      status: "error",
      message: "We could not submit the account claim right now.",
    };
  }
}

export const registerEmployeeAction = claimEmployeeAccountAction;

export async function setPasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  try {
    const values = setPasswordSchema.parse(formDataToValues(formData));
    const tokenResult = await consumePasswordSetupToken(
      values.email,
      values.setupToken,
    );

    if (!tokenResult.account || tokenResult.error) {
      return {
        status: "error",
        message:
          tokenResult.error ?? "The password setup link is invalid or expired.",
      };
    }

    const passwordHash = await hashPassword(values.password);
    const role = await getRoleForAccount(tokenResult.account.id);

    if (!role) {
      return {
        status: "error",
        message: "This account is not linked to a valid application role.",
      };
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(authAccounts)
        .set({
          passwordHash,
          status: "Active",
          mustSetPassword: false,
          lastLoginAt: now,
          updatedAt: now,
        })
        .where(eq(authAccounts.id, tokenResult.account!.id));

      await tx
        .delete(authEmailOtps)
        .where(eq(authEmailOtps.accountId, tokenResult.account!.id));
      await tx
        .delete(authPasswordSetupTokens)
        .where(eq(authPasswordSetupTokens.accountId, tokenResult.account!.id));
      await tx
        .update(authTemporaryPasswordReveals)
        .set({ revealedAt: now })
        .where(
          and(
            eq(authTemporaryPasswordReveals.accountId, tokenResult.account!.id),
            isNull(authTemporaryPasswordReveals.revealedAt),
          ),
        );
    });

    await createSession(tokenResult.account.id);
    redirect(getRedirectForRole(role));
  } catch (error) {
    unstable_rethrow(error);

    if (error instanceof ZodError) {
      return buildValidationState(error);
    }

    console.error(error);
    return {
      status: "error",
      message: "We could not finish password setup right now.",
    };
  }
}

export async function passwordLoginAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  try {
    const values = passwordLoginSchema.parse(formDataToValues(formData));
    const account = await findAuthAccountByEmail(values.email);

    if (
      !account ||
      account.status !== "Active" ||
      !account.passwordHash
    ) {
      return {
        status: "error",
        message: "Invalid email or password.",
      };
    }

    const isValidPassword = await verifyPassword(
      values.password,
      account.passwordHash,
    );

    if (!isValidPassword) {
      return {
        status: "error",
        message: "Invalid email or password.",
      };
    }

    const role = await getRoleForAccount(account.id);
    if (!role) {
      return {
        status: "error",
        message: "This account is not linked to a valid application role.",
      };
    }

    if (account.mustSetPassword) {
      const setupToken = await createPasswordSetupToken(account.id);

      return {
        status: "success",
        message:
          "Temporary password accepted. Set your permanent password to continue.",
        passwordSetup: {
          email: account.email,
          token: setupToken,
        },
      };
    }

    await db
      .update(authAccounts)
      .set({
        lastLoginAt: new Date(),
      })
      .where(eq(authAccounts.id, account.id));

    await createSession(account.id);
    redirect(getRedirectForRole(role));
  } catch (error) {
    unstable_rethrow(error);

    if (error instanceof ZodError) {
      return buildValidationState(error);
    }

    console.error(error);
    return {
      status: "error",
      message: "We could not sign you in right now.",
    };
  }
}

export async function createAdminAccountAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  try {
    const actor = await requirePermission(AUTH_PERMISSIONS.ACCESS_MANAGE);
    const values = adminAccountSchema.parse(formDataWithDepartmentIds(formData));
    if (
      values.groupKey === AUTH_GROUP_KEYS.MANAGER &&
      values.departmentIds.length === 0
    ) {
      return {
        status: "error",
        message: "Select at least one department for a Manager account.",
        fieldErrors: {
          departmentIds: ["Select at least one department for a Manager account."],
        },
      };
    }
    const confidentialityLevel = getConfidentialityForAdminGroup(values.groupKey);

    const result = await upsertAdminAccountWithTemporaryPassword({
      email: values.email,
      level: confidentialityLevel,
      firstName: values.firstName || undefined,
      lastName: values.lastName || undefined,
      tempPassword: values.tempPassword,
    });

    const account = await findAuthAccountByEmail(result.email);
    if (!account) {
      throw new Error("Created account could not be loaded.");
    }

    await db.transaction(async (tx) => {
      await setAccountGroupsTx(tx, account.id, [values.groupKey]);
      await setManagerDepartmentsTx(
        tx,
        account.id,
        values.groupKey === AUTH_GROUP_KEYS.MANAGER ? values.departmentIds : [],
      );
    });

    await recordAdminAuditEvent({
      actorUserId: actor.accountId,
      entityType: "auth_account",
      entityId: result.employeeId,
      action: "admin_account_upsert",
      details: {
        email: result.email,
        source: result.source,
        groupKey: values.groupKey,
        confidentialityLevel,
        managerDepartmentIds:
          values.groupKey === AUTH_GROUP_KEYS.MANAGER ? values.departmentIds : [],
      },
    });

    revalidatePath("/access-management");

    return {
      status: "success",
      message:
        result.source === "created-new"
          ? "Access account created. Share the temporary password securely."
          : "Access account updated. Share the temporary password securely.",
    };
  } catch (error) {
    if (error instanceof ZodError) {
      return buildValidationState(error);
    }

    if (error instanceof Error) {
      return {
        status: "error",
        message: error.message,
      };
    }

    console.error(error);
    return {
      status: "error",
      message: "We could not create the admin account right now.",
    };
  }
}

async function getAccountGroupKeys(accountId: string, database: DbExecutor = db) {
  const rows = await database
    .select({
      key: authPermissionGroups.key,
    })
    .from(authAccountPermissionGroups)
    .innerJoin(
      authPermissionGroups,
      eq(authAccountPermissionGroups.groupId, authPermissionGroups.id),
    )
    .where(eq(authAccountPermissionGroups.accountId, accountId));

  return rows
    .map((row: { key: string }) => row.key)
    .filter(isAuthGroupKey);
}

async function getAccountStatus(accountId: string, database: DbExecutor = db) {
  const [account] = await database
    .select({
      status: authAccounts.status,
    })
    .from(authAccounts)
    .where(eq(authAccounts.id, accountId))
    .limit(1);

  if (!account) {
    throw new Error("Account not found.");
  }

  return account.status as "PendingSetup" | "Active" | "Locked" | "Disabled";
}

async function countActiveSystemAdmins(database: DbExecutor = db) {
  const [record] = await database
    .select({
      count: sql<number>`count(distinct ${authAccounts.id})::int`,
    })
    .from(authAccounts)
    .innerJoin(employees, eq(authAccounts.employeeId, employees.id))
    .innerJoin(
      authAccountPermissionGroups,
      eq(authAccountPermissionGroups.accountId, authAccounts.id),
    )
    .innerJoin(
      authPermissionGroups,
      eq(authAccountPermissionGroups.groupId, authPermissionGroups.id),
    )
    .where(
      and(
        eq(authAccounts.status, "Active"),
        isNull(employees.deletedAt),
        eq(authPermissionGroups.key, AUTH_GROUP_KEYS.SYSTEM_ADMIN),
      ),
    );

  return Number(record?.count ?? 0);
}

async function assertNotRemovingLastSystemAdmin(args: {
  accountId: string;
  database: DbExecutor;
  nextGroupKey?: AuthGroupKey;
  nextStatus?: "Active" | "Locked" | "Disabled";
}) {
  const [currentStatus, currentGroupKeys, activeSystemAdminCount] =
    await Promise.all([
      getAccountStatus(args.accountId, args.database),
      getAccountGroupKeys(args.accountId, args.database),
      countActiveSystemAdmins(args.database),
    ]);

  const isActiveSystemAdmin =
    currentStatus === "Active" &&
    currentGroupKeys.includes(AUTH_GROUP_KEYS.SYSTEM_ADMIN);
  const removesSystemAdminGroup =
    args.nextGroupKey != null &&
    args.nextGroupKey !== AUTH_GROUP_KEYS.SYSTEM_ADMIN;
  const removesActiveStatus =
    args.nextStatus != null && args.nextStatus !== "Active";

  if (
    isActiveSystemAdmin &&
    activeSystemAdminCount <= 1 &&
    (removesSystemAdminGroup || removesActiveStatus)
  ) {
    throw new Error("At least one active System Admin account is required.");
  }
}

export async function updateAccountGroupAction(formData: FormData) {
  const actor = await requirePermission(AUTH_PERMISSIONS.ACCESS_MANAGE);
  const values = accountGroupSchema.parse(formDataWithDepartmentIds(formData));
  if (
    values.groupKey === AUTH_GROUP_KEYS.MANAGER &&
    values.departmentIds.length === 0
  ) {
    throw new Error("Select at least one department for a Manager account.");
  }
  const groupKey = values.groupKey as AuthGroupKey;
  const confidentialityLevel =
    groupKey === AUTH_GROUP_KEYS.SYSTEM_ADMIN
      ? "Managerial"
      : groupKey === AUTH_GROUP_KEYS.HR_ADMIN
        ? "Supervisory"
        : groupKey === AUTH_GROUP_KEYS.MANAGER
          ? "Supervisory"
          : "Rank and File";

  await db.transaction(async (tx) => {
    await assertNotRemovingLastSystemAdmin({
      accountId: values.accountId,
      database: tx,
      nextGroupKey: groupKey,
    });

    const previousGroups = await getAccountGroupKeys(values.accountId, tx);
    await setAccountGroupsTx(tx, values.accountId, [groupKey]);
    await setManagerDepartmentsTx(
      tx,
      values.accountId,
      groupKey === AUTH_GROUP_KEYS.MANAGER ? values.departmentIds : [],
    );

    const [account] = await tx
      .select({
        employeeId: authAccounts.employeeId,
      })
      .from(authAccounts)
      .where(eq(authAccounts.id, values.accountId))
      .limit(1);

    if (!account) {
      throw new Error("Account not found.");
    }

    await tx
      .insert(employeesGeneralInfo)
      .values({
        employeeId: account.employeeId,
        confidentialityLevel,
      })
      .onConflictDoUpdate({
        target: [employeesGeneralInfo.employeeId],
        set: {
          confidentialityLevel,
        },
      });

    await recordAdminAuditEvent({
      actorUserId: actor.accountId,
      entityType: "auth_account",
      entityId: values.accountId,
      action: "account_group_update",
      details: {
        previousGroups,
        nextGroups: [groupKey],
        confidentialityLevel,
        managerDepartmentIds:
          groupKey === AUTH_GROUP_KEYS.MANAGER ? values.departmentIds : [],
      },
      database: tx,
    });
  });

  revalidatePath("/access-management");
}

export async function updateAccountStatusAction(formData: FormData) {
  const actor = await requirePermission(AUTH_PERMISSIONS.ACCESS_MANAGE);
  const values = accountStatusSchema.parse(formDataToValues(formData));
  const now = new Date();

  await db.transaction(async (tx) => {
    await assertNotRemovingLastSystemAdmin({
      accountId: values.accountId,
      database: tx,
      nextStatus: values.status,
    });

    const previousStatus = await getAccountStatus(values.accountId, tx);

    await tx
      .update(authAccounts)
      .set({
        status: values.status,
        updatedAt: now,
      })
      .where(eq(authAccounts.id, values.accountId));

    if (values.status !== "Active") {
      await revokeAccountArtifactsTx(tx, values.accountId, now);
    }

    await recordAdminAuditEvent({
      actorUserId: actor.accountId,
      entityType: "auth_account",
      entityId: values.accountId,
      action: "account_status_update",
      details: {
        previousStatus,
        nextStatus: values.status,
      },
      database: tx,
    });
  });

  revalidatePath("/access-management");
}

export async function resetAccountPasswordAction(formData: FormData) {
  const actor = await requirePermission(AUTH_PERMISSIONS.ACCESS_MANAGE);
  const values = resetAccountPasswordSchema.parse(formDataToValues(formData));
  const passwordHash = await hashPassword(values.tempPassword);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(authAccounts)
      .set({
        passwordHash,
        status: "Active",
        mustSetPassword: true,
        lastLoginAt: null,
        updatedAt: now,
      })
      .where(eq(authAccounts.id, values.accountId));

    await revokeAccountArtifactsTx(tx, values.accountId, now);

    await recordAdminAuditEvent({
      actorUserId: actor.accountId,
      entityType: "auth_account",
      entityId: values.accountId,
      action: "account_password_reset",
      details: {
        method: "temporary_password",
      },
      database: tx,
    });
  });

  revalidatePath("/access-management");
}

export async function revokeAccountSessionsAction(formData: FormData) {
  const actor = await requirePermission(AUTH_PERMISSIONS.ACCESS_MANAGE);
  const values = accountIdSchema.parse(formDataToValues(formData));
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(authSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(authSessions.accountId, values.accountId),
          isNull(authSessions.revokedAt),
        ),
      );

    await recordAdminAuditEvent({
      actorUserId: actor.accountId,
      entityType: "auth_account",
      entityId: values.accountId,
      action: "account_sessions_revoked",
      details: {
        revokedAt: now.toISOString(),
      },
      database: tx,
    });
  });

  revalidatePath("/access-management");
}

export async function forgotPasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  try {
    const values = forgotPasswordSchema.parse(formDataToValues(formData));
    const account = await findAuthAccountByEmail(values.email);

    if (account?.status === "Active") {
      await createPasswordSetupToken(account.id);
    }

    return {
      status: "success",
      message:
        "If the email is linked to an active account, a password reset can be completed by a System Admin while email delivery is unavailable.",
    };
  } catch (error) {
    if (error instanceof ZodError) {
      return buildValidationState(error);
    }

    console.error(error);
    return {
      status: "error",
      message: "We could not start password reset right now.",
    };
  }
}

export async function logoutAction() {
  await logout();
  redirect("/");
}

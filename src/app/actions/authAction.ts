"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z, ZodError } from "zod";
import { db } from "@/db";
import {
  authAccounts,
  authSessions,
  authTemporaryPasswordReveals,
  employeesGeneralInfo,
} from "@/db/schema";
import {
  createTemporaryPassword,
  encryptSecret,
  hashPassword,
  normalizeEmail,
} from "@/lib/auth/crypto";
import { authConfig, getTempPasswordRevealKey } from "@/lib/auth/config";
import type { AuthActionState } from "@/lib/auth/action-state";
import {
  consumePasswordSetupToken,
  createPasswordSetupToken,
  createSessionTx,
  setCreatedSessionCookie,
  signInWithPassword,
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
} from "@/lib/auth/permissions";
import { upsertAdminAccountWithTemporaryPassword } from "@/lib/auth/bootstrap";
import {
  acquireAccountLifecycleLockTx,
  assertAccountAccessManagerTx,
  assertNotRemovingLastSystemAdminTx,
  getAccountAccessStateTx,
} from "@/lib/auth/lifecycle";

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
    const genericClaimMessage =
      "If the email is eligible, the account claim has been submitted. A System Admin can provide the temporary password from Access Management.";

    await db.transaction(async (tx) => {
      await acquireAccountLifecycleLockTx(tx);
      const employee = await findEmployeeClaimByEmail(normalizedEmail, tx);
      if (!employee || employee.confidentialityLevel !== "Rank and File") return;
      const existingAccount = employee.accountId
        ? await tx.query.authAccounts.findFirst({ where: eq(authAccounts.id, employee.accountId) })
        : null;
      if (existingAccount) {
        const role = await getRoleForAccount(existingAccount.id, tx);
        if (role !== "EMPLOYEE" || existingAccount.status !== "Active"
          || !existingAccount.mustSetPassword) return;
      }
      const now = new Date();
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
    const passwordHash = await hashPassword(values.password);
    const result = await db.transaction(async (tx) => {
      const tokenResult = await consumePasswordSetupToken(values.email, values.setupToken, tx);
      if (!tokenResult.account || tokenResult.error) return null;
      const accountId = tokenResult.account.id;
      const role = await getRoleForAccount(accountId, tx);
      if (!role) throw new Error("This account is not linked to a valid application role.");
      const now = new Date();
      await tx
        .update(authAccounts)
        .set({
          passwordHash,
          status: "Active",
          mustSetPassword: false,
          lastLoginAt: now,
          updatedAt: now,
        })
        .where(eq(authAccounts.id, accountId));

      await revokeAccountArtifactsTx(tx, accountId, now);
      await tx
        .update(authTemporaryPasswordReveals)
        .set({ revealedAt: now })
        .where(
          and(
            eq(authTemporaryPasswordReveals.accountId, accountId),
            isNull(authTemporaryPasswordReveals.revealedAt),
          ),
        );
      const session = await createSessionTx(tx, accountId, passwordHash);
      return { role, session };
    });

    if (!result) return {
      status: "error",
      message: "The password setup link is invalid or expired.",
    };
    await setCreatedSessionCookie(result.session);
    redirect(getRedirectForRole(result.role));
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
    const result = await signInWithPassword(values.email, values.password);
    if (!result) {
      return {
        status: "error",
        message: "Invalid email or password.",
      };
    }

    if (result.setupToken) {
      return {
        status: "success",
        message:
          "Temporary password accepted. Set your permanent password to continue.",
        passwordSetup: {
          email: result.email,
          token: result.setupToken,
        },
      };
    }

    redirect(getRedirectForRole(result.role));
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

    const result = await db.transaction(async (tx) => {
      await acquireAccountLifecycleLockTx(tx);
      await assertAccountAccessManagerTx(tx, actor);
      const result = await upsertAdminAccountWithTemporaryPassword({
        email: values.email,
        level: confidentialityLevel,
        firstName: values.firstName || undefined,
        lastName: values.lastName || undefined,
        tempPassword: values.tempPassword,
        groupKey: values.groupKey,
        departmentIds: values.groupKey === AUTH_GROUP_KEYS.MANAGER ? values.departmentIds : [],
      }, tx);
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
          accountStatus: result.accountStatus,
          managerDepartmentIds:
            values.groupKey === AUTH_GROUP_KEYS.MANAGER ? values.departmentIds : [],
        },
        database: tx,
      });
      return result;
    });

    revalidatePath("/access-management");

    return {
      status: "success",
      message:
        result.source === "created-new"
          ? "Access account created. Share the temporary password securely."
          : result.accountStatus === "Active"
            ? "Access account updated. Share the temporary password securely."
            : `Access account updated. Its ${result.accountStatus} status is unchanged; activate it separately when appropriate.`,
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
    await acquireAccountLifecycleLockTx(tx);
    await assertAccountAccessManagerTx(tx, actor);
    await assertNotRemovingLastSystemAdminTx({
      accountId: values.accountId,
      tx,
      nextGroupKey: groupKey,
    });

    const previousGroups = (await getAccountAccessStateTx(tx, values.accountId)).groupKeys;
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
    await acquireAccountLifecycleLockTx(tx);
    await assertAccountAccessManagerTx(tx, actor);
    await assertNotRemovingLastSystemAdminTx({
      accountId: values.accountId,
      tx,
      nextStatus: values.status,
    });

    const current = await getAccountAccessStateTx(tx, values.accountId);
    if (values.status === "Active" && current.employeeDeletedAt) {
      throw new Error("An archived employee account cannot be activated.");
    }
    const previousStatus = current.account.status;

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
    await acquireAccountLifecycleLockTx(tx);
    await assertAccountAccessManagerTx(tx, actor);
    const current = await getAccountAccessStateTx(tx, values.accountId);
    await tx
      .update(authAccounts)
      .set({
        passwordHash,
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
        accountStatus: current.account.status,
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
    await acquireAccountLifecycleLockTx(tx);
    await assertAccountAccessManagerTx(tx, actor);
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

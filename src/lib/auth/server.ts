import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import {
  authAccountPermissionGroups,
  authAccounts,
  authAdminInvites,
  authEmailOtps,
  authManagerDepartments,
  authPermissionGroups,
  authPasswordSetupTokens,
  authSessions,
  department,
  employees,
  employeesGeneralInfo,
  employeesOtherReferences,
} from "@/db/schema";
import { authConfig } from "@/lib/auth/config";
import {
  createInviteCode,
  createOpaqueToken,
  hashValue,
  normalizeEmail,
  normalizeOptionalEmail,
} from "@/lib/auth/crypto";
import { sendAdminInviteEmail } from "@/lib/auth/mailer";
import { issueOnboardingOtp } from "@/lib/auth/onboarding";
import { getAppRoleFromConfidentialityLevel, type AppRole } from "@/utils/getEmployeeLevel";
import {
  AUTH_GROUP_KEYS,
  AUTH_GROUPS,
  type AuthGroupKey,
  type AuthPermission,
  getAppRoleForGroups,
  getDefaultGroupForConfidentialityLevel,
  getPermissionsForGroups,
  isAuthGroupKey,
} from "@/lib/auth/permissions";
export {
  assignDefaultAccountGroupTx,
  ensureDefaultPermissionGroupsTx,
  setManagerDepartmentsTx,
  setAccountGroupsTx,
} from "@/lib/auth/group-sync";

type ConfidentialityLevel = "Rank and File" | "Supervisory" | "Managerial" | null;

export type AuthContext = {
  sessionId: string;
  accountId: string;
  employeeId: string;
  email: string;
  status: "PendingSetup" | "Active" | "Locked" | "Disabled";
  mustSetPassword: boolean;
  role: AppRole;
  groupKeys: AuthGroupKey[];
  permissions: AuthPermission[];
  confidentialityLevel: ConfidentialityLevel;
  employeeFirstName: string;
  employeeLastName: string;
  employeeDeletedAt: Date | null;
};

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}

function getRedirectForRole(role: AppRole) {
  if (role === "ADMIN") return "/home";
  if (role === "MANAGER") return "/managerHome";
  if (role === "EMPLOYEE") return "/employeeHome";
  return "/";
}

async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();

  cookieStore.set(authConfig.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: authConfig.secureCookies,
    path: "/",
    expires: expiresAt,
  });
}

async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(authConfig.sessionCookieName);
}

function formatInviteEmailResult(emailFailed: boolean) {
  return emailFailed
    ? "Invite created, but the email could not be delivered. Copy the code manually."
    : "Invite created and emailed.";
}

async function listAssignedGroupKeys(accountId: string) {
  const rows = await db
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
    .map((row) => row.key)
    .filter(isAuthGroupKey);
}

function withFallbackGroup(
  groupKeys: AuthGroupKey[],
  confidentialityLevel: ConfidentialityLevel,
) {
  if (groupKeys.length > 0) {
    return groupKeys;
  }

  const fallbackGroup = getDefaultGroupForConfidentialityLevel(confidentialityLevel);
  return fallbackGroup ? [fallbackGroup] : [];
}

export function hasPermission(
  auth: Pick<AuthContext, "permissions" | "groupKeys">,
  permission: AuthPermission,
) {
  return (
    auth.groupKeys.includes(AUTH_GROUP_KEYS.SYSTEM_ADMIN) ||
    auth.permissions.includes(permission)
  );
}

export const getCurrentAuthContext = cache(async (): Promise<AuthContext | null> => {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(authConfig.sessionCookieName)?.value;

  if (!sessionToken) {
    return null;
  }

  const now = new Date();
  const sessionTokenHash = hashValue(sessionToken);
  const [record] = await db
    .select({
      sessionId: authSessions.id,
      accountId: authAccounts.id,
      employeeId: authAccounts.employeeId,
      email: authAccounts.email,
      status: authAccounts.status,
      mustSetPassword: authAccounts.mustSetPassword,
      confidentialityLevel: employeesGeneralInfo.confidentialityLevel,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
      employeeDeletedAt: employees.deletedAt,
    })
    .from(authSessions)
    .innerJoin(authAccounts, eq(authSessions.accountId, authAccounts.id))
    .innerJoin(employees, eq(authAccounts.employeeId, employees.id))
    .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
    .where(
      and(
        eq(authSessions.sessionTokenHash, sessionTokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (!record) {
    return null;
  }

  const assignedGroupKeys = await listAssignedGroupKeys(record.accountId);
  const groupKeys = withFallbackGroup(
    assignedGroupKeys,
    record.confidentialityLevel,
  );
  const role =
    getAppRoleForGroups(groupKeys) ??
    getAppRoleFromConfidentialityLevel(record.confidentialityLevel);
  const permissions = getPermissionsForGroups(groupKeys);

  if (record.status !== "Active" || record.employeeDeletedAt || !role) {
    return null;
  }

  return {
    ...record,
    groupKeys,
    permissions,
    role,
  };
});

export async function requireAuthenticatedUser(options?: { redirectTo?: string }) {
  const auth = await getCurrentAuthContext();

  if (!auth) {
    if (options?.redirectTo) {
      redirect(options.redirectTo);
    }

    throw new Error("Unauthorized.");
  }

  return auth;
}

export async function requireAdmin(options?: { redirectTo?: string }) {
  const auth = await requireAuthenticatedUser(options);

  if (auth.role !== "ADMIN") {
    if (options?.redirectTo) {
      redirect(getRedirectForRole(auth.role));
    }

    throw new Error("Forbidden.");
  }

  return auth;
}

export async function requireGroup(
  groupKey: AuthGroupKey,
  options?: { redirectTo?: string },
) {
  const auth = await requireAuthenticatedUser(options);

  if (!auth.groupKeys.includes(groupKey)) {
    if (options?.redirectTo) {
      redirect(getRedirectForRole(auth.role));
    }

    throw new Error("Forbidden.");
  }

  return auth;
}

export async function requirePermission(
  permission: AuthPermission,
  options?: { redirectTo?: string },
) {
  const auth = await requireAuthenticatedUser(options);

  if (!hasPermission(auth, permission)) {
    if (options?.redirectTo) {
      redirect(getRedirectForRole(auth.role));
    }

    throw new Error("Forbidden.");
  }

  return auth;
}

export async function requireEmployee(options?: { redirectTo?: string }) {
  const auth = await requireAuthenticatedUser(options);

  if (auth.role !== "EMPLOYEE") {
    if (options?.redirectTo) {
      redirect(getRedirectForRole(auth.role));
    }

    throw new Error("Forbidden.");
  }

  return auth;
}

export async function requireManager(options?: { redirectTo?: string }) {
  const auth = await requireAuthenticatedUser(options);

  if (auth.role !== "MANAGER") {
    if (options?.redirectTo) {
      redirect(getRedirectForRole(auth.role));
    }

    throw new Error("Forbidden.");
  }

  return auth;
}

export async function getManagerDepartmentIds(
  accountId: string,
  database: Pick<typeof db, "select"> = db,
) {
  const rows = await database
    .select({
      departmentId: authManagerDepartments.departmentId,
    })
    .from(authManagerDepartments)
    .where(eq(authManagerDepartments.accountId, accountId));

  return rows.map((row) => row.departmentId);
}

export async function assertManagerCanAccessEmployee(args: {
  accountId: string;
  employeeId: string;
  database?: Pick<typeof db, "select">;
}) {
  const database = args.database ?? db;
  const managerDepartmentIds = await getManagerDepartmentIds(
    args.accountId,
    database,
  );

  if (managerDepartmentIds.length === 0) {
    throw new Error("Manager account is not assigned to a department.");
  }

  const [row] = await database
    .select({
      employeeId: employees.id,
    })
    .from(employees)
    .innerJoin(
      employeesGeneralInfo,
      eq(employees.id, employeesGeneralInfo.employeeId),
    )
    .where(
      and(
        eq(employees.id, args.employeeId),
        isNull(employees.deletedAt),
        isNull(employeesGeneralInfo.deletedAt),
        inArray(employeesGeneralInfo.departmentId, managerDepartmentIds),
      ),
    )
    .limit(1);

  if (!row) {
    throw new Error("Employee is not assigned to one of this manager's departments.");
  }

  return true;
}

export async function createSession(accountId: string) {
  const now = new Date();
  const expiresAt = addDays(now, authConfig.sessionTtlDays);
  const rawToken = createOpaqueToken(32);
  const sessionTokenHash = hashValue(rawToken);
  const headerStore = await headers();

  await db.insert(authSessions).values({
    accountId,
    sessionTokenHash,
    expiresAt,
    lastSeenAt: now,
    ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerStore.get("user-agent"),
  });

  await setSessionCookie(rawToken, expiresAt);
}

export async function logout() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(authConfig.sessionCookieName)?.value;

  if (sessionToken) {
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authSessions.sessionTokenHash, hashValue(sessionToken)),
          isNull(authSessions.revokedAt),
        ),
      );
  }

  await clearSessionCookie();
}

export async function revokeAccountArtifactsTx(
  tx: DbClient,
  accountId: string,
  now = new Date(),
) {
  await tx
    .update(authSessions)
    .set({ revokedAt: now })
    .where(and(eq(authSessions.accountId, accountId), isNull(authSessions.revokedAt)));
  await tx.delete(authEmailOtps).where(eq(authEmailOtps.accountId, accountId));
  await tx
    .delete(authPasswordSetupTokens)
    .where(eq(authPasswordSetupTokens.accountId, accountId));
}

export async function getRoleForAccount(accountId: string): Promise<AppRole> {
  const [record] = await db
    .select({
      confidentialityLevel: employeesGeneralInfo.confidentialityLevel,
      employeeDeletedAt: employees.deletedAt,
    })
    .from(authAccounts)
    .innerJoin(employees, eq(authAccounts.employeeId, employees.id))
    .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
    .where(eq(authAccounts.id, accountId))
    .limit(1);

  if (!record || record.employeeDeletedAt) {
    return null;
  }

  const groupKeys = withFallbackGroup(
    await listAssignedGroupKeys(accountId),
    record.confidentialityLevel,
  );

  return (
    getAppRoleForGroups(groupKeys) ??
    getAppRoleFromConfidentialityLevel(record.confidentialityLevel)
  );
}

export async function syncLinkedAccountEmailTx(
  tx: DbClient,
  employeeId: string,
  email: string | null,
) {
  const account = await tx.query.authAccounts.findFirst({
    where: eq(authAccounts.employeeId, employeeId),
    columns: {
      id: true,
      email: true,
    },
  });

  if (!account) {
    return;
  }

  const normalizedEmail = normalizeOptionalEmail(email);
  if (!normalizedEmail) {
    throw new Error("A linked login account must keep an email address.");
  }

  if (account.email === normalizedEmail) {
    return;
  }

  const now = new Date();
  await tx
    .update(authAccounts)
    .set({
      email: normalizedEmail,
      updatedAt: now,
    })
    .where(eq(authAccounts.id, account.id));

  await revokeAccountArtifactsTx(tx, account.id, now);
}

export async function disableLinkedAccountTx(tx: DbClient, employeeId: string) {
  const account = await tx.query.authAccounts.findFirst({
    where: eq(authAccounts.employeeId, employeeId),
    columns: {
      id: true,
    },
  });

  if (!account) {
    return;
  }

  const now = new Date();

  await tx
    .update(authAccounts)
    .set({
      status: "Disabled",
      updatedAt: now,
    })
    .where(eq(authAccounts.id, account.id));

  await revokeAccountArtifactsTx(tx, account.id, now);
}

export async function findAuthAccountByEmail(email: string) {
  return db.query.authAccounts.findFirst({
    where: eq(authAccounts.email, normalizeEmail(email)),
  });
}

export async function findEmployeeClaimByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);

  const [record] = await db
    .select({
      employeeId: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      confidentialityLevel: employeesGeneralInfo.confidentialityLevel,
      email: employeesOtherReferences.email,
      deletedAt: employees.deletedAt,
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

export async function verifyOnboardingOtp(email: string, otp: string) {
  const account = await findAuthAccountByEmail(email);
  if (!account) {
    return { account: null, error: "The code is invalid or expired." };
  }

  const now = new Date();
  const otpRecord = await db.query.authEmailOtps.findFirst({
    where: and(
      eq(authEmailOtps.accountId, account.id),
      eq(authEmailOtps.purpose, "Onboarding"),
      isNull(authEmailOtps.consumedAt),
    ),
    orderBy: [desc(authEmailOtps.createdAt)],
  });

  if (!otpRecord || otpRecord.expiresAt <= now) {
    return { account: null, error: "The code is invalid or expired." };
  }

  if (otpRecord.attemptCount >= otpRecord.maxAttempts) {
    return { account: null, error: "This code has expired. Request a new one." };
  }

  if (otpRecord.otpHash !== hashValue(otp)) {
    const nextAttempts = otpRecord.attemptCount + 1;
    await db
      .update(authEmailOtps)
      .set({
        attemptCount: nextAttempts,
        consumedAt: nextAttempts >= otpRecord.maxAttempts ? now : otpRecord.consumedAt,
      })
      .where(eq(authEmailOtps.id, otpRecord.id));

    return { account: null, error: "The code is invalid or expired." };
  }

  await db
    .update(authEmailOtps)
    .set({ consumedAt: now })
    .where(eq(authEmailOtps.id, otpRecord.id));

  return { account, error: null };
}

export async function createPasswordSetupToken(accountId: string) {
  const rawToken = createOpaqueToken(24);
  const now = new Date();
  const expiresAt = addMinutes(now, authConfig.setupTtlMinutes);

  await db.transaction(async (tx) => {
    await tx
      .delete(authPasswordSetupTokens)
      .where(eq(authPasswordSetupTokens.accountId, accountId));

    await tx.insert(authPasswordSetupTokens).values({
      accountId,
      tokenHash: hashValue(rawToken),
      expiresAt,
    });
  });

  return rawToken;
}

export async function consumePasswordSetupToken(
  email: string,
  rawToken: string,
) {
  const account = await findAuthAccountByEmail(email);
  if (!account) {
    return { account: null, error: "The password setup link is invalid or expired." };
  }

  const now = new Date();
  const tokenRecord = await db.query.authPasswordSetupTokens.findFirst({
    where: and(
      eq(authPasswordSetupTokens.accountId, account.id),
      eq(authPasswordSetupTokens.tokenHash, hashValue(rawToken)),
      isNull(authPasswordSetupTokens.usedAt),
      gt(authPasswordSetupTokens.expiresAt, now),
    ),
    orderBy: [desc(authPasswordSetupTokens.createdAt)],
  });

  if (!tokenRecord) {
    return { account: null, error: "The password setup link is invalid or expired." };
  }

  await db
    .update(authPasswordSetupTokens)
    .set({ usedAt: now })
    .where(eq(authPasswordSetupTokens.id, tokenRecord.id));

  return { account, error: null };
}

export async function createAdminInvite(args: {
  email: string;
  confidentialityLevel: "Supervisory" | "Managerial";
  invitedByAccountId: string;
}) {
  const normalizedEmail = normalizeEmail(args.email);
  const inviteCode = createInviteCode();
  const now = new Date();
  const expiresAt = addDays(now, 7);

  await db.transaction(async (tx) => {
    await tx
      .update(authAdminInvites)
      .set({ expiresAt: now })
      .where(
        and(
          eq(authAdminInvites.email, normalizedEmail),
          isNull(authAdminInvites.usedAt),
          gt(authAdminInvites.expiresAt, now),
        ),
      );

    await tx.insert(authAdminInvites).values({
      email: normalizedEmail,
      inviteTokenHash: hashValue(inviteCode),
      confidentialityLevel: args.confidentialityLevel,
      invitedByAccountId: args.invitedByAccountId,
      expiresAt,
    });
  });

  let emailFailed = false;
  try {
    await sendAdminInviteEmail({
      email: normalizedEmail,
      inviteCode,
      confidentialityLevel: args.confidentialityLevel,
    });
  } catch {
    emailFailed = true;
  }

  return {
    inviteCode,
    message: formatInviteEmailResult(emailFailed),
  };
}

export async function findValidAdminInvite(email: string, inviteCode: string) {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date();

  const invite = await db.query.authAdminInvites.findFirst({
    where: and(
      eq(authAdminInvites.email, normalizedEmail),
      eq(authAdminInvites.inviteTokenHash, hashValue(inviteCode.trim().toUpperCase())),
      isNull(authAdminInvites.usedAt),
      gt(authAdminInvites.expiresAt, now),
    ),
    orderBy: [desc(authAdminInvites.createdAt)],
  });

  if (!invite) {
    return { invite: null, error: "The invite code or email is invalid." };
  }

  return { invite, error: null };
}

export async function markAdminInviteUsedTx(tx: DbClient, inviteId: string) {
  await tx
    .update(authAdminInvites)
    .set({ usedAt: new Date() })
    .where(eq(authAdminInvites.id, inviteId));
}

export async function listAdminInvites() {
  const now = new Date();

  return db
    .select({
      id: authAdminInvites.id,
      email: authAdminInvites.email,
      confidentialityLevel: authAdminInvites.confidentialityLevel,
      expiresAt: authAdminInvites.expiresAt,
      usedAt: authAdminInvites.usedAt,
      createdAt: authAdminInvites.createdAt,
      status: sql<string>`
        case
          when ${authAdminInvites.usedAt} is not null then 'Used'
          when ${authAdminInvites.expiresAt} <= ${now} then 'Expired'
          else 'Active'
        end
      `,
    })
    .from(authAdminInvites)
    .orderBy(desc(authAdminInvites.createdAt));
}

export async function listAccountAccessRows() {
  const rows = await db
    .select({
      accountId: authAccounts.id,
      employeeId: employees.id,
      employeeType: employees.employeeType,
      employeeNo: employees.employeeNo,
      email: authAccounts.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      confidentialityLevel: employeesGeneralInfo.confidentialityLevel,
      status: authAccounts.status,
      mustSetPassword: authAccounts.mustSetPassword,
      lastLoginAt: authAccounts.lastLoginAt,
      createdAt: authAccounts.createdAt,
      groupKey: authPermissionGroups.key,
      groupName: authPermissionGroups.name,
      managerDepartmentId: authManagerDepartments.departmentId,
      managerDepartmentName: department.name,
      managerDepartmentCode: department.code,
    })
    .from(authAccounts)
    .innerJoin(employees, eq(authAccounts.employeeId, employees.id))
    .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
    .leftJoin(
      authAccountPermissionGroups,
      eq(authAccountPermissionGroups.accountId, authAccounts.id),
    )
    .leftJoin(
      authPermissionGroups,
      eq(authAccountPermissionGroups.groupId, authPermissionGroups.id),
    )
    .leftJoin(
      authManagerDepartments,
      eq(authManagerDepartments.accountId, authAccounts.id),
    )
    .leftJoin(department, eq(authManagerDepartments.departmentId, department.id))
    .where(isNull(employees.deletedAt))
    .orderBy(desc(authAccounts.createdAt));

  const grouped = new Map<
    string,
    {
      accountId: string;
      employeeId: string;
      employeeType: "EMP" | "ADMIN";
      employeeNo: string;
      email: string;
      firstName: string;
      lastName: string;
      confidentialityLevel: ConfidentialityLevel;
      status: "PendingSetup" | "Active" | "Locked" | "Disabled";
      mustSetPassword: boolean;
      lastLoginAt: Date | null;
      createdAt: Date;
      groupKeys: AuthGroupKey[];
      groupNames: string[];
      managerDepartmentIds: number[];
      managerDepartmentNames: string[];
    }
  >();

  for (const row of rows) {
    const existing =
      grouped.get(row.accountId) ??
      {
        accountId: row.accountId,
        employeeId: row.employeeId,
        employeeType: row.employeeType,
        employeeNo: row.employeeNo,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        confidentialityLevel: row.confidentialityLevel,
        status: row.status,
        mustSetPassword: row.mustSetPassword,
        lastLoginAt: row.lastLoginAt,
        createdAt: row.createdAt,
        groupKeys: [],
        groupNames: [],
        managerDepartmentIds: [],
        managerDepartmentNames: [],
      };

    if (row.groupKey && isAuthGroupKey(row.groupKey) && !existing.groupKeys.includes(row.groupKey)) {
      existing.groupKeys.push(row.groupKey);
      existing.groupNames.push(row.groupName ?? AUTH_GROUPS[row.groupKey].name);
    }

    if (
      row.managerDepartmentId != null &&
      !existing.managerDepartmentIds.includes(row.managerDepartmentId)
    ) {
      existing.managerDepartmentIds.push(row.managerDepartmentId);
      existing.managerDepartmentNames.push(
        row.managerDepartmentName
          ? `${row.managerDepartmentCode ?? ""}${
              row.managerDepartmentCode ? " | " : ""
            }${row.managerDepartmentName}`
          : `Department #${row.managerDepartmentId}`,
      );
    }

    grouped.set(row.accountId, existing);
  }

  return [...grouped.values()].map((row) => {
    const groupKeys = withFallbackGroup(row.groupKeys, row.confidentialityLevel);
    const groupNames =
      row.groupNames.length > 0
        ? row.groupNames
        : groupKeys.map((groupKey) => AUTH_GROUPS[groupKey].name);

    return {
      ...row,
      groupKeys,
      groupNames,
    };
  });
}

export async function listAdminAccounts() {
  return db
    .select({
      accountId: authAccounts.id,
      employeeId: employees.id,
      email: authAccounts.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      confidentialityLevel: employeesGeneralInfo.confidentialityLevel,
      status: authAccounts.status,
      mustSetPassword: authAccounts.mustSetPassword,
      lastLoginAt: authAccounts.lastLoginAt,
      createdAt: authAccounts.createdAt,
    })
    .from(authAccounts)
    .innerJoin(employees, eq(authAccounts.employeeId, employees.id))
    .innerJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
    .where(
      and(
        isNull(employees.deletedAt),
        inArray(employeesGeneralInfo.confidentialityLevel, [
          "Supervisory",
          "Managerial",
        ]),
      ),
    )
    .orderBy(desc(authAccounts.createdAt));
}

export async function revokeAdminInvite(id: string) {
  const now = new Date();

  await db
    .update(authAdminInvites)
    .set({ expiresAt: now })
    .where(
      and(
        eq(authAdminInvites.id, id),
        isNull(authAdminInvites.usedAt),
        gt(authAdminInvites.expiresAt, now),
      ),
    );
}

export { getRedirectForRole, issueOnboardingOtp };

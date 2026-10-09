import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import {
  authAccountPermissionGroups,
  authAccounts,
  authPermissionGroups,
  authSessions,
  employees,
  employeesGeneralInfo,
} from "@/db/schema";
import {
  AUTH_GROUP_KEYS,
  getDefaultGroupForConfidentialityLevel,
  isAuthGroupKey,
  type AuthGroupKey,
} from "@/lib/auth/permissions";

// All account eligibility changes take this lock before reading state. A single
// transaction lock also protects the cross-account last-System-Admin invariant.
export async function acquireAccountLifecycleLockTx(tx: DbClient) {
  await tx.execute(sql`select pg_advisory_xact_lock(734120, 1)`);
}

export async function getAccountAccessStateTx(tx: DbClient, accountId: string) {
  const [record] = await tx
    .select({
      account: authAccounts,
      employeeDeletedAt: employees.deletedAt,
      confidentialityLevel: employeesGeneralInfo.confidentialityLevel,
    })
    .from(authAccounts)
    .innerJoin(employees, eq(employees.id, authAccounts.employeeId))
    .leftJoin(employeesGeneralInfo, eq(employeesGeneralInfo.employeeId, employees.id))
    .where(eq(authAccounts.id, accountId))
    .limit(1);
  if (!record) throw new Error("Account not found.");

  const groupRows = await tx
    .select({ key: authPermissionGroups.key })
    .from(authAccountPermissionGroups)
    .innerJoin(authPermissionGroups, eq(authPermissionGroups.id, authAccountPermissionGroups.groupId))
    .where(eq(authAccountPermissionGroups.accountId, accountId));
  const assignedGroupKeys = groupRows.map((row) => row.key).filter(isAuthGroupKey);
  const fallbackGroup = getDefaultGroupForConfidentialityLevel(record.confidentialityLevel);
  const groupKeys = assignedGroupKeys.length > 0
    ? assignedGroupKeys
    : fallbackGroup ? [fallbackGroup] : [];
  return { ...record, assignedGroupKeys, groupKeys };
}

export async function countActiveEffectiveAccountsInGroupsTx(tx: DbClient, groupKeys: AuthGroupKey[], employeeType?: "EMP" | "ADMIN") {
  const rows = await tx
    .select({
      accountId: authAccounts.id,
      groupKey: authPermissionGroups.key,
      confidentialityLevel: employeesGeneralInfo.confidentialityLevel,
    })
    .from(authAccounts)
    .innerJoin(employees, eq(employees.id, authAccounts.employeeId))
    .leftJoin(employeesGeneralInfo, eq(employeesGeneralInfo.employeeId, employees.id))
    .leftJoin(authAccountPermissionGroups, eq(authAccountPermissionGroups.accountId, authAccounts.id))
    .leftJoin(authPermissionGroups, eq(authPermissionGroups.id, authAccountPermissionGroups.groupId))
    .where(and(eq(authAccounts.status, "Active"), isNull(employees.deletedAt),
      employeeType ? eq(employees.employeeType, employeeType) : undefined));
  const accounts = new Map<string, { groups: AuthGroupKey[]; fallback: AuthGroupKey | null }>();
  for (const row of rows) {
    const account = accounts.get(row.accountId) ?? {
      groups: [],
      fallback: getDefaultGroupForConfidentialityLevel(row.confidentialityLevel),
    };
    if (row.groupKey && isAuthGroupKey(row.groupKey)) account.groups.push(row.groupKey);
    accounts.set(row.accountId, account);
  }
  return [...accounts.values()].filter((account) =>
    account.groups.length > 0
      ? account.groups.some((key) => groupKeys.includes(key))
      : account.fallback != null && groupKeys.includes(account.fallback),
  ).length;
}

export async function countActiveEffectiveSystemAdminsTx(tx: DbClient, employeeType?: "EMP" | "ADMIN") {
  return countActiveEffectiveAccountsInGroupsTx(tx, [AUTH_GROUP_KEYS.SYSTEM_ADMIN], employeeType);
}

export async function assertNotRemovingLastSystemAdminTx(args: {
  tx: DbClient;
  accountId: string;
  nextGroupKey?: AuthGroupKey;
  nextStatus?: "PendingSetup" | "Active" | "Locked" | "Disabled";
  nextEmployeeArchived?: boolean;
  nextConfidentialityLevel?: "Rank and File" | "Supervisory" | "Managerial" | null;
}) {
  await acquireAccountLifecycleLockTx(args.tx);
  const current = await getAccountAccessStateTx(args.tx, args.accountId);
  const isActiveSystemAdmin = current.account.status === "Active"
    && !current.employeeDeletedAt
    && current.groupKeys.includes(AUTH_GROUP_KEYS.SYSTEM_ADMIN);
  const removesAccess = args.nextEmployeeArchived
    || (args.nextStatus != null && args.nextStatus !== "Active")
    || (args.nextGroupKey != null && args.nextGroupKey !== AUTH_GROUP_KEYS.SYSTEM_ADMIN)
    || (args.nextConfidentialityLevel !== undefined && current.assignedGroupKeys.length === 0
      && getDefaultGroupForConfidentialityLevel(args.nextConfidentialityLevel) !== AUTH_GROUP_KEYS.SYSTEM_ADMIN);
  if (isActiveSystemAdmin && removesAccess
    && await countActiveEffectiveSystemAdminsTx(args.tx) <= 1) {
    throw new Error("At least one active System Admin account is required.");
  }
}

// Authentication before a transaction is insufficient if the action waited for
// a concurrent disable/demotion. Recheck the actor under the lifecycle lock.
async function assertAccountActorTx(
  tx: DbClient,
  actor: { accountId: string; sessionId: string },
  groupKeys: AuthGroupKey[],
) {
  const current = await getAccountAccessStateTx(tx, actor.accountId);
  const [session] = await tx.select({ id: authSessions.id }).from(authSessions).where(and(
    eq(authSessions.id, actor.sessionId),
    eq(authSessions.accountId, actor.accountId),
    isNull(authSessions.revokedAt),
    gt(authSessions.expiresAt, new Date()),
  )).limit(1);
  if (!session || current.account.status !== "Active" || current.employeeDeletedAt
    || !current.groupKeys.some((key) => groupKeys.includes(key))) {
    throw new Error("Your account no longer has permission to perform this action.");
  }
}

export async function assertAccountAccessManagerTx(tx: DbClient, actor: { accountId: string; sessionId: string }) {
  await assertAccountActorTx(tx, actor, [AUTH_GROUP_KEYS.SYSTEM_ADMIN]);
}

export async function assertAccountAdminTx(tx: DbClient, actor: { accountId: string; sessionId: string }) {
  await assertAccountActorTx(tx, actor, [AUTH_GROUP_KEYS.SYSTEM_ADMIN, AUTH_GROUP_KEYS.HR_ADMIN]);
}

export async function assertEmployeeConfidentialityChangeTx(
  tx: DbClient,
  employeeId: string,
  nextConfidentialityLevel: "Rank and File" | "Supervisory" | "Managerial" | null,
) {
  await acquireAccountLifecycleLockTx(tx);
  const [account] = await tx.select({ id: authAccounts.id }).from(authAccounts)
    .where(eq(authAccounts.employeeId, employeeId)).limit(1);
  if (account) await assertNotRemovingLastSystemAdminTx({ tx, accountId: account.id, nextConfidentialityLevel });
}

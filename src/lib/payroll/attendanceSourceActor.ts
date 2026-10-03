import "server-only";
import { eq } from "drizzle-orm";
import type { DbClient } from "@/db";
import { authAccounts, authAccountPermissionGroups, authPermissionGroups, employees, employeesGeneralInfo } from "@/db/schema";
import { getAppRoleForGroups, getDefaultGroupForConfidentialityLevel, isAuthGroupKey } from "@/lib/auth/permissions";

/** Scheduler credentials do not make an inactive or non-admin account an audit actor. */
export async function attendanceSchedulerActorAuthorized(database: DbClient, actorId: string) {
  const [actor] = await database.select({ status: authAccounts.status, deletedAt: employees.deletedAt, level: employeesGeneralInfo.confidentialityLevel })
    .from(authAccounts).innerJoin(employees, eq(authAccounts.employeeId, employees.id))
    .leftJoin(employeesGeneralInfo, eq(employeesGeneralInfo.employeeId, employees.id))
    .where(eq(authAccounts.id, actorId));
  if (!actor || actor.status !== "Active" || actor.deletedAt) return false;
  const assigned = await database.select({ key: authPermissionGroups.key }).from(authAccountPermissionGroups)
    .innerJoin(authPermissionGroups, eq(authAccountPermissionGroups.groupId, authPermissionGroups.id))
    .where(eq(authAccountPermissionGroups.accountId, actorId));
  const keys = assigned.map(row => row.key).filter(isAuthGroupKey);
  const fallback = getDefaultGroupForConfidentialityLevel(actor.level);
  return getAppRoleForGroups(keys.length ? keys : fallback ? [fallback] : []) === "ADMIN";
}

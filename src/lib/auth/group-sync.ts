import { eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import {
  authAccountPermissionGroups,
  authManagerDepartments,
  authPermissionGroups,
} from "@/db/schema";
import {
  AUTH_GROUPS,
  type AuthGroupKey,
  getDefaultGroupForConfidentialityLevel,
} from "@/lib/auth/permissions";

type ConfidentialityLevel = "Rank and File" | "Supervisory" | "Managerial" | null;
type DbExecutor = Pick<typeof db, "select" | "insert" | "delete">;

export async function ensureDefaultPermissionGroupsTx(tx: DbExecutor) {
  for (const group of Object.values(AUTH_GROUPS)) {
    await tx
      .insert(authPermissionGroups)
      .values({
        key: group.key,
        name: group.name,
        description: group.description,
        isSystem: true,
      })
      .onConflictDoUpdate({
        target: authPermissionGroups.key,
        set: {
          name: group.name,
          description: group.description,
          isSystem: true,
        },
      });
  }
}

export async function setAccountGroupsTx(
  tx: DbExecutor,
  accountId: string,
  groupKeys: AuthGroupKey[],
) {
  await ensureDefaultPermissionGroupsTx(tx);

  const uniqueGroupKeys = [...new Set(groupKeys)];
  const groupRows =
    uniqueGroupKeys.length > 0
      ? await tx
          .select({
            id: authPermissionGroups.id,
            key: authPermissionGroups.key,
          })
          .from(authPermissionGroups)
          .where(inArray(authPermissionGroups.key, uniqueGroupKeys))
      : [];

  if (groupRows.length !== uniqueGroupKeys.length) {
    throw new Error("One or more access groups do not exist.");
  }

  await tx
    .delete(authAccountPermissionGroups)
    .where(eq(authAccountPermissionGroups.accountId, accountId));

  if (groupRows.length > 0) {
    await tx.insert(authAccountPermissionGroups).values(
      groupRows.map((group: { id: string }) => ({
        accountId,
        groupId: group.id,
      })),
    );
  }
}

export async function setManagerDepartmentsTx(
  tx: DbExecutor,
  accountId: string,
  departmentIds: number[],
) {
  const uniqueDepartmentIds = [
    ...new Set(
      departmentIds
        .map((departmentId) => Number(departmentId))
        .filter((departmentId) => Number.isInteger(departmentId) && departmentId > 0),
    ),
  ];

  await tx
    .delete(authManagerDepartments)
    .where(eq(authManagerDepartments.accountId, accountId));

  if (uniqueDepartmentIds.length === 0) {
    return;
  }

  await tx.insert(authManagerDepartments).values(
    uniqueDepartmentIds.map((departmentId) => ({
      accountId,
      departmentId,
    })),
  );
}

export async function assignDefaultAccountGroupTx(
  tx: DbExecutor,
  accountId: string,
  confidentialityLevel: ConfidentialityLevel,
) {
  const groupKey = getDefaultGroupForConfidentialityLevel(confidentialityLevel);
  if (!groupKey) return;

  await setAccountGroupsTx(tx, accountId, [groupKey]);
}

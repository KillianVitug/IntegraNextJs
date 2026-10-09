"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { employees } from "@/db/schema";
import { actionClient } from "@/lib/safe-action";
import { recordAdminAuditEvent, requireAdminActor } from "@/lib/admin";
import { DELETE_EMPLOYEE_MASTER_DATA_CONFIRMATION } from "@/constants/employeeMasterData";
import { requireAdmin } from "@/lib/auth/server";
import { acquireAccountLifecycleLockTx, assertAccountAdminTx, countActiveEffectiveSystemAdminsTx } from "@/lib/auth/lifecycle";

const employeeMasterDataPath = "/constants/dataMenu/employeeMasterData";

export async function getEmployeeMasterDataSummary() {
  await requireAdminActor();

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(employees)
    .where(eq(employees.employeeType, "EMP"));

  return {
    regularEmployeeCount: Number(countRow?.count ?? 0),
  };
}

export const deleteAllRegularEmployeesAction = actionClient
  .metadata({ actionName: "deleteAllRegularEmployees" })
  .schema(
    z.object({
      confirmation: z.literal(DELETE_EMPLOYEE_MASTER_DATA_CONFIRMATION),
    })
  )
  .action(async () => {
    const actor = await requireAdmin();
    let deletedCount = 0;

    await db.transaction(async (tx) => {
      await acquireAccountLifecycleLockTx(tx);
      await assertAccountAdminTx(tx, actor);
      const previousAdminCount = await countActiveEffectiveSystemAdminsTx(tx);
      if (previousAdminCount > 0 && await countActiveEffectiveSystemAdminsTx(tx, "ADMIN") === 0) {
        throw new Error("At least one active System Admin account is required.");
      }
      const deletedRows = await tx
        .delete(employees)
        .where(eq(employees.employeeType, "EMP"))
        .returning({ id: employees.id });


      deletedCount = deletedRows.length;

      await recordAdminAuditEvent({
        actorUserId: actor.accountId,
        entityType: "employee_master_data",
        entityId: "EMP",
        action: "employee_master_data.delete_all_regular_employees",
        details: { deletedCount },
        database: tx,
      });
    });

    revalidatePath("/employeeMaster");
    revalidatePath("/employeeMaster/form");
    revalidatePath(employeeMasterDataPath);

    return {
      deletedCount,
      message: `Deleted ${deletedCount} regular employee record${
        deletedCount === 1 ? "" : "s"
      }.`,
    };
  });

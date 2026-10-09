"use server";

import { actionClient } from "@/lib/safe-action";
import { db } from "@/db";
import {
  employees,
  employeesGeneralInfo,
  employeesSalary,
  employeesOtherReferences,
  employeesTimekeeping,
  employeesRecurringEntries,
  employeesLeaveRecords,
  employeesSalaryAdjustments,
  employeesLoans,
  employeeFolders,
  employeeFiles,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { recordAdminAuditEvent } from "@/lib/admin";
import { disableLinkedAccountTx, requireAdmin } from "@/lib/auth/server";
import { acquireAccountLifecycleLockTx, assertAccountAdminTx } from "@/lib/auth/lifecycle";

export const archiveEmployeeAction = actionClient
  .metadata({ actionName: "archiveEmployee" })
  .schema(z.string().uuid())
  .action(async ({ parsedInput: employeeId }) => {
    const actor = await requireAdmin();
    const now = new Date();

    try {
      await db.transaction(async (tx) => {
      await acquireAccountLifecycleLockTx(tx);
      await assertAccountAdminTx(tx, actor);
      await disableLinkedAccountTx(tx, employeeId);
      const [archived] = await tx.update(employees).set({ deletedAt: now })
        .where(eq(employees.id, employeeId)).returning({ id: employees.id });
      if (!archived) throw new Error("Employee not found.");
      await tx.update(employeesGeneralInfo).set({ deletedAt: now }).where(eq(employeesGeneralInfo.employeeId, employeeId));
      await tx.update(employeesSalary).set({ deletedAt: now }).where(eq(employeesSalary.employeeId, employeeId));
      await tx.update(employeesOtherReferences).set({ deletedAt: now }).where(eq(employeesOtherReferences.employeeId, employeeId));
      await tx.update(employeesTimekeeping).set({ deletedAt: now }).where(eq(employeesTimekeeping.employeeId, employeeId));
      await tx.update(employeesRecurringEntries).set({ deletedAt: now }).where(eq(employeesRecurringEntries.employeeId, employeeId));
      await tx.update(employeesLeaveRecords).set({ deletedAt: now }).where(eq(employeesLeaveRecords.employeeId, employeeId));
      await tx.update(employeesSalaryAdjustments).set({ deletedAt: now }).where(eq(employeesSalaryAdjustments.employeeId, employeeId));
      await tx.update(employeesLoans).set({ deletedAt: now }).where(eq(employeesLoans.employeeId, employeeId));
      await tx.update(employeeFolders).set({ deletedAt: now }).where(eq(employeeFolders.employeeId, employeeId));

      await tx.update(employeeFiles)
        .set({ deletedAt: now })
        .where(
          inArray(
            employeeFiles.groupId,
            tx.select({ id: employeeFolders.id })
              .from(employeeFolders)
              .where(eq(employeeFolders.employeeId, employeeId))
          )
        );
        
      await recordAdminAuditEvent({
        actorUserId: actor.accountId,
        entityType: "employee",
        entityId: employeeId,
        action: "archived",
        database: tx,
      });
      });
    } catch (error) {
      if (error instanceof Error && [
        "At least one active System Admin account is required.",
        "Employee not found.",
      ].includes(error.message)) {
        return { success: false, message: error.message };
      }
      throw error;
    }

    revalidatePath("/employeeMaster");
    revalidatePath("/access-management");
    return { success: true };
  });

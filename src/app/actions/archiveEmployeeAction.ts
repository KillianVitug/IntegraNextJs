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
import { eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdminActor } from "@/lib/admin";
import { disableLinkedAccountTx } from "@/lib/auth/server";

export const archiveEmployeeAction = actionClient
  .metadata({ actionName: "archiveEmployee" })
  .schema(z.string().uuid())
  .action(async ({ parsedInput: employeeId }) => {
    await requireAdminActor();
    const now = new Date();

    await db.transaction(async (tx) => {
      await disableLinkedAccountTx(tx, employeeId);
      await tx.update(employees).set({ deletedAt: now }).where(eq(employees.id, employeeId));
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
          eq(
            employeeFiles.groupId,
            tx.select({ id: employeeFolders.id })
              .from(employeeFolders)
              .where(eq(employeeFolders.employeeId, employeeId))
          )
        );
        
        revalidatePath("/employeeMaster");
    });

    return { success: true };
  });

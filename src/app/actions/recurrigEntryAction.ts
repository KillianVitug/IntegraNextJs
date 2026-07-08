"use server";

import { db } from "@/db";
import { accountCode, employees, employeesRecurringEntries } from "@/db/schema";
import { actionClient } from "@/lib/safe-action";
import { asc, eq, inArray } from "drizzle-orm";
import {
  insertEmployeeRecurringEntriesSchema,
  saveEmployeeRecurringEntriesSchema,
  type InsertEmployeeRecurringEntriesSchemaType,
  type SaveEmployeeRecurringEntriesSchemaType,
} from "@/zod-schemas/employeeRecurringEntries";
import { z } from "zod";
import { flattenValidationErrors } from "next-safe-action";
import { requireAdminActor } from "@/lib/admin";
import { revalidatePath } from "next/cache";
import { markEmployeePayrollRunsStale } from "@/lib/payroll/staleRuns";

const allowedRecurringAccountTypes = ["Other Income", "Other Deduction"] as const;

function normalizeRecurringAmount(value: string | number | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : "0.00";
}

function normalizeRecurringText(value: string | null | undefined) {
  return value?.trim() || null;
}

function hasRecurringEntryChanged(
  existingEntry: typeof employeesRecurringEntries.$inferSelect,
  values: Partial<typeof employeesRecurringEntries.$inferInsert>
) {
  return (
    existingEntry.accountCode !== values.accountCode ||
    normalizeRecurringAmount(existingEntry.amount) !==
      normalizeRecurringAmount(values.amount) ||
    normalizeRecurringText(existingEntry.description) !==
      normalizeRecurringText(values.description) ||
    existingEntry.frequency !== (values.frequency ?? null) ||
    existingEntry.status !== (values.status ?? null) ||
    existingEntry.startDate !== (values.startDate ?? null) ||
    existingEntry.endDate !== (values.endDate ?? null)
  );
}

/* -----------------------------------------
   CREATE
------------------------------------------ */

export const createRecurringEntry = actionClient
  .metadata({ actionName: "createRecurringEntry" })
  .schema(insertEmployeeRecurringEntriesSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({
      parsedInput: entry,
    }: {
      parsedInput: InsertEmployeeRecurringEntriesSchemaType;
    }) => {
      const actor = await requireAdminActor();
      // New Entry
      if (!entry.id || entry.id === "(New)") {
        const result = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(employeesRecurringEntries)
            .values({
              employeeId: entry.employeeId,
              accountCode: entry.accountCode,
              amount: entry.amount,
              description: entry.description,
              frequency: entry.frequency,
              status: entry.status,
              startDate: entry.startDate,
              endDate: entry.endDate,
            })
            .returning({ insertedId: employeesRecurringEntries.id });

          await markEmployeePayrollRunsStale({
            tx,
            employeeId: entry.employeeId,
            actorUserId: actor.userId,
            notes: "Marked stale because an employee recurring entry was added.",
          });

          return inserted;
        });

        revalidatePath("/employeeMaster");
        revalidatePath("/payroll");

        return {
          message: `Entry ID #${result[0].insertedId} created successfully`,
          id: result[0].insertedId,
        };
      } else {
        // Updating ticket
        const entryId = Number(entry.id);
        if (!Number.isInteger(entryId)) {
          throw new Error("Invalid ID for update.");
        }

        const result = await db.transaction(async (tx) => {
          const [existingEntry] = await tx
            .select()
            .from(employeesRecurringEntries)
            .where(eq(employeesRecurringEntries.id, entryId))
            .limit(1);

          if (!existingEntry) {
            throw new Error("Recurring entry not found.");
          }

          const values = {
            employeeId: entry.employeeId,
            accountCode: entry.accountCode,
            amount: entry.amount,
            description: entry.description,
            frequency: entry.frequency,
            status: entry.status,
            startDate: entry.startDate,
            endDate: entry.endDate,
          };
          const changed = hasRecurringEntryChanged(existingEntry, values);

          const updated = await tx
            .update(employeesRecurringEntries)
            .set(values)
            .where(eq(employeesRecurringEntries.id, entryId))
            .returning({ updatedId: employeesRecurringEntries.id });

          if (changed) {
            await markEmployeePayrollRunsStale({
              tx,
              employeeId: entry.employeeId,
              actorUserId: actor.userId,
              notes: "Marked stale because an employee recurring entry changed.",
            });
          }

          return updated;
        });

        revalidatePath("/employeeMaster");
        revalidatePath("/payroll");

        return {
          message: `Entry ID #${result[0].updatedId} updated successfully`,
          
        };
      }
    }
  );

/* -----------------------------------------
   SAVE BATCH
------------------------------------------ */
export const saveRecurringEntries = actionClient
  .metadata({ actionName: "saveRecurringEntries" })
  .schema(saveEmployeeRecurringEntriesSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({
      parsedInput,
    }: {
      parsedInput: SaveEmployeeRecurringEntriesSchemaType;
    }) => {
      const actor = await requireAdminActor();

      const result = await db.transaction(async (tx) => {
        const [employee] = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(eq(employees.id, parsedInput.employeeId))
          .limit(1);

        if (!employee) {
          throw new Error("Employee not found.");
        }

        const existingEntries = await tx
          .select()
          .from(employeesRecurringEntries)
          .where(eq(employeesRecurringEntries.employeeId, parsedInput.employeeId));
        const existingEntriesById = new Map(
          existingEntries.map((entry) => [entry.id, entry])
        );

        const allowedAccountRows = await tx
          .select({ accountCode: accountCode.accountCode })
          .from(accountCode)
          .where(
            inArray(accountCode.accountType, [...allowedRecurringAccountTypes])
          );
        const allowedAccountCodes = new Set(
          allowedAccountRows.map((row) => row.accountCode)
        );

        const submittedIds = new Set<number>();
        for (const entry of parsedInput.entries) {
          if (!entry.id) continue;
          if (submittedIds.has(entry.id)) {
            throw new Error("Duplicate recurring entry row found.");
          }
          submittedIds.add(entry.id);

          if (!existingEntriesById.has(entry.id)) {
            throw new Error("One or more recurring entries no longer exist.");
          }
        }

        let payrollInputsChanged = existingEntries.some(
          (existingEntry) => !submittedIds.has(existingEntry.id)
        );

        for (const existingEntry of existingEntries) {
          if (submittedIds.has(existingEntry.id)) continue;

          await tx
            .delete(employeesRecurringEntries)
            .where(eq(employeesRecurringEntries.id, existingEntry.id));
        }

        let insertedCount = 0;
        let updatedCount = 0;
        let preservedLegacyCount = 0;

        for (const entry of parsedInput.entries) {
          const existingEntry = entry.id
            ? existingEntriesById.get(entry.id) ?? null
            : null;
          const isAllowedAccountCode = allowedAccountCodes.has(entry.accountCode);

          if (!isAllowedAccountCode) {
            if ((existingEntry?.accountCode ?? "") === entry.accountCode) {
              preservedLegacyCount += 1;
              continue;
            }

            throw new Error(
              "Recurring entries can only use Other Income or Other Deduction account codes."
            );
          }

          const values = {
            employeeId: parsedInput.employeeId,
            accountCode: entry.accountCode,
            amount: entry.amount,
            description: entry.description?.trim() || null,
            frequency: null,
            status: "Active" as const,
            startDate: null,
            endDate: null,
          };

          if (existingEntry) {
            if (hasRecurringEntryChanged(existingEntry, values)) {
              payrollInputsChanged = true;
            }

            await tx
              .update(employeesRecurringEntries)
              .set(values)
              .where(eq(employeesRecurringEntries.id, existingEntry.id));
            updatedCount += 1;
          } else {
            payrollInputsChanged = true;
            await tx.insert(employeesRecurringEntries).values(values);
            insertedCount += 1;
          }
        }

        const staleRunCount = payrollInputsChanged
          ? await markEmployeePayrollRunsStale({
              tx,
              employeeId: parsedInput.employeeId,
              actorUserId: actor.userId,
              notes: "Marked stale because employee recurring entries changed.",
            })
          : 0;

        const entries = await tx
          .select({
            id: employeesRecurringEntries.id,
            employeeId: employeesRecurringEntries.employeeId,
            accountCode: employeesRecurringEntries.accountCode,
            description: employeesRecurringEntries.description,
            amount: employeesRecurringEntries.amount,
            frequency: employeesRecurringEntries.frequency,
            status: employeesRecurringEntries.status,
            startDate: employeesRecurringEntries.startDate,
            endDate: employeesRecurringEntries.endDate,
          })
          .from(employeesRecurringEntries)
          .where(eq(employeesRecurringEntries.employeeId, parsedInput.employeeId))
          .orderBy(asc(employeesRecurringEntries.id));

        return {
          success: true,
          insertedCount,
          updatedCount,
          deletedCount: existingEntries.length - submittedIds.size,
          preservedLegacyCount,
          staleRunCount,
          entries,
        };
      });

      revalidatePath("/employeeMaster");
      revalidatePath("/payroll");

      return {
        ...result,
        message: "Recurring entries saved successfully.",
      };
    }
  );

/* -----------------------------------------
   DELETE
------------------------------------------ */
export const deleteRecurringEntry = actionClient
  .metadata({ actionName: "deleteRecurringEntry" })
  .schema(insertEmployeeRecurringEntriesSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const entryId =
      typeof parsedInput.id === "string"
        ? Number(parsedInput.id)
        : parsedInput.id;

    if (isNaN(entryId)) {
      throw new Error("Invalid ID for deletion.");
    }

    await db.transaction(async (tx) => {
      const [existingEntry] = await tx
        .select({
          id: employeesRecurringEntries.id,
          employeeId: employeesRecurringEntries.employeeId,
        })
        .from(employeesRecurringEntries)
        .where(eq(employeesRecurringEntries.id, entryId))
        .limit(1);

      await tx
        .delete(employeesRecurringEntries)
        .where(eq(employeesRecurringEntries.id, entryId));

      if (existingEntry) {
        await markEmployeePayrollRunsStale({
          tx,
          employeeId: existingEntry.employeeId,
          actorUserId: actor.userId,
          notes: "Marked stale because an employee recurring entry was deleted.",
        });
      }
    });

    revalidatePath("/employeeMaster");
    revalidatePath("/payroll");

    return {
      success: true,
      message: `Entry ID #${entryId} deleted successfully.`,
    };
  });

/* -----------------------------------------
   GET BY EMPLOYEE
------------------------------------------ */
export const getRecurringEntriesByEmployee = actionClient
  .metadata({ actionName: "getRecurringEntriesByEmployee" })
  .schema(
    z.object({
      employeeId: z.string().uuid(), // or z.string() if it's not a UUID
    }),
    {
      handleValidationErrorsShape: async (ve) =>
        flattenValidationErrors(ve).fieldErrors,
    }
  )
  .action(
    async ({ parsedInput: entry }: { parsedInput: { employeeId: string } }) => {
      await requireAdminActor();
      if (!entry.employeeId) {
        throw new Error("Missing employeeId");
      }

      const entries = await db
        .select({
          id: employeesRecurringEntries.id,
          employeeId: employeesRecurringEntries.employeeId,
          accountCode: employeesRecurringEntries.accountCode,
          description: employeesRecurringEntries.description,
          amount: employeesRecurringEntries.amount,
          frequency: employeesRecurringEntries.frequency,
          status: employeesRecurringEntries.status,
          startDate: employeesRecurringEntries.startDate,
          endDate: employeesRecurringEntries.endDate,
          
        })
        .from(employeesRecurringEntries)
        .where(eq(employeesRecurringEntries.employeeId, entry.employeeId));

      return { entries };
    }
  );

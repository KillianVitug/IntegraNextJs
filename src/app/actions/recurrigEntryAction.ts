"use server";

import { db } from "@/db";
import { employeesRecurringEntries } from "@/db/schema";
import { actionClient } from "@/lib/safe-action";
import { eq } from "drizzle-orm";
import {
  insertEmployeeRecurringEntriesSchema,
  type InsertEmployeeRecurringEntriesSchemaType,
} from "@/zod-schemas/employeeRecurringEntries";
import { z } from "zod";
import { flattenValidationErrors } from "next-safe-action";

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
      // New Entry
      if (!entry.id || entry.id === "(New)") {
        const result = await db
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

        return {
          message: `Entry ID #${result[0].insertedId} created successfully`,
          id: result[0].insertedId,
        };
      } else {
        // Updating ticket
        const result = await db
          .update(employeesRecurringEntries)
          .set({
            employeeId: entry.employeeId,
            accountCode: entry.accountCode,
            amount: entry.amount,
            description: entry.description,
            frequency: entry.frequency,
            status: entry.status,
            startDate: entry.startDate,
            endDate: entry.endDate,
          })
          .where(eq(employeesRecurringEntries.id, entry.id))
          .returning({ updatedId: employeesRecurringEntries.id });

        return {
          message: `Entry ID #${result[0].updatedId} updated successfully`,
          
        };
      }
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
    const entryId =
      typeof parsedInput.id === "string"
        ? Number(parsedInput.id)
        : parsedInput.id;

    if (isNaN(entryId)) {
      throw new Error("Invalid ID for deletion.");
    }

    await db
      .delete(employeesRecurringEntries)
      .where(eq(employeesRecurringEntries.id, entryId));

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

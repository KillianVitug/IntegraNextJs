"use server";

import { eq, and, inArray } from "drizzle-orm";
import { flattenValidationErrors } from "next-safe-action";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  employees,
  employeesGeneralInfo,
  employeesSalary,
  employeesOtherReferences,
  employeesTimekeeping,
  employeesRecurringEntries
} from "@/db/schema";
import { actionClient } from "@/lib/safe-action";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { insertEmployeeSchema, InsertEmployeeSchemaType } from "@/zod-schemas/employee";

export const saveEmployeeAction = actionClient
  .metadata({ actionName: "saveEmployeeAction" })
  .schema(insertEmployeeSchema, {
    handleValidationErrorsShape: async (ve) => flattenValidationErrors(ve).fieldErrors,
  })
  .action(async ({ parsedInput }: { parsedInput: InsertEmployeeSchemaType }) => {
    const { isAuthenticated } = getKindeServerSession();
    const isAuth = await isAuthenticated();
    if (!isAuth) redirect("/login");

    const {
      id,
      employeeNo,
      firstName,
      lastName,
      middleName,
      suffix,
      generalInfo,
      salary,
      otherReferences,
      timekeeping,
    } = parsedInput;

    try {
      if (!id) {
        throw new Error("Employee ID must be provided from frontend (UUID).");
      }

      await db.transaction(async (tx) => {
        type DBExecutor = Omit<typeof db, "$client">;

        // 1.1: Check for unique employeeNo
        const duplicateEmployee = await tx.query.employees.findFirst({
          where: eq(employees.employeeNo, employeeNo),
        });
        if (duplicateEmployee && duplicateEmployee.id !== id) {
          throw new Error("DUPLICATE_EMPLOYEE_NO");
        }

        // Always insert the employee row first if it doesn't exist
        const existing = await tx.query.employees.findFirst({
          where: eq(employees.id, id),
        });

        if (!existing) {
          await tx.insert(employees).values({
            id,
            employeeNo,
            firstName,
            lastName,
            middleName,
            suffix,
          });
        } else {
          await tx
            .update(employees)
            .set({ employeeNo, firstName, lastName, middleName, suffix })
            .where(eq(employees.id, id));
        }

        // Helper for inserting or updating related rows without transactions
        const insertOrUpdate = async <T>(
          executor: DBExecutor,
          table: any,
          data: T | undefined,
          employeeId: string
        ) => {
          if (data) {
            await executor
              .insert(table)
              .values({ ...data, employeeId })
              .onConflictDoUpdate({
                target: [table.employeeId],
                set: data,
              });
          }
        };

        // Insert or update related tables
        await insertOrUpdate(tx, employeesGeneralInfo, generalInfo, id);
        await insertOrUpdate(tx, employeesSalary, salary, id);
        await insertOrUpdate(tx, employeesOtherReferences, otherReferences, id);
        await insertOrUpdate(tx, employeesTimekeeping, timekeeping, id);
      });
      return { message: `Employee ID #${id} saved successfully` };
    } catch (error) {
      console.error("Error saving employee:", error);
    
      if (error instanceof Error && error.message.includes("invalid input syntax for type")) {
        const match = error.message.match(/invalid input syntax for type \w+: "(.+?)"/);
        if (match) {
          const invalidValue = match[1];
      
          // Flatten all fields from parsedInput into a key-value map
          const flattenFields = (obj: Record<string, any>, prefix = ""): Record<string, string> => {
            const result: Record<string, string> = {};
            for (const key in obj) {
              const value = obj[key];
              const path = prefix ? `${prefix}.${key}` : key;
              if (value && typeof value === "object" && !Array.isArray(value)) {
                Object.assign(result, flattenFields(value, path));
              } else {
                result[path] = String(value);
              }
            }
            return result;
          };
      
          // Convert something like "monthlyRate" ➝ "Monthly Rate"
          const prettifyFieldName = (fieldPath: string): string => {
            const lastKey = fieldPath.split(".").pop() ?? fieldPath;
            return lastKey
              .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase ➝ camel Case
              .replace(/_/g, " ") // snake_case ➝ snake case
              .replace(/\b\w/g, (c) => c.toUpperCase()); // capitalize words
          };
      
          const allFields = flattenFields(parsedInput);
          const matchedField = Object.entries(allFields).find(
            ([, value]) => value === invalidValue
          );
      
          const rawFieldPath = matchedField?.[0] ?? "unknown";
          const prettyField = prettifyFieldName(rawFieldPath);
      
          return {
            serverError: `Invalid value for ${prettyField}: "${invalidValue}". Please check the input.`,
          };
        }
      }
    
      if (error instanceof Error && error.message === "DUPLICATE_EMPLOYEE_NO") {
        return {
          serverError: `Employee number "${employeeNo}" is already taken.`,
        };
      }
    
      return {
        serverError: "Failed to save employee. Please try again.",
      };
    }
    
  });

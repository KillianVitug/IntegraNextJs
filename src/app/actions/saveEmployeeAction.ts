"use server";

import { eq } from "drizzle-orm";
import { flattenValidationErrors } from "next-safe-action";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  employees,
  employeesGeneralInfo,
  employeesSalary,
  employeesOtherReferences,
  employeesTimekeeping,
} from "@/db/schema";
import { actionClient } from "@/lib/safe-action";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { insertEmployeeSchema, InsertEmployeeSchemaType } from "@/zod-schemas/employee";
import { InsertEmployeeSalarySchemaType } from "@/zod-schemas/employeeSalary"
import { toNumber } from "@/lib/number";

type SalaryInput = Partial<InsertEmployeeSalarySchemaType>;

// Union type of all tables that have employeeId
type EmployeeOwnedTable =
  | typeof employeesGeneralInfo
  | typeof employeesSalary
  | typeof employeesOtherReferences
  | typeof employeesTimekeeping;


/* ───────────────────────────────────────────── */
// Deeply nested object with unknown values
type DeepObject = Record<string, unknown>;

/**
 * Recursively flatten an object into { "parent.child": value }.
 * Keeps null and undefined as-is for better matching.
 */
function flattenForPgError(obj: DeepObject, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key in obj) {
    const value = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenForPgError(value as DeepObject, path));
    } else {
      result[path] = value;
    }
  }

  return result;
}

/**
 * Find the field in a nested object that matches the bad value from PostgreSQL
 */
function parsePgError<T extends DeepObject>(
  payload: T,
  message: string
): { fieldName?: string; message: string } {
  const match = message.match(/invalid input syntax for type \w+: "(.+?)"/);
  if (!match) return { message: "Invalid database value." };

  const badValue = match[1];
  const flat = flattenForPgError(payload);

  // Try to match exact value (string or number)
  let matchedPath = Object.entries(flat).find(
    ([_, v]) => String(v) === badValue
  )?.[0];

  // Fallback: match null/empty for numeric columns
  if (!matchedPath) {
    matchedPath = Object.entries(flat).find(
      ([_, v]) => v === null || v === undefined || v === ""
    )?.[0];
  }

  const prettyField = matchedPath
    ? matchedPath
        .split(".")
        .pop()!
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "Unknown Field";

  return {
    fieldName: matchedPath,
    message: `Invalid value for "${prettyField}": "${badValue}"`,
  };
}



export const saveEmployeeAction = actionClient
  .metadata({ actionName: "saveEmployeeAction" })
  .schema(insertEmployeeSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(async ({ parsedInput }: { parsedInput: InsertEmployeeSchemaType }) => {
    const { isAuthenticated } = getKindeServerSession();
    if (!(await isAuthenticated())) redirect("/login");

    const {
      id,
      employeeNo,
      firstName,
      lastName,
      middleName,
      middleInitial,
      suffix,
      generalInfo,
      salary,
      otherReferences,
      timekeeping,
    } = parsedInput;

    try {
      if (!id) throw new Error("Employee ID must be provided from frontend (UUID).");

      await db.transaction(async (tx) => {
        // 🔹 Check for duplicate employeeNo
        const duplicate = await tx.query.employees.findFirst({
          where: eq(employees.employeeNo, employeeNo),
        });
        if (duplicate && duplicate.id !== id) {
          throw new Error("DUPLICATE_EMPLOYEE_NO");
        }

        // 🔹 Insert or update main employee row
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
            middleInitial,
            suffix,
          });
        } else {
          await tx
            .update(employees)
            .set({ employeeNo, firstName, lastName, middleName, middleInitial, suffix })
            .where(eq(employees.id, id));
        }

        // 🔹 Upsert helper for related tables
        const upsert = async <T extends object>(
          table: EmployeeOwnedTable,
          data: T | undefined
        ) => {
          if (!data) return;

          await tx
            .insert(table)
            .values({ ...data, employeeId: id })
            .onConflictDoUpdate({
              target: [table.employeeId],
              set: data,
            });
        };

        function normalizeOptionalFk<T extends string | null | undefined>(v: T) {
          return v === "" || v === undefined ? null : v;
        }

        function normalizeSalaryForDb(salary: SalaryInput) {
          if (!salary) return salary;
        
          return Object.fromEntries(
            Object.entries(salary).map(([key, val]) => [
              key,
              toNumber(val),
            ])
          ) as SalaryInput;
        }

        // 🔹 Insert or update related tables
        await upsert(employeesGeneralInfo, generalInfo);
        await upsert(employeesSalary, salary && {
          ...normalizeSalaryForDb(salary),
          customPayrollCode: normalizeOptionalFk(salary.customPayrollCode),
          customPayrollDescription: normalizeOptionalFk(salary.customPayrollDescription),
        });
        await upsert(employeesOtherReferences, otherReferences);
        await upsert(employeesTimekeeping, timekeeping);
      });

      return { message: `Employee ID #${id} saved successfully` };
    } catch (error) {
      console.error("❌ Error saving employee:", error);

      if (error instanceof Error && error.message === "DUPLICATE_EMPLOYEE_NO") {
        return { serverError: `Employee number "${employeeNo}" is already taken.` };
      }

      if (
        error instanceof Error &&
        error.message.includes("invalid input syntax for type")
      ) {
        const { fieldName, message } = parsePgError(parsedInput, error.message);
        return {
          validationErrors: {
            // Use the full path so RHF can identify the field
            [fieldName ?? "unknown"]: [message],
          },
        };
      }

      return { serverError: "Failed to save employee. Please try again." };
    }
  });

// export const saveEmployeeAction = actionClient
//   .metadata({ actionName: "saveEmployeeAction" })
//   .schema(insertEmployeeSchema, {
//     handleValidationErrorsShape: async (ve) =>
//       flattenValidationErrors(ve).fieldErrors,
//   })
//   .action(
//     async ({ parsedInput }: { parsedInput: InsertEmployeeSchemaType }) => {
//       const { isAuthenticated } = getKindeServerSession();
//       const isAuth = await isAuthenticated();
//       if (!isAuth) redirect("/login");

//       const {
//         id,
//         employeeNo,
//         firstName,
//         lastName,
//         middleName,
//         middleInitial,
//         suffix,
//         generalInfo,
//         salary,
//         otherReferences,
//         timekeeping,
//       } = parsedInput;

//       try {
//         if (!id) {
//           throw new Error("Employee ID must be provided from frontend (UUID).");
//         }

//         await db.transaction(async (tx) => {
//           type DBExecutor = Omit<typeof db, "$client">;

//           // 1.1: Check for unique employeeNo
//           const duplicateEmployee = await tx.query.employees.findFirst({
//             where: eq(employees.employeeNo, employeeNo),
//           });
//           if (duplicateEmployee && duplicateEmployee.id !== id) {
//             throw new Error("DUPLICATE_EMPLOYEE_NO");
//           }

//           // Always insert the employee row first if it doesn't exist
//           const existing = await tx.query.employees.findFirst({
//             where: eq(employees.id, id),
//           });

//           if (!existing) {
//             await tx.insert(employees).values({
//               id,
//               employeeNo,
//               firstName,
//               lastName,
//               middleName,
//               middleInitial,
//               suffix,
//             });
//           } else {
//             await tx
//               .update(employees)
//               .set({ employeeNo, firstName, lastName, middleName, middleInitial, suffix })
//               .where(eq(employees.id, id));
//           }

//           // Helper for inserting or updating related rows without transactions
//           const insertOrUpdate = async <T>(
//             executor: DBExecutor,
//             table: any,
//             data: T | undefined,
//             employeeId: string
//           ) => {
//             if (data) {
//               await executor
//                 .insert(table)
//                 .values({ ...data, employeeId })
//                 .onConflictDoUpdate({
//                   target: [table.employeeId],
//                   set: data,
//                 });
//             }
//           };

//           // Insert or update related tables
//           await insertOrUpdate(tx, employeesGeneralInfo, generalInfo, id);
//           await insertOrUpdate(tx, employeesSalary, salary, id);
//           await insertOrUpdate(tx, employeesOtherReferences, otherReferences, id);
//           await insertOrUpdate(tx, employeesTimekeeping, timekeeping, id);
//         });
//         return { message: `Employee ID #${id} saved successfully` };
//       } catch (error) {
//         console.error("Error saving employee:", error);

//         if (
//           error instanceof Error &&
//           error.message.includes("invalid input syntax for type")
//         ) {
//           const match = error.message.match(
//             /invalid input syntax for type \w+: "(.+?)"/
//           );
//           if (match) {
//             const invalidValue = match[1];

//             // Flatten all fields from parsedInput into a key-value map
//             const flattenFields = (
//               obj: Record<string, any>,
//               prefix = ""
//             ): Record<string, string> => {
//               const result: Record<string, string> = {};
//               for (const key in obj) {
//                 const value = obj[key];
//                 const path = prefix ? `${prefix}.${key}` : key;
//                 if (
//                   value &&
//                   typeof value === "object" &&
//                   !Array.isArray(value)
//                 ) {
//                   Object.assign(result, flattenFields(value, path));
//                 } else {
//                   result[path] = String(value);
//                 }
//               }
//               return result;
//             };

//             // Convert something like "monthlyRate" ➝ "Monthly Rate"
//             const prettifyFieldName = (fieldPath: string): string => {
//               const lastKey = fieldPath.split(".").pop() ?? fieldPath;
//               return lastKey
//                 .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase ➝ camel Case
//                 .replace(/_/g, " ") // snake_case ➝ snake case
//                 .replace(/\b\w/g, (c) => c.toUpperCase()); // capitalize words
//             };

//             const allFields = flattenFields(parsedInput);
//             const matchedField = Object.entries(allFields).find(
//               ([, value]) => value === invalidValue
//             );

//             const rawFieldPath = matchedField?.[0] ?? "unknown";
//             const prettyField = prettifyFieldName(rawFieldPath);

//             return {
//               serverError: `Invalid value for ${prettyField}: "${invalidValue}". Please check the input.`,
//             };
//           }
//         }

//         if (
//           error instanceof Error &&
//           error.message === "DUPLICATE_EMPLOYEE_NO"
//         ) {
//           return {
//             serverError: `Employee number "${employeeNo}" is already taken.`,
//           };
//         }

//         return {
//           serverError: "Failed to save employee. Please try again.",
//         };
//       }
//     }
//   );

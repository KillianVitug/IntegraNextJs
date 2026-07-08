"use server";

import { eq } from "drizzle-orm";
import { flattenValidationErrors } from "next-safe-action";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  employees,
  employeesGeneralInfo,
  employeesOtherReferences,
  employeesSalary,
  employeesTimekeeping,
} from "@/db/schema";
import { requireAdmin, syncLinkedAccountEmailTx } from "@/lib/auth/server";
import { actionClient } from "@/lib/safe-action";
import { SaveEmployeeResult } from "@/types/employeeResults";
import {
  InvalidEmployeeNoError,
  formatEmployeeCodeFromParts,
  normalizeEmployeeNoForSave,
  normalizeEmployeeTypeForSave,
} from "@/utils/employeeNo";
import { generateEmployeeNoTx } from "@/utils/generateEmployeeNo";
import { DEFAULT_EMPLOYEE_TYPE, isManagerialConfidentialityLevel } from "@/utils/employeeCode";
import {
  insertEmployeeSchema,
  type InsertEmployeeSchemaType,
} from "@/zod-schemas/employee";
import { normalizeSalaryForDb } from "@/lib/payroll/salaryNormalization";
import { markEmployeePayrollRunsStale } from "@/lib/payroll/staleRuns";

type EmployeeOwnedTable =
  | typeof employeesGeneralInfo
  | typeof employeesSalary
  | typeof employeesOtherReferences
  | typeof employeesTimekeeping;

const salaryImpactFields = [
  "dailyRate",
  "monthlyRate",
  "monthlyAllowance",
  "dailyAllowance",
  "cola",
  "rateDivisor",
  "billingRate",
  "ignoreDtrForMonthlyRate",
  "ignoreContributionDeduction",
  "customPayrollId",
  "customPayrollDescription",
  "slvlGroupId",
] as const;

const salaryRateFields = new Set<(typeof salaryImpactFields)[number]>([
  "dailyRate",
  "monthlyRate",
]);

const salaryMoneyFields = new Set<(typeof salaryImpactFields)[number]>([
  "monthlyAllowance",
  "dailyAllowance",
  "cola",
  "rateDivisor",
  "billingRate",
]);

const salaryIdFields = new Set<(typeof salaryImpactFields)[number]>([
  "customPayrollId",
  "slvlGroupId",
]);

function isDuplicateEmployeeNoError(error: unknown) {
  const dbError = error as {
    code?: string;
    constraint?: string;
    message?: string;
  };
  const message = dbError.message ?? "";
  const constraint = dbError.constraint ?? "";

  return (
    (dbError.code === "23505" &&
      (constraint === "employees_employee_type_no_unique" ||
        message.includes("employee_no"))) ||
    message.includes("employees_employee_type_no_unique") ||
    (message.includes("duplicate key value") && message.includes("employee_no"))
  );
}

function normalizeOptionalInt(value: string | number | null | undefined) {
  if (value === "" || value === undefined || value === null) return null;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function normalizeOtherReferences(
  otherReferences: InsertEmployeeSchemaType["otherReferences"],
) {
  if (!otherReferences) {
    return undefined;
  }

  return {
    ...otherReferences,
    email: otherReferences.email?.trim().toLowerCase() || null,
  };
}

function normalizeSalaryComparisonValue(
  field: (typeof salaryImpactFields)[number],
  value: unknown,
) {
  if (field === "ignoreDtrForMonthlyRate" || field === "ignoreContributionDeduction") {
    return value === true || value === "true";
  }

  if (value === "" || value === null || value === undefined) return null;

  if (salaryRateFields.has(field) || salaryMoneyFields.has(field)) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return null;
    return numericValue.toFixed(salaryRateFields.has(field) ? 4 : 2);
  }

  if (salaryIdFields.has(field)) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  return String(value).trim() || null;
}

function hasSalaryImpactChange(
  existingSalary: typeof employeesSalary.$inferSelect | null | undefined,
  normalizedSalary: Partial<typeof employeesSalary.$inferInsert>,
) {
  return salaryImpactFields.some((field) => {
    const nextValue = normalizeSalaryComparisonValue(
      field,
      normalizedSalary[field],
    );
    const existingValue = normalizeSalaryComparisonValue(
      field,
      existingSalary?.[field],
    );

    return nextValue !== existingValue;
  });
}

export const saveEmployeeAction = actionClient
  .metadata({ actionName: "saveEmployeeAction" })
  .schema(insertEmployeeSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(async ({ parsedInput }): Promise<SaveEmployeeResult> => {
    const auth = await requireAdmin();
    const canChooseEmployeeType = isManagerialConfidentialityLevel(
      auth.confidentialityLevel,
    );

    const {
      id,
      employeeType,
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

    const normalizedOtherReferences = normalizeOtherReferences(otherReferences);
    let attemptedEmployeeNo = employeeNo?.trim() ?? "";
    let attemptedEmployeeType = normalizeEmployeeTypeForSave(employeeType);

    try {
      return await db.transaction(async (tx) => {
        let employeeId = id;

        if (!employeeId) {
          const finalEmployeeType = canChooseEmployeeType
            ? normalizeEmployeeTypeForSave(employeeType)
            : DEFAULT_EMPLOYEE_TYPE;
          const finalEmployeeNo =
            employeeNo && employeeNo.trim() !== ""
              ? normalizeEmployeeNoForSave(employeeNo)
              : await generateEmployeeNoTx(tx, finalEmployeeType);
          attemptedEmployeeNo = finalEmployeeNo;
          attemptedEmployeeType = finalEmployeeType;

          const [created] = await tx
            .insert(employees)
            .values({
              employeeType: finalEmployeeType,
              employeeNo: finalEmployeeNo,
              firstName,
              lastName,
              middleName,
              middleInitial,
              suffix,
            })
            .returning({ id: employees.id });

          employeeId = created.id;
        } else {
          const [existingEmployee] = await tx
            .select({
              employeeType: employees.employeeType,
            })
            .from(employees)
            .where(eq(employees.id, employeeId))
            .limit(1);

          if (!existingEmployee) {
            throw new Error("Employee not found.");
          }

          const finalEmployeeNo = normalizeEmployeeNoForSave(employeeNo, {
            allowLegacyPrefix: true,
          });
          const finalEmployeeType = existingEmployee.employeeType;
          attemptedEmployeeNo = finalEmployeeNo;
          attemptedEmployeeType = finalEmployeeType;

          await tx
            .update(employees)
            .set({
              employeeType: finalEmployeeType,
              employeeNo: finalEmployeeNo,
              firstName,
              lastName,
              middleName,
              middleInitial,
              suffix,
            })
            .where(eq(employees.id, employeeId));
        }

        const upsert = async <T extends object>(
          table: EmployeeOwnedTable,
          data?: T,
        ) => {
          if (!data) return;

          await tx
            .insert(table)
            .values({ ...data, employeeId })
            .onConflictDoUpdate({
              target: [table.employeeId],
              set: data,
            });
        };

        const normalizedSalary = salary ? normalizeSalaryForDb(salary) : undefined;
        const existingSalary = normalizedSalary
          ? await tx.query.employeesSalary.findFirst({
              where: eq(employeesSalary.employeeId, employeeId),
            })
          : null;
        const salaryChanged =
          normalizedSalary != null &&
          hasSalaryImpactChange(existingSalary, normalizedSalary);

        await upsert(
          employeesGeneralInfo,
          generalInfo && {
            ...generalInfo,
            departmentId: normalizeOptionalInt(generalInfo.departmentId),
          },
        );
        await upsert(employeesSalary, normalizedSalary);
        await upsert(
          employeesOtherReferences,
          normalizedOtherReferences && {
            ...normalizedOtherReferences,
            positionId: normalizeOptionalInt(normalizedOtherReferences.positionId),
          },
        );
        await upsert(
          employeesTimekeeping,
          timekeeping && {
            ...timekeeping,
          },
        );

        await syncLinkedAccountEmailTx(
          tx,
          employeeId,
          normalizedOtherReferences?.email ?? null,
        );

        if (salaryChanged) {
          await markEmployeePayrollRunsStale({
            tx,
            employeeId,
            actorUserId: auth.accountId,
            notes: "Marked stale because employee salary setup changed.",
          });
        }

        revalidatePath("/employeeMaster");
        revalidatePath("/payroll");
        return {
          data: { employeeId },
          message: "Employee saved successfully",
        };
      });
    } catch (error) {
      if (error instanceof InvalidEmployeeNoError) {
        return {
          serverError: error.message,
        };
      }

      if (isDuplicateEmployeeNoError(error)) {
        return {
          serverError: `Employee number "${formatEmployeeCodeFromParts({
            employeeType: attemptedEmployeeType,
            employeeNo: attemptedEmployeeNo || employeeNo,
          })}" is already taken.`,
        };
      }

      if (error instanceof Error && error.message.includes("email")) {
        return {
          serverError: error.message,
        };
      }

      console.error(error);
      return { serverError: "Failed to save employee." };
    }
  });

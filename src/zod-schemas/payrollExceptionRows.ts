import { attendanceDtrDayTypeValues } from "@/lib/payroll/dtrOverrides";
import { overtimeCategoryValues } from "@/lib/payroll/overtime";
import {
  isPayrollExceptionDtrQuantityOnlyDeductionSource,
  payrollExceptionDtrOverrideSourceValues,
} from "@/lib/payroll/payrollExceptions";
import { z } from "zod";

const deductionAccountTypes = new Set([
  "Unpaid Leaves/Absences",
  "Loan",
  "Other Deduction",
]);

const amountOnlyDeductionAccountTypes = new Set(["Loan", "Other Deduction"]);

const hourBasedAccountTypes = new Set([
  "Regular Hours",
  "Overtime",
  "Night Premium",
  "Sunday/Holiday",
  "Paid Leaves",
  "Unpaid Leaves/Absences",
]);

function optionalNumber(max?: number) {
  return z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    max == null
      ? z.coerce.number().min(0).nullable()
      : z.coerce.number().min(0).max(max).nullable()
  );
}

export const savePayrollExceptionRowsSchema = z
  .object({
    payrollPeriodId: z.string().uuid(),
    employeeId: z.string().uuid(),
    rows: z.array(
      z.object({
        id: z.string().uuid().optional().nullable(),
        attendanceDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid attendance date."),
        accountCodeId: z.coerce.number().int().positive().nullable().optional(),
        accountCodeSnapshot: z.string().trim().max(50).optional().nullable(),
        accountTypeSnapshot: z.string().trim().max(80).optional().nullable(),
        accountDescriptionSnapshot: z.string().trim().max(80).optional().nullable(),
        dayType: z.enum(attendanceDtrDayTypeValues).nullable().optional(),
        overtimeCategory: z.enum(overtimeCategoryValues).nullable().optional(),
        dtrOverrideSource: z
          .enum(payrollExceptionDtrOverrideSourceValues)
          .nullable()
          .optional(),
        hours: optionalNumber().optional(),
        minutes: optionalNumber().optional(),
        amountOverride: optionalNumber(999999999).optional(),
        remarks: z
          .string()
          .trim()
          .max(500, "Remarks must be 500 characters or fewer.")
          .optional()
          .nullable(),
      })
    ),
  })
  .superRefine((value, ctx) => {
    const rowKeys = new Set<string>();

    value.rows.forEach((row, index) => {
      const accountType = row.accountTypeSnapshot ?? "";
      const isGeneratedQuantityOnlyDeduction =
        isPayrollExceptionDtrQuantityOnlyDeductionSource(row.dtrOverrideSource);
      const accountKey =
        row.accountCodeId != null
          ? String(row.accountCodeId)
          : row.accountCodeSnapshot?.trim() || "__missing__";
      const overtimeKey =
        accountType === "Overtime"
          ? row.overtimeCategory ?? "__missing_ot__"
          : "__none__";
      const key = `${accountKey}:${overtimeKey}`;

      if (rowKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "accountCodeId"],
          message:
            accountType === "Other Income"
              ? "Only one Other Income row per payroll period and account code is allowed."
              : "Only one account-code row per payroll period, account code, and OT category is allowed.",
        });
      }
      rowKeys.add(key);

      if (
        row.amountOverride != null &&
        !row.remarks?.trim() &&
        !deductionAccountTypes.has(accountType) &&
        accountType !== "Other Income"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "remarks"],
          message: "Remarks are required when an amount override is entered.",
        });
      }

      const quantityMinutes =
        Math.floor(row.hours ?? 0) * 60 + Math.floor(row.minutes ?? 0);

      if (
        accountType === "Other Income" &&
        (row.amountOverride == null || row.amountOverride <= 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "amountOverride"],
          message: "Enter an Other Income amount.",
        });
      }

      if (
        amountOnlyDeductionAccountTypes.has(accountType) &&
        !isGeneratedQuantityOnlyDeduction &&
        (row.amountOverride == null || row.amountOverride <= 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "amountOverride"],
          message: "Enter a deduction amount.",
        });
      }

      if (
        row.amountOverride == null &&
        (hourBasedAccountTypes.has(accountType) ||
          isGeneratedQuantityOnlyDeduction) &&
        quantityMinutes <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "hours"],
          message: "Enter hours/minutes or an amount override.",
        });
      }

      if (!row.accountCodeId && !row.accountCodeSnapshot?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", index, "accountCodeId"],
          message: "Select an account code.",
        });
      }
    });
  });

export type SavePayrollExceptionRowsSchemaType = z.infer<
  typeof savePayrollExceptionRowsSchema
>;

export const updatePayrollLoanInstallmentAmountSchema = z.object({
  payrollPeriodId: z.string().uuid(),
  employeeId: z.string().uuid(),
  installmentId: z.string().uuid(),
  scheduledAmount: z.preprocess(
    (value) => {
      if (typeof value === "string") return value.replaceAll(",", "").trim();
      return value;
    },
    z.coerce
      .number()
      .min(0.01, "Scheduled deduction must be greater than zero.")
      .max(999999999, "Scheduled deduction is too large.")
  ),
});

export type UpdatePayrollLoanInstallmentAmountSchemaType = z.infer<
  typeof updatePayrollLoanInstallmentAmountSchema
>;

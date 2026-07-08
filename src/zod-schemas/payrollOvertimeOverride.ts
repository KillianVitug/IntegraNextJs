import { overtimeCategoryValues } from "@/lib/payroll/overtime";
import { z } from "zod";

function zeroIfEmpty(max: number) {
  return z.preprocess(
    (value) => (value === "" || value == null ? 0 : value),
    z.coerce.number().int().min(0).max(max)
  );
}

function nullableIfEmpty(max: number) {
  return z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number().int().min(0).max(max).nullable()
  );
}

export const savePayrollOvertimeOverrideSchema = z.object({
  payrollPeriodId: z.string().uuid(),
  employeeId: z.string().uuid(),
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid attendance date."),
  isApproved: z.boolean(),
  category: z.enum(overtimeCategoryValues),
  manualHours: zeroIfEmpty(24),
  manualMinutes: zeroIfEmpty(59),
  workedHours: nullableIfEmpty(24).optional(),
  workedMinutes: nullableIfEmpty(59).optional(),
  remarks: z
    .string()
    .trim()
    .max(500, "Remarks must be 500 characters or fewer.")
    .optional()
    .nullable(),
});

export type SavePayrollOvertimeOverrideSchemaType = z.infer<
  typeof savePayrollOvertimeOverrideSchema
>;

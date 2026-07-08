import { z } from "zod";

const normalizedNumericString = z.preprocess((value) => {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.replace(/,/g, "").trim();
  return value;
}, z.string().regex(/^\d*\.?\d*$/, "Must be a number"));

const requiredNumericString = normalizedNumericString.refine(
  (value) => value !== "",
  "Required"
);

const requiredRateNumericString = requiredNumericString.refine(
  (value) => (value.split(".")[1]?.length ?? 0) <= 4,
  "Must have at most 4 decimal places"
);

export const salaryChangeModeSchema = z.enum([
  "OnePeriodOverride",
  "ForwardEffective",
  "MultiPeriodOverride",
]);

export const salaryChangeStatusSchema = z.enum([
  "Active",
  "Superseded",
  "Canceled",
  "AppliedPermanent",
]);

export const resolvedSalarySourceSchema = z.enum([
  "Base",
  "ForwardEffective",
  "MultiPeriodOverride",
  "OnePeriodOverride",
]);

export const salarySnapshotSchema = z.object({
  dailyRate: requiredRateNumericString,
  monthlyRate: requiredRateNumericString,
  monthlyAllowance: requiredNumericString,
  dailyAllowance: requiredNumericString,
  cola: requiredNumericString,
  rateDivisor: requiredNumericString,
  billingRate: requiredNumericString,
});

export const salarySnapshotNullableSchema = z.object({
  dailyRate: z.string().nullable(),
  monthlyRate: z.string().nullable(),
  monthlyAllowance: z.string().nullable(),
  dailyAllowance: z.string().nullable(),
  cola: z.string().nullable(),
  rateDivisor: z.string().nullable(),
  billingRate: z.string().nullable(),
});

export const createSalaryChangeSchema = z
  .object({
    employeeId: z.string().uuid(),
    payrollPeriodId: z.string().uuid(),
    endPayrollPeriodId: z.string().uuid().nullable().optional(),
    mode: salaryChangeModeSchema,
    reason: z.string().trim().min(1, "Reason is required"),
    notes: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : undefined)),
    ...salarySnapshotSchema.shape,
  })
  .superRefine((value, ctx) => {
    if (value.mode === "MultiPeriodOverride" && !value.endPayrollPeriodId) {
      ctx.addIssue({
        code: "custom",
        path: ["endPayrollPeriodId"],
        message: "To Payroll Period is required",
      });
    }
  });

export const cancelSalaryChangeSchema = z.object({
  changeId: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1, "Reason is required"),
});

export const makeBaseSalarySchema = z.object({
  employeeId: z.string().uuid(),
  changeId: z.coerce.number().int().positive(),
});

export const salaryChangePeriodLookupSchema = z.object({
  employeeId: z.string().uuid(),
  payrollPeriodId: z.string().uuid(),
});

export const salaryChangeFilterSchema = z.object({
  payrollPeriodId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  status: salaryChangeStatusSchema.optional(),
  year: z.coerce.number().int().optional(),
});

export const resolvedSalaryReadSchema = z.object({
  employeeId: z.string().uuid(),
  payrollPeriodId: z.string().uuid(),
  payrollCode: z.string(),
  salary: salarySnapshotSchema,
  adjustmentId: z.number().nullable(),
  adjustmentMode: salaryChangeModeSchema.nullable(),
  resolvedFrom: resolvedSalarySourceSchema,
  latestRunStatus: z.string().nullable(),
});

export const salaryChangeHistoryReadSchema = z.object({
  id: z.number(),
  employeeId: z.string().uuid(),
  employeeNo: z.string(),
  employeeType: z.string(),
  fullName: z.string(),
  payrollPeriodId: z.string().uuid(),
  endPayrollPeriodId: z.string().uuid().nullable(),
  payrollCode: z.string(),
  periodStartDate: z.string(),
  periodEndDate: z.string(),
  endPayrollCode: z.string().nullable(),
  endPeriodStartDate: z.string().nullable(),
  endPeriodEndDate: z.string().nullable(),
  mode: salaryChangeModeSchema,
  status: salaryChangeStatusSchema,
  reason: z.string(),
  notes: z.string().nullable(),
  createdByUserId: z.string(),
  createdAt: z.date(),
  supersededAt: z.date().nullable(),
  canceledAt: z.date().nullable(),
  appliedPermanentAt: z.date().nullable(),
  before: salarySnapshotNullableSchema,
  after: salarySnapshotNullableSchema,
});

export type SalaryChangeFilter = z.infer<typeof salaryChangeFilterSchema>;
export type SalaryChangeHistoryRead = z.infer<typeof salaryChangeHistoryReadSchema>;
export type SalaryChangeMode = z.infer<typeof salaryChangeModeSchema>;
export type SalaryChangeStatus = z.infer<typeof salaryChangeStatusSchema>;
export type SalarySnapshot = z.infer<typeof salarySnapshotSchema>;
export type SalarySnapshotNullable = z.infer<typeof salarySnapshotNullableSchema>;
export type CreateSalaryChangeInput = z.infer<typeof createSalaryChangeSchema>;
export type CancelSalaryChangeInput = z.infer<typeof cancelSalaryChangeSchema>;
export type MakeBaseSalaryInput = z.infer<typeof makeBaseSalarySchema>;
export type ResolvedSalaryRead = z.infer<typeof resolvedSalaryReadSchema>;

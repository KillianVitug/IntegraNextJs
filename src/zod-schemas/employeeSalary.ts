import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeesSalary } from "@/db/schema";
import { z } from "zod";
import {
  salaryChangeStatusSchema,
  salarySnapshotNullableSchema,
  salarySnapshotSchema,
} from "./salaryChange";

const numericString = z.preprocess((val) => {
  if (val == null || val === "") return "";
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return val.replace(/,/g, "").trim();
  return val;
}, z.string().regex(/^\d*\.?\d*$/, "Must be a number"));

const rateNumericString = numericString.refine(
  (value) => (value.split(".")[1]?.length ?? 0) <= 4,
  "Must have at most 4 decimal places"
);

const lookupIdString = z.preprocess((val) => {
  if (val == null) return val;
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return val.trim();
  return val;
}, z.union([
  z.string().regex(/^\d+$/, "Must be an integer id"),
  z.literal(""),
  z.null(),
  z.undefined(),
]));

export const insertEmployeeSalarySchema = createInsertSchema(employeesSalary, {
    id: z.number().optional(),
    employeeId: z.string().uuid().optional(),
    dailyRate: rateNumericString,
    monthlyRate: rateNumericString,
    monthlyAllowance: numericString,
    dailyAllowance: numericString,
    cola: numericString,
    rateDivisor: numericString,
    billingRate: numericString,
    ignoreDtrForMonthlyRate: z.boolean().default(false),
    ignoreContributionDeduction: z.boolean().default(false),
    slvlGroupId: lookupIdString,
    customPayrollId: lookupIdString,
    customPayrollDescription: z.string().nullable().optional(),
});

// New schema for salary updates
export const updateEmployeeSalarySchema = z.object({
  dailyRate: rateNumericString,
  monthlyRate: rateNumericString,
  monthlyAllowance: numericString,
  dailyAllowance: numericString,
  rateDivisor: numericString,
  billingRate: numericString,
  ignoreDtrForMonthlyRate: z.boolean().default(false).optional(),
  ignoreContributionDeduction: z.boolean().default(false).optional(),
  slvlGroupId: lookupIdString,
  customPayrollId: lookupIdString,
  customPayrollDescription: z.string().nullable().optional(),
});

export const selectEmployeeSalarySchema = createSelectSchema(employeesSalary);

export const employeeSalaryReadSchema = z.object({
  dailyRate: z.string(),
  monthlyRate: z.string(),
  monthlyAllowance: z.string(),
  dailyAllowance: z.string(),
  rateDivisor: z.string(),
  billingRate: z.string(),
  customPayrollCode: z.string().nullable(),
});

export const employeeSalaryUIViewSchema = z.object({
  dailyRate: z.string().nullable(),
  monthlyRate: z.string().nullable(),
  monthlyAllowance: z.string().nullable(),
  dailyAllowance: z.string().nullable(),
  rateDivisor: z.string().nullable(),
  billingRate: z.string().nullable(),
});

export const salaryAdjustmentReadSchema = z.object({
  id: z.number(),
  employeeId: z.string(),
  payrollCode: z.string(),
  employeeNo: z.string(),
  fullName: z.string(),
  oldDailyRate: z.string().nullable(),
  oldMonthlyRate: z.string().nullable(),
  oldMonthlyAllowance: z.string().nullable(),
  oldDailyAllowance: z.string().nullable(),
  oldRateDivisor: z.string().nullable(),
  oldBillingRate: z.string().nullable(),
  newDailyRate: z.string().nullable(),
  newMonthlyRate: z.string().nullable(),
  newMonthlyAllowance: z.string().nullable(),
  newDailyAllowance: z.string().nullable(),
  newRateDivisor: z.string().nullable(),
  newBillingRate: z.string().nullable(),
  adjustmentDate: z.date(),
});

export const employeeSalaryHistorySourceSchema = z.enum([
  "LegacyAdjustment",
  "SalaryChange",
]);

export const employeeSalaryHistoryModeSchema = z.enum([
  "Legacy",
  "OnePeriodOverride",
  "ForwardEffective",
  "MultiPeriodOverride",
]);

export const employeeSalaryHistoryStatusSchema = z.enum([
  "Applied",
  "Active",
  "Superseded",
  "Canceled",
  "AppliedPermanent",
]);

export const employeeMasterReferencePeriodSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  adjustedPayDate: z.string(),
  cycle: z.string(),
  status: z.string(),
});

export const employeeMasterEffectiveChangeSchema = z.object({
  id: z.number(),
  payrollPeriodId: z.string().uuid(),
  payrollCode: z.string(),
  periodStartDate: z.string(),
  periodEndDate: z.string(),
  mode: z.literal("ForwardEffective"),
  status: salaryChangeStatusSchema,
  reason: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  appliedPermanentAt: z.string().nullable(),
});

export const employeeSalaryTabViewSchema = z.object({
  baseSalary: salarySnapshotSchema,
  effectiveSalary: salarySnapshotSchema.nullable(),
  effectiveChange: employeeMasterEffectiveChangeSchema.nullable(),
  referencePeriod: employeeMasterReferencePeriodSchema.nullable(),
});

export const employeeSalaryHistoryRowSchema = z.object({
  historyId: z.string(),
  sourceId: z.number(),
  source: employeeSalaryHistorySourceSchema,
  eventDate: z.string(),
  payrollCode: z.string(),
  periodStartDate: z.string().nullable(),
  periodEndDate: z.string().nullable(),
  endPayrollCode: z.string().nullable(),
  endPeriodStartDate: z.string().nullable(),
  endPeriodEndDate: z.string().nullable(),
  mode: employeeSalaryHistoryModeSchema,
  status: employeeSalaryHistoryStatusSchema,
  reason: z.string().nullable(),
  notes: z.string().nullable(),
  appliedPermanentAt: z.string().nullable(),
  before: salarySnapshotNullableSchema,
  after: salarySnapshotNullableSchema,
});

export type SalaryAdjustmentRead = z.infer<typeof salaryAdjustmentReadSchema>;
export type EmployeeSalaryUIView = z.infer<typeof employeeSalaryUIViewSchema>;
export type EmployeeSalaryRead = z.infer<typeof employeeSalaryReadSchema>;
export type InsertEmployeeSalarySchemaType = z.infer<typeof insertEmployeeSalarySchema>;
export type UpdateEmployeeSalarySchemaType = z.infer<typeof updateEmployeeSalarySchema>;
export type SelectEmployeeSalarySchemaType = z.infer<typeof selectEmployeeSalarySchema>;
export type EmployeeMasterReferencePeriod = z.infer<
  typeof employeeMasterReferencePeriodSchema
>;
export type EmployeeMasterEffectiveChange = z.infer<
  typeof employeeMasterEffectiveChangeSchema
>;
export type EmployeeSalaryTabView = z.infer<typeof employeeSalaryTabViewSchema>;
export type EmployeeSalaryHistoryRow = z.infer<
  typeof employeeSalaryHistoryRowSchema
>;


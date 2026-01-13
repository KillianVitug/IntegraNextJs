import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeesSalary } from "@/db/schema";
import { z } from "zod";

const numericString = z.preprocess((val) => {
  if (val == null || val === "") return "";
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return val.replace(/,/g, "").trim();
  return val;
}, z.string().regex(/^\d*\.?\d*$/, "Must be a number"));

const numeric = z.coerce.number().default(0);

export const insertEmployeeSalarySchema = createInsertSchema(employeesSalary, {
    id: z.number().optional(),
    employeeId: z.string().uuid().optional(),
    dailyRate: numericString,
    monthlyRate: numericString,
    monthlyAllowance: numericString,
    dailyAllowance: numericString,
    cola: numericString,
    rateDivisor: numericString,
    billingRate: numericString,
    slvlGroupId: z.string().nullable().optional(),
});

// New schema for salary updates (excludes cola and slvlGroupId)
export const updateEmployeeSalarySchema = z.object({
  dailyRate: numericString,
  monthlyRate: numericString,
  monthlyAllowance: numericString,
  dailyAllowance: numericString,
  rateDivisor: numericString,
  billingRate: numericString,
  slvlGroupId: z.string().nullable().optional(),
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

export type SalaryAdjustmentRead = z.infer<typeof salaryAdjustmentReadSchema>;
export type EmployeeSalaryUIView = z.infer<typeof employeeSalaryUIViewSchema>;
export type EmployeeSalaryRead = z.infer<typeof employeeSalaryReadSchema>;
export type InsertEmployeeSalarySchemaType = z.infer<typeof insertEmployeeSalarySchema>;
export type UpdateEmployeeSalarySchemaType = z.infer<typeof updateEmployeeSalarySchema>;
export type SelectEmployeeSalarySchemaType = z.infer<typeof selectEmployeeSalarySchema>;



import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeesSalary } from "@/db/schema";
import { z } from "zod";

const numericString = z.preprocess(
    (val) => {
      if (val === null || val === undefined || val === "") return "";
      if (typeof val === "number") return val.toString();
      if (typeof val === "string") return val.trim();
      return val;
    },
    z
      .string()
      .regex(/^\d*\.?\d*$/, "Must be a number")
      .or(z.literal(""))
      .nullable()
      .optional()
  );

export const insertEmployeeSalarySchema = createInsertSchema(employeesSalary, {
    id: z.number().optional(),
    employeeId: z.string().uuid().optional().optional(),
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

export type InsertEmployeeSalarySchemaType = z.infer<typeof insertEmployeeSalarySchema>;
export type UpdateEmployeeSalarySchemaType = z.infer<typeof updateEmployeeSalarySchema>;
export type SelectEmployeeSalarySchemaType = z.infer<typeof selectEmployeeSalarySchema>;

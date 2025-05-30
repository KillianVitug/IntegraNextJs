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
    slvlGroupId: z.coerce.number().nullable(),
});
export const selectEmployeeSalarySchema = createSelectSchema(employeesSalary);

export type InsertEmployeeSalarySchemaType = z.infer<typeof insertEmployeeSalarySchema>;
export type SelectEmployeeSalarySchemaType = z.infer<typeof selectEmployeeSalarySchema>;

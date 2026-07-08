import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  categoryEnum,
  confidentialityLevelEnum,
  employeesGeneralInfo,
  employmentStatusEnum,
  payrollModeEnum,
  payrollTermsEnum,
  taxStatusEnum,
} from "@/db/schema";
import { z } from "zod";

export const insertEmployeeGeneralInfoSchema = createInsertSchema(
  employeesGeneralInfo,
  {
    id: z.number().optional(),
    employeeId: z.string().uuid().optional(),
    departmentId: z.string().nullable().optional(),
    payrollMode: z.enum(payrollModeEnum.enumValues).nullable().optional(),
    payrollTerms: z.enum(payrollTermsEnum.enumValues).nullable().optional(),
    category: z.enum(categoryEnum.enumValues).nullable().optional(),
    employmentStatus: z.enum(employmentStatusEnum.enumValues).nullable().optional(),
    confidentialityLevel: z
      .enum(confidentialityLevelEnum.enumValues)
      .nullable()
      .optional(),
    taxStatus: z.enum(taxStatusEnum.enumValues).nullable().optional(),
  },
);

export const selectEmployeeGeneralInfoSchema = createSelectSchema(
  employeesGeneralInfo,
  {
    payrollMode: z.enum(payrollModeEnum.enumValues).nullable(),
    payrollTerms: z.enum(payrollTermsEnum.enumValues).nullable(),
    category: z.enum(categoryEnum.enumValues).nullable(),
    employmentStatus: z.enum(employmentStatusEnum.enumValues).nullable(),
    confidentialityLevel: z.enum(confidentialityLevelEnum.enumValues).nullable(),
    taxStatus: z.enum(taxStatusEnum.enumValues).nullable(),
  },
);

export type InsertEmployeeGeneralInfoSchemaType = z.infer<
  typeof insertEmployeeGeneralInfoSchema
>;
export type SelectEmployeeGeneralInfoSchemaType = z.infer<
  typeof selectEmployeeGeneralInfoSchema
>;

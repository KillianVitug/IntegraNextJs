import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { contributionTypeEnum, basisOfComputationEnum, employeeContributionGroups } from "@/db/schema";
import {employeeContributionFlagsInputSchema} from "./payrollContributionFlags"
import { z } from "zod";

//Form Purposes
export const insertEmployeeContributionGroupSchema =
  createInsertSchema(employeeContributionGroups, {
    // payrollCode: z.coerce.number(), 
    // approximationPercent: z.coerce.number().min(0).max(100),
  });

export const selectEmployeeContributionGroupSchema =
  createSelectSchema(employeeContributionGroups);

export type InsertEmployeeContributionGroup =
  z.infer<typeof insertEmployeeContributionGroupSchema>;


//Server Purposes
export const payrollContributionSchema = z.object({
  basisOfComputation: z.enum(basisOfComputationEnum.enumValues),

  basisValue: z.coerce.number().nullable(),
  approximationPercent: z.coerce.number(),

  percentage: z.coerce.number().nullable(),
  fixedAmount: z.coerce.number().nullable(),
  minimum: z.coerce.number().nullable(),
  maximum: z.coerce.number().nullable(),

  fixedEmployeeShare: z.coerce.number(),
  fixedEmployerShare: z.coerce.number(),
  fixedECShare: z.coerce.number(),

  scheduleFlags: z.object({
    always: z.boolean(),
    endOfMonth: z.boolean(),
    firstPayroll: z.boolean(),
    secondPayroll: z.boolean(),
    thirdPayroll: z.boolean(),
    forthPayroll: z.boolean().optional(),
  }),

  flags: employeeContributionFlagsInputSchema.partial().optional(),
});

export type PayrollContribution =
  z.infer<typeof payrollContributionSchema>;
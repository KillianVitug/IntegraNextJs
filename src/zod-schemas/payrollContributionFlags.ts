import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeeContributionFlags } from "@/db/schema";
import { z } from "zod";

//Form Purposes
export const insertEmployeeContributionFlagsSchema =
  createInsertSchema(employeeContributionFlags, {
    // groupId: z.coerce.number(),
  });

export const selectEmployeeContributionFlagsSchema =
  createSelectSchema(employeeContributionFlags);

export type InsertEmployeeContributionFlags =
  z.infer<typeof insertEmployeeContributionFlagsSchema>;

//Server Purposes
export const employeeContributionFlagsInputSchema = z.object({
  scheduleAlways: z.boolean(),
  scheduleEndOfMonth: z.boolean(),
  scheduleFirstPayroll: z.boolean(),
  scheduleSecondPayroll: z.boolean(),
  scheduleThirdPayroll: z.boolean(),
  scheduleForthPayroll: z.boolean(),

  pagibigMaxContribution: z.boolean().optional(),
  pagibigDeductShare: z.boolean().optional(),
  peraaComputeBoth: z.boolean().optional(),
  peraaComputeEmployer: z.boolean().optional(),
  taxFixedPercentage: z.boolean().optional(),
  taxFixedValue: z.coerce.number().optional(),
  taxMonthEndAdjustment: z.boolean().optional(),

  flag1: z.boolean().optional(),
  flag2: z.boolean().optional(),
  flag3: z.boolean().optional(),
});

export type EmployeeContributionFlagsInput =
  z.infer<typeof employeeContributionFlagsInputSchema>;
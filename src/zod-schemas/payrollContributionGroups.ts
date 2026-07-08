import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { /*contributionTypeEnum,*/ basisOfComputationEnum, employeeContributionGroups } from "@/db/schema";
import {employeeContributionFlagsInputSchema} from "./payrollContributionFlags"
import { z } from "zod";

const numericString = z.preprocess((val) => {
  if (val === "") return null;
  if (val == null) return null;
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return val.replace(/,/g, "").trim();
  return val;
}, z.string().regex(/^\d*\.?\d*$/, "Must be a number").nullable());


//Form Purposes
export const insertEmployeeContributionGroupSchema =
  createInsertSchema(employeeContributionGroups, {
    // payrollCode: z.coerce.number(), 
    // approximationPercent: z.coerce.number().min(0).max(100),
  });
  
  //Server Purposes
  const scheduleFlagsSchema = z.object({
    always: z.boolean(),
    endOfMonth: z.boolean(),
    firstPayroll: z.boolean(),
    secondPayroll: z.boolean(),
    thirdPayroll: z.boolean(),
    forthPayroll: z.boolean(),
  });
  
  export const payrollContributionSchema = z.object({
    basisOfComputation: z.enum(basisOfComputationEnum.enumValues),
  
    basisValue: numericString.nullable(),
    approximationPercent: z.coerce.number(),
  
    percentage: numericString.nullable(),
    fixedAmount: numericString.nullable(),
    minimum: numericString.nullable(),
    maximum: numericString.nullable(),
  
    fixedEmployeeShare: numericString.nullable(),
    fixedEmployerShare: numericString.nullable(),
    fixedECShare: numericString.nullable(),

    
  
    scheduleFlags: scheduleFlagsSchema,
    flags: employeeContributionFlagsInputSchema.partial().optional(),
  });

export const selectEmployeeContributionGroupSchema =
  createSelectSchema(employeeContributionGroups);

export type InsertEmployeeContributionGroup =
  z.infer<typeof insertEmployeeContributionGroupSchema>;

export type PayrollContribution =
  z.infer<typeof payrollContributionSchema>;
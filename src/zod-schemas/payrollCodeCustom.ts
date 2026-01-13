import { z } from "zod";
import {
  customPayrollDefinitionInputSchema,
  insertCustomPayrollDefinitionSchema,
  selectCustomPayrollDefinitionSchema,
} from "./payrollCodeDefinitions";
import {
  payrollContributionSchema,
  // insertEmployeeContributionGroupSchema,
  selectEmployeeContributionGroupSchema,
} from "./payrollContributionGroups";
import {
  // employeeContributionFlagsInputSchema,
  // insertEmployeeContributionFlagsSchema,
  selectEmployeeContributionFlagsSchema,
} from "./payrollContributionFlags";

// import { basisOfComputationEnum, contributionTypeEnum } from "@/db/schema"

//Form Purposes
export const insertCustomPayrollSchema =
  insertCustomPayrollDefinitionSchema.extend({
    
  });


  
const selectEmployeeContributionGroupWithFlagsSchema =
  selectEmployeeContributionGroupSchema.extend({
    flags: selectEmployeeContributionFlagsSchema.optional(),
  });
  
export const selectCustomPayrollWithRelationsSchema =
selectCustomPayrollDefinitionSchema.extend({
  contributionGroups:
      selectEmployeeContributionGroupWithFlagsSchema.array(),
  });
  
  export type SelectCustomPayrollWithRelations =
  z.infer<typeof selectCustomPayrollWithRelationsSchema>;

  export type InsertCustomPayrollSchemaType =
  z.infer<typeof insertCustomPayrollSchema>;


//Server Purposes
export const customPayrollPayloadSchema =
  customPayrollDefinitionInputSchema.extend({
    contributions: z.record(
      payrollContributionSchema
    ),
  });

export type CustomPayrollPayload =
  z.infer<typeof customPayrollPayloadSchema>;



  // export const payrollContributionPayloadSchema = z.object({
  //   contributionType: z.enum(contributionTypeEnum.enumValues),
  //   basisOfComputation: z.enum(basisOfComputationEnum.enumValues),   
  //   basisValue: z.string().nullable(),
  //   approximationPercent: z.string(),
  //   percentage: z.string().nullable(),
  //   fixedAmount: z.string().nullable(),
  //   minimum: z.string().nullable(),
  //   maximum: z.string().nullable(),
  //   fixedEmployeeShare: z.string().nullable(),
  //   fixedEmployerShare: z.string().nullable(),
  //   fixedECShare: z.string().nullable(),
  
  //   scheduleFlags: z.object({
  //     always: z.boolean(),
  //     endOfMonth: z.boolean(),
  //     firstPayroll: z.boolean(),
  //     secondPayroll: z.boolean(),
  //     thirdPayroll: z.boolean(),
  //     forthPayroll: z.boolean().optional(),
  //   }),
  
  //   flags: z.object({
  //     flag1: z.boolean().optional(),
  //     flag2: z.boolean().optional(),
  //     flag3: z.boolean().optional(),
  //   }).optional(),
  // });
  
  // export const customPayrollPayloadSchema = z.object({
  //   code: z.string(),
  //   description: z.string().nullable(),
  //   rateDivisor: z.string().nullable(),
  //   hourlyRateDivisor: z.string().nullable(),
  //   contributions: z.record(payrollContributionPayloadSchema),
  // });
  
  // export type CustomPayrollPayload = z.infer<typeof customPayrollPayloadSchema>;
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { philhealthContributionRates } from "@/db/schema";
import { z } from "zod";
import { requiredNumberField } from "./helpers";

export const insertPhilhealthContributionRateSchema = createInsertSchema(
  philhealthContributionRates,
  {
    id: z.number().optional().or(z.literal(0)),
    versionId: z.coerce.number().positive("Version is required"),
    monthlyBasicSalaryFloor: requiredNumberField("Monthly Salary Floor"),
    monthlyBasicSalaryCeiling: requiredNumberField("Monthly Salary Ceiling"),
    premiumRate: requiredNumberField("Premium Rate"),
    employeeShareRate: requiredNumberField("Employee Share Rate"),
    employerShareRate: requiredNumberField("Employer Share Rate"),
  }
).refine(
  (data) => data.monthlyBasicSalaryCeiling >= data.monthlyBasicSalaryFloor,
  {
    message: "Monthly Salary Ceiling must be on or after Monthly Salary Floor",
    path: ["monthlyBasicSalaryCeiling"],
  }
);

export const selectPhilhealthContributionRateSchema = createSelectSchema(
  philhealthContributionRates,
  {
    monthlyBasicSalaryFloor: z.coerce.number(),
    monthlyBasicSalaryCeiling: z.coerce.number(),
    premiumRate: z.coerce.number(),
    employeeShareRate: z.coerce.number(),
    employerShareRate: z.coerce.number(),
  }
);

export const deletePhilhealthContributionRateSchema = z.object({
  id: z.coerce.number().positive(),
});

export type InsertPhilhealthContributionRateSchemaType = z.infer<
  typeof insertPhilhealthContributionRateSchema
>;
export type SelectPhilhealthContributionRateSchemaType = z.infer<
  typeof selectPhilhealthContributionRateSchema
>;

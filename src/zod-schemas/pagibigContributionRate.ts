import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { pagibigContributionRates } from "@/db/schema";
import { z } from "zod";
import { optionalNumberField, requiredNumberField } from "./helpers";

export const insertPagibigContributionRateSchema = createInsertSchema(
  pagibigContributionRates,
  {
    id: z.number().optional().or(z.literal(0)),
    versionId: z.coerce.number().positive("Version is required"),
    rangeFrom: requiredNumberField("Range From"),
    rangeTo: requiredNumberField("Range To"),
    employeeRate: requiredNumberField("Employee Rate"),
    employerRate: requiredNumberField("Employer Rate"),
    maxCompensationBase: optionalNumberField(),
  }
).refine((data) => data.rangeTo >= data.rangeFrom, {
  message: "Range To must be greater than or equal to Range From",
  path: ["rangeTo"],
});

export const selectPagibigContributionRateSchema = createSelectSchema(
  pagibigContributionRates,
  {
    rangeFrom: z.coerce.number(),
    rangeTo: z.coerce.number(),
    employeeRate: z.coerce.number(),
    employerRate: z.coerce.number(),
    maxCompensationBase: z.coerce.number().nullable(),
  }
);

export const deletePagibigContributionRateSchema = z.object({
  id: z.coerce.number().positive(),
});

export type InsertPagibigContributionRateSchemaType = z.infer<
  typeof insertPagibigContributionRateSchema
>;
export type SelectPagibigContributionRateSchemaType = z.infer<
  typeof selectPagibigContributionRateSchema
>;

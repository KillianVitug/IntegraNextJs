import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { sssContributionBrackets } from "@/db/schema";
import { z } from "zod";
import { requiredNumberField } from "./helpers";

export const insertSssContributionBracketSchema = createInsertSchema(
  sssContributionBrackets,
  {
    id: z.number().optional().or(z.literal(0)),
    versionId: z.coerce.number().positive("Version is required"),
    rangeFrom: requiredNumberField("Range From"),
    rangeTo: requiredNumberField("Range To"),
    salaryCredit: requiredNumberField("Salary Credit"),
    employeeShare: requiredNumberField("Employee Share"),
    employerShare: requiredNumberField("Employer Share"),
    ecShare: requiredNumberField("EC Share"),
  }
).refine((data) => data.rangeTo >= data.rangeFrom, {
  message: "Range To must be greater than or equal to Range From",
  path: ["rangeTo"],
});

export const selectSssContributionBracketSchema = createSelectSchema(
  sssContributionBrackets,
  {
    rangeFrom: z.coerce.number(),
    rangeTo: z.coerce.number(),
    salaryCredit: z.coerce.number(),
    employeeShare: z.coerce.number(),
    employerShare: z.coerce.number(),
    ecShare: z.coerce.number(),
  }
);

export const deleteSssContributionBracketSchema = z.object({
  id: z.coerce.number().positive(),
});

export type InsertSssContributionBracketSchemaType = z.infer<
  typeof insertSssContributionBracketSchema
>;
export type SelectSssContributionBracketSchemaType = z.infer<
  typeof selectSssContributionBracketSchema
>;

import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { birWithholdingTaxBrackets } from "@/db/schema";
import { z } from "zod";
import { optionalNumberField, requiredNumberField } from "./helpers";

export const insertBirWithholdingTaxBracketSchema = createInsertSchema(
  birWithholdingTaxBrackets,
  {
    id: z.number().optional().or(z.literal(0)),
    versionId: z.coerce.number().positive("Version is required"),
    payrollTerms: z.literal("Semi-Monthly"),
    compensationFrom: requiredNumberField("Compensation From"),
    compensationTo: optionalNumberField(),
    baseTax: requiredNumberField("Base Tax"),
    overPercentage: requiredNumberField("Over Percentage"),
  }
).refine(
  (data) => data.compensationTo == null || data.compensationTo >= data.compensationFrom,
  {
    message: "Compensation To must be greater than or equal to Compensation From",
    path: ["compensationTo"],
  }
);

export const selectBirWithholdingTaxBracketSchema = createSelectSchema(
  birWithholdingTaxBrackets,
  {
    compensationFrom: z.coerce.number(),
    compensationTo: z.coerce.number().nullable(),
    baseTax: z.coerce.number(),
    overPercentage: z.coerce.number(),
  }
);

export const deleteBirWithholdingTaxBracketSchema = z.object({
  id: z.coerce.number().positive(),
});

export type InsertBirWithholdingTaxBracketSchemaType = z.infer<
  typeof insertBirWithholdingTaxBracketSchema
>;
export type SelectBirWithholdingTaxBracketSchemaType = z.infer<
  typeof selectBirWithholdingTaxBracketSchema
>;

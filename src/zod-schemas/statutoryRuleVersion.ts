import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  payrollTermsEnum,
  statutoryRuleTypeEnum,
  statutoryRuleVersions,
} from "@/db/schema";
import { z } from "zod";
import {
  optionalDateField,
  optionalTextField,
  requiredDateField,
} from "./helpers";

export const insertStatutoryRuleVersionSchema = createInsertSchema(
  statutoryRuleVersions,
  {
    id: z.number().optional().or(z.literal(0)),
    ruleType: z.enum(statutoryRuleTypeEnum.enumValues),
    code: z.string().min(1, "Code is required"),
    description: optionalTextField,
    payrollTerms: z.literal("Semi-Monthly"),
    effectiveFrom: requiredDateField("Effective From"),
    effectiveTo: optionalDateField,
    isDefault: z.boolean().default(false),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
  },
).refine(
  (data) =>
    !data.effectiveTo ||
    new Date(`${data.effectiveTo}T00:00:00`) >=
      new Date(`${data.effectiveFrom}T00:00:00`),
  {
    message: "Effective To must be on or after Effective From",
    path: ["effectiveTo"],
  },
);

export const selectStatutoryRuleVersionSchema = createSelectSchema(
  statutoryRuleVersions,
  {
    ruleType: z.enum(statutoryRuleTypeEnum.enumValues),
    payrollTerms: z.enum(payrollTermsEnum.enumValues),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
  },
);

export const deleteStatutoryRuleVersionSchema = z.object({
  id: z.coerce
    .number()
    .positive("Version ID must be a positive number"),
});

export type InsertStatutoryRuleVersionSchemaType = z.infer<
  typeof insertStatutoryRuleVersionSchema
>;
export type SelectStatutoryRuleVersionSchemaType = z.infer<
  typeof selectStatutoryRuleVersionSchema
>;
export type DeleteStatutoryRuleVersionSchemaType = z.infer<
  typeof deleteStatutoryRuleVersionSchema
>;

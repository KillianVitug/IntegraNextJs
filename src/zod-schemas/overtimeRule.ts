import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { overtimeRules } from "@/db/schema";
import { overtimeCategoryValues } from "@/lib/payroll/overtime";
import { z } from "zod";

const optionalMinutesTo = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  z.coerce.number().int().min(0).nullable()
);

export const insertOvertimeRuleSchema = createInsertSchema(overtimeRules, {
  id: z.coerce.number().optional(),
  category: z.enum(overtimeCategoryValues),
  minutesFrom: z.coerce.number().int().min(0),
  minutesTo: optionalMinutesTo,
  rateMultiplier: z.coerce.number().positive(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
}).superRefine((value, ctx) => {
  if (value.minutesTo != null && value.minutesTo < value.minutesFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["minutesTo"],
      message: "Minutes To cannot be earlier than Minutes From.",
    });
  }
});

export const selectOvertimeRuleSchema = createSelectSchema(overtimeRules, {
  category: z.enum(overtimeCategoryValues),
  minutesFrom: z.coerce.number(),
  minutesTo: z.coerce.number().nullable(),
  rateMultiplier: z.coerce.number(),
});

export const deleteOvertimeRuleSchema = z.object({
  id: z.coerce.number().positive(),
});

export type InsertOvertimeRuleSchemaType = z.infer<typeof insertOvertimeRuleSchema>;
export type SelectOvertimeRuleSchemaType = z.infer<typeof selectOvertimeRuleSchema>;

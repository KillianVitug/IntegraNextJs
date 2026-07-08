import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { tardinessRules } from "@/db/schema";
import { z } from "zod";

const optionalMinutesTo = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  z.coerce.number().int().min(0).nullable()
);

export const insertTardinessRuleSchema = createInsertSchema(tardinessRules, {
  id: z.coerce.number().optional(),
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

export const selectTardinessRuleSchema = createSelectSchema(tardinessRules, {
  minutesFrom: z.coerce.number(),
  minutesTo: z.coerce.number().nullable(),
  rateMultiplier: z.coerce.number(),
});

export const deleteTardinessRuleSchema = z.object({
  id: z.coerce.number().positive(),
});

export type InsertTardinessRuleSchemaType = z.infer<typeof insertTardinessRuleSchema>;
export type SelectTardinessRuleSchemaType = z.infer<typeof selectTardinessRuleSchema>;

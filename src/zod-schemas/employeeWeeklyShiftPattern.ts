import { z } from "zod";
import { restDayEnum } from "@/db/schema";

const weekdayEnumValues = restDayEnum.enumValues;

const nullableShiftTableIdSchema = z.preprocess((value) => {
  if (value == null || value === "") return null;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}, z.coerce.number().int().positive().nullable());

export const employeeWeeklyShiftPatternDayInputSchema = z.object({
  weekday: z.enum(weekdayEnumValues),
  shiftTableId: nullableShiftTableIdSchema,
});

export const upsertEmployeeWeeklyShiftPatternSchema = z
  .object({
    id: z.coerce.number().int().positive().optional(),
    employeeId: z.string().uuid(),
    effectiveFrom: z.string().min(1),
    effectiveTo: z.string().min(1).nullable().optional(),
    days: z.array(employeeWeeklyShiftPatternDayInputSchema).length(weekdayEnumValues.length),
  })
  .superRefine((value, ctx) => {
    const seenWeekdays = new Set<string>();

    for (const [index, day] of value.days.entries()) {
      if (seenWeekdays.has(day.weekday)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["days", index, "weekday"],
          message: "Each weekday can only appear once.",
        });
      }

      seenWeekdays.add(day.weekday);
    }

    for (const weekday of weekdayEnumValues) {
      if (!seenWeekdays.has(weekday)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["days"],
          message: "All weekdays must be included in the weekly pattern.",
        });
        break;
      }
    }
  });

export const deleteEmployeeWeeklyShiftPatternSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type EmployeeWeeklyShiftPatternDayInput = z.infer<
  typeof employeeWeeklyShiftPatternDayInputSchema
>;
export type UpsertEmployeeWeeklyShiftPatternInput = z.infer<
  typeof upsertEmployeeWeeklyShiftPatternSchema
>;

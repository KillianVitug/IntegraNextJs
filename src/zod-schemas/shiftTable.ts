import { z } from "zod";
import { shiftBreakSlotEnum } from "@/db/schema";
import {
  SHIFT_BREAK_SLOT_DEFINITIONS,
  getShiftBreakSlotDefinition,
  getTimeRangeDurationMinutes,
  parseTimeToMinutes,
} from "@/lib/shifts";

const optionalTimeSchema = z.preprocess(
  (value) => (value === "" || value == null ? null : String(value)),
  z.string().nullable()
);

const shiftBreakInputSchema = z.object({
  slotKey: z.enum(shiftBreakSlotEnum.enumValues),
  fromTime: optionalTimeSchema,
  toTime: optionalTimeSchema,
  deduct: z.coerce.boolean().default(false),
  deductHours: z.coerce.number().int().min(0).max(23).default(0),
  deductMinutes: z.coerce.number().int().min(0).max(59).default(0),
});

const shiftBreakSelectSchema = shiftBreakInputSchema.extend({
  label: z.string(),
  sortOrder: z.coerce.number().int(),
});

export const insertShiftTableSchema = z
  .object({
    id: z.coerce.number().int().positive().optional(),
    code: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(120),
    regularStartTime: z.string().min(1),
    regularEndTime: z.string().min(1),
    breaks: z.array(shiftBreakInputSchema).length(SHIFT_BREAK_SLOT_DEFINITIONS.length),
  })
  .superRefine((value, ctx) => {
    const shiftDurationMinutes = getTimeRangeDurationMinutes(
      value.regularStartTime,
      value.regularEndTime
    );
    const shiftStartMinutes = parseTimeToMinutes(value.regularStartTime);
    const shiftEndMinutes = parseTimeToMinutes(value.regularEndTime);

    if (
      shiftDurationMinutes == null ||
      shiftStartMinutes == null ||
      shiftEndMinutes == null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["regularStartTime"],
        message: "Regular working hours must have valid start and end times.",
      });
      return;
    }

    const isOvernight = shiftEndMinutes <= shiftStartMinutes;
    const shiftEndAbsolute = shiftStartMinutes + shiftDurationMinutes;
    let deductibleRegularMinutes = 0;

    const activeWindows: Array<{
      breakIndex: number;
      label: string;
      fromAbsolute: number;
      toAbsolute: number;
    }> = [];

    for (const [index, breakRow] of value.breaks.entries()) {
      const expectedDefinition = SHIFT_BREAK_SLOT_DEFINITIONS[index];
      const definition = getShiftBreakSlotDefinition(breakRow.slotKey);

      if (!expectedDefinition || breakRow.slotKey !== expectedDefinition.slotKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", index, "slotKey"],
          message: "Break rows must keep the fixed slot order.",
        });
      }

      if (!definition) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", index, "slotKey"],
          message: "Invalid break slot.",
        });
        continue;
      }

      const hasAnyValue =
        Boolean(breakRow.fromTime) ||
        Boolean(breakRow.toTime) ||
        breakRow.deduct ||
        breakRow.deductHours > 0 ||
        breakRow.deductMinutes > 0;

      if (definition.required && !breakRow.fromTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", index, "fromTime"],
          message: `${definition.label} start time is required.`,
        });
      }

      if (definition.required && !breakRow.toTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", index, "toTime"],
          message: `${definition.label} end time is required.`,
        });
      }

      if (!definition.required && !hasAnyValue) {
        continue;
      }

      if (!breakRow.fromTime || !breakRow.toTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", index, "fromTime"],
          message: `${definition.label} must have both From and To values.`,
        });
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", index, "toTime"],
          message: `${definition.label} must have both From and To values.`,
        });
        continue;
      }

      const fromBase = parseTimeToMinutes(breakRow.fromTime);
      const toBase = parseTimeToMinutes(breakRow.toTime);

      if (fromBase == null || toBase == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", index, "fromTime"],
          message: `${definition.label} must use valid time values.`,
        });
        continue;
      }

      const fromAbsolute =
        isOvernight && fromBase < shiftStartMinutes ? fromBase + 1440 : fromBase;
      const toBaseAbsolute =
        isOvernight && toBase < shiftStartMinutes ? toBase + 1440 : toBase;
      const toAbsolute =
        toBaseAbsolute <= fromAbsolute ? toBaseAbsolute + 1440 : toBaseAbsolute;
      const durationMinutes = toAbsolute - fromAbsolute;
      const deductedMinutes = breakRow.deduct
        ? breakRow.deductHours * 60 + breakRow.deductMinutes
        : 0;

      if (!breakRow.deduct && (breakRow.deductHours > 0 || breakRow.deductMinutes > 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", index, "deduct"],
          message: "Enable Deduct before entering deductible hours or minutes.",
        });
      }

      if (breakRow.deduct && deductedMinutes <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", index, "deductHours"],
          message: "Deducted duration must be greater than zero.",
        });
      }

      if (deductedMinutes > durationMinutes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", index, "deductHours"],
          message: "Deducted duration cannot exceed the break window.",
        });
      }

      if (
        definition.category === "regular" &&
        (fromAbsolute < shiftStartMinutes || toAbsolute > shiftEndAbsolute)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", index, "fromTime"],
          message: `${definition.label} must be within regular working hours.`,
        });
      }

      if (definition.category === "regular") {
        deductibleRegularMinutes += deductedMinutes;
      }

      activeWindows.push({
        breakIndex: index,
        label: definition.label,
        fromAbsolute,
        toAbsolute,
      });
    }

    for (let index = 0; index < activeWindows.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < activeWindows.length; compareIndex += 1) {
        const current = activeWindows[index];
        const next = activeWindows[compareIndex];

        const overlaps =
          current.fromAbsolute < next.toAbsolute &&
          next.fromAbsolute < current.toAbsolute;

        if (!overlaps) continue;

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", current.breakIndex, "fromTime"],
          message: `${current.label} overlaps with ${next.label}.`,
        });
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["breaks", next.breakIndex, "fromTime"],
          message: `${next.label} overlaps with ${current.label}.`,
        });
      }
    }

    if (deductibleRegularMinutes > shiftDurationMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["breaks", 0, "deductHours"],
        message: "Total deductible regular breaks cannot exceed the regular shift duration.",
      });
    }
  });

export const selectShiftTableSchema = z.object({
  id: z.coerce.number().int().positive(),
  code: z.string(),
  description: z.string(),
  regularStartTime: z.string(),
  regularEndTime: z.string(),
  deductibleBreakMinutes: z.coerce.number(),
  paidBreakMinutes: z.coerce.number(),
  hoursPerDay: z.coerce.number(),
  breaks: z.array(shiftBreakSelectSchema),
});

export const deleteShiftTableSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type InsertShiftTableSchemaType = z.infer<typeof insertShiftTableSchema>;
export type SelectShiftTableSchemaType = z.infer<typeof selectShiftTableSchema>;

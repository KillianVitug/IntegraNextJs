import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  holidayTemplates,
  holidayYearCalendar,
  holidayTypeEnum,
  holidayTemplateRecurrenceEnum,
  holidayYearSourceEnum,
  holidayYearStatusEnum,
} from "@/db/schema";
import { z } from "zod";

const nullableDateString = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  z.string().nullable()
);

const nullableInteger = z.preprocess(
  (value) => (value === "" || value == null ? null : Number(value)),
  z.number().int().nullable()
);

const optionalDate = z.coerce.date().optional();

function requireRange(
  ctx: z.RefinementCtx,
  value: number | null | undefined,
  path: string,
  min: number,
  max: number,
  label: string
) {
  if (value == null || (value >= min && value <= max)) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [path],
    message: `${label} must be between ${min} and ${max}.`,
  });
}

export const insertHolidayTemplateSchema = createInsertSchema(holidayTemplates, {
  id: z.coerce.number().optional(),
  name: z.string().trim().min(1, "Holiday name is required.").max(150),
  holidayType: z.enum(holidayTypeEnum.enumValues),
  recurrenceType: z.enum(holidayTemplateRecurrenceEnum.enumValues),
  fixedMonth: nullableInteger,
  fixedDay: nullableInteger,
  nthMonth: nullableInteger,
  nthWeekday: nullableInteger,
  nthOccurrence: nullableInteger,
  durationDays: z.coerce.number().int().min(1).max(31),
  notes: z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.string().nullable()
  ),
  createdAt: optionalDate,
  updatedAt: optionalDate,
}).superRefine((value, ctx) => {
  requireRange(ctx, value.durationDays, "durationDays", 1, 31, "Duration");

  if (value.recurrenceType === "FixedDate") {
    requireRange(ctx, value.fixedMonth, "fixedMonth", 1, 12, "Fixed month");
    requireRange(ctx, value.fixedDay, "fixedDay", 1, 31, "Fixed day");
  }

  if (value.recurrenceType === "NthWeekday") {
    requireRange(ctx, value.nthMonth, "nthMonth", 1, 12, "Month");
    requireRange(ctx, value.nthWeekday, "nthWeekday", 0, 6, "Weekday");

    if (
      value.nthOccurrence == null ||
      ![-1, 1, 2, 3, 4, 5].includes(value.nthOccurrence)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nthOccurrence"],
        message: "Occurrence must be first through fifth, or last.",
      });
    }
  }
});

export const selectHolidayTemplateSchema = createSelectSchema(holidayTemplates, {
  holidayType: z.enum(holidayTypeEnum.enumValues),
  recurrenceType: z.enum(holidayTemplateRecurrenceEnum.enumValues),
});

export const insertHolidayYearCalendarSchema = createInsertSchema(
  holidayYearCalendar,
  {
    id: z.coerce.number().optional(),
    year: z.coerce.number().int().min(2000).max(2100),
    templateId: nullableInteger.optional(),
    source: z.enum(holidayYearSourceEnum.enumValues),
    name: z.string().trim().min(1, "Holiday name is required.").max(150),
    holidayDate: nullableDateString,
    holidayDate2: nullableDateString,
    checkDate1: nullableDateString,
    checkDate2: nullableDateString,
    requireCheckDate1: z.coerce.boolean().default(false),
    requireCheckDate2: z.coerce.boolean().default(false),
    holidayType: z.enum(holidayTypeEnum.enumValues),
    status: z.enum(holidayYearStatusEnum.enumValues),
    notes: z.preprocess(
      (value) => (value === "" || value == null ? null : value),
      z.string().nullable()
    ),
    generatedAt: optionalDate,
    createdAt: optionalDate,
    updatedAt: optionalDate,
  }
).superRefine((value, ctx) => {
  if (value.status === "Confirmed" && !value.holidayDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["holidayDate"],
      message: "Confirmed holidays need a holiday date.",
    });
  }

  if (value.holidayDate2 && !value.holidayDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["holidayDate"],
      message: "Holiday Date is required when Holiday Date 2 is set.",
    });
  }

  if (value.holidayDate && Number(value.holidayDate.slice(0, 4)) !== value.year) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["holidayDate"],
      message: "Holiday Date must be in the selected holiday year.",
    });
  }

  if (value.holidayDate2 && value.holidayDate2 < value.holidayDate!) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["holidayDate2"],
      message: "Holiday Date 2 cannot be earlier than Holiday Date.",
    });
  }

  if (value.requireCheckDate1 && !value.checkDate1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checkDate1"],
      message: "Check Date 1 is required when its requirement is enabled.",
    });
  }

  if (value.requireCheckDate2 && !value.checkDate2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checkDate2"],
      message: "Check Date 2 is required when its requirement is enabled.",
    });
  }
});

export const selectHolidayYearCalendarSchema = createSelectSchema(
  holidayYearCalendar,
  {
    holidayDate: z.string().nullable(),
    holidayDate2: z.string().nullable(),
    checkDate1: z.string().nullable(),
    checkDate2: z.string().nullable(),
    requireCheckDate1: z.boolean(),
    requireCheckDate2: z.boolean(),
    source: z.enum(holidayYearSourceEnum.enumValues),
    holidayType: z.enum(holidayTypeEnum.enumValues),
    status: z.enum(holidayYearStatusEnum.enumValues),
  }
);

export const generateHolidayYearSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

export const deleteHolidayTemplateSchema = z.object({
  id: z.coerce.number().positive(),
});

export const deleteHolidayYearCalendarSchema = z.object({
  id: z.coerce.number().positive(),
});

export const holidayTemplateRecurrenceValues =
  holidayTemplateRecurrenceEnum.enumValues;
export const holidayYearSourceValues = holidayYearSourceEnum.enumValues;
export const holidayYearStatusValues = holidayYearStatusEnum.enumValues;

export const insertHolidayCalendarSchema = insertHolidayYearCalendarSchema;
export const selectHolidayCalendarSchema = selectHolidayYearCalendarSchema;
export const deleteHolidayCalendarSchema = deleteHolidayYearCalendarSchema;

export type InsertHolidayTemplateSchemaType = z.infer<
  typeof insertHolidayTemplateSchema
>;
export type SelectHolidayTemplateSchemaType = z.infer<
  typeof selectHolidayTemplateSchema
>;
export type InsertHolidayYearCalendarSchemaType = z.infer<
  typeof insertHolidayYearCalendarSchema
>;
export type SelectHolidayYearCalendarSchemaType = z.infer<
  typeof selectHolidayYearCalendarSchema
>;
export type GenerateHolidayYearSchemaType = z.infer<
  typeof generateHolidayYearSchema
>;
export type InsertHolidayCalendarSchemaType = InsertHolidayYearCalendarSchemaType;
export type SelectHolidayCalendarSchemaType = SelectHolidayYearCalendarSchemaType;

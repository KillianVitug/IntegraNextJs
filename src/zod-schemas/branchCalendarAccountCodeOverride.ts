import { z } from "zod";

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableDateKeySchema = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  dateKeySchema.nullable()
);

export const saveBranchCalendarAccountCodeOverrideSchema = z.object({
  attendanceDate: dateKeySchema,
  departmentId: z.coerce.number().int().positive().nullable().optional(),
  regularAccountCodeId: z.coerce.number().int().positive(),
  overtimeAccountCodeId: z.coerce.number().int().positive(),
});

export const clearBranchCalendarAccountCodeOverrideSchema = z.object({
  attendanceDate: dateKeySchema,
  departmentId: z.coerce.number().int().positive().nullable().optional(),
});

export const saveBranchCalendarHolidayCheckDatesSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    checkDate1: nullableDateKeySchema,
    checkDate2: nullableDateKeySchema,
    requireCheckDate1: z.coerce.boolean().default(false),
    requireCheckDate2: z.coerce.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.requireCheckDate1 && !value.checkDate1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkDate1"],
        message: "Check Date 1 is required when enabled.",
      });
    }

    if (value.requireCheckDate2 && !value.checkDate2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkDate2"],
        message: "Check Date 2 is required when enabled.",
      });
    }
  });

export type SaveBranchCalendarAccountCodeOverrideSchemaType = z.infer<
  typeof saveBranchCalendarAccountCodeOverrideSchema
>;

export type ClearBranchCalendarAccountCodeOverrideSchemaType = z.infer<
  typeof clearBranchCalendarAccountCodeOverrideSchema
>;

export type SaveBranchCalendarHolidayCheckDatesSchemaType = z.infer<
  typeof saveBranchCalendarHolidayCheckDatesSchema
>;

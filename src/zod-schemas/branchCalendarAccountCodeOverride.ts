import { z } from "zod";
import { shiftScheduleEnum } from "@/db/schema";

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

export const saveBranchCalendarScheduleOverrideSchema = z
  .object({
    attendanceDate: dateKeySchema,
    employeeIds: z.array(z.string().uuid()).min(1),
    mode: z.enum(["WORKING_SHIFT", "REST_DAY"]),
    shiftTableId: z.coerce.number().int().positive().nullable().optional(),
    shiftSchedule: z.enum(shiftScheduleEnum.enumValues).nullable().optional(),
    graceMinutes: z.coerce.number().int().min(0).default(0),
    isFlexible: z.coerce.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "WORKING_SHIFT" && !value.shiftTableId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shiftTableId"],
        message: "Select a shift table for working-shift overrides.",
      });
    }
  });

export const revertBranchCalendarScheduleOverrideSchema = z.object({
  itemId: z.string().uuid(),
});

export const revertBranchCalendarScheduleOverridesSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
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

export type SaveBranchCalendarScheduleOverrideSchemaType = z.infer<
  typeof saveBranchCalendarScheduleOverrideSchema
>;

export type RevertBranchCalendarScheduleOverrideSchemaType = z.infer<
  typeof revertBranchCalendarScheduleOverrideSchema
>;

export type RevertBranchCalendarScheduleOverridesSchemaType = z.infer<
  typeof revertBranchCalendarScheduleOverridesSchema
>;

export type SaveBranchCalendarHolidayCheckDatesSchemaType = z.infer<
  typeof saveBranchCalendarHolidayCheckDatesSchema
>;

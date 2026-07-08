import { z } from "zod";
import { restDayEnum, shiftScheduleEnum } from "@/db/schema";

export const upsertEmployeeShiftAssignmentSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  employeeId: z.string().uuid(),
  shiftTableId: z.coerce.number().int().positive(),
  shiftSchedule: z.enum(shiftScheduleEnum.enumValues).nullable().optional(),
  effectiveFrom: z.string().min(1),
  effectiveTo: z.string().min(1).nullable().optional(),
  graceMinutes: z.coerce.number().int().min(0).default(0),
  restDay: z.enum(restDayEnum.enumValues).nullable().optional(),
  isFlexible: z.coerce.boolean().default(false),
});

export const deleteEmployeeShiftAssignmentSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type UpsertEmployeeShiftAssignmentInput = z.infer<
  typeof upsertEmployeeShiftAssignmentSchema
>;

import { createSelectSchema } from "drizzle-zod";
import { employeesTimekeeping, restDayEnum, shiftScheduleEnum } from "@/db/schema";
import { z } from "zod";

export const insertEmployeeTimekeepingSchema = z.object({
  employeeId: z.string().uuid().optional(),
  timekeepingId: z.string().nullable().optional(),
  shiftSchedule: z.enum(shiftScheduleEnum.enumValues).nullable().optional(),
  checkInTime: z.string().nullable(),
  checkOutTime: z.string().nullable(),
  restDay: z.enum(restDayEnum.enumValues).nullable().optional(),
  hoursWorked: z.coerce.number().default(0),
  minutesWorked: z.coerce.number().default(0),
});

export const selectEmployeeTimekeepingSchema = createSelectSchema(
  employeesTimekeeping,
  {
    shiftSchedule: z.enum(shiftScheduleEnum.enumValues).nullable(),
    restDay: z.enum(restDayEnum.enumValues).nullable(),
  },
);

export type InsertEmployeeTimekeepingSchemaType = z.infer<
  typeof insertEmployeeTimekeepingSchema
>;
export type SelectEmployeeTimekeepingSchemaType = z.infer<
  typeof selectEmployeeTimekeepingSchema
>;

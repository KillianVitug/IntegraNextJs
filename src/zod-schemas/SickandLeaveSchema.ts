import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeesLeaveRecords } from "@/db/schema";
import { z } from "zod";

/* ---------- DB Schemas ---------- */

export const insertEmployeeLeaveSchema = createInsertSchema(employeesLeaveRecords, {
  employeeId: z.string().uuid(),
  dateFiled: z.string(),
  leaveStartDate: z.string().min(1),
  leaveEndDate: z.string().optional().nullable(),
  leaveType: z.string().trim().min(1, "Leave Type is required"),
  noOfDays: z.coerce.number().min(0.5),
  reason: z.string().min(1),
  leaveStatus: z.enum(employeesLeaveRecords.leaveStatus.enumValues),
});

export const selectEmployeeLeaveSchema = createSelectSchema(employeesLeaveRecords);

/* ---------- FORM DTO ---------- */

export const leaveFormSchema = insertEmployeeLeaveSchema.pick({
  employeeId: true,
  dateFiled: true,
  leaveStartDate: true,
  leaveEndDate: true,
  leaveType: true,
  noOfDays: true,
  reason: true,
  leaveStatus: true,
}).extend({
  leaveEndDate: z.string().optional().nullable().or(z.literal("")),
  dayPart: z.enum(["FullDay", "AM", "PM"]).default("FullDay"),
});

export type LeaveFormSchemaType = z.infer<typeof leaveFormSchema>;
export type InsertEmployeeLeaveSchemaType = z.infer<typeof insertEmployeeLeaveSchema>;
export type SelectEmployeeLeaveSchemaType = z.infer<typeof selectEmployeeLeaveSchema>;

/* ---------- EDIT DTO ---------- */

export type LeaveEditPayload = LeaveFormSchemaType & { id: number };

import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { employeesLeaveRecords } from "@/db/schema";
import { z } from "zod";

/* ---------- DB Schemas ---------- */

export const insertEmployeeLeaveSchema = createInsertSchema(employeesLeaveRecords, {
  employeeId: z.string().uuid(),
  dateFiled: z.string(),
  leaveType: z.enum(employeesLeaveRecords.leaveType.enumValues),
  noOfDays: z.coerce.number().min(1),
  reason: z.string().min(1),
  leaveStatus: z.enum(employeesLeaveRecords.leaveStatus.enumValues),
});

export const selectEmployeeLeaveSchema = createSelectSchema(employeesLeaveRecords);

/* ---------- FORM DTO ---------- */

export const leaveFormSchema = insertEmployeeLeaveSchema.pick({
  employeeId: true,
  dateFiled: true,
  leaveType: true,
  noOfDays: true,
  reason: true,
  leaveStatus: true,
});

export type LeaveFormSchemaType = z.infer<typeof leaveFormSchema>;
export type InsertEmployeeLeaveSchemaType = z.infer<typeof insertEmployeeLeaveSchema>;
export type SelectEmployeeLeaveSchemaType = z.infer<typeof selectEmployeeLeaveSchema>;

/* ---------- EDIT DTO ---------- */

export type LeaveEditPayload = LeaveFormSchemaType & { id: number };

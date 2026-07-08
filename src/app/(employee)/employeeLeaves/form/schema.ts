import { z } from "zod";

export const employeeLeaveFormSchema = z.object({
  dateFiled: z.string().min(1),
  leaveStartDate: z.string().min(1),
  leaveEndDate: z.string().optional().nullable().or(z.literal("")),
  leaveType: z.string().trim().min(1, "Leave Type is required"),
  dayPart: z.enum(["FullDay", "AM", "PM"]).default("FullDay"),
  noOfDays: z.coerce.number().min(0.5),
  reason: z.string().min(1),
});

export type EmployeeLeaveFormSchemaType = z.infer<
  typeof employeeLeaveFormSchema
>;

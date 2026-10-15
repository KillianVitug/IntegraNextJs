import { z } from "zod";

export type LeaveFormValues = {
  id: string;
  year: string;
  employeeId: string;
  leaveType: string;
  dateFiled: string;
  leaveStartDate: string;
  leaveEndDate: string;
  dayPart: string;
  reason: string;
};

export type LeaveFormState = {
  values: LeaveFormValues;
  revision: number;
  error?: string;
  message?: string;
  balance?: { employeeId: string; leaveType: string; year: number; days: number; requiresBalance: boolean };
};

export function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function readLeaveFormValues(form: FormData): LeaveFormValues {
  const text = (name: string) => String(form.get(name) ?? "");
  return {
    id: text("id"), year: text("year"), employeeId: text("employeeId"), leaveType: text("leaveType"),
    dateFiled: text("dateFiled"), leaveStartDate: text("leaveStartDate"), leaveEndDate: text("leaveEndDate"),
    dayPart: text("dayPart") || "FullDay", reason: text("reason"),
  };
}

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Select a valid date.").refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Select a valid date.");

export const managerLeaveFormSchema = z.object({
  employeeId: z.string().uuid("Select an employee."),
  leaveType: z.string().trim().min(1, "Select a leave type."),
  dateFiled: dateKey,
  leaveStartDate: dateKey,
  leaveEndDate: dateKey.or(z.literal("")),
  reason: z.string().trim().min(1, "Enter a reason for the request.").max(4000, "Keep the reason within 4,000 characters."),
  dayPart: z.enum(["FullDay", "AM", "PM"]),
}).refine((value) => !value.leaveEndDate || value.leaveEndDate >= value.leaveStartDate, {
  message: "Leave end must be on or after leave start.", path: ["leaveEndDate"],
});

export function leaveFormPayload(values: LeaveFormValues) {
  const parsed = managerLeaveFormSchema.parse(values);
  const days = Math.round((Date.parse(`${parsed.leaveEndDate || parsed.leaveStartDate}T00:00:00Z`) - Date.parse(`${parsed.leaveStartDate}T00:00:00Z`)) / 86_400_000) + 1;
  return { ...parsed, noOfDays: parsed.dayPart === "FullDay" ? days : 0.5 };
}

export function safeLeaveError(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Check the request fields.";
  const message = error instanceof Error ? error.message : "";
  if (/^(Only (pending leave requests|requests submitted by this manager)|This employee already has an approved leave|Employee is not assigned to one of this manager|Manager account is not assigned|Selected leave type was not found|Leave policy is not configured|Half-day leave|Half-day leaves|This leave request has no chargeable)/.test(message)) return message;
  if (/^(Forbidden\.|Unauthorized\.)$/.test(message)) return "Your access has changed. Sign in again before retrying.";
  return "Unable to complete the request. Your entries are retained. Retry or check the request list before filing again.";
}

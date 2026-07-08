import type { leaveTypes } from "@/db/schema";

type LeaveTypeRecord = typeof leaveTypes.$inferSelect;

export type LeaveTypeResolutionInput = {
  leaveType: string | null | undefined;
  leaveTypeLookup?: LeaveTypeRecord | null;
};

export const LEAVE_PAYROLL_ACCOUNT_CODES = [
  {
    code: "5-200",
    description: "Company Sick Leave",
    leaveCodes: ["SL"],
    leaveNames: ["Company Sick Leave", "Sick Leave"],
  },
  {
    code: "5-202",
    description: "Maternity Leave",
    leaveCodes: ["ML"],
    leaveNames: ["Maternity Leave"],
  },
  {
    code: "5-203",
    description: "Paternity Leave",
    leaveCodes: ["PL"],
    leaveNames: ["Paternity Leave"],
  },
  {
    code: "5-204",
    description: "Company Vacation Leave",
    leaveCodes: ["VL"],
    leaveNames: ["Company Vacation Leave", "Vacation Leave"],
  },
] as const;

export function normalizeLeavePayrollAccountKey(
  value: string | null | undefined
) {
  return (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LEAVE_PAYROLL_ACCOUNT_CODE_BY_KEY = new Map(
  LEAVE_PAYROLL_ACCOUNT_CODES.flatMap((mapping) => [
    ...mapping.leaveCodes.map((code) => [
      normalizeLeavePayrollAccountKey(code),
      mapping.code,
    ] as const),
    ...mapping.leaveNames.map((name) => [
      normalizeLeavePayrollAccountKey(name),
      mapping.code,
    ] as const),
  ])
);

export function getMappedLeavePayrollAccountCode(
  record: LeaveTypeResolutionInput
) {
  const leaveType = record.leaveTypeLookup ?? null;
  const candidates = [leaveType?.code, leaveType?.name, record.leaveType];

  for (const candidate of candidates) {
    const mappedCode = LEAVE_PAYROLL_ACCOUNT_CODE_BY_KEY.get(
      normalizeLeavePayrollAccountKey(candidate)
    );
    if (mappedCode) return mappedCode;
  }

  return null;
}

export type PayrollSection =
  | "estimate"
  | "settings"
  | "attendanceSources"
  | "attendanceBatch"
  | "run"
  | "manual"
  | "report"
  | "outputs"
  | "specialRun"
  | "attendance"
  | "attendanceHold"
  | "accountCodes";

export const PAYROLL_SECTION_PATHS: Record<PayrollSection, string> = {
  estimate: "/payroll/provisional",
  settings: "/payroll/settings",
  attendanceSources: "/payroll/attendance-sources",
  attendanceBatch: "/payroll/attendance-batch",
  run: "/payroll",
  manual: "/payroll/manual",
  report: "/payroll/report",
  outputs: "/payroll/outputs",
  specialRun: "/payroll/special-run",
  attendance: "/payroll/attendance-details",
  attendanceHold: "/payroll/attendance-hold",
  accountCodes: "/payroll/account-code",
};

export const PAYROLL_ROUTE_SECTIONS: Record<string, PayrollSection> = {
  settings: "settings",
  manual: "manual",
  "attendance-details": "attendance",
  "attendance-hold": "attendanceHold",
  "account-code": "accountCodes",
};

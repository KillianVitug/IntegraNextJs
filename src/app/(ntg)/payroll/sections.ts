export type PayrollSection =
  | "run"
  | "manual"
  | "report"
  | "outputs"
  | "specialRun"
  | "attendance"
  | "attendanceHold"
  | "accountCodes";

export const PAYROLL_SECTION_PATHS: Record<PayrollSection, string> = {
  run: "/payroll",
  manual: "/payroll/manual",
  report: "/payroll/report",
  outputs: "/payroll/outputs",
  specialRun: "/payroll/special-run",
  attendance: "/payroll/attendance-imports",
  attendanceHold: "/payroll/attendance-hold",
  accountCodes: "/payroll/account-code",
};

export const PAYROLL_ROUTE_SECTIONS: Record<string, PayrollSection> = {
  manual: "manual",
  "attendance-imports": "attendance",
  "attendance-hold": "attendanceHold",
  "account-code": "accountCodes",
};

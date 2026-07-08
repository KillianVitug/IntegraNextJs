export const employeeTypeValues = ["EMP", "ADMIN"] as const;

export type EmployeeType = (typeof employeeTypeValues)[number];

export type ConfidentialityLevel =
  | "Rank and File"
  | "Supervisory"
  | "Managerial"
  | null
  | undefined;

export const DEFAULT_EMPLOYEE_TYPE: EmployeeType = "EMP";
export const ADMIN_EMPLOYEE_TYPE: EmployeeType = "ADMIN";

export function isEmployeeType(value: string | null | undefined): value is EmployeeType {
  return value === "EMP" || value === "ADMIN";
}

export function normalizeEmployeeType(value: string | null | undefined): EmployeeType {
  return isEmployeeType(value) ? value : DEFAULT_EMPLOYEE_TYPE;
}

export function formatEmployeeCode(args: {
  employeeType: string | null | undefined;
  employeeNo: string | null | undefined;
}) {
  const employeeNo = args.employeeNo?.trim() ?? "";

  if (!employeeNo) {
    return "";
  }

  return `${normalizeEmployeeType(args.employeeType)}${employeeNo}`;
}

export function isManagerialConfidentialityLevel(level: ConfidentialityLevel) {
  return level === "Managerial";
}


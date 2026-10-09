import type { AuthGroupKey } from "./permissions";

export type EmployeeAccountStatus = "PendingSetup" | "Active" | "Locked" | "Disabled";
export type EmployeeConfidentialityLevel = "Rank and File" | "Supervisory" | "Managerial" | null;

export type EmployeeAccountAccessData = {
  employee: {
    id: string;
    employeeNo: string;
    employeeType: "EMP" | "ADMIN";
    firstName: string;
    lastName: string;
    email: string | null;
    homeDepartmentId: number | null;
    homeDepartmentName: string | null;
    confidentialityLevel: EmployeeConfidentialityLevel;
  };
  account: {
    id: string;
    email: string;
    status: EmployeeAccountStatus;
    mustSetPassword: boolean;
    lastLoginAt: string | null;
    /** Null means multiple/no effective roles: require an explicit choice. */
    groupKey: AuthGroupKey | null;
    groupKeys: AuthGroupKey[];
    managerDepartmentIds: number[];
  } | null;
  departments: { id: number; code: string; name: string }[];
  advisory: string | null;
  /** Opaque revision of the saved identity and access state. */
  version: string;
};

type ExpectedEmployeeAccess = {
  employeeId: string;
  expectedAccountId: string | null;
  expectedVersion: string;
};
type AccessChoice = { groupKey: AuthGroupKey; departmentIds: number[] };
type TemporaryPassword = { tempPassword: string; confirmTempPassword: string };

export type EmployeeAccountAccessMutation = ExpectedEmployeeAccess & (
  | ({ operation: "create" } & AccessChoice & TemporaryPassword)
  | ({ operation: "access" } & AccessChoice)
  | ({ operation: "resetPassword" } & TemporaryPassword)
  | { operation: "status"; status: "Active" | "Locked" | "Disabled" }
  | { operation: "revokeSessions" }
);

export type EmployeeAccountAccessResult = {
  status: "success" | "error";
  message: string;
  data?: EmployeeAccountAccessData;
};

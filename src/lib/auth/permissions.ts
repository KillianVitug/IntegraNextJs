export const AUTH_GROUP_KEYS = {
  SYSTEM_ADMIN: "SYSTEM_ADMIN",
  HR_ADMIN: "HR_ADMIN",
  MANAGER: "MANAGER",
  EMPLOYEE: "EMPLOYEE",
} as const;

export type AuthGroupKey =
  (typeof AUTH_GROUP_KEYS)[keyof typeof AUTH_GROUP_KEYS];

export const AUTH_GROUPS: Record<
  AuthGroupKey,
  {
    key: AuthGroupKey;
    name: string;
    description: string;
  }
> = {
  SYSTEM_ADMIN: {
    key: AUTH_GROUP_KEYS.SYSTEM_ADMIN,
    name: "System Admin",
    description:
      "Full system access, including account lifecycle and access management.",
  },
  HR_ADMIN: {
    key: AUTH_GROUP_KEYS.HR_ADMIN,
    name: "HR Admin",
    description:
      "Operational HR and payroll access, including payroll processing and approvals.",
  },
  MANAGER: {
    key: AUTH_GROUP_KEYS.MANAGER,
    name: "Manager",
    description:
      "Department manager access for assigned employees, leave filing, and schedule requests.",
  },
  EMPLOYEE: {
    key: AUTH_GROUP_KEYS.EMPLOYEE,
    name: "Employee",
    description: "Employee self-service access.",
  },
};

export const ALL_AUTH_GROUP_KEYS = Object.values(AUTH_GROUP_KEYS);

export const AUTH_PERMISSIONS = {
  ACCESS_MANAGE: "access.manage",
  EMPLOYEE_MANAGE: "employee.manage",
  LEAVE_MANAGE: "leave.manage",
  FILES_MANAGE: "files.manage",
  SALARY_MANAGE: "salary.manage",
  LOANS_MANAGE: "loans.manage",
  ATTENDANCE_MANAGE: "attendance.manage",
  PAYROLL_MANAGE: "payroll.manage",
  PAYROLL_COMPUTE: "payroll.compute",
  PAYROLL_REVIEW: "payroll.review",
  PAYROLL_APPROVE: "payroll.approve",
  PAYROLL_POST: "payroll.post",
  CONSTANTS_MANAGE: "constants.manage",
  REPORTS_VIEW: "reports.view",
  MANAGER_DEPARTMENT_WORKSPACE: "manager.department.workspace",
} as const;

export type AuthPermission =
  (typeof AUTH_PERMISSIONS)[keyof typeof AUTH_PERMISSIONS];

export const ALL_AUTH_PERMISSIONS = Object.values(AUTH_PERMISSIONS);

const HR_ADMIN_PERMISSIONS: AuthPermission[] = [
  AUTH_PERMISSIONS.EMPLOYEE_MANAGE,
  AUTH_PERMISSIONS.LEAVE_MANAGE,
  AUTH_PERMISSIONS.FILES_MANAGE,
  AUTH_PERMISSIONS.SALARY_MANAGE,
  AUTH_PERMISSIONS.LOANS_MANAGE,
  AUTH_PERMISSIONS.ATTENDANCE_MANAGE,
  AUTH_PERMISSIONS.PAYROLL_MANAGE,
  AUTH_PERMISSIONS.PAYROLL_COMPUTE,
  AUTH_PERMISSIONS.PAYROLL_REVIEW,
  AUTH_PERMISSIONS.PAYROLL_APPROVE,
  AUTH_PERMISSIONS.PAYROLL_POST,
  AUTH_PERMISSIONS.CONSTANTS_MANAGE,
  AUTH_PERMISSIONS.REPORTS_VIEW,
];

export const GROUP_PERMISSIONS: Record<AuthGroupKey, AuthPermission[]> = {
  SYSTEM_ADMIN: ALL_AUTH_PERMISSIONS,
  HR_ADMIN: HR_ADMIN_PERMISSIONS,
  MANAGER: [AUTH_PERMISSIONS.MANAGER_DEPARTMENT_WORKSPACE],
  EMPLOYEE: [],
};

export function isAuthGroupKey(value: string): value is AuthGroupKey {
  return ALL_AUTH_GROUP_KEYS.includes(value as AuthGroupKey);
}

export function getPermissionsForGroups(groupKeys: readonly string[]) {
  const permissions = new Set<AuthPermission>();

  for (const groupKey of groupKeys) {
    if (!isAuthGroupKey(groupKey)) continue;

    for (const permission of GROUP_PERMISSIONS[groupKey]) {
      permissions.add(permission);
    }
  }

  return [...permissions];
}

export function getDefaultGroupForConfidentialityLevel(
  level: "Rank and File" | "Supervisory" | "Managerial" | null | undefined,
): AuthGroupKey | null {
  if (level === "Managerial") return AUTH_GROUP_KEYS.SYSTEM_ADMIN;
  if (level === "Supervisory") return AUTH_GROUP_KEYS.HR_ADMIN;
  if (level === "Rank and File") return AUTH_GROUP_KEYS.EMPLOYEE;
  return null;
}

export function getAppRoleForGroups(groupKeys: readonly string[]) {
  if (
    groupKeys.includes(AUTH_GROUP_KEYS.SYSTEM_ADMIN) ||
    groupKeys.includes(AUTH_GROUP_KEYS.HR_ADMIN)
  ) {
    return "ADMIN" as const;
  }

  if (groupKeys.includes(AUTH_GROUP_KEYS.MANAGER)) {
    return "MANAGER" as const;
  }

  if (groupKeys.includes(AUTH_GROUP_KEYS.EMPLOYEE)) {
    return "EMPLOYEE" as const;
  }

  return null;
}

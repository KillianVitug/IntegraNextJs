import { isNull, notInArray, or } from "drizzle-orm";
import { employeesGeneralInfo } from "@/db/schema";

export const separatedEmploymentStatuses = [
  "Resigned",
  "Terminated",
  "Finished Conctract",
] as const;

export const separatedDepartmentEmploymentStatuses = separatedEmploymentStatuses;

export type DepartmentEmploymentStatus =
  (typeof employeesGeneralInfo.$inferSelect)["employmentStatus"];

export type PayrollEmploymentStatus = DepartmentEmploymentStatus;

export function isPayrollEligibleEmploymentStatus(
  status: DepartmentEmploymentStatus | null | undefined,
) {
  return (
    status == null ||
    !separatedEmploymentStatuses.some((separated) => separated === status)
  );
}

export const isCurrentDepartmentEmploymentStatus =
  isPayrollEligibleEmploymentStatus;

export function payrollEligibleEmploymentStatusCondition() {
  return or(
    isNull(employeesGeneralInfo.employmentStatus),
    notInArray(employeesGeneralInfo.employmentStatus, [
      ...separatedEmploymentStatuses,
    ]),
  );
}

export const currentDepartmentMemberStatusCondition =
  payrollEligibleEmploymentStatusCondition;

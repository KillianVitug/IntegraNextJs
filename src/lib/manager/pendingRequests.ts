import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { employees, employeesGeneralInfo, employeesLeaveRecords, managerScheduleChangeRequests } from "@/db/schema";
import { getManagerDepartmentIds, requireManager } from "@/lib/auth/server";
import { currentDepartmentMemberStatusCondition } from "@/lib/employmentStatus";

// Deliberately excludes request reasons, decision notes and the schedule JSON.
// The homepage needs identities and dates, not unrestricted HR text.
export async function getManagerPendingRequests(departmentId: number | null) {
  const auth = await requireManager({ redirectTo: "/" });
  const allowed = await getManagerDepartmentIds(auth.accountId);
  if (departmentId === null) return { leaves: [], schedules: [] };
  if (!Number.isSafeInteger(departmentId) || !allowed.includes(departmentId)) {
    throw new Error("This branch is not available to your manager account.");
  }
  const member = and(
    eq(employeesGeneralInfo.departmentId, departmentId),
    isNull(employees.deletedAt),
    isNull(employeesGeneralInfo.deletedAt),
    currentDepartmentMemberStatusCondition(),
  );
  const [leaves, schedules] = await Promise.all([
    db.select({
      id: employeesLeaveRecords.id,
      employeeId: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      dateFiled: employeesLeaveRecords.dateFiled,
      startDate: employeesLeaveRecords.leaveStartDate,
      endDate: employeesLeaveRecords.leaveEndDate,
    }).from(employeesLeaveRecords)
      .innerJoin(employees, eq(employees.id, employeesLeaveRecords.employeeId))
      .innerJoin(employeesGeneralInfo, eq(employeesGeneralInfo.employeeId, employees.id))
      .where(and(member, isNull(employeesLeaveRecords.deletedAt), eq(employeesLeaveRecords.leaveStatus, "Pending")))
      .orderBy(asc(employeesLeaveRecords.dateFiled), asc(employeesLeaveRecords.id)),
    db.select({
      id: managerScheduleChangeRequests.id,
      employeeId: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      action: managerScheduleChangeRequests.action,
      submittedAt: managerScheduleChangeRequests.createdAt,
    }).from(managerScheduleChangeRequests)
      .innerJoin(employees, eq(employees.id, managerScheduleChangeRequests.employeeId))
      .innerJoin(employeesGeneralInfo, eq(employeesGeneralInfo.employeeId, employees.id))
      .where(and(member, eq(managerScheduleChangeRequests.requestedByAccountId, auth.accountId), eq(managerScheduleChangeRequests.status, "Pending")))
      .orderBy(asc(managerScheduleChangeRequests.createdAt), asc(managerScheduleChangeRequests.id)),
  ]);
  return { leaves, schedules };
}

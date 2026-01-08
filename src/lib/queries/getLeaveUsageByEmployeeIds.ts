import { db } from "@/db";
import { employeesLeaveRecords } from "@/db/schema";
import { eq, inArray, and } from "drizzle-orm";

export async function getLeaveUsageByEmployeeIds(employeeIds: string[]) {
  if (employeeIds.length === 0) return {};

  const records = await db
    .select({
      employeeId: employeesLeaveRecords.employeeId,
      leaveType: employeesLeaveRecords.leaveType,
      noOfDays: employeesLeaveRecords.noOfDays,
    })
    .from(employeesLeaveRecords)
    .where(
      and(
        inArray(employeesLeaveRecords.employeeId, employeeIds),
        eq(employeesLeaveRecords.leaveStatus, "Approved")
      )
    );

  const usageMap: Record<
    string,
    { usedSickLeave: number; usedVacationLeave: number }
  > = {};

  for (const record of records) {
    const empId = record.employeeId;
    if (!usageMap[empId]) {
      usageMap[empId] = { usedSickLeave: 0, usedVacationLeave: 0 };
    }
    if (record.leaveType === "SL")
      usageMap[empId].usedSickLeave += Number(record.noOfDays);
    if (record.leaveType === "VL")
      usageMap[empId].usedVacationLeave += Number(record.noOfDays);
  }

  return usageMap;
}

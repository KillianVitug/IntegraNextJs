import { db } from "@/db";
import { employees, employeesGeneralInfo, slvlGroup, employeesSalary, department, employeesLeaveRecords } from "@/db/schema";
import { eq, isNull, asc } from "drizzle-orm";

export async function getSickAndLeave() {
  const results = await db
    .select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      middleName: employees.middleName,
      lastName: employees.lastName,
      dateHired: employeesGeneralInfo.dateHired,
      department: department.name,
      status: employeesGeneralInfo.employmentStatus,
      sickLeave: slvlGroup.defaultSickLeave,
      vacationLeave: slvlGroup.defaultVacationLeave,
      
    })
    .from(employees)
    .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
    .leftJoin(employeesSalary, eq(employees.id, employeesSalary.employeeId)) // <-- Add this
    .leftJoin(slvlGroup, eq(employeesSalary.slvlGroupId, slvlGroup.id))      // <-- Now this works
    .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
    .where(isNull(employees.deletedAt))
    .orderBy(asc(employees.employeeNo));

    const enrichedResults = results.map((employee) => ({
  ...employee,
  fullName: `${employee.lastName}, ${employee.firstName} ${employee.middleName ?? ""}`.trim(),
}));

  return enrichedResults;
}

export async function getApprovedLeaveRecords() {
  try {
      const records = await db
          .select({
              employeeId: employeesLeaveRecords.employeeId,
              leaveType: employeesLeaveRecords.leaveType,
              noOfDays: employeesLeaveRecords.noOfDays
          })
          .from(employeesLeaveRecords)
          .where(eq(employeesLeaveRecords.leaveStatus, "Approved"));
      return { data: records, error: null };
  } catch (error) {
      return { data: null, error: "Failed to fetch approved leave records" };
  }
}

export async function getSickAndLeaveWithUsage(){
  const [employeeData, approvedRecordsResult] = await Promise.all([
    getSickAndLeave(),
    getApprovedLeaveRecords(),
  ]);

  if (approvedRecordsResult.error) {
    throw new Error(approvedRecordsResult.error);
  }

  const approvedLeaves = approvedRecordsResult.data || [];

  const usageMap = new Map<
    string,
    { usedSickLeave: number; usedVacationLeave: number }
  >();

  approvedLeaves.forEach((lr) => {
    const usage = usageMap.get(lr.employeeId) || {
      usedSickLeave: 0,
      usedVacationLeave: 0,
    };

    if (lr.leaveType === "SL") usage.usedSickLeave += Number(lr.noOfDays);
    if (lr.leaveType === "VL") usage.usedVacationLeave += Number(lr.noOfDays);

    usageMap.set(lr.employeeId, usage);
  });

  return employeeData.map((employee) => {
    const usage = usageMap.get(employee.id) || {
      usedSickLeave: 0,
      usedVacationLeave: 0,
    };

    return {
      ...employee,
      usedSickLeave: usage.usedSickLeave,
      usedVacationLeave: usage.usedVacationLeave,
    };
  });
}

export type SickAndLeaveResultsType = Array<
  Awaited<ReturnType<typeof getSickAndLeaveWithUsage>>[number]
>;

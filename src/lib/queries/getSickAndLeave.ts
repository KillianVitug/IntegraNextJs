import { db } from "@/db";
import { employees, employeesGeneralInfo, slvlGroup, employeesSalary } from "@/db/schema";
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
      department: employeesGeneralInfo.departmentId,
      status: employeesGeneralInfo.employmentStatus,
      sickLeave: slvlGroup.defaultSickLeave,
      vacationLeave: slvlGroup.defaultVacationLeave,
    })
    .from(employees)
    .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
    .leftJoin(employeesSalary, eq(employees.id, employeesSalary.employeeId)) // <-- Add this
    .leftJoin(slvlGroup, eq(employeesSalary.slvlGroupId, slvlGroup.id))      // <-- Now this works
    .where(isNull(employees.deletedAt))
    .orderBy(asc(employees.employeeNo));

    const enrichedResults = results.map((employee) => ({
  ...employee,
  fullName: `${employee.lastName}, ${employee.firstName} ${employee.middleName ?? ""}`.trim(),
}));

  return enrichedResults;
}

export type SickAndLeaveResultsType = Awaited<ReturnType<typeof getSickAndLeave>>;

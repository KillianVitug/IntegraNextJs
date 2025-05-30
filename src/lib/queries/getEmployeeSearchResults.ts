import { db } from "@/db";
import { employees, employeesGeneralInfo, employeesOtherReferences, employeesRecurringEntries, employeesSalary, employeesTimekeeping } from "@/db/schema";
import { ilike, or, eq, sql } from "drizzle-orm";

export async function getEmployeeSearchResults(searchText: string) {
    const results = await db.select({
        id: employees.id,
        employeeNo: employees.employeeNo,
        firstName: employees.firstName,
        middleName: employees.middleName,
        lastName: employees.lastName,
        DateHired: employeesGeneralInfo.dateHired,
        Department: employeesGeneralInfo.departmentId,
        Status: employeesGeneralInfo.employmentStatus,
        Position: employeesOtherReferences.positionId,
        Address: employeesOtherReferences.address,
        Telephone: employeesOtherReferences.telephoneNo,
        RestDay: employeesTimekeeping.restDay

    })
    .from(employees)
    .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
    .leftJoin(employeesOtherReferences, eq(employees.id, employeesOtherReferences.employeeId))
    .leftJoin(employeesSalary, eq(employees.id, employeesSalary.employeeId))
    .leftJoin(employeesTimekeeping, eq(employees.id, employeesTimekeeping.employeeId))
    .leftJoin(employeesRecurringEntries, eq(employees.id, employeesRecurringEntries.employeeId))
    .where(or(
        ilike(employees.employeeNo, `%${searchText}%`),
        ilike(employees.middleName, `%${searchText}%`),
        ilike(employeesOtherReferences.address, `%${searchText}%`),
        sql`lower(concat(${employees.firstName}, ' ', ${employees.lastName})) LIKE ${`%${searchText.toLowerCase().replace(' ', '%')}%`}`,
    ))
    return results
}

export type EmployeeSearchResultsType = Awaited<ReturnType<typeof getEmployeeSearchResults>>
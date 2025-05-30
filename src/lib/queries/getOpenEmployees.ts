import { db } from "@/db";
import { employees, employeesGeneralInfo, employeesOtherReferences, employeesRecurringEntries, employeesSalary, employeesTimekeeping } from "@/db/schema";
import { ilike, or, eq, sql, isNull, asc } from "drizzle-orm";

export async function getOpenEmployees() {
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
    .where(isNull(employees.deletedAt)) // ? This is the fix
    .orderBy(asc(employees.employeeNo))
    return results
}
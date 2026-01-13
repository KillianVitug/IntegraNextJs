import { db } from "@/db";
import { department, employeesSalary, employeesOtherReferences, employees, employeesGeneralInfo, employeesTimekeeping, position } from "@/db/schema";
import { asc, eq, isNull } from "drizzle-orm";

export async function getEmployee(id: string) {
    const employee = await db.query.employees.findFirst({
        where: eq(employees.id, id),
        with: {
            generalInfo: true,
            salary: true,
            otherReferences: true,
            recurringEntries: true,
            timekeeping: true
        }
    });
    return employee;
}



export async function getOpenEmployees() {
    const results = await db.select({
        id: employees.id,
        employeeNo: employees.employeeNo,
        firstName: employees.firstName,
        middleName: employees.middleName,
        lastName: employees.lastName,
        DateHired: employeesGeneralInfo.dateHired,
        Department: department.name,
        Status: employeesGeneralInfo.employmentStatus,
        Position: position.name,
        Address: employeesOtherReferences.address,
        Telephone: employeesOtherReferences.telephoneNo,
        Email: employeesOtherReferences.email,

    })
    .from(employees)
    .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
    .leftJoin(employeesOtherReferences, eq(employees.id, employeesOtherReferences.employeeId))
    .leftJoin(employeesSalary, eq(employees.id, employeesSalary.employeeId))
    .leftJoin(employeesTimekeeping, eq(employees.id, employeesTimekeeping.employeeId))
    .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
    .leftJoin(position, eq(employeesOtherReferences.positionId, position.id))
    .where(isNull(employees.deletedAt)) // ? This is the fix
    .orderBy(asc(employees.employeeNo))
    return results
}

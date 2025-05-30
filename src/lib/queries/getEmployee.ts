import { db } from "@/db";
import { employees, employeesGeneralInfo, employeesSalary, employeesOtherReferences, employeesRecurringEntries, employeesTimekeeping } from "@/db/schema";
import { eq } from "drizzle-orm";

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

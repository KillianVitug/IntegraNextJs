import { db } from "@/db";
import { customPayrollDefinitions, employeeFiles, employeeFolders } from "@/db/schema";
import { ilike, or, eq, sql, isNull, asc } from "drizzle-orm";

export async function getPayrollCode(code: string) {
    const employee = await db.query.customPayrollDefinitions.findFirst({
        where: eq(customPayrollDefinitions.code, code)
    });
    return employee;
}

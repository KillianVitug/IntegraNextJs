import { db } from "@/db";
import { employees, employeesLoans, accountCode } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export async function getLoanRecords() {
  const results = await db
    .select({
      id: employeesLoans.id,
      employeeNo: employees.employeeNo,
      employeeName: sql<string>`CONCAT(${employees.lastName}, ', ', ${employees.firstName}, ' ', COALESCE(${employees.middleName}, ''))`,
      accountCode: accountCode.accountCode,
      accountCodeDescription: accountCode.description,
      loanReferenceNumber: employeesLoans.loanReferenceNumber,
    })
    .from(employeesLoans)
    .innerJoin(employees, eq(employeesLoans.employeeId, employees.id))
    .leftJoin(accountCode, eq(employeesLoans.accountCodeId, accountCode.id))
    .where(sql`${employeesLoans.deletedAt} IS NULL`)
    .orderBy(employees.employeeNo);

  return results;
}


export type getLoanRecordsTypes = Awaited<
  ReturnType<typeof getLoanRecords>
>;
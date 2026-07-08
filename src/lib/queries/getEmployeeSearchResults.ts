import { db } from "@/db";
import { customPayrollDefinitions, position , department, employees, employeesGeneralInfo, employeesOtherReferences, employeesSalary, employeeFiles, employeesLoans, accountCode, slvlGroup } from "@/db/schema";
import { ilike, or, eq, sql, asc, and } from "drizzle-orm";
import { getSickAndLeaveWithUsage } from "./getSickAndLeave"
import { employeeCodeSql } from "@/lib/employeeCodeSql";
import { sortEmployeesByLastName } from "@/utils/employeeDisplay";

const employeeSearchSelect = {
    id: employees.id,
    employeeNo: employees.employeeNo,
    employeeType: employees.employeeType,
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
} as const;

//MasterEmployee
export async function getEmployeeSearchResults(searchText: string, page = 1, pageSize = 50) {
    const offset = (page - 1) * pageSize;
    const whereClause = or(
        ilike(employeeCodeSql({
            employeeType: employees.employeeType,
            employeeNo: employees.employeeNo,
        }), `%${searchText}%`),
        ilike(employees.employeeNo, `%${searchText}%`),
        ilike(employees.middleName, `%${searchText}%`),
        ilike(employeesOtherReferences.address, `%${searchText}%`),
        sql`lower(concat(${employees.firstName}, ' ', ${employees.lastName})) LIKE ${`%${searchText.toLowerCase().replace(' ', '%')}%`}`,
    );

    const [data, [countRow]] = await Promise.all([
        db.select(employeeSearchSelect)
            .from(employees)
            .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
            .leftJoin(employeesOtherReferences, eq(employees.id, employeesOtherReferences.employeeId))
            .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
            .leftJoin(position, eq(employeesOtherReferences.positionId, position.id))
            .where(whereClause)
            .orderBy(
                asc(employees.lastName),
                asc(employees.firstName),
                asc(employees.middleName),
                asc(employees.employeeNo),
                asc(employees.id)
            )
            .limit(pageSize)
            .offset(offset),
        db.select({ total: sql<number>`count(*)` })
            .from(employees)
            .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
            .leftJoin(employeesOtherReferences, eq(employees.id, employeesOtherReferences.employeeId))
            .where(whereClause),
    ]);

    return { data, total: Number(countRow.total) };
}
export type EmployeeSearchResultsType = Awaited<ReturnType<typeof getEmployeeSearchResults>>["data"];

//Employee Custom Payroll
export async function getCustomPayrollSearchResults(searchText: string) {
    const results = await db.select({
        id: customPayrollDefinitions.id,
        code: customPayrollDefinitions.code,
        description: customPayrollDefinitions.description,
        rateDivisor: customPayrollDefinitions.rateDivisor
    })
    .from(customPayrollDefinitions)
    .where(or(
        ilike(customPayrollDefinitions.code, `%${searchText}%`),
        ilike(customPayrollDefinitions.description, `%${searchText}%`),
    ))
    return results
}
export type CustomPayrollResultsType = Awaited<ReturnType<typeof getCustomPayrollSearchResults>>

//EmployeeFile
export async function getEmployeeSearchFileResults(searchText: string) {
    const results = await db.select({
        fileName: employeeFiles.fileName,
        description: employeeFiles.description,
        remarks: employeeFiles.remarks,
        filePath: employeeFiles.filePath,
        fileExtension: employeeFiles.fileExtension,
        mimeType: employeeFiles.mimeType,
        createdAt: employeeFiles.createdAt,
    })
    .from(employeeFiles)
    .where(or(
        ilike(employees.employeeNo, `%${searchText}%`),
        ilike(employees.middleName, `%${searchText}%`),
        sql`lower(concat(${employees.firstName}, ' ', ${employees.lastName})) LIKE ${`%${searchText.toLowerCase().replace(' ', '%')}%`}`,
    ))
    return results
}
export type EmployeeSearchFileResultsType = Awaited<ReturnType<typeof getEmployeeSearchFileResults>>

export async function getFolderSearchResults(searchText: string) {
    const folders = await db.query.employeeFolders.findMany({
      with: {
        files: true,
        employee: true,
      },
      where: or(
        ilike(employeeCodeSql({
          employeeType: employees.employeeType,
          employeeNo: employees.employeeNo,
        }), `%${searchText}%`),
        ilike(employees.employeeNo, `%${searchText}%`),
        ilike(employees.middleName, `%${searchText}%`),
        sql`lower(concat(${employees.firstName}, ' ', ${employees.lastName})) LIKE ${`%${searchText.toLowerCase()}%`}`
      ),
    });

    return sortEmployeesByLastName(folders.map(folder => ({
      id: folder.id,
      employeeNo: folder.employee.employeeNo,
      employeeType: folder.employee.employeeType,
      employeeName: `${folder.employee.lastName}, ${folder.employee.firstName} ${
        folder.employee.middleName ?? ""
      }`,
      folderName: folder.folderName,
      folderType: folder.folderType,
      description: folder.description,
      remarks: folder.remarks,
      createdAt: folder.createdAt,
      files: folder.files,
    })));
  }

  export type EmployeeSearchFolderResultsType = Awaited<ReturnType<typeof getFolderSearchResults>>

//EmployeeLoan
export async function getEmployeeLoanSearchResults(searchText: string, page = 1, pageSize = 50) {
    const offset = (page - 1) * pageSize;
    const whereClause = or(
        ilike(employeeCodeSql({
          employeeType: employees.employeeType,
          employeeNo: employees.employeeNo,
        }), `%${searchText}%`),
        ilike(employees.employeeNo, `%${searchText}%`),
        ilike(employees.firstName, `%${searchText}%`),
        ilike(employees.lastName, `%${searchText}%`),
        sql`lower(concat(${employees.firstName}, ' ', ${employees.lastName})) LIKE ${`%${searchText.toLowerCase().replace(' ', '%')}%`}`
    );

    const loanSelect = {
        id: employeesLoans.id,
        employeeNo: employees.employeeNo,
        employeeType: employees.employeeType,
        employeeName: sql<string>`CONCAT(${employees.lastName}, ', ', ${employees.firstName}, ' ', COALESCE(${employees.middleName}, ''))`,
        accountCode: accountCode.accountCode,
        accountCodeDescription: accountCode.description,
        loanReferenceNumber: employeesLoans.loanReferenceNumber,
        loanPaymentStatus:
          sql<"Paid" | "Unpaid">`CASE WHEN ${employeesLoans.loanBalance} <= 0 OR ${employeesLoans.status} = 'Paid With Reloan' THEN 'Paid' ELSE 'Unpaid' END`,
    } as const;

    const [data, [countRow]] = await Promise.all([
        db.select(loanSelect)
            .from(employeesLoans)
            .innerJoin(employees, eq(employeesLoans.employeeId, employees.id))
            .leftJoin(accountCode, eq(employeesLoans.accountCodeId, accountCode.id))
            .where(and(sql`${employeesLoans.deletedAt} IS NULL`, whereClause))
            .orderBy(
                asc(employees.lastName),
                asc(employees.firstName),
                asc(employees.middleName),
                asc(employees.employeeNo),
                asc(employeesLoans.id)
            )
            .limit(pageSize)
            .offset(offset),
        db.select({ total: sql<number>`count(*)` })
            .from(employeesLoans)
            .innerJoin(employees, eq(employeesLoans.employeeId, employees.id))
            .where(and(sql`${employeesLoans.deletedAt} IS NULL`, whereClause)),
    ]);

    return { data, total: Number(countRow.total) };
}
export type EmployeeLoanSearchResultsType = Awaited<ReturnType<typeof getEmployeeLoanSearchResults>>["data"];

//EmployeeLeave
export async function getSickAndLeaveSearchResults(searchText: string, page = 1, pageSize = 50) {
    const offset = (page - 1) * pageSize;
    const whereClause = or(
        ilike(employeeCodeSql({
            employeeType: employees.employeeType,
            employeeNo: employees.employeeNo,
        }), `%${searchText}%`),
        ilike(employees.employeeNo, `%${searchText}%`),
        ilike(employees.middleName, `%${searchText}%`),
        sql`lower(concat(${employees.firstName}, ' ', ${employees.lastName})) LIKE ${`%${searchText.toLowerCase().replace(' ', '%')}%`}`,
    );

    const leaveSelect = {
        id: employees.id,
        employeeNo: employees.employeeNo,
        employeeType: employees.employeeType,
        firstName: employees.firstName,
        middleName: employees.middleName,
        lastName: employees.lastName,
        dateHired: employeesGeneralInfo.dateHired,
        department: department.name,
        status: employeesGeneralInfo.employmentStatus,
        sickLeave: slvlGroup.defaultSickLeave,
        vacationLeave: slvlGroup.defaultVacationLeave,
    } as const;

    const [data, [countRow]] = await Promise.all([
        db.select(leaveSelect)
            .from(employees)
            .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
            .leftJoin(employeesSalary, eq(employees.id, employeesSalary.employeeId))
            .leftJoin(slvlGroup, eq(employeesSalary.slvlGroupId, slvlGroup.id))
            .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
            .where(whereClause)
            .orderBy(
                asc(employees.lastName),
                asc(employees.firstName),
                asc(employees.middleName),
                asc(employees.employeeNo),
                asc(employees.id)
            )
            .limit(pageSize)
            .offset(offset),
        db.select({ total: sql<number>`count(*)` })
            .from(employees)
            .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
            .leftJoin(employeesOtherReferences, eq(employees.id, employeesOtherReferences.employeeId))
            .where(whereClause),
    ]);

    return { data, total: Number(countRow.total) };
}
export type SickAndLeaveSearchResultsType = Awaited<ReturnType<typeof getSickAndLeaveWithUsage>>["data"]

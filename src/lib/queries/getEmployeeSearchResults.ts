import { db } from "@/db";
import { customPayrollDefinitions, position , department, employees, employeesGeneralInfo, employeesOtherReferences, employeesRecurringEntries, employeesSalary, employeesTimekeeping, employeeFiles, employeesLoans, accountCode, slvlGroup } from "@/db/schema";
import { ilike, or, eq, sql, asc } from "drizzle-orm";
import { getSickAndLeaveWithUsage } from "./getSickAndLeave"

//MasterEmployee
export async function getEmployeeSearchResults(searchText: string) {
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
    .leftJoin(employeesRecurringEntries, eq(employees.id, employeesRecurringEntries.employeeId))
    .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
    .leftJoin(position, eq(employeesOtherReferences.positionId, position.id))
    .where(or(
        ilike(employees.employeeNo, `%${searchText}%`),
        ilike(employees.middleName, `%${searchText}%`),
        ilike(employeesOtherReferences.address, `%${searchText}%`),
        sql`lower(concat(${employees.firstName}, ' ', ${employees.lastName})) LIKE ${`%${searchText.toLowerCase().replace(' ', '%')}%`}`,
    ))
    return results
}
export type EmployeeSearchResultsType = Awaited<ReturnType<typeof getEmployeeSearchResults>>

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
        // isArchived: employeeFiles.isArchived,
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
        ilike(employees.employeeNo, `%${searchText}%`),
        ilike(employees.middleName, `%${searchText}%`),
        sql`lower(concat(${employees.firstName}, ' ', ${employees.lastName})) LIKE ${`%${searchText.toLowerCase()}%`}`
      ),
    });
  
    return folders.map(folder => ({
      id: folder.id,
      employeeNo: folder.employee.employeeNo,
      employeeName: `${folder.employee.lastName}, ${folder.employee.firstName} ${
        folder.employee.middleName ?? ""
      }`,
      folderName: folder.folderName,
      folderType: folder.folderType,
      description: folder.description,
      remarks: folder.remarks,
      createdAt: folder.createdAt,
      files: folder.files,
    }));
  }

  export type EmployeeSearchFolderResultsType = Awaited<ReturnType<typeof getFolderSearchResults>>

//EmployeeLoan
export async function getEmployeeLoanSearchResults(searchText: string) {
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
      .where(or(
        ilike(employees.employeeNo, `%${searchText}%`),
        ilike(employees.firstName, `%${searchText}%`),
        ilike(employees.lastName, `%${searchText}%`),
        sql`lower(concat(${employees.firstName}, ' ', ${employees.lastName})) LIKE ${`%${searchText.toLowerCase().replace(' ', '%')}%`}`
      ))
      .orderBy(asc(employeesLoans.id));
  
    return results;
}
export type EmployeeLoanSearchResultsType = Awaited<ReturnType<typeof getEmployeeLoanSearchResults>>;

//EmployeeLeave
export async function getSickAndLeaveSearchResults(searchText: string) {
    const results = await db.select({
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

    .where(or(
        ilike(employees.employeeNo, `%${searchText}%`),
        ilike(employees.middleName, `%${searchText}%`),
        sql`lower(concat(${employees.firstName}, ' ', ${employees.lastName})) LIKE ${`%${searchText.toLowerCase().replace(' ', '%')}%`}`,
    ))
    .orderBy(asc(employees.employeeNo));
    return results
}
export type SickAndLeaveSearchResultsType = Awaited<ReturnType<typeof getSickAndLeaveWithUsage>>





import { db } from "@/db";
import { department, employeesOtherReferences, employees, employeesGeneralInfo, position } from "@/db/schema";
import { employeeCodeSql } from "@/lib/employeeCodeSql";
import { normalizeTableQueryOptions, type TableQueryOptions, type TableSort } from "@/lib/queries/tableQuery";
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";

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

const openEmployeesSelect = {
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

const employeeSearchColumns = [
    employees.employeeNo,
    sql<string>`cast(${employees.employeeType} as text)`,
    employees.firstName,
    employees.middleName,
    employees.lastName,
    department.name,
    sql<string>`cast(${employeesGeneralInfo.employmentStatus} as text)`,
    position.name,
    employeesOtherReferences.address,
    employeesOtherReferences.telephoneNo,
    employeesOtherReferences.email,
] as const;

const employeeFullNameSql = sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.middleName}, ${employees.lastName})`;
const employeeLastFirstNameSql = sql<string>`concat_ws(', ', ${employees.lastName}, concat_ws(' ', ${employees.firstName}, ${employees.middleName}))`;

const employeeFilterColumns = {
    employeeNo: employees.employeeNo,
    employeeType: sql<string>`cast(${employees.employeeType} as text)`,
    firstName: employees.firstName,
    middleName: employees.middleName,
    lastName: employees.lastName,
    DateHired: sql<string>`cast(${employeesGeneralInfo.dateHired} as text)`,
    Department: department.name,
    Status: sql<string>`cast(${employeesGeneralInfo.employmentStatus} as text)`,
    Position: position.name,
    Address: employeesOtherReferences.address,
    Telephone: employeesOtherReferences.telephoneNo,
    Email: employeesOtherReferences.email,
} as const;

const employeeSortColumns = {
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

export async function getOpenEmployees(options: TableQueryOptions | number = {}, pageSizeArg = 50) {
    const query = normalizeEmployeeQueryOptions(options, pageSizeArg);
    const offset = (query.page - 1) * query.pageSize;
    const whereClause = buildEmployeeWhereClause(query.search, query.filters);
    const orderBy = buildEmployeeOrderBy(query.sort);

    const [data, [countRow]] = await Promise.all([
        db.select(openEmployeesSelect)
            .from(employees)
            .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
            .leftJoin(employeesOtherReferences, eq(employees.id, employeesOtherReferences.employeeId))
            .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
            .leftJoin(position, eq(employeesOtherReferences.positionId, position.id))
            .where(whereClause)
            .orderBy(...orderBy)
            .limit(query.pageSize)
            .offset(offset),
        db.select({ total: sql<number>`count(*)` })
            .from(employees)
            .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
            .leftJoin(employeesOtherReferences, eq(employees.id, employeesOtherReferences.employeeId))
            .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
            .leftJoin(position, eq(employeesOtherReferences.positionId, position.id))
            .where(whereClause),
    ]);

    return { data, total: Number(countRow.total) };
}

function normalizeEmployeeQueryOptions(options: TableQueryOptions | number, pageSizeArg: number) {
    if (typeof options === "number") {
        return normalizeTableQueryOptions(
            { page: options, pageSize: pageSizeArg },
            { id: "employeeNo", desc: false }
        );
    }

    return normalizeTableQueryOptions(options, { id: "employeeNo", desc: false });
}

function buildEmployeeWhereClause(search: string, filters: Record<string, string>) {
    const conditions: SQL[] = [isNull(employees.deletedAt)];

    if (search) {
        const pattern = toLikePattern(search);
        conditions.push(
            or(
                ilike(employeeCodeSql({ employeeType: employees.employeeType, employeeNo: employees.employeeNo }), pattern),
                ilike(employeeFullNameSql, pattern),
                ilike(employeeLastFirstNameSql, pattern),
                ...employeeSearchColumns.map((column) => ilike(column, pattern))
            )!
        );
    }

    for (const [columnId, value] of Object.entries(filters)) {
        const column = employeeFilterColumns[columnId as keyof typeof employeeFilterColumns];

        if (column) {
            conditions.push(ilike(column, toLikePattern(value)));
        }
    }

    return and(...conditions);
}

function buildEmployeeOrderBy(sort: TableSort | null) {
    const fallback = [
        asc(employees.lastName),
        asc(employees.firstName),
        asc(employees.middleName),
        asc(employees.employeeNo),
        asc(employees.id),
    ];

    if (!sort) {
        return fallback;
    }

    const column = employeeSortColumns[sort.id as keyof typeof employeeSortColumns];

    if (!column) {
        return fallback;
    }

    return [
        sort.desc ? desc(column) : asc(column),
        asc(employees.id),
    ];
}

function toLikePattern(value: string) {
    return `%${value}%`;
}

export type OpenEmployeesResult = Awaited<ReturnType<typeof getOpenEmployees>>;
export type OpenEmployeesRow = OpenEmployeesResult["data"][number];

import { db } from "@/db";
import { employees, employeesLoans, accountCode } from "@/db/schema";
import { employeeCodeSql } from "@/lib/employeeCodeSql";
import { normalizeTableQueryOptions, type TableQueryOptions, type TableSort } from "@/lib/queries/tableQuery";
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";

const loanEmployeeNameSql = sql<string>`CONCAT(${employees.lastName}, ', ', ${employees.firstName}, ' ', COALESCE(${employees.middleName}, ''))`;
const loanPaymentStatusSql = sql<"Paid" | "Unpaid">`CASE WHEN ${employeesLoans.loanBalance} <= 0 OR ${employeesLoans.status} = 'Paid With Reloan' THEN 'Paid' ELSE 'Unpaid' END`;
const loanStatusTextSql = sql<string>`cast(${employeesLoans.status} as text)`;

const loanSelect = {
    id: employeesLoans.id,
    employeeNo: employees.employeeNo,
    employeeType: employees.employeeType,
    employeeName: loanEmployeeNameSql,
    accountCode: accountCode.accountCode,
    accountCodeDescription: accountCode.description,
    loanReferenceNumber: employeesLoans.loanReferenceNumber,
    status: loanStatusTextSql,
    loanPaymentStatus: loanPaymentStatusSql,
} as const;

const loanSearchColumns = [
    employees.employeeNo,
    sql<string>`cast(${employees.employeeType} as text)`,
    employees.firstName,
    employees.middleName,
    employees.lastName,
    loanEmployeeNameSql,
    accountCode.accountCode,
    accountCode.description,
    employeesLoans.loanReferenceNumber,
    loanStatusTextSql,
    loanPaymentStatusSql,
] as const;

const loanFilterColumns = {
    employeeNo: employees.employeeNo,
    employeeType: sql<string>`cast(${employees.employeeType} as text)`,
    employeeName: loanEmployeeNameSql,
    accountCode: accountCode.accountCode,
    accountCodeDescription: accountCode.description,
    loanReferenceNumber: employeesLoans.loanReferenceNumber,
    status: loanStatusTextSql,
    loanPaymentStatus: loanPaymentStatusSql,
} as const;

const loanSortColumns = {
    employeeNo: employees.employeeNo,
    employeeType: employees.employeeType,
    employeeName: loanEmployeeNameSql,
    accountCode: accountCode.accountCode,
    accountCodeDescription: accountCode.description,
    loanReferenceNumber: employeesLoans.loanReferenceNumber,
    status: employeesLoans.status,
    loanPaymentStatus: loanPaymentStatusSql,
} as const;

export async function getLoanRecords(options: TableQueryOptions | number = {}, pageSizeArg = 50) {
    const query = normalizeLoanQueryOptions(options, pageSizeArg);
    const offset = (query.page - 1) * query.pageSize;
    const whereClause = buildLoanWhereClause(query.search, query.filters);
    const orderBy = buildLoanOrderBy(query.sort);

    const [data, [countRow]] = await Promise.all([
        db.select(loanSelect)
            .from(employeesLoans)
            .innerJoin(employees, eq(employeesLoans.employeeId, employees.id))
            .leftJoin(accountCode, eq(employeesLoans.accountCodeId, accountCode.id))
            .where(whereClause)
            .orderBy(...orderBy)
            .limit(query.pageSize)
            .offset(offset),
        db.select({ total: sql<number>`count(*)` })
            .from(employeesLoans)
            .innerJoin(employees, eq(employeesLoans.employeeId, employees.id))
            .leftJoin(accountCode, eq(employeesLoans.accountCodeId, accountCode.id))
            .where(whereClause),
    ]);

    return { data, total: Number(countRow.total) };
}

function normalizeLoanQueryOptions(options: TableQueryOptions | number, pageSizeArg: number) {
    if (typeof options === "number") {
        return normalizeTableQueryOptions(
            { page: options, pageSize: pageSizeArg },
            { id: "employeeName", desc: false }
        );
    }

    return normalizeTableQueryOptions(options, { id: "employeeName", desc: false });
}

function buildLoanWhereClause(search: string, filters: Record<string, string>) {
    const conditions: SQL[] = [isNull(employeesLoans.deletedAt)];

    if (search) {
        const pattern = toLikePattern(search);
        conditions.push(
            or(
                ilike(employeeCodeSql({ employeeType: employees.employeeType, employeeNo: employees.employeeNo }), pattern),
                ...loanSearchColumns.map((column) => ilike(column, pattern))
            )!
        );
    }

    for (const [columnId, value] of Object.entries(filters)) {
        const column = loanFilterColumns[columnId as keyof typeof loanFilterColumns];

        if (column) {
            conditions.push(ilike(column, toLikePattern(value)));
        }
    }

    return and(...conditions);
}

function buildLoanOrderBy(sort: TableSort | null) {
    const fallback = [
        asc(employees.lastName),
        asc(employees.firstName),
        asc(employees.middleName),
        asc(employees.employeeNo),
        asc(accountCode.accountCode),
        asc(accountCode.description),
        desc(employeesLoans.loanReferenceNumber),
        asc(employeesLoans.id),
    ];

    if (!sort) {
        return fallback;
    }

    if (sort.id === "employeeName") {
        return sort.desc
            ? [
                desc(employees.lastName),
                desc(employees.firstName),
                desc(employees.middleName),
                desc(employees.employeeNo),
                asc(accountCode.accountCode),
                asc(accountCode.description),
                desc(employeesLoans.loanReferenceNumber),
                asc(employeesLoans.id),
            ]
            : fallback;
    }

    const column = loanSortColumns[sort.id as keyof typeof loanSortColumns];

    if (!column) {
        return fallback;
    }

    return [
        sort.desc ? desc(column) : asc(column),
        asc(employeesLoans.id),
    ];
}

function toLikePattern(value: string) {
    return `%${value}%`;
}

export type getLoanRecordsTypes = Awaited<ReturnType<typeof getLoanRecords>>["data"];

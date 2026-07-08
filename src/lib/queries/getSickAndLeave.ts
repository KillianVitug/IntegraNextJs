import { db } from "@/db";
import {
  employees,
  employeesGeneralInfo,
  slvlGroup,
  employeesSalary,
  department,
  employeesLeaveRecords,
  leaveBalanceLedger,
  leaveTypes,
} from "@/db/schema";
import { employeeCodeSql } from "@/lib/employeeCodeSql";
import { normalizeTableQueryOptions, type TableQueryOptions, type TableSort } from "@/lib/queries/tableQuery";
import { eq, isNull, asc, and, inArray, sql, desc, ilike, or, type SQL } from "drizzle-orm";

const sickAndLeaveSelect = {
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

const sickAndLeaveFullNameSql = sql<string>`CONCAT(${employees.lastName}, ', ', ${employees.firstName}, ' ', COALESCE(${employees.middleName}, ''))`;

const sickAndLeaveSearchColumns = [
  employees.employeeNo,
  sql<string>`cast(${employees.employeeType} as text)`,
  employees.firstName,
  employees.middleName,
  employees.lastName,
  sickAndLeaveFullNameSql,
  department.name,
  sql<string>`cast(${employeesGeneralInfo.employmentStatus} as text)`,
] as const;

const sickAndLeaveFilterColumns = {
  employeeNo: employees.employeeNo,
  employeeType: sql<string>`cast(${employees.employeeType} as text)`,
  fullName: sickAndLeaveFullNameSql,
  dateHired: sql<string>`cast(${employeesGeneralInfo.dateHired} as text)`,
  department: department.name,
  status: sql<string>`cast(${employeesGeneralInfo.employmentStatus} as text)`,
  sickLeave: sql<string>`cast(${slvlGroup.defaultSickLeave} as text)`,
  vacationLeave: sql<string>`cast(${slvlGroup.defaultVacationLeave} as text)`,
} as const;

const sickAndLeaveSortColumns = {
  employeeNo: employees.employeeNo,
  employeeType: employees.employeeType,
  fullName: sickAndLeaveFullNameSql,
  dateHired: employeesGeneralInfo.dateHired,
  department: department.name,
  status: employeesGeneralInfo.employmentStatus,
  sickLeave: slvlGroup.defaultSickLeave,
  vacationLeave: slvlGroup.defaultVacationLeave,
} as const;

async function getSickAndLeave(year: number, options: TableQueryOptions | number = {}, pageSizeArg = 50) {
  const query = normalizeSickAndLeaveQueryOptions(options, pageSizeArg);
  const offset = (query.page - 1) * query.pageSize;
  const whereClause = buildSickAndLeaveWhereClause(year, query.search, query.filters);
  const orderBy = buildSickAndLeaveOrderBy(query.sort);

  const [rows, [countRow]] = await Promise.all([
    db.select(sickAndLeaveSelect)
      .from(employees)
      .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
      .leftJoin(employeesSalary, eq(employees.id, employeesSalary.employeeId))
      .leftJoin(slvlGroup, eq(employeesSalary.slvlGroupId, slvlGroup.id))
      .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset(offset),
    db.select({ total: sql<number>`count(distinct ${employees.id})` })
      .from(employees)
      .leftJoin(employeesGeneralInfo, eq(employees.id, employeesGeneralInfo.employeeId))
      .leftJoin(employeesSalary, eq(employees.id, employeesSalary.employeeId))
      .leftJoin(slvlGroup, eq(employeesSalary.slvlGroupId, slvlGroup.id))
      .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
      .where(whereClause),
  ]);

  const data = rows.map((employee) => ({
    ...employee,
    fullName: `${employee.lastName}, ${employee.firstName} ${employee.middleName ?? ""}`.trim(),
  }));

  return { data, total: Number(countRow.total) };
}

export async function getApprovedLeaveRecords() {
  try {
      const records = await db
          .select({
              employeeId: employeesLeaveRecords.employeeId,
              leaveType: employeesLeaveRecords.leaveType,
              noOfDays: employeesLeaveRecords.noOfDays
          })
          .from(employeesLeaveRecords)
          .where(eq(employeesLeaveRecords.leaveStatus, "Approved"));
      return { data: records, error: null };
  } catch {
      return { data: null, error: "Failed to fetch approved leave records" };
  }
}

export async function getSickAndLeaveWithUsage(year: number, options: TableQueryOptions | number = {}, pageSizeArg = 50) {
  const { data: employeeData, total } = await getSickAndLeave(year, options, pageSizeArg);

  if (employeeData.length === 0) {
    return { data: [], total };
  }

  const employeeIds = employeeData.map((e) => e.id);

  const ledgerUsage = await db
    .select({
      employeeId: leaveBalanceLedger.employeeId,
      leaveType: leaveTypes.code,
      usedDays: sql<string>`ABS(COALESCE(SUM(${leaveBalanceLedger.quantity}), 0))`,
    })
    .from(leaveBalanceLedger)
    .innerJoin(leaveTypes, eq(leaveBalanceLedger.leaveTypeId, leaveTypes.id))
    .where(and(
      inArray(leaveBalanceLedger.employeeId, employeeIds),
      eq(leaveBalanceLedger.transactionType, "Used"),
      sql`(${leaveBalanceLedger.periodYear} = ${year} or (${leaveBalanceLedger.periodYear} is null and extract(year from ${leaveBalanceLedger.entryDate}) = ${year}))`,
    ))
    .groupBy(leaveBalanceLedger.employeeId, leaveTypes.code);

  const usageMap = new Map<string, { usedSickLeave: number; usedVacationLeave: number }>();

  ledgerUsage.forEach(lr => {
    const usage = usageMap.get(lr.employeeId) ?? { usedSickLeave: 0, usedVacationLeave: 0 };
    if (lr.leaveType === "SL") usage.usedSickLeave += Number(lr.usedDays);
    if (lr.leaveType === "VL") usage.usedVacationLeave += Number(lr.usedDays);
    usageMap.set(lr.employeeId, usage);
  });

  const data = employeeData.map(emp => ({
    ...emp,
    ...usageMap.get(emp.id),
    usedSickLeave: usageMap.get(emp.id)?.usedSickLeave ?? 0,
    usedVacationLeave: usageMap.get(emp.id)?.usedVacationLeave ?? 0,
  }));

  return { data, total };
}

function normalizeSickAndLeaveQueryOptions(options: TableQueryOptions | number, pageSizeArg: number) {
  if (typeof options === "number") {
    return normalizeTableQueryOptions(
      { page: options, pageSize: pageSizeArg },
      { id: "employeeNo", desc: false }
    );
  }

  return normalizeTableQueryOptions(options, { id: "employeeNo", desc: false });
}

function buildSickAndLeaveWhereClause(year: number, search: string, filters: Record<string, string>) {
  const conditions: SQL[] = [
    isNull(employees.deletedAt),
    sql`${employeesGeneralInfo.dateHired} is not null`,
    sql`extract(year from ${employeesGeneralInfo.dateHired}) <= ${year}`,
  ];

  if (search) {
    const pattern = toLikePattern(search);
    conditions.push(
      or(
        ilike(employeeCodeSql({ employeeType: employees.employeeType, employeeNo: employees.employeeNo }), pattern),
        ...sickAndLeaveSearchColumns.map((column) => ilike(column, pattern))
      )!
    );
  }

  for (const [columnId, value] of Object.entries(filters)) {
    const column = sickAndLeaveFilterColumns[columnId as keyof typeof sickAndLeaveFilterColumns];

    if (column) {
      conditions.push(ilike(column, toLikePattern(value)));
    }
  }

  return and(...conditions);
}

function buildSickAndLeaveOrderBy(sort: TableSort | null) {
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

  const column = sickAndLeaveSortColumns[sort.id as keyof typeof sickAndLeaveSortColumns];

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

export type SickAndLeaveResultsType = Array<
  Awaited<ReturnType<typeof getSickAndLeaveWithUsage>>["data"][number]
>;


export async function getLeaveUsageByEmployeeIds(employeeIds: string[]) {
  if (employeeIds.length === 0) return {};

  const records = await db
    .select({
      employeeId: leaveBalanceLedger.employeeId,
      leaveType: leaveTypes.code,
      usedDays: sql<string>`ABS(COALESCE(SUM(${leaveBalanceLedger.quantity}), 0))`,
    })
    .from(leaveBalanceLedger)
    .innerJoin(leaveTypes, eq(leaveBalanceLedger.leaveTypeId, leaveTypes.id))
    .where(
      and(
        inArray(leaveBalanceLedger.employeeId, employeeIds),
        eq(leaveBalanceLedger.transactionType, "Used")
      )
    )
    .groupBy(leaveBalanceLedger.employeeId, leaveTypes.code);

  const usageMap: Record<
    string,
    { usedSickLeave: number; usedVacationLeave: number }
  > = {};

  for (const record of records) {
    const empId = record.employeeId;
    if (!usageMap[empId]) {
      usageMap[empId] = { usedSickLeave: 0, usedVacationLeave: 0 };
    }
    if (record.leaveType === "SL")
      usageMap[empId].usedSickLeave += Number(record.usedDays);
    if (record.leaveType === "VL")
      usageMap[empId].usedVacationLeave += Number(record.usedDays);
  }

  return usageMap;
}

import "server-only";

import { db } from "@/db";
import { connection } from "next/server";
import {
  attendanceImportBatches,
  department,
  employees,
  employeesGeneralInfo,
  employeesLeaveRecords,
  employeesOtherReferences,
  leaveStatusEnum,
  payrollPeriods,
  position,
} from "@/db/schema";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";

type LeaveStatus = typeof leaveStatusEnum.enumValues[number];
type LeaveType = string;

export type HomeDashboardData = {
  employeeRecordCount: number;
  departmentCount: number;
  pendingLeaveRequestCount: number;
  openPayrollPeriodCount: number;
  upcomingPayrollPeriods: HomeUpcomingPayrollPeriod[];
  recentAttendanceImports: HomeAttendanceImportItem[];
};

export type HomeUpcomingPayrollPeriod = {
  id: string;
  code: string;
  year: number;
  cycle: "A" | "B";
  startDate: string;
  endDate: string;
  nominalPayDate: string;
  adjustedPayDate: string;
  status: string;
};

export type HomeAttendanceImportItem = {
  id: string;
  sourceFileName: string;
  sourceFormat: string;
  status: string;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  importedAt: string;
  payrollPeriodId: string | null;
  payrollPeriodCode: string | null;
  payrollPeriodYear: number | null;
};

export type HomeLeavePageData = {
  leavesThisWeek: number;
  leavesNextMonth: number;
  pendingLeaves: number;
  pendingRows: HomePendingLeaveRow[];
};

export type HomePendingLeaveRow = {
  id: number;
  employeeId: string;
  employeeNo: string | null;
  employeeType: string | null;
  firstName: string | null;
  lastName: string | null;
  dateFiled: string;
  leaveStartDate: string;
  leaveEndDate: string | null;
  leaveType: LeaveType;
  noOfDays: number;
  reason: string;
  leaveStatus: LeaveStatus;
};

export type HomeDepartmentsData = {
  cards: HomeDepartmentCardData[];
};

export type HomeDepartmentEmployeeRow = {
  employeeId: string;
  employeeNo: string | null;
  employeeType: string | null;
  fullName: string;
  position: string | null;
};

export type HomeDepartmentCardData = {
  selectionKey: string;
  departmentId: number | null;
  name: string;
  code: string;
  employeeCount: number;
  isUnassigned: boolean;
  employees: HomeDepartmentEmployeeRow[];
};

function toNumber(value: unknown) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function toDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentWeekRange(referenceDate: Date) {
  const current = new Date(referenceDate);
  current.setHours(0, 0, 0, 0);

  const dayOfWeek = current.getDay();
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const start = new Date(current);
  start.setDate(current.getDate() + offsetToMonday);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return {
    start: toDateOnly(start),
    end: toDateOnly(end),
  };
}

function getNextMonthRange(referenceDate: Date) {
  const start = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 1,
    1
  );
  start.setHours(0, 0, 0, 0);

  const end = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 2,
    0
  );
  end.setHours(0, 0, 0, 0);

  return {
    start: toDateOnly(start),
    end: toDateOnly(end),
  };
}

function overlapsRange(
  record: {
    dateFiled: string;
    leaveStartDate: string | null;
    leaveEndDate: string | null;
  },
  rangeStart: string,
  rangeEnd: string
) {
  const leaveStart = record.leaveStartDate ?? record.dateFiled;
  const leaveEnd = record.leaveEndDate ?? leaveStart;

  return leaveStart <= rangeEnd && leaveEnd >= rangeStart;
}

function formatEmployeeFullName(params: {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}) {
  const givenNames = [params.firstName, params.middleName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return [params.lastName, givenNames].filter(Boolean).join(", ").trim();
}

export async function getHomeDashboardData(): Promise<HomeDashboardData> {
  await connection();

  const today = toDateOnly(new Date());

  const [
    employeeCountRows,
    departmentCountRows,
    pendingLeaveCountRows,
    openPayrollPeriodCountRows,
    upcomingPayrollPeriods,
    recentAttendanceImports,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(employees)
      .where(isNull(employees.deletedAt)),
    db.select({ count: sql<number>`COUNT(*)` }).from(department),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(employeesLeaveRecords)
      .leftJoin(employees, eq(employeesLeaveRecords.employeeId, employees.id))
      .where(
        and(
          eq(employeesLeaveRecords.leaveStatus, "Pending"),
          isNull(employees.deletedAt)
        )
      ),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(payrollPeriods)
      .where(eq(payrollPeriods.status, "Open")),
    db
      .select({
        id: payrollPeriods.id,
        code: payrollPeriods.code,
        year: payrollPeriods.year,
        cycle: payrollPeriods.cycle,
        startDate: payrollPeriods.startDate,
        endDate: payrollPeriods.endDate,
        nominalPayDate: payrollPeriods.nominalPayDate,
        adjustedPayDate: payrollPeriods.adjustedPayDate,
        status: payrollPeriods.status,
      })
      .from(payrollPeriods)
      .where(gte(payrollPeriods.adjustedPayDate, today))
      .orderBy(
        asc(payrollPeriods.adjustedPayDate),
        asc(payrollPeriods.startDate),
        asc(payrollPeriods.code)
      )
      .limit(4),
    db
      .select({
        id: attendanceImportBatches.id,
        sourceFileName: attendanceImportBatches.sourceFileName,
        sourceFormat: attendanceImportBatches.sourceFormat,
        status: attendanceImportBatches.status,
        totalRows: attendanceImportBatches.totalRows,
        matchedRows: attendanceImportBatches.matchedRows,
        unmatchedRows: attendanceImportBatches.unmatchedRows,
        duplicateRows: attendanceImportBatches.duplicateRows,
        importedAt: attendanceImportBatches.importedAt,
        payrollPeriodId: payrollPeriods.id,
        payrollPeriodCode: payrollPeriods.code,
        payrollPeriodYear: payrollPeriods.year,
      })
      .from(attendanceImportBatches)
      .leftJoin(
        payrollPeriods,
        eq(attendanceImportBatches.payrollPeriodId, payrollPeriods.id)
      )
      .orderBy(desc(attendanceImportBatches.importedAt))
      .limit(5),
  ]);

  return {
    employeeRecordCount: toNumber(employeeCountRows[0]?.count),
    departmentCount: toNumber(departmentCountRows[0]?.count),
    pendingLeaveRequestCount: toNumber(pendingLeaveCountRows[0]?.count),
    openPayrollPeriodCount: toNumber(openPayrollPeriodCountRows[0]?.count),
    upcomingPayrollPeriods,
    recentAttendanceImports: recentAttendanceImports.map((batch) => ({
      ...batch,
      importedAt: batch.importedAt.toISOString(),
    })),
  };
}

export async function getHomeLeavePageData(): Promise<HomeLeavePageData> {
  await connection();

  const today = new Date();
  const weekRange = getCurrentWeekRange(today);
  const nextMonthRange = getNextMonthRange(today);
  const leaveStartSort = sql<string>`COALESCE(${employeesLeaveRecords.leaveStartDate}, ${employeesLeaveRecords.dateFiled})`;

  const [approvedLeaveRows, pendingRows] = await Promise.all([
    db
      .select({
        dateFiled: employeesLeaveRecords.dateFiled,
        leaveStartDate: employeesLeaveRecords.leaveStartDate,
        leaveEndDate: employeesLeaveRecords.leaveEndDate,
      })
      .from(employeesLeaveRecords)
      .leftJoin(employees, eq(employeesLeaveRecords.employeeId, employees.id))
      .where(
        and(
          eq(employeesLeaveRecords.leaveStatus, "Approved"),
          isNull(employees.deletedAt)
        )
      ),
    db
      .select({
        id: employeesLeaveRecords.id,
        employeeId: employeesLeaveRecords.employeeId,
        employeeNo: employees.employeeNo,
        employeeType: employees.employeeType,
        firstName: employees.firstName,
        lastName: employees.lastName,
        dateFiled: employeesLeaveRecords.dateFiled,
        leaveStartDate: employeesLeaveRecords.leaveStartDate,
        leaveEndDate: employeesLeaveRecords.leaveEndDate,
        leaveType: employeesLeaveRecords.leaveType,
        noOfDays: employeesLeaveRecords.noOfDays,
        reason: employeesLeaveRecords.reason,
        leaveStatus: employeesLeaveRecords.leaveStatus,
      })
      .from(employeesLeaveRecords)
      .leftJoin(employees, eq(employeesLeaveRecords.employeeId, employees.id))
      .where(
        and(
          eq(employeesLeaveRecords.leaveStatus, "Pending"),
          isNull(employees.deletedAt)
        )
      )
      .orderBy(asc(leaveStartSort), asc(employeesLeaveRecords.dateFiled)),
  ]);

  return {
    leavesThisWeek: approvedLeaveRows.filter((record) =>
      overlapsRange(record, weekRange.start, weekRange.end)
    ).length,
    leavesNextMonth: approvedLeaveRows.filter((record) =>
      overlapsRange(record, nextMonthRange.start, nextMonthRange.end)
    ).length,
    pendingLeaves: pendingRows.length,
    pendingRows: pendingRows.map((row) => ({
      ...row,
      leaveStartDate: row.leaveStartDate ?? row.dateFiled,
      leaveEndDate: row.leaveEndDate ?? null,
      noOfDays: toNumber(row.noOfDays),
      reason: row.reason ?? "",
    })),
  };
}

export async function getHomeDepartmentsData(): Promise<HomeDepartmentsData> {
  await connection();

  const [groupedDepartments, employeeRows] = await Promise.all([
    db
      .select({
        departmentId: department.id,
        name: department.name,
        code: department.code,
        employeeCount: sql<number>`COUNT(${employees.id})`,
      })
      .from(department)
      .leftJoin(
        employeesGeneralInfo,
        eq(department.id, employeesGeneralInfo.departmentId)
      )
      .leftJoin(
        employees,
        and(
          eq(employeesGeneralInfo.employeeId, employees.id),
          isNull(employees.deletedAt)
        )
      )
      .groupBy(department.id, department.name, department.code)
      .orderBy(asc(department.name)),
    db
      .select({
        employeeId: employees.id,
        employeeNo: employees.employeeNo,
        employeeType: employees.employeeType,
        firstName: employees.firstName,
        middleName: employees.middleName,
        lastName: employees.lastName,
        departmentId: employeesGeneralInfo.departmentId,
        position: position.name,
      })
      .from(employees)
      .leftJoin(
        employeesGeneralInfo,
        eq(employees.id, employeesGeneralInfo.employeeId)
      )
      .leftJoin(
        employeesOtherReferences,
        eq(employees.id, employeesOtherReferences.employeeId)
      )
      .leftJoin(position, eq(employeesOtherReferences.positionId, position.id))
      .where(isNull(employees.deletedAt))
      .orderBy(
        asc(employees.employeeType),
        asc(employees.employeeNo),
        asc(employees.lastName),
        asc(employees.firstName),
      ),
  ]);

  const employeesBySelectionKey = new Map<string, HomeDepartmentEmployeeRow[]>();

  for (const row of employeeRows) {
    const selectionKey =
      row.departmentId == null ? "unassigned" : `department-${row.departmentId}`;
    const employee = {
      employeeId: row.employeeId,
      employeeNo: row.employeeNo,
      employeeType: row.employeeType,
      fullName:
        formatEmployeeFullName({
          firstName: row.firstName,
          middleName: row.middleName,
          lastName: row.lastName,
        }) || "Unknown employee",
      position: row.position ?? null,
    } satisfies HomeDepartmentEmployeeRow;

    const current = employeesBySelectionKey.get(selectionKey) ?? [];
    current.push(employee);
    employeesBySelectionKey.set(selectionKey, current);
  }

  const cards: HomeDepartmentCardData[] = groupedDepartments.map((row) => {
    const selectionKey = `department-${row.departmentId}`;

    return {
      selectionKey,
      departmentId: row.departmentId,
      name: row.name,
      code: row.code,
      employeeCount: toNumber(row.employeeCount),
      isUnassigned: false,
      employees: employeesBySelectionKey.get(selectionKey) ?? [],
    };
  });

  const unassignedEmployees = employeesBySelectionKey.get("unassigned") ?? [];

  if (unassignedEmployees.length > 0) {
    cards.push({
      selectionKey: "unassigned",
      departmentId: null,
      name: "Unassigned",
      code: "N/A",
      employeeCount: unassignedEmployees.length,
      isUnassigned: true,
      employees: unassignedEmployees,
    });
  }

  return { cards };
}

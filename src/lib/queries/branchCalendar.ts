import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  accountCode,
  branchCalendarAccountCodeOverrides,
  department,
  employeeLeaveRecordDays,
  employeeShiftAssignments,
  employeeWeeklyShiftPatterns,
  employees,
  employeesGeneralInfo,
  employeesLeaveRecords,
  employeesTimekeeping,
  holidayYearCalendar,
  leaveTypes,
} from "@/db/schema";
import {
  isResolvedScheduleRestDay,
  resolveEmployeeScheduleForDate,
} from "@/lib/payroll/scheduleResolver";

const branchCalendarMonthSchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  departmentId: z.coerce.number().int().positive().optional(),
});

const branchCalendarAccountCodeTypes = [
  "Regular Hours",
  "Overtime",
  "Night Premium",
  "Sunday/Holiday",
] as const;

function buildDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
}

function buildMonthDateKeys(year: number, month: number) {
  const dayCount = new Date(year, month, 0).getDate();
  return Array.from({ length: dayCount }, (_, index) =>
    buildDateKey(year, month, index + 1),
  );
}

function formatMonthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function toNumber(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function eachDateInRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  let cursor = parseDateKey(startDate);
  const end = parseDateKey(endDate);

  while (cursor.getTime() <= end.getTime()) {
    dates.push(formatDateKey(cursor));
    cursor = addUtcDays(cursor, 1);
  }

  return dates;
}

function formatAccountOption(
  row:
    | {
        id: number;
        accountCode: string;
        description: string | null;
      }
    | undefined
    | null
) {
  if (!row) return null;

  return {
    id: row.id,
    code: row.accountCode,
    description: row.description,
  };
}

export async function getBranchCalendarMonth(input: unknown) {
  const { year, month, departmentId } = branchCalendarMonthSchema.parse(input);
  const dateKeys = buildMonthDateKeys(year, month);
  const startDate = dateKeys[0];
  const endDate = dateKeys[dateKeys.length - 1];

  const departments = await db
    .select({
      id: department.id,
      name: department.name,
      code: department.code,
    })
    .from(department)
    .orderBy(asc(department.name), asc(department.code));

  const selectedDepartmentId = departments.some((row) => row.id === departmentId)
    ? departmentId
    : null;

  const [employeeRows, holidayRows, accountCodeRows, overrideRows] =
    await Promise.all([
    db
      .select({
        id: employees.id,
        employeeNo: employees.employeeNo,
        firstName: employees.firstName,
        middleName: employees.middleName,
        lastName: employees.lastName,
        departmentId: employeesGeneralInfo.departmentId,
        departmentName: department.name,
        departmentCode: department.code,
        timekeeping: {
          id: employeesTimekeeping.id,
          employeeId: employeesTimekeeping.employeeId,
          timekeepingId: employeesTimekeeping.timekeepingId,
          shiftSchedule: employeesTimekeeping.shiftSchedule,
          checkInTime: employeesTimekeeping.checkInTime,
          checkOutTime: employeesTimekeeping.checkOutTime,
          restDay: employeesTimekeeping.restDay,
          hoursWorked: employeesTimekeeping.hoursWorked,
          minutesWorked: employeesTimekeeping.minutesWorked,
          createdAt: employeesTimekeeping.createdAt,
          updatedAt: employeesTimekeeping.updatedAt,
          deletedAt: employeesTimekeeping.deletedAt,
        },
      })
      .from(employees)
      .innerJoin(
        employeesGeneralInfo,
        eq(employees.id, employeesGeneralInfo.employeeId),
      )
      .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
      .leftJoin(
        employeesTimekeeping,
        eq(employees.id, employeesTimekeeping.employeeId),
      )
      .where(
        and(
          isNull(employees.deletedAt),
          isNull(employeesGeneralInfo.deletedAt),
          selectedDepartmentId
            ? eq(employeesGeneralInfo.departmentId, selectedDepartmentId)
            : undefined,
        ),
      )
      .orderBy(
        asc(department.name),
        asc(employees.lastName),
        asc(employees.firstName),
      ),
    db
      .select({
        id: holidayYearCalendar.id,
        name: holidayYearCalendar.name,
        holidayDate: holidayYearCalendar.holidayDate,
        holidayDate2: holidayYearCalendar.holidayDate2,
        checkDate1: holidayYearCalendar.checkDate1,
        checkDate2: holidayYearCalendar.checkDate2,
        requireCheckDate1: holidayYearCalendar.requireCheckDate1,
        requireCheckDate2: holidayYearCalendar.requireCheckDate2,
        holidayType: holidayYearCalendar.holidayType,
        isPaid: holidayYearCalendar.isPaid,
      })
      .from(holidayYearCalendar)
      .where(
        and(
          eq(holidayYearCalendar.status, "Confirmed"),
          isNotNull(holidayYearCalendar.holidayDate),
          lte(holidayYearCalendar.holidayDate, endDate),
          sql`coalesce(${holidayYearCalendar.holidayDate2}, ${holidayYearCalendar.holidayDate}) >= ${startDate}`,
        ),
      )
      .orderBy(asc(holidayYearCalendar.holidayDate), asc(holidayYearCalendar.name)),
    db
      .select({
        id: accountCode.id,
        accountCode: accountCode.accountCode,
        accountType: accountCode.accountType,
        description: accountCode.description,
      })
      .from(accountCode)
      .where(inArray(accountCode.accountType, [...branchCalendarAccountCodeTypes]))
      .orderBy(
        asc(accountCode.accountCode),
        asc(accountCode.accountType),
        asc(accountCode.description),
      ),
    db
      .select({
        id: branchCalendarAccountCodeOverrides.id,
        attendanceDate: branchCalendarAccountCodeOverrides.attendanceDate,
        departmentId: branchCalendarAccountCodeOverrides.departmentId,
        regularAccountCodeId:
          branchCalendarAccountCodeOverrides.regularAccountCodeId,
        overtimeAccountCodeId:
          branchCalendarAccountCodeOverrides.overtimeAccountCodeId,
      })
      .from(branchCalendarAccountCodeOverrides)
      .where(
        and(
          gte(branchCalendarAccountCodeOverrides.attendanceDate, startDate),
          lte(branchCalendarAccountCodeOverrides.attendanceDate, endDate),
          selectedDepartmentId
            ? or(
                isNull(branchCalendarAccountCodeOverrides.departmentId),
                eq(
                  branchCalendarAccountCodeOverrides.departmentId,
                  selectedDepartmentId,
                ),
              )
            : isNull(branchCalendarAccountCodeOverrides.departmentId),
        ),
      ),
  ]);

  const accountCodeOptions = accountCodeRows.map((row) => ({
    id: row.id,
    code: row.accountCode,
    accountType: row.accountType,
    description: row.description,
  }));
  const accountCodeById = new Map(accountCodeRows.map((row) => [row.id, row]));
  const overrideByDateScope = new Map(
    overrideRows.map((row) => [
      `${row.attendanceDate}:${row.departmentId ?? "all"}`,
      row,
    ]),
  );

  function formatOverride(
    row: (typeof overrideRows)[number] | undefined | null,
    source: "direct" | "inherited",
  ) {
    if (!row) return null;
    const regularAccount = formatAccountOption(
      accountCodeById.get(row.regularAccountCodeId),
    );
    const overtimeAccount = formatAccountOption(
      accountCodeById.get(row.overtimeAccountCodeId),
    );
    if (!regularAccount || !overtimeAccount) return null;

    return {
      id: row.id,
      attendanceDate: row.attendanceDate,
      departmentId: row.departmentId,
      regularAccountCodeId: row.regularAccountCodeId,
      overtimeAccountCodeId: row.overtimeAccountCodeId,
      regularAccount,
      overtimeAccount,
      source,
    };
  }

  function getAccountCodeOverrideForDate(date: string) {
    const allDepartmentsRow = overrideByDateScope.get(`${date}:all`);
    const departmentRow = selectedDepartmentId
      ? overrideByDateScope.get(`${date}:${selectedDepartmentId}`)
      : null;
    const direct = formatOverride(
      selectedDepartmentId ? departmentRow : allDepartmentsRow,
      "direct",
    );
    const inherited = selectedDepartmentId
      ? formatOverride(allDepartmentsRow, "inherited")
      : null;

    return {
      direct,
      inherited,
      effective: direct ?? inherited,
    };
  }

  const holidaysByDate = new Map<
    string,
    {
      id: number;
      name: string;
      holidayDate: string;
      holidayDate2: string | null;
      checkDate1: string | null;
      checkDate2: string | null;
      requireCheckDate1: boolean;
      requireCheckDate2: boolean;
      holidayType: string;
      isPaid: boolean;
    }[]
  >();
  const checkDateMarkersByDate = new Map<
    string,
    {
      holidayId: number;
      holidayName: string;
      checkDateNumber: 1 | 2;
      holidayDate: string;
      holidayDate2: string | null;
    }[]
  >();

  for (const holiday of holidayRows) {
    if (!holiday.holidayDate) continue;
    const rangeStart = holiday.holidayDate < startDate ? startDate : holiday.holidayDate;
    const holidayEnd = holiday.holidayDate2 ?? holiday.holidayDate;
    const rangeEnd = holidayEnd > endDate ? endDate : holidayEnd;

    for (const date of eachDateInRange(rangeStart, rangeEnd)) {
      const current = holidaysByDate.get(date) ?? [];
      current.push({
        id: holiday.id,
        name: holiday.name,
        holidayDate: holiday.holidayDate,
        holidayDate2: holiday.holidayDate2,
        checkDate1: holiday.checkDate1,
        checkDate2: holiday.checkDate2,
        requireCheckDate1: holiday.requireCheckDate1,
        requireCheckDate2: holiday.requireCheckDate2,
        holidayType: holiday.holidayType,
        isPaid: holiday.isPaid,
      });
      holidaysByDate.set(date, current);
    }

    const checkDateEntries = [
      {
        date: holiday.requireCheckDate1 ? holiday.checkDate1 : null,
        checkDateNumber: 1 as const,
      },
      {
        date: holiday.requireCheckDate2 ? holiday.checkDate2 : null,
        checkDateNumber: 2 as const,
      },
    ];

    for (const entry of checkDateEntries) {
      if (!entry.date || entry.date < startDate || entry.date > endDate) continue;
      const current = checkDateMarkersByDate.get(entry.date) ?? [];
      current.push({
        holidayId: holiday.id,
        holidayName: holiday.name,
        checkDateNumber: entry.checkDateNumber,
        holidayDate: holiday.holidayDate,
        holidayDate2: holiday.holidayDate2,
      });
      checkDateMarkersByDate.set(entry.date, current);
    }
  }

  const employeeIds = employeeRows.map((employee) => employee.id);

  if (employeeIds.length === 0) {
    return {
      year,
      month,
      monthLabel: formatMonthLabel(year, month),
      startDate,
      endDate,
      selectedDepartmentId,
      departments,
      regularAccountCodeOptions: accountCodeOptions,
      overtimeAccountCodeOptions: accountCodeOptions,
      employeeCount: 0,
      days: dateKeys.map((date, index) => ({
        date,
        dayOfMonth: index + 1,
        employeeCount: 0,
        workingCount: 0,
        restDayCount: 0,
        overrideCount: 0,
        approvedLeaveCount: 0,
        approvedLeaveEmployeeCount: 0,
        accountCodeOverride: getAccountCodeOverrideForDate(date),
        holidays: holidaysByDate.get(date) ?? [],
        holidayCheckDates: checkDateMarkersByDate.get(date) ?? [],
        employees: [],
      })),
    };
  }

  const [shiftAssignments, weeklyPatterns, approvedLeaveDays] = await Promise.all([
    db
      .select()
      .from(employeeShiftAssignments)
      .where(
        and(
          inArray(employeeShiftAssignments.employeeId, employeeIds),
          lte(employeeShiftAssignments.effectiveFrom, endDate),
          or(
            isNull(employeeShiftAssignments.effectiveTo),
            gte(employeeShiftAssignments.effectiveTo, startDate),
          ),
        ),
      )
      .orderBy(
        asc(employeeShiftAssignments.employeeId),
        desc(employeeShiftAssignments.effectiveFrom),
      ),
    db.query.employeeWeeklyShiftPatterns.findMany({
      where: and(
        inArray(employeeWeeklyShiftPatterns.employeeId, employeeIds),
        lte(employeeWeeklyShiftPatterns.effectiveFrom, endDate),
        or(
          isNull(employeeWeeklyShiftPatterns.effectiveTo),
          gte(employeeWeeklyShiftPatterns.effectiveTo, startDate),
        ),
      ),
      with: {
        days: true,
      },
    }),
    db
      .select({
        leaveRecordId: employeesLeaveRecords.id,
        employeeId: employeesLeaveRecords.employeeId,
        leaveType: employeesLeaveRecords.leaveType,
        leaveTypeName: leaveTypes.name,
        reason: employeesLeaveRecords.reason,
        leaveDate: employeeLeaveRecordDays.leaveDate,
        dayPart: employeeLeaveRecordDays.dayPart,
        quantity: employeeLeaveRecordDays.quantity,
      })
      .from(employeeLeaveRecordDays)
      .innerJoin(
        employeesLeaveRecords,
        eq(employeeLeaveRecordDays.leaveRecordId, employeesLeaveRecords.id),
      )
      .leftJoin(leaveTypes, eq(employeesLeaveRecords.leaveTypeId, leaveTypes.id))
      .where(
        and(
          inArray(employeesLeaveRecords.employeeId, employeeIds),
          eq(employeesLeaveRecords.leaveStatus, "Approved"),
          isNull(employeesLeaveRecords.deletedAt),
          gte(employeeLeaveRecordDays.leaveDate, startDate),
          lte(employeeLeaveRecordDays.leaveDate, endDate),
        ),
      )
      .orderBy(
        asc(employeeLeaveRecordDays.leaveDate),
        asc(employeesLeaveRecords.employeeId),
      ),
  ]);

  const assignmentsByEmployeeId = new Map<string, typeof shiftAssignments>();
  for (const assignment of shiftAssignments) {
    const current = assignmentsByEmployeeId.get(assignment.employeeId) ?? [];
    current.push(assignment);
    assignmentsByEmployeeId.set(assignment.employeeId, current);
  }

  const weeklyPatternsByEmployeeId = new Map<string, typeof weeklyPatterns>();
  for (const pattern of weeklyPatterns) {
    const current = weeklyPatternsByEmployeeId.get(pattern.employeeId) ?? [];
    current.push(pattern);
    weeklyPatternsByEmployeeId.set(pattern.employeeId, current);
  }

  const approvedLeavesByEmployeeDate = new Map<
    string,
    typeof approvedLeaveDays
  >();
  for (const leaveDay of approvedLeaveDays) {
    const key = `${leaveDay.employeeId}:${leaveDay.leaveDate}`;
    const current = approvedLeavesByEmployeeDate.get(key) ?? [];
    current.push(leaveDay);
    approvedLeavesByEmployeeDate.set(key, current);
  }

  const days = dateKeys.map((date, index) => {
    const employeesForDay = employeeRows.map((employee) => {
      const approvedLeaves = (
        approvedLeavesByEmployeeDate.get(`${employee.id}:${date}`) ?? []
      ).map((leaveDay) => ({
        leaveRecordId: leaveDay.leaveRecordId,
        leaveType: leaveDay.leaveType,
        leaveTypeName: leaveDay.leaveTypeName,
        dayPart: leaveDay.dayPart,
        quantity: toNumber(leaveDay.quantity),
        reason: leaveDay.reason,
      }));
      const resolvedSchedule = resolveEmployeeScheduleForDate({
        attendanceDate: date,
        assignments: assignmentsByEmployeeId.get(employee.id) ?? [],
        weeklyPatterns: weeklyPatternsByEmployeeId.get(employee.id) ?? [],
        legacyTimekeeping: employee.timekeeping,
      });
      const isRestDay = isResolvedScheduleRestDay(resolvedSchedule);
      const override = resolvedSchedule.overrideAssignment;
      const weeklyDay = resolvedSchedule.weeklyPatternDay;
      const shiftName = override?.shiftName ?? weeklyDay?.shiftName ?? null;
      const shiftCode = override?.shiftCode ?? weeklyDay?.shiftCode ?? null;
      const checkInTime = resolvedSchedule.shiftWindow.checkInTime;
      const checkOutTime = resolvedSchedule.shiftWindow.checkOutTime;

      return {
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        firstName: employee.firstName,
        middleName: employee.middleName,
        lastName: employee.lastName,
        departmentId: employee.departmentId,
        departmentName: employee.departmentName,
        departmentCode: employee.departmentCode,
        source: resolvedSchedule.source,
        shiftName,
        shiftCode,
        checkInTime,
        checkOutTime,
        hoursPerDay: toNumber(resolvedSchedule.hoursPerDay),
        isRestDay,
        overrideEffectiveFrom: override?.effectiveFrom ?? null,
        overrideEffectiveTo: override?.effectiveTo ?? null,
        hasApprovedLeave: approvedLeaves.length > 0,
        approvedLeaves,
      };
    });

    const employeesWithApprovedLeave = employeesForDay.filter(
      (employee) => employee.hasApprovedLeave,
    );

    return {
      date,
      dayOfMonth: index + 1,
      employeeCount: employeesForDay.length,
      workingCount: employeesForDay.filter((employee) => !employee.isRestDay).length,
      restDayCount: employeesForDay.filter((employee) => employee.isRestDay).length,
      overrideCount: employeesForDay.filter(
        (employee) => employee.source === "OVERRIDE",
      ).length,
      approvedLeaveCount: employeesWithApprovedLeave.reduce(
        (total, employee) => total + employee.approvedLeaves.length,
        0,
      ),
      approvedLeaveEmployeeCount: employeesWithApprovedLeave.length,
      accountCodeOverride: getAccountCodeOverrideForDate(date),
      holidays: holidaysByDate.get(date) ?? [],
      holidayCheckDates: checkDateMarkersByDate.get(date) ?? [],
      employees: employeesForDay,
    };
  });

  return {
    year,
    month,
    monthLabel: formatMonthLabel(year, month),
    startDate,
    endDate,
    selectedDepartmentId,
    departments,
    regularAccountCodeOptions: accountCodeOptions,
    overtimeAccountCodeOptions: accountCodeOptions,
    employeeCount: employeeRows.length,
    days,
  };
}

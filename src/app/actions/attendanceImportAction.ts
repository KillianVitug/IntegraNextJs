"use server";

import { revalidatePath } from "next/cache";
import { createHash } from "crypto";
import type {
  AttendanceImportBatchDiagnosticsView,
  AttendanceDtrCorrectionQueueView,
  AttendanceDtrCorrectionView,
  AttendanceDtrEmployeeRowsView,
  AttendanceDtrEmployeeSummaryView,
  AttendanceDtrEmployeeView,
  AttendanceDtrHeldRowsView,
  AttendanceDtrSummaryView,
  AttendanceDtrTotalsView,
  AttendanceDtrView,
  PayrollExceptionWorkspaceView,
} from "@/app/(ntg)/payroll/types";
import { db } from "@/db";
import {
  accountCode,
  attendanceDailySummaries,
  attendanceDtrCorrections,
  attendanceDtrHoldApprovals,
  attendanceImportBatches,
  attendanceRawLogs,
  branchCalendarAccountCodeOverrides,
  employeeAttendanceDayStatusOverrides,
  employeeAttendanceDayTypeOverrides,
  employeeAttendancePeriodOverrides,
  employeePayrollExceptionRows,
  employeeShiftAssignments,
  employeeWeeklyShiftPatterns,
  employees,
  employeesGeneralInfo,
  employeesLeaveRecords,
  employeesTimekeeping,
  holidayTypeAccountCodes,
  holidayYearCalendar,
  leaveTypes,
  overtimeRules,
  payrollPeriods,
  payrollRuns,
  shiftTableBreaks,
} from "@/db/schema";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  getManagerDepartmentIds,
  requireManager,
} from "@/lib/auth/server";
import {
  recordAdminAuditEvent,
  recordPayrollRunEvent,
  requireAdminActor,
} from "@/lib/admin";
import {
  getEmployeeDepartmentMetadata,
  loadEmployeeDepartmentMetadataByEmployeeId,
  type EmployeeDepartmentMetadata,
} from "@/lib/payroll/employeeDepartment";
import {
  AttendanceParseError,
  assertAttendanceLogsMatchPayrollPeriod,
  filterAttendanceLogsForPayrollPeriod,
  normalizeAttendanceEmployeeKey,
  parseAttendanceBuffer,
  type ParsedAttendanceLog,
} from "@/lib/payroll/attendance";
import {
  buildAttendanceCorrectionSuggestionComputations,
  buildAttendancePeriodDetailRows,
  buildAttendanceSummaryComputations,
  type AttendanceApprovedCorrectionRecord,
  type AttendanceCorrectionSuggestionComputation,
  type AttendanceSummaryComputation,
  type ShiftTableBreakRecord,
} from "@/lib/payroll/attendanceSync";
import { ensurePayrollFoundationData } from "@/lib/payroll/foundation";
import { fetchConfirmedHolidayRowsForRange } from "@/lib/holidays";
import { buildLeaveTypeMapByCode, resolveLeavePayStatus } from "@/lib/payroll/leave";
import { DEFAULT_EMPLOYEE_TYPE } from "@/utils/employeeCode";
import {
  applyAttendanceDtrEffectiveStatus,
  ATTENDANCE_DTR_WORKED_MINUTES_PER_PRESENT_DAY,
  attendanceDtrDayTypeValues,
  attendanceDtrManualStatusValues,
  computeNetDtrWorkedMinutes,
  getAttendanceDtrDayTypeFromHolidayType,
  getHolidayTypeFromAttendanceDtrDayType,
  getComputedAttendanceDtrStatus,
  normalizeAttendanceDtrAnomalyFlags,
  normalizeAttendanceDtrPeriodOverride,
  type AttendanceDtrDayType,
  type AttendanceDtrManualStatus,
} from "@/lib/payroll/dtrOverrides";
import {
  buildHolidayTypeByDate,
  resolveOvertimeCategory,
  type OvertimeCategory,
  type OvertimeHolidayType,
} from "@/lib/payroll/overtime";
import { computeManualPayrollLatestBaseline } from "@/lib/payroll/engine";
import { refreshManualPayrollAttendanceLinesFromBaseline } from "@/lib/payroll/manualPayroll";
import { computeGeneratedDtrLwopMinutes } from "@/lib/payroll/dtrLwop";
import {
  isGeneratedDtrHolidayCheckRequirementSatisfied,
  getGeneratedDtrHolidayOvertimeCapacityMinutes,
  getGeneratedDtrHolidayWorkedMinutes,
  type GeneratedDtrHolidayCheckDateAttendance,
  type GeneratedDtrHolidayCheckDateRequirement,
} from "@/lib/payroll/generatedDtrHolidays";
import {
  getEmployeePayrollExceptionRows,
  getEmployeePayrollRecurringEntryRows,
  getPayrollExceptionAccountCodeOptions,
} from "@/lib/payroll/payrollExceptionRows";
import { getEmployeePayrollScheduledLoanRows } from "@/lib/payroll/payrollLoanRows";
import type { PayrollExceptionDtrOverrideSource } from "@/lib/payroll/payrollExceptions";
import {
  type AttendanceCorrectionPayload,
  type AttendanceDtrCorrectionStatus,
  type AttendanceDtrCorrectionType,
} from "@/lib/payroll/attendanceCorrections";
import type {
  ShiftAssignmentRecord,
  WeeklyShiftPatternRecord,
} from "@/lib/payroll/scheduleResolver";

type AttendancePeriodRawLogRow = Pick<
  typeof attendanceRawLogs.$inferSelect,
  | "id"
  | "employeeId"
  | "employeeNo"
  | "batchId"
  | "loggedAt"
  | "logDate"
  | "logTime"
  | "direction"
  | "sourceLine"
  | "rawText"
  | "deviceId"
  | "siteCode"
> & {
  sourceFileName: string;
};

type AttendancePeriodEmployeeRecord = typeof employees.$inferSelect & {
  timekeeping: typeof employeesTimekeeping.$inferSelect | null;
};

type AttendancePeriodEligibleEmployeeRecord = AttendancePeriodEmployeeRecord & {
  generalInfo: typeof employeesGeneralInfo.$inferSelect | null;
};

type AttendancePeriodLeaveRecord = Pick<
  typeof employeesLeaveRecords.$inferSelect,
  "employeeId" | "leaveStartDate" | "leaveEndDate" | "dateFiled" | "leaveType"
> & {
  leaveTypeLookup: typeof leaveTypes.$inferSelect | null;
};

type AttendancePeriodSourceData = {
  payrollPeriod: typeof payrollPeriods.$inferSelect;
  rawLogs: AttendancePeriodRawLogRow[];
  employeeRecords: AttendancePeriodEmployeeRecord[];
  departmentByEmployeeId: Map<string, EmployeeDepartmentMetadata>;
  approvedLeaves: AttendancePeriodLeaveRecord[];
  shiftAssignments: ShiftAssignmentRecord[];
  weeklyPatterns: WeeklyShiftPatternRecord[];
  shiftTableBreaksByShiftTableId: Map<number, ShiftTableBreakRecord[]>;
  approvedCorrections: Array<typeof attendanceDtrCorrections.$inferSelect>;
  periodOverrides: Array<typeof employeeAttendancePeriodOverrides.$inferSelect>;
  dayStatusOverrides: Array<typeof employeeAttendanceDayStatusOverrides.$inferSelect>;
  dayTypeOverrides: Array<typeof employeeAttendanceDayTypeOverrides.$inferSelect>;
  holidayRows: Array<{
    holidayDate: string;
    holidayDate2: string | null;
    checkDate1?: string | null;
    checkDate2?: string | null;
    requireCheckDate1?: boolean | null;
    requireCheckDate2?: boolean | null;
    holidayType: OvertimeHolidayType;
  }>;
};

type AttendancePeriodPersistedSummarySourceData = {
  payrollPeriod: typeof payrollPeriods.$inferSelect;
  summaryRows: Array<typeof attendanceDailySummaries.$inferSelect>;
  employeeRecords: AttendancePeriodEmployeeRecord[];
  departmentByEmployeeId: Map<string, EmployeeDepartmentMetadata>;
  sourceFilesByEmployeeId: Map<
    string,
    Map<string, { batchId: string; sourceFileName: string; punchCount: number }>
  >;
  rawPunchesByEmployeeDate: Map<string, Date[]>;
  periodOverrides: Array<typeof employeeAttendancePeriodOverrides.$inferSelect>;
  dayStatusOverrides: Array<typeof employeeAttendanceDayStatusOverrides.$inferSelect>;
  dayTypeOverrides: Array<typeof employeeAttendanceDayTypeOverrides.$inferSelect>;
  holdApprovalRows: Array<{
    employeeId: string;
    attendanceDate: string;
    status: string;
    targetPayrollPeriodCode: string;
  }>;
  holidayRows: Array<{
    holidayDate: string;
    holidayDate2: string | null;
    checkDate1?: string | null;
    checkDate2?: string | null;
    requireCheckDate1?: boolean | null;
    requireCheckDate2?: boolean | null;
    holidayType: OvertimeHolidayType;
  }>;
};

type AttendanceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AttendanceDatabase = typeof db | AttendanceTransaction;

async function loadEligibleSemiMonthlyAttendanceEmployees(
  database: AttendanceDatabase,
  payrollPeriod: typeof payrollPeriods.$inferSelect,
  employeeId?: string,
  employeeIds?: string[]
): Promise<AttendancePeriodEmployeeRecord[]> {
  if (employeeIds && employeeIds.length === 0) return [];

  const employeeRows = (await database.query.employees.findMany({
    where: and(
      employeeId
        ? eq(employees.id, employeeId)
        : employeeIds
          ? inArray(employees.id, employeeIds)
          : sql`TRUE`,
      eq(employees.employeeType, DEFAULT_EMPLOYEE_TYPE),
      isNull(employees.deletedAt)
    ),
    with: {
      generalInfo: true,
      timekeeping: true,
    },
  })) as AttendancePeriodEligibleEmployeeRecord[];

  return employeeRows.filter((employee) => {
    const payrollTerms = employee.generalInfo?.payrollTerms;
    const separated = employee.generalInfo?.separationDate;

    return (
      payrollTerms === "Semi-Monthly" &&
      (!separated || separated >= payrollPeriod.startDate)
    );
  });
}

const attendanceDayNameFormatter = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
});

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildAttendanceHash(args: {
  employeeNo: string;
  normalizedEmployeeKey: string | null;
  logDate: string;
  logTime: string;
  direction: string;
  deviceId?: string | null;
}) {
  return createHash("sha256")
    .update(
      [
        args.normalizedEmployeeKey ?? args.employeeNo,
        args.logDate,
        args.logTime,
        args.direction,
        args.deviceId ?? "",
      ].join("|")
    )
    .digest("hex");
}

function collectShiftTableIds(args: {
  shiftAssignments: Array<{ shiftTableId: number | null }>;
  weeklyPatterns: Array<{
    days: Array<{ shiftTableId: number | null }>;
  }>;
}) {
  return [...new Set(
    [
      ...args.shiftAssignments.map((assignment) => assignment.shiftTableId),
      ...args.weeklyPatterns.flatMap((pattern) =>
        pattern.days.map((day) => day.shiftTableId)
      ),
    ].filter((shiftTableId): shiftTableId is number => typeof shiftTableId === "number" && shiftTableId > 0)
  )];
}

function buildShiftTableBreakLookup(breakRows: ShiftTableBreakRecord[]) {
  const breaksByShiftTableId = new Map<number, ShiftTableBreakRecord[]>();

  for (const breakRow of breakRows) {
    const current = breaksByShiftTableId.get(breakRow.shiftTableId) ?? [];
    current.push(breakRow);
    breaksByShiftTableId.set(breakRow.shiftTableId, current);
  }

  return breaksByShiftTableId;
}

function buildEmployeeLookup<T extends { employeeNo: string }>(employeeRecords: T[]) {
  const employeeByNormalizedKey = new Map<string, typeof employeeRecords[number]>();
  const ambiguousNormalizedKeys = new Set<string>();

  for (const employee of employeeRecords) {
    const normalizedKey = normalizeAttendanceEmployeeKey(employee.employeeNo);
    if (!normalizedKey) continue;

    if (ambiguousNormalizedKeys.has(normalizedKey)) {
      continue;
    }

    const existingEmployee = employeeByNormalizedKey.get(normalizedKey);
    if (existingEmployee) {
      employeeByNormalizedKey.delete(normalizedKey);
      ambiguousNormalizedKeys.add(normalizedKey);
      continue;
    }

    employeeByNormalizedKey.set(normalizedKey, employee);
  }

  return {
    employeeByNormalizedKey,
    ambiguousNormalizedKeys,
  };
}

function buildBatchNotes(parts: Array<string | null | undefined>) {
  const filtered = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return filtered.length > 0 ? filtered.join(" ") : null;
}

type AttendanceRawLogComputationRow = Pick<
  typeof attendanceRawLogs.$inferSelect,
  | "id"
  | "employeeId"
  | "employeeNo"
  | "batchId"
  | "loggedAt"
  | "logDate"
  | "logTime"
  | "direction"
  | "sourceLine"
  | "rawText"
  | "deviceId"
  | "siteCode"
>;

function mapAttendanceRawRowsToParsedLogs(
  rows: AttendanceRawLogComputationRow[]
): ParsedAttendanceLog[] {
  return rows.map((row) => ({
    rawLogId: row.id,
    employeeNo: row.employeeNo,
    employeeId: row.employeeId ?? null,
    batchId: row.batchId,
    loggedAt: row.loggedAt,
    logDate: row.logDate,
    logTime: row.logTime,
    direction: row.direction,
    sourceLine: row.sourceLine ?? 0,
    rawText: row.rawText ?? "",
    deviceId: row.deviceId ?? null,
    siteCode: row.siteCode ?? null,
  }));
}

function mapApprovedCorrectionRows(
  rows: Array<typeof attendanceDtrCorrections.$inferSelect>
): AttendanceApprovedCorrectionRecord[] {
  return rows.map((row) => ({
    employeeId: row.employeeId,
    attendanceDate: row.attendanceDate,
    correctionType: row.correctionType as AttendanceDtrCorrectionType,
    payload: row.payload,
  }));
}

function buildAttendanceSummaryConflictSet() {
  return {
    shiftAssignmentId: sql`excluded.shift_assignment_id`,
    sourceBatchId: sql`excluded.source_batch_id`,
    firstInAt: sql`excluded.first_in_at`,
    lastOutAt: sql`excluded.last_out_at`,
    scheduledInTime: sql`excluded.scheduled_in_time`,
    scheduledOutTime: sql`excluded.scheduled_out_time`,
    scheduledMinutes: sql`excluded.scheduled_minutes`,
    workedMinutes: sql`excluded.worked_minutes`,
    regularMinutes: sql`excluded.regular_minutes`,
    lateMinutes: sql`excluded.late_minutes`,
    undertimeMinutes: sql`excluded.undertime_minutes`,
    overtimeMinutes: sql`excluded.overtime_minutes`,
    nightMinutes: sql`excluded.night_minutes`,
    paidLeaveMinutes: sql`excluded.paid_leave_minutes`,
    unpaidLeaveMinutes: sql`excluded.unpaid_leave_minutes`,
    absentMinutes: sql`excluded.absent_minutes`,
    isRestDay: sql`excluded.is_rest_day`,
    anomalyFlags: sql`excluded.anomaly_flags`,
    updatedAt: new Date(),
  };
}

function formatTimeValue(value: Date | null | undefined) {
  if (!value) return null;

  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  const seconds = String(value.getSeconds()).padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

function formatAttendanceDayName(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";

  return attendanceDayNameFormatter.format(new Date(Date.UTC(year, month - 1, day)));
}

function buildEmployeeDisplayName(employee: typeof employees.$inferSelect) {
  return `${employee.lastName}, ${employee.firstName}${
    employee.middleName ? ` ${employee.middleName}` : ""
  }`.trim();
}

async function resolveApprovedLeaveFlags<T extends AttendancePeriodLeaveRecord>(
  approvedLeaves: T[],
  database: Parameters<typeof buildLeaveTypeMapByCode>[1] = db
) {
  const leaveTypesByCode = await buildLeaveTypeMapByCode(
    approvedLeaves
      .filter((leave) => leave.leaveTypeLookup == null)
      .map((leave) => leave.leaveType),
    database
  );

  return approvedLeaves.map((leave) => ({
    employeeId: leave.employeeId,
    leaveStartDate: leave.leaveStartDate,
    leaveEndDate: leave.leaveEndDate,
    dateFiled: leave.dateFiled,
    isPaid: resolveLeavePayStatus(leave, leaveTypesByCode).isPaid,
  }));
}

function roundDays(value: number) {
  return Math.round(value * 100) / 100;
}

function buildAttendanceDtrTotals(
  rows: Array<{
    scheduledMinutes: number;
    workedMinutes: number;
    regularMinutes: number;
    lateMinutes: number;
    undertimeMinutes: number;
    overtimeMinutes: number;
    paidLeaveMinutes: number;
    unpaidLeaveMinutes: number;
    absentMinutes: number;
    isRestDay: boolean;
  }>,
  periodOverride?: typeof employeeAttendancePeriodOverrides.$inferSelect | null
) {
  const totals = {
    workedMinutes: 0,
    lateMinutes: 0,
    undertimeMinutes: 0,
    overtimeMinutes: 0,
    paidLeaveMinutes: 0,
    unpaidLeaveMinutes: 0,
    absentMinutes: 0,
    presentDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
  };

  for (const row of rows) {
    const scheduledMinutes = row.scheduledMinutes > 0 ? row.scheduledMinutes : 480;

    totals.workedMinutes += row.workedMinutes;
    totals.lateMinutes += row.lateMinutes;
    totals.undertimeMinutes += row.undertimeMinutes;
    totals.overtimeMinutes += row.overtimeMinutes;
    totals.paidLeaveMinutes += row.paidLeaveMinutes;
    totals.unpaidLeaveMinutes += row.unpaidLeaveMinutes;
    totals.absentMinutes += row.absentMinutes;

    if (!row.isRestDay && (row.workedMinutes > 0 || row.regularMinutes > 0)) {
      totals.presentDays += Math.max(1, roundDays(row.regularMinutes / scheduledMinutes));
    }

    if (row.paidLeaveMinutes > 0) {
      totals.paidLeaveDays += roundDays(row.paidLeaveMinutes / scheduledMinutes);
    }

    if (row.unpaidLeaveMinutes > 0) {
      totals.unpaidLeaveDays += roundDays(row.unpaidLeaveMinutes / scheduledMinutes);
    }

    if (row.absentMinutes > 0) {
      totals.absentDays += roundDays(row.absentMinutes / scheduledMinutes);
    }
  }

  const computedPresentDays = roundDays(totals.presentDays);
  const biometricWorkedMinutes = totals.workedMinutes;
  const computed = {
    presentDays: computedPresentDays,
    workedMinutes: computeNetDtrWorkedMinutes({
      presentDays: computedPresentDays,
      lateMinutes: totals.lateMinutes,
      undertimeMinutes: totals.undertimeMinutes,
    }),
    lateMinutes: totals.lateMinutes,
    undertimeMinutes: totals.undertimeMinutes,
    overtimeMinutes: totals.overtimeMinutes,
  };
  const overrides = normalizeAttendanceDtrPeriodOverride(periodOverride);
  const effectiveLateMinutes = overrides.lateMinutes ?? computed.lateMinutes;
  const effectiveUndertimeMinutes =
    overrides.undertimeMinutes ?? computed.undertimeMinutes;

  return {
    ...totals,
    presentDays: overrides.presentDays ?? computed.presentDays,
    workedMinutes: computeNetDtrWorkedMinutes({
      presentDays: computed.presentDays,
      lateMinutes: effectiveLateMinutes,
      undertimeMinutes: effectiveUndertimeMinutes,
      workedMinutesOverride: overrides.workedMinutes,
    }),
    lateMinutes: effectiveLateMinutes,
    undertimeMinutes: effectiveUndertimeMinutes,
    overtimeMinutes: overrides.overtimeMinutes ?? computed.overtimeMinutes,
    biometricWorkedMinutes,
    paidLeaveDays: roundDays(totals.paidLeaveDays),
    unpaidLeaveDays: roundDays(totals.unpaidLeaveDays),
    absentDays: roundDays(totals.absentDays),
    computed,
    overrides,
  } satisfies AttendanceDtrTotalsView;
}

async function loadAttendancePeriodSourceData(
  database: AttendanceDatabase,
  payrollPeriodId: string,
  employeeId?: string
): Promise<AttendancePeriodSourceData> {
  const payrollPeriod = await database.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, payrollPeriodId),
  });

  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  const rawLogs: AttendancePeriodRawLogRow[] = await database
    .select({
      id: attendanceRawLogs.id,
      employeeId: attendanceRawLogs.employeeId,
      employeeNo: attendanceRawLogs.employeeNo,
      batchId: attendanceRawLogs.batchId,
      sourceFileName: attendanceImportBatches.sourceFileName,
      loggedAt: attendanceRawLogs.loggedAt,
      logDate: attendanceRawLogs.logDate,
      logTime: attendanceRawLogs.logTime,
      direction: attendanceRawLogs.direction,
      sourceLine: attendanceRawLogs.sourceLine,
      rawText: attendanceRawLogs.rawText,
      deviceId: attendanceRawLogs.deviceId,
      siteCode: attendanceRawLogs.siteCode,
    })
    .from(attendanceRawLogs)
    .innerJoin(attendanceImportBatches, eq(attendanceRawLogs.batchId, attendanceImportBatches.id))
    .where(
      and(
        eq(attendanceImportBatches.payrollPeriodId, payrollPeriodId),
        isNotNull(attendanceRawLogs.employeeId),
        employeeId ? eq(attendanceRawLogs.employeeId, employeeId) : sql`TRUE`,
        gte(attendanceRawLogs.logDate, payrollPeriod.startDate),
        lte(attendanceRawLogs.logDate, payrollPeriod.endDate)
      )
    )
    .orderBy(
      asc(attendanceRawLogs.employeeId),
      asc(attendanceRawLogs.loggedAt),
      asc(attendanceRawLogs.id)
    );

  const employeeIds: string[] = [
    ...new Set(
      rawLogs
        .map((row) => row.employeeId)
        .filter((employeeId): employeeId is string => Boolean(employeeId))
    ),
  ];
  const employeeRecords: AttendancePeriodEmployeeRecord[] =
    employeeIds.length === 0
      ? []
      : await database.query.employees.findMany({
          where: and(
            inArray(employees.id, employeeIds),
            eq(employees.employeeType, DEFAULT_EMPLOYEE_TYPE),
            isNull(employees.deletedAt),
          ),
          with: {
            timekeeping: true,
          },
        });
  const departmentByEmployeeId = await loadEmployeeDepartmentMetadataByEmployeeId(
    employeeIds,
    database
  );
  const approvedLeaves: AttendancePeriodLeaveRecord[] =
    employeeIds.length === 0
      ? []
      : await database.query.employeesLeaveRecords.findMany({
          where: and(
            inArray(employeesLeaveRecords.employeeId, employeeIds),
            eq(employeesLeaveRecords.leaveStatus, "Approved")
          ),
          with: {
            leaveTypeLookup: true,
          },
        });
  const shiftAssignments: ShiftAssignmentRecord[] =
    employeeIds.length === 0
      ? []
      : (
          await database
            .select()
            .from(employeeShiftAssignments)
            .where(
              and(
                inArray(employeeShiftAssignments.employeeId, employeeIds),
                lte(employeeShiftAssignments.effectiveFrom, payrollPeriod.endDate)
              )
            )
            .orderBy(
              desc(employeeShiftAssignments.effectiveFrom),
              desc(employeeShiftAssignments.id)
            )
        ).filter(
          (assignment: typeof employeeShiftAssignments.$inferSelect) =>
            !assignment.effectiveTo || assignment.effectiveTo >= payrollPeriod.startDate
        );
  const weeklyPatterns: WeeklyShiftPatternRecord[] =
    employeeIds.length === 0
      ? []
      : ((
          await database.query.employeeWeeklyShiftPatterns.findMany({
            where: and(
              inArray(employeeWeeklyShiftPatterns.employeeId, employeeIds),
              lte(employeeWeeklyShiftPatterns.effectiveFrom, payrollPeriod.endDate)
            ),
            with: {
              days: true,
            },
          })
        ) as WeeklyShiftPatternRecord[])
          .filter(
            (pattern: WeeklyShiftPatternRecord) =>
              !pattern.effectiveTo || pattern.effectiveTo >= payrollPeriod.startDate
          )
          .sort((left: WeeklyShiftPatternRecord, right: WeeklyShiftPatternRecord) => {
            const employeeComparison = left.employeeId.localeCompare(right.employeeId);
            if (employeeComparison !== 0) return employeeComparison;
            const fromComparison = right.effectiveFrom.localeCompare(left.effectiveFrom);
            if (fromComparison !== 0) return fromComparison;
            return right.id - left.id;
          });
  const shiftTableIds = collectShiftTableIds({
    shiftAssignments,
    weeklyPatterns,
  });
  const shiftTableBreakRows: ShiftTableBreakRecord[] =
    shiftTableIds.length === 0
      ? []
      : await database
          .select()
          .from(shiftTableBreaks)
          .where(inArray(shiftTableBreaks.shiftTableId, shiftTableIds))
          .orderBy(asc(shiftTableBreaks.shiftTableId), asc(shiftTableBreaks.sortOrder));
  const periodOverrides: Array<typeof employeeAttendancePeriodOverrides.$inferSelect> =
    employeeIds.length === 0
      ? []
      : await database
          .select()
          .from(employeeAttendancePeriodOverrides)
          .where(
            and(
              eq(employeeAttendancePeriodOverrides.payrollPeriodId, payrollPeriodId),
              inArray(employeeAttendancePeriodOverrides.employeeId, employeeIds)
            )
          );
  const dayStatusOverrides: Array<
    typeof employeeAttendanceDayStatusOverrides.$inferSelect
  > =
    employeeIds.length === 0
      ? []
      : await database
          .select()
          .from(employeeAttendanceDayStatusOverrides)
          .where(
            and(
              eq(employeeAttendanceDayStatusOverrides.payrollPeriodId, payrollPeriodId),
              inArray(employeeAttendanceDayStatusOverrides.employeeId, employeeIds),
              gte(employeeAttendanceDayStatusOverrides.attendanceDate, payrollPeriod.startDate),
              lte(employeeAttendanceDayStatusOverrides.attendanceDate, payrollPeriod.endDate)
            )
          );
  const dayTypeOverrides: Array<
    typeof employeeAttendanceDayTypeOverrides.$inferSelect
  > =
    employeeIds.length === 0
      ? []
      : await database
          .select()
          .from(employeeAttendanceDayTypeOverrides)
          .where(
            and(
              eq(employeeAttendanceDayTypeOverrides.payrollPeriodId, payrollPeriodId),
              inArray(employeeAttendanceDayTypeOverrides.employeeId, employeeIds),
              gte(employeeAttendanceDayTypeOverrides.attendanceDate, payrollPeriod.startDate),
              lte(employeeAttendanceDayTypeOverrides.attendanceDate, payrollPeriod.endDate)
            )
          );
  const approvedCorrections: Array<typeof attendanceDtrCorrections.$inferSelect> =
    employeeIds.length === 0
      ? []
      : await database
          .select()
          .from(attendanceDtrCorrections)
          .where(
            and(
              eq(attendanceDtrCorrections.payrollPeriodId, payrollPeriodId),
              inArray(attendanceDtrCorrections.employeeId, employeeIds),
              eq(attendanceDtrCorrections.status, "Approved"),
              gte(attendanceDtrCorrections.attendanceDate, payrollPeriod.startDate),
              lte(attendanceDtrCorrections.attendanceDate, payrollPeriod.endDate)
            )
          );
  const holidayRows = await fetchConfirmedHolidayRowsForRange(
    payrollPeriod.startDate,
    payrollPeriod.endDate
  );

  return {
    payrollPeriod,
    rawLogs,
    employeeRecords,
    departmentByEmployeeId,
    approvedLeaves,
    shiftAssignments,
    weeklyPatterns,
    shiftTableBreaksByShiftTableId: buildShiftTableBreakLookup(shiftTableBreakRows),
    approvedCorrections,
    periodOverrides,
    dayStatusOverrides,
    dayTypeOverrides,
    holidayRows: holidayRows as AttendancePeriodSourceData["holidayRows"],
  };
}

async function loadAttendancePeriodPersistedSummarySourceData(
  database: AttendanceDatabase,
  payrollPeriodId: string,
  employeeId?: string,
  options?: { employeeIds?: string[] }
): Promise<AttendancePeriodPersistedSummarySourceData> {
  const payrollPeriod = await database.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, payrollPeriodId),
  });

  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  const scopedEmployeeIds = options?.employeeIds
    ? [...new Set(options.employeeIds)]
    : undefined;
  if (scopedEmployeeIds && scopedEmployeeIds.length === 0) {
    return {
      payrollPeriod,
      summaryRows: [],
      employeeRecords: [],
      departmentByEmployeeId: new Map(),
      sourceFilesByEmployeeId: new Map(),
      rawPunchesByEmployeeDate: new Map(),
      periodOverrides: [],
      dayStatusOverrides: [],
      dayTypeOverrides: [],
      holdApprovalRows: [],
      holidayRows: (await fetchConfirmedHolidayRowsForRange(
        payrollPeriod.startDate,
        payrollPeriod.endDate
      )) as AttendancePeriodPersistedSummarySourceData["holidayRows"],
    };
  }

  const [summaryRows, employeeRecords] = await Promise.all([
    database
      .select()
      .from(attendanceDailySummaries)
      .where(
        and(
          employeeId
            ? eq(attendanceDailySummaries.employeeId, employeeId)
            : scopedEmployeeIds
              ? inArray(attendanceDailySummaries.employeeId, scopedEmployeeIds)
              : sql`TRUE`,
          gte(attendanceDailySummaries.attendanceDate, payrollPeriod.startDate),
          lte(attendanceDailySummaries.attendanceDate, payrollPeriod.endDate)
        )
      )
      .orderBy(
        asc(attendanceDailySummaries.employeeId),
        asc(attendanceDailySummaries.attendanceDate)
      ),
    loadEligibleSemiMonthlyAttendanceEmployees(
      database,
      payrollPeriod,
      employeeId,
      scopedEmployeeIds
    ),
  ]);

  const employeeIds = employeeRecords.map((employee) => employee.id);

  const [
    departmentByEmployeeId,
    sourceFileRows,
    rawPunchRows,
    periodOverrides,
    dayStatusOverrides,
    dayTypeOverrides,
    holdApprovalRows,
    holidayRows,
  ] = await Promise.all([
    loadEmployeeDepartmentMetadataByEmployeeId(employeeIds, database),
    employeeIds.length === 0
      ? Promise.resolve([])
      : database
          .select({
            employeeId: attendanceRawLogs.employeeId,
            batchId: attendanceRawLogs.batchId,
            sourceFileName: attendanceImportBatches.sourceFileName,
            punchCount: sql<number>`COUNT(*)::int`,
          })
          .from(attendanceRawLogs)
          .innerJoin(
            attendanceImportBatches,
            eq(attendanceRawLogs.batchId, attendanceImportBatches.id)
          )
          .where(
            and(
              eq(attendanceImportBatches.payrollPeriodId, payrollPeriodId),
              isNotNull(attendanceRawLogs.employeeId),
              inArray(attendanceRawLogs.employeeId, employeeIds),
              gte(attendanceRawLogs.logDate, payrollPeriod.startDate),
              lte(attendanceRawLogs.logDate, payrollPeriod.endDate)
            )
          )
          .groupBy(
            attendanceRawLogs.employeeId,
            attendanceRawLogs.batchId,
            attendanceImportBatches.sourceFileName
          ),
    employeeIds.length > 0 && (employeeId || scopedEmployeeIds)
      ? database
          .select({
            employeeId: attendanceRawLogs.employeeId,
            logDate: attendanceRawLogs.logDate,
            loggedAt: attendanceRawLogs.loggedAt,
          })
          .from(attendanceRawLogs)
          .innerJoin(
            attendanceImportBatches,
            eq(attendanceRawLogs.batchId, attendanceImportBatches.id)
          )
          .where(
            and(
              eq(attendanceImportBatches.payrollPeriodId, payrollPeriodId),
              employeeId
                ? eq(attendanceRawLogs.employeeId, employeeId)
                : inArray(attendanceRawLogs.employeeId, employeeIds),
              gte(attendanceRawLogs.logDate, payrollPeriod.startDate),
              lte(attendanceRawLogs.logDate, payrollPeriod.endDate)
            )
          )
          .orderBy(
            asc(attendanceRawLogs.employeeId),
            asc(attendanceRawLogs.logDate),
            asc(attendanceRawLogs.loggedAt),
            asc(attendanceRawLogs.id)
          )
      : Promise.resolve([]),
    employeeIds.length === 0
      ? Promise.resolve([])
      : database
          .select()
          .from(employeeAttendancePeriodOverrides)
          .where(
            and(
              eq(employeeAttendancePeriodOverrides.payrollPeriodId, payrollPeriodId),
              inArray(employeeAttendancePeriodOverrides.employeeId, employeeIds)
            )
          ),
    employeeIds.length === 0
      ? Promise.resolve([])
      : database
          .select()
          .from(employeeAttendanceDayStatusOverrides)
          .where(
            and(
              eq(employeeAttendanceDayStatusOverrides.payrollPeriodId, payrollPeriodId),
              inArray(employeeAttendanceDayStatusOverrides.employeeId, employeeIds),
              gte(employeeAttendanceDayStatusOverrides.attendanceDate, payrollPeriod.startDate),
              lte(employeeAttendanceDayStatusOverrides.attendanceDate, payrollPeriod.endDate)
            )
          ),
    employeeIds.length === 0
      ? Promise.resolve([])
      : database
          .select()
          .from(employeeAttendanceDayTypeOverrides)
          .where(
            and(
              eq(employeeAttendanceDayTypeOverrides.payrollPeriodId, payrollPeriodId),
              inArray(employeeAttendanceDayTypeOverrides.employeeId, employeeIds),
              gte(employeeAttendanceDayTypeOverrides.attendanceDate, payrollPeriod.startDate),
              lte(employeeAttendanceDayTypeOverrides.attendanceDate, payrollPeriod.endDate)
            )
          ),
    employeeIds.length === 0
      ? Promise.resolve([])
      : database
          .select({
            employeeId: attendanceDtrHoldApprovals.employeeId,
            attendanceDate: attendanceDtrHoldApprovals.attendanceDate,
            status: attendanceDtrHoldApprovals.status,
            targetPayrollPeriodCode: payrollPeriods.code,
          })
          .from(attendanceDtrHoldApprovals)
          .innerJoin(
            payrollPeriods,
            eq(attendanceDtrHoldApprovals.targetPayrollPeriodId, payrollPeriods.id)
          )
          .where(
            and(
              eq(attendanceDtrHoldApprovals.sourcePayrollPeriodId, payrollPeriodId),
              inArray(attendanceDtrHoldApprovals.employeeId, employeeIds),
              gte(attendanceDtrHoldApprovals.attendanceDate, payrollPeriod.startDate),
              lte(attendanceDtrHoldApprovals.attendanceDate, payrollPeriod.endDate)
            )
          ),
    fetchConfirmedHolidayRowsForRange(payrollPeriod.startDate, payrollPeriod.endDate),
  ]);

  const sourceFilesByEmployeeId =
    new Map<
      string,
      Map<string, { batchId: string; sourceFileName: string; punchCount: number }>
    >();
  for (const row of sourceFileRows as Array<{
    employeeId: string | null;
    batchId: string;
    sourceFileName: string;
    punchCount: number;
  }>) {
    if (!row.employeeId) continue;

    const currentFiles = sourceFilesByEmployeeId.get(row.employeeId) ?? new Map();
    currentFiles.set(row.batchId, {
      batchId: row.batchId,
      sourceFileName: row.sourceFileName,
      punchCount: Number(row.punchCount) || 0,
    });
    sourceFilesByEmployeeId.set(row.employeeId, currentFiles);
  }

  const rawPunchesByEmployeeDate = new Map<string, Date[]>();
  for (const row of rawPunchRows as Array<{
    employeeId: string | null;
    logDate: string;
    loggedAt: Date;
  }>) {
    if (!row.employeeId) continue;

    const key = `${row.employeeId}|${row.logDate}`;
    const punches = rawPunchesByEmployeeDate.get(key) ?? [];
    punches.push(row.loggedAt);
    rawPunchesByEmployeeDate.set(key, punches);
  }

  return {
    payrollPeriod,
    summaryRows: summaryRows as Array<typeof attendanceDailySummaries.$inferSelect>,
    employeeRecords,
    departmentByEmployeeId,
    sourceFilesByEmployeeId,
    rawPunchesByEmployeeDate,
    periodOverrides:
      periodOverrides as Array<typeof employeeAttendancePeriodOverrides.$inferSelect>,
    dayStatusOverrides:
      dayStatusOverrides as Array<
        typeof employeeAttendanceDayStatusOverrides.$inferSelect
      >,
    dayTypeOverrides:
      dayTypeOverrides as Array<typeof employeeAttendanceDayTypeOverrides.$inferSelect>,
    holdApprovalRows:
      holdApprovalRows as AttendancePeriodPersistedSummarySourceData["holdApprovalRows"],
    holidayRows: holidayRows as AttendancePeriodPersistedSummarySourceData["holidayRows"],
  };
}

async function markPayrollPeriodRunsStale(args: {
  tx: AttendanceTransaction;
  payrollPeriodId: string;
  payrollPeriodCode: string;
  actorUserId: string;
  notes?: string;
}) {
  const affectedRuns = await args.tx
    .select({
      id: payrollRuns.id,
      status: payrollRuns.status,
    })
    .from(payrollRuns)
    .where(eq(payrollRuns.payrollPeriodId, args.payrollPeriodId))
    .orderBy(desc(payrollRuns.createdAt));

  const blockingRun = affectedRuns.find(
    (run: { status: string }) => run.status === "Approved" || run.status === "Posted"
  );

  if (blockingRun) {
    throw new Error(
      `Attendance summary refresh is blocked because payroll period ${args.payrollPeriodCode} already has a ${blockingRun.status} run.`
    );
  }

  const staleRunIds = affectedRuns
    .filter((run: { status: string }) => run.status === "Draft" || run.status === "Reviewed")
    .map((run: { id: string }) => run.id);

  if (staleRunIds.length === 0) return 0;

  await args.tx
    .update(payrollRuns)
    .set({
      status: "Stale",
      reviewedAt: null,
      reviewedByUserId: null,
      approvedAt: null,
      approvedByUserId: null,
      updatedAt: new Date(),
    })
    .where(inArray(payrollRuns.id, staleRunIds));

  for (const runId of staleRunIds) {
    await recordPayrollRunEvent({
      payrollRunId: runId,
      actorUserId: args.actorUserId,
      eventType: "MarkedStale",
      toStatus: "Stale",
      database: args.tx,
      notes:
        args.notes ??
        "Marked stale because attendance summaries were refreshed from imported logs.",
    });
  }

  return staleRunIds.length;
}

async function syncAttendanceCorrectionSuggestions(args: {
  tx: AttendanceTransaction;
  payrollPeriod: Pick<
    typeof payrollPeriods.$inferSelect,
    "id" | "startDate" | "endDate"
  >;
  employeeIds: string[];
  suggestions: AttendanceCorrectionSuggestionComputation[];
}) {
  const employeeIds = [...new Set(args.employeeIds)];
  if (employeeIds.length === 0) {
    return { pendingSuggestionCount: 0 };
  }

  await args.tx
    .delete(attendanceDtrCorrections)
    .where(
      and(
        eq(attendanceDtrCorrections.payrollPeriodId, args.payrollPeriod.id),
        inArray(attendanceDtrCorrections.employeeId, employeeIds),
        eq(attendanceDtrCorrections.status, "Pending"),
        gte(attendanceDtrCorrections.attendanceDate, args.payrollPeriod.startDate),
        lte(attendanceDtrCorrections.attendanceDate, args.payrollPeriod.endDate)
      )
    );

  let pendingSuggestionCount = 0;
  const values = args.suggestions.map((suggestion) => ({
    payrollPeriodId: args.payrollPeriod.id,
    employeeId: suggestion.employeeId,
    attendanceDate: suggestion.attendanceDate,
    correctionType: suggestion.correctionType,
    status: (suggestion.autoApprove === true ? "Approved" : "Pending") as
      | "Approved"
      | "Pending",
    confidence: suggestion.confidence,
    reason: suggestion.reason,
    payload: suggestion.payload,
  }));
  const autoAppliedValues = values.filter(
    (value) =>
      value.status === "Approved" &&
      AUTO_APPLIED_DTR_CORRECTION_TYPES.has(value.correctionType)
  );
  const passiveValues = values.filter(
    (value) => !autoAppliedValues.includes(value)
  );

  for (const rows of chunk(autoAppliedValues, 200)) {
    if (rows.length === 0) continue;

    await args.tx
      .insert(attendanceDtrCorrections)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          attendanceDtrCorrections.payrollPeriodId,
          attendanceDtrCorrections.employeeId,
          attendanceDtrCorrections.attendanceDate,
          attendanceDtrCorrections.correctionType,
        ],
        set: {
          status: "Approved",
          confidence: sql`excluded.confidence`,
          reason: sql`excluded.reason`,
          payload: sql`excluded.payload`,
          reviewedByUserId: null,
          reviewedAt: null,
          updatedAt: new Date(),
        },
      });
  }

  for (const rows of chunk(passiveValues, 200)) {
    if (rows.length === 0) continue;

    const insertedRows = await args.tx
      .insert(attendanceDtrCorrections)
      .values(rows)
      .onConflictDoNothing({
        target: [
          attendanceDtrCorrections.payrollPeriodId,
          attendanceDtrCorrections.employeeId,
          attendanceDtrCorrections.attendanceDate,
          attendanceDtrCorrections.correctionType,
        ],
      })
      .returning({
        id: attendanceDtrCorrections.id,
        status: attendanceDtrCorrections.status,
      });

    pendingSuggestionCount += insertedRows.filter(
      (r) => r.status === "Pending"
    ).length;
  }

  return { pendingSuggestionCount };
}

const AUTO_APPLIED_DTR_CORRECTION_TYPES = new Set<AttendanceDtrCorrectionType>([
  "Duplicate Punch",
  "Same-Direction Duplicate",
]);

function isAutoAppliedDtrCorrectionSuggestion(
  suggestion: Pick<
    AttendanceCorrectionSuggestionComputation,
    "autoApprove" | "correctionType"
  >
) {
  return (
    suggestion.autoApprove === true &&
    AUTO_APPLIED_DTR_CORRECTION_TYPES.has(suggestion.correctionType)
  );
}

type AttendanceImportParams = {
  fileName: string;
  contentBase64: string;
  payrollPeriodId?: string | null;
  replaceExisting?: boolean;
};

type AttendanceImportScope = {
  actorUserId: string;
  sourceHashScope?: string;
  employeeIds?: string[];
  persistUnmatchedLogs: boolean;
  replaceExisting: boolean;
  revalidatePaths: string[];
  auditAction: string;
  auditDetails?: Record<string, unknown>;
};

async function importAttendanceLogsForScope(
  params: AttendanceImportParams,
  scope: AttendanceImportScope
) {
  await ensurePayrollFoundationData();

  const buffer = Buffer.from(params.contentBase64, "base64");
  const fileSourceHash = createHash("sha256").update(buffer).digest("hex");
  const sourceHash = scope.sourceHashScope
    ? createHash("sha256")
        .update(`${scope.sourceHashScope}:${fileSourceHash}`)
        .digest("hex")
    : fileSourceHash;
  const scopedEmployeeIds = scope.employeeIds
    ? [...new Set(scope.employeeIds)]
    : undefined;
  let parsedAttendance: ReturnType<typeof parseAttendanceBuffer>;

  try {
    parsedAttendance = parseAttendanceBuffer(buffer, params.fileName);
  } catch (error) {
    if (error instanceof AttendanceParseError) {
      if (error.code === "UNSUPPORTED_ENCODING") {
        throw new Error(
          "The attendance file could not be decoded. Unicode/Excel-exported files are supported, including UTF-8 and Unicode/UTF-16."
        );
      }

      throw new Error(
        "The attendance file could not be imported. Supported DTR files include comma, tab, semicolon, pipe, whitespace-delimited, UTF-8, and Unicode/UTF-16 exports."
      );
    }

    throw error;
  }

  const {
    logs: parsedLogs,
    duplicateCount: fileDuplicateCount,
  } = parsedAttendance;

  if (parsedLogs.length === 0) {
    throw new Error(
      "No usable attendance logs were found. Make sure the file includes an ID, EnNo, UID, or employee number column and a valid DateTime."
    );
  }

  const selectedPayrollPeriod = params.payrollPeriodId
    ? await db.query.payrollPeriods.findFirst({
        where: eq(payrollPeriods.id, params.payrollPeriodId),
      })
    : null;

  if (params.payrollPeriodId && !selectedPayrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  let importLogs = parsedLogs;
  let fileDuplicateCountForImport = fileDuplicateCount;
  let ignoredOutOfPeriodCount = 0;
  let ignoredOutOfPeriodDates = "";
  let ignoredOutOfPeriodPayrollCodeRange = "";

  if (selectedPayrollPeriod) {
    const selectedPayrollPeriodDateRange = {
      startDate: selectedPayrollPeriod.startDate,
      endDate: selectedPayrollPeriod.endDate,
    };
    const periodFilter = filterAttendanceLogsForPayrollPeriod({
      logs: parsedLogs,
      payrollPeriod: selectedPayrollPeriodDateRange,
    });

    assertAttendanceLogsMatchPayrollPeriod({
      logs: parsedLogs,
      duplicateLogs: parsedAttendance.duplicateLogs,
      payrollPeriod: {
        code: selectedPayrollPeriod.code,
        ...selectedPayrollPeriodDateRange,
      },
    });

    importLogs = periodFilter.logs;
    ignoredOutOfPeriodCount = periodFilter.ignoredOutOfPeriodCount;
    ignoredOutOfPeriodDates = periodFilter.ignoredDates;
    ignoredOutOfPeriodPayrollCodeRange =
      periodFilter.ignoredPayrollCodeRange;
    fileDuplicateCountForImport = parsedAttendance.duplicateLogs.filter(
      (log) =>
        log.logDate >= selectedPayrollPeriodDateRange.startDate &&
        log.logDate <= selectedPayrollPeriodDateRange.endDate
    ).length;
  }

  const existingBatch = await db.query.attendanceImportBatches.findFirst({
    where: and(
      eq(attendanceImportBatches.sourceHash, sourceHash),
      params.payrollPeriodId
        ? eq(attendanceImportBatches.payrollPeriodId, params.payrollPeriodId)
        : isNull(attendanceImportBatches.payrollPeriodId)
    ),
  });

  if (existingBatch) {
    return existingBatch;
  }

  if (scopedEmployeeIds && scopedEmployeeIds.length === 0) {
    throw new Error("Manager account is not assigned to a department.");
  }

  const employeeRecords = await db.query.employees.findMany({
    where: and(
      scopedEmployeeIds ? inArray(employees.id, scopedEmployeeIds) : sql`TRUE`,
      eq(employees.employeeType, DEFAULT_EMPLOYEE_TYPE),
      isNull(employees.deletedAt),
    ),
    with: {
      timekeeping: true,
    },
  });
  const { employeeByNormalizedKey, ambiguousNormalizedKeys } =
    buildEmployeeLookup(employeeRecords);
  const outOfScopeEmployeeLookup =
    scopedEmployeeIds && scopedEmployeeIds.length > 0
      ? buildEmployeeLookup(
          await db.query.employees.findMany({
            where: and(
              eq(employees.employeeType, DEFAULT_EMPLOYEE_TYPE),
              isNull(employees.deletedAt),
            ),
            columns: {
              id: true,
              employeeNo: true,
            },
          })
        )
      : null;
  const normalizedHashes = importLogs.map((log) =>
    buildAttendanceHash({
      employeeNo: log.employeeNo,
      normalizedEmployeeKey: normalizeAttendanceEmployeeKey(log.employeeNo),
      logDate: log.logDate,
      logTime: log.logTime,
      direction: log.direction,
      deviceId: log.deviceId ?? null,
    })
  );

  const existingHashes = new Set<string>();
  for (const hashes of chunk(normalizedHashes, 500)) {
    if (hashes.length === 0) continue;

    const rows = await db
      .select({ normalizedHash: attendanceRawLogs.normalizedHash })
      .from(attendanceRawLogs)
      .where(inArray(attendanceRawLogs.normalizedHash, hashes));

    for (const row of rows) {
      if (row.normalizedHash) {
        existingHashes.add(row.normalizedHash);
      }
    }
  }

  const importResult = await db.transaction(async (tx) => {
    const [createdBatch] = await tx
      .insert(attendanceImportBatches)
      .values({
        payrollPeriodId: params.payrollPeriodId ?? null,
        sourceFileName: params.fileName,
        sourceFormat: params.fileName.toLowerCase().endsWith(".txt") ? "TXT" : "CSV",
        sourceHash,
        totalRows: importLogs.length,
      })
      .returning();

    let matchedRows = 0;
    let unmatchedRows = 0;
    let duplicateRows = fileDuplicateCountForImport;
    let skippedSummaryRows = 0;
    let ambiguousRows = 0;
    let invalidIdentifierRows = 0;
    let ignoredOutOfScopeRows = 0;
    let ignoredUnmatchedRows = 0;

    const rawRows = importLogs.flatMap((log) => {
      const normalizedEmployeeKey = normalizeAttendanceEmployeeKey(log.employeeNo);
      const normalizedHash = buildAttendanceHash({
        employeeNo: log.employeeNo,
        normalizedEmployeeKey,
        logDate: log.logDate,
        logTime: log.logTime,
        direction: log.direction,
        deviceId: log.deviceId ?? null,
      });

      if (existingHashes.has(normalizedHash)) {
        duplicateRows += 1;
        return [];
      }

      let employee: (typeof employeeRecords)[number] | null = null;

      if (!normalizedEmployeeKey) {
        unmatchedRows += 1;
        invalidIdentifierRows += 1;
      } else if (ambiguousNormalizedKeys.has(normalizedEmployeeKey)) {
        unmatchedRows += 1;
        ambiguousRows += 1;
      } else {
        employee = employeeByNormalizedKey.get(normalizedEmployeeKey) ?? null;

        if (employee) {
          matchedRows += 1;
        } else {
          unmatchedRows += 1;
          const outOfScopeEmployee =
            outOfScopeEmployeeLookup?.employeeByNormalizedKey.get(
              normalizedEmployeeKey
            ) ?? null;
          if (outOfScopeEmployee) {
            ignoredOutOfScopeRows += 1;
          } else {
            ignoredUnmatchedRows += 1;
          }
        }
      }

      if (!employee && !scope.persistUnmatchedLogs) {
        return [];
      }

      return [
        {
          batchId: createdBatch.id,
          employeeId: employee?.id ?? null,
          employeeNo: log.employeeNo,
          deviceId: log.deviceId ?? null,
          siteCode: log.siteCode ?? null,
          sourceLine: log.sourceLine,
          direction: log.direction,
          loggedAt: log.loggedAt,
          logDate: log.logDate,
          logTime: log.logTime,
          rawText: log.rawText,
          normalizedHash,
        } satisfies typeof attendanceRawLogs.$inferInsert,
      ];
    });

    for (const rows of chunk(rawRows, 500)) {
      if (rows.length === 0) continue;
      await tx.insert(attendanceRawLogs).values(rows);
    }

    const matchedEmployeeIds = [...new Set(
      rawRows
        .map((row) => row.employeeId)
        .filter((employeeId): employeeId is string => Boolean(employeeId))
    )];
    const importedSummaryKeys = new Set(
      rawRows.flatMap((row) =>
        row.employeeId ? [`${row.employeeId}|${row.logDate}`] : []
      )
    );
    const importedLogDates = rawRows.map((row) => row.logDate).sort();
    const importedRange =
      importedLogDates.length === 0
        ? null
        : {
            startDate: importedLogDates[0],
            endDate: importedLogDates[importedLogDates.length - 1],
          };
    const summaryCoverageRange = selectedPayrollPeriod
      ? {
          startDate: selectedPayrollPeriod.startDate,
          endDate: selectedPayrollPeriod.endDate,
        }
      : importedRange;
    const scheduleCoverageRange = summaryCoverageRange ?? importedRange;
    const matchedEmployees = employeeRecords.filter((employee) =>
      matchedEmployeeIds.includes(employee.id)
    );

    const shiftAssignments =
      matchedEmployeeIds.length === 0
        ? []
        : await tx
            .select()
            .from(employeeShiftAssignments)
            .where(inArray(employeeShiftAssignments.employeeId, matchedEmployeeIds))
            .orderBy(
              desc(employeeShiftAssignments.effectiveFrom),
              desc(employeeShiftAssignments.id)
            );
    const weeklyPatterns =
      matchedEmployeeIds.length === 0 || !scheduleCoverageRange
        ? []
        : (
            await tx.query.employeeWeeklyShiftPatterns.findMany({
              where: and(
                inArray(employeeWeeklyShiftPatterns.employeeId, matchedEmployeeIds),
                lte(
                  employeeWeeklyShiftPatterns.effectiveFrom,
                  scheduleCoverageRange.endDate
                )
              ),
              with: {
                days: true,
              },
            })
          )
            .filter(
              (pattern) =>
                !pattern.effectiveTo ||
                pattern.effectiveTo >= scheduleCoverageRange.startDate
            )
            .sort((left, right) => {
              const employeeComparison = left.employeeId.localeCompare(right.employeeId);
              if (employeeComparison !== 0) return employeeComparison;
              const fromComparison = right.effectiveFrom.localeCompare(left.effectiveFrom);
              if (fromComparison !== 0) return fromComparison;
              return right.id - left.id;
            });
    const shiftTableIds = collectShiftTableIds({
      shiftAssignments,
      weeklyPatterns,
    });
    const shiftTableBreakRows: ShiftTableBreakRecord[] =
      shiftTableIds.length === 0
        ? []
        : await tx
            .select()
            .from(shiftTableBreaks)
            .where(inArray(shiftTableBreaks.shiftTableId, shiftTableIds))
            .orderBy(asc(shiftTableBreaks.shiftTableId), asc(shiftTableBreaks.sortOrder));

    const approvedLeaves =
      matchedEmployeeIds.length === 0
        ? []
        : await tx.query.employeesLeaveRecords.findMany({
            where: and(
              inArray(employeesLeaveRecords.employeeId, matchedEmployeeIds),
              eq(employeesLeaveRecords.leaveStatus, "Approved")
            ),
            with: {
              leaveTypeLookup: true,
            },
          });
    const resolvedApprovedLeaves = await resolveApprovedLeaveFlags(approvedLeaves, tx);
    const summaryRawRows =
      matchedEmployeeIds.length === 0 || !summaryCoverageRange
        ? rawRows
        : await tx
            .select({
              id: attendanceRawLogs.id,
              employeeId: attendanceRawLogs.employeeId,
              employeeNo: attendanceRawLogs.employeeNo,
              batchId: attendanceRawLogs.batchId,
              loggedAt: attendanceRawLogs.loggedAt,
              logDate: attendanceRawLogs.logDate,
              logTime: attendanceRawLogs.logTime,
              direction: attendanceRawLogs.direction,
              sourceLine: attendanceRawLogs.sourceLine,
              rawText: attendanceRawLogs.rawText,
              deviceId: attendanceRawLogs.deviceId,
              siteCode: attendanceRawLogs.siteCode,
            })
            .from(attendanceRawLogs)
            .where(
              and(
                isNotNull(attendanceRawLogs.employeeId),
                inArray(attendanceRawLogs.employeeId, matchedEmployeeIds),
                gte(attendanceRawLogs.logDate, summaryCoverageRange.startDate),
                lte(attendanceRawLogs.logDate, summaryCoverageRange.endDate)
              )
            )
            .orderBy(
              asc(attendanceRawLogs.employeeId),
              asc(attendanceRawLogs.loggedAt),
              asc(attendanceRawLogs.id)
            );

    const summaryParsedLogs = summaryRawRows.map((row) => ({
      rawLogId: "id" in row ? row.id : null,
      employeeNo: row.employeeNo,
      employeeId: row.employeeId ?? null,
      batchId: row.batchId,
      loggedAt: row.loggedAt,
      logDate: row.logDate,
      logTime: row.logTime,
      direction: row.direction,
      sourceLine: row.sourceLine ?? 0,
      rawText: row.rawText ?? "",
      deviceId: row.deviceId ?? null,
      siteCode: row.siteCode ?? null,
    })) satisfies ParsedAttendanceLog[];
    const correctionSuggestions =
      summaryCoverageRange == null
        ? []
        : buildAttendanceCorrectionSuggestionComputations({
            employees: matchedEmployees.map((employee) => ({
              id: employee.id,
              employeeNo: employee.employeeNo,
              timekeeping: employee.timekeeping ?? null,
            })),
            logs: summaryParsedLogs,
            approvedLeaves: resolvedApprovedLeaves,
            shiftAssignments,
            weeklyPatterns,
            shiftTableBreaksByShiftTableId:
              buildShiftTableBreakLookup(shiftTableBreakRows),
            allowedAttendanceDateRange: summaryCoverageRange,
          });
    const autoAppliedCorrectionSummaryKeys = new Set(
      correctionSuggestions
        .filter(isAutoAppliedDtrCorrectionSuggestion)
        .map((suggestion) => `${suggestion.employeeId}|${suggestion.attendanceDate}`)
    );

    // Insert corrections before building summaries so that any auto-approved
    // corrections (e.g. Same-Direction Duplicate) are already in the DB and
    // can be reloaded and applied to produce correct worked-hour summaries.
    const correctionSuggestionSync =
      selectedPayrollPeriod && summaryCoverageRange
        ? await syncAttendanceCorrectionSuggestions({
            tx,
            payrollPeriod: selectedPayrollPeriod,
            employeeIds: matchedEmployeeIds,
            suggestions: correctionSuggestions,
          })
        : { pendingSuggestionCount: 0 };

    // Reload approved corrections after sync so newly auto-approved ones are included.
    const approvedCorrectionsAfterSync =
      matchedEmployeeIds.length === 0 || !summaryCoverageRange || !selectedPayrollPeriod
        ? []
        : await tx
            .select()
            .from(attendanceDtrCorrections)
            .where(
              and(
                eq(attendanceDtrCorrections.payrollPeriodId, selectedPayrollPeriod.id),
                inArray(attendanceDtrCorrections.employeeId, matchedEmployeeIds),
                eq(attendanceDtrCorrections.status, "Approved"),
                gte(
                  attendanceDtrCorrections.attendanceDate,
                  summaryCoverageRange.startDate
                ),
                lte(
                  attendanceDtrCorrections.attendanceDate,
                  summaryCoverageRange.endDate
                )
              )
            );

    const summaryComputations = buildAttendanceSummaryComputations({
      employees: matchedEmployees.map((employee) => ({
        id: employee.id,
        employeeNo: employee.employeeNo,
        timekeeping: employee.timekeeping ?? null,
      })),
      logs: summaryParsedLogs,
      approvedLeaves: resolvedApprovedLeaves,
      shiftAssignments,
      weeklyPatterns,
      shiftTableBreaksByShiftTableId: buildShiftTableBreakLookup(shiftTableBreakRows),
      approvedCorrections: mapApprovedCorrectionRows(approvedCorrectionsAfterSync),
      allowedAttendanceDateRange: summaryCoverageRange ?? undefined,
    });
    const summaryDates = [...new Set(summaryComputations.map((summary) => summary.attendanceDate))];
    const existingSummaries =
      matchedEmployeeIds.length === 0 || summaryDates.length === 0
        ? []
        : await tx
            .select({
              id: attendanceDailySummaries.id,
              employeeId: attendanceDailySummaries.employeeId,
              attendanceDate: attendanceDailySummaries.attendanceDate,
            })
            .from(attendanceDailySummaries)
            .where(
              and(
                inArray(attendanceDailySummaries.employeeId, matchedEmployeeIds),
                inArray(attendanceDailySummaries.attendanceDate, summaryDates)
              )
            );

    const existingSummaryByEmployeeDate = new Map(
      existingSummaries.map((summary) => [
        `${summary.employeeId}|${summary.attendanceDate}`,
        summary,
      ])
    );

    const summariesToPersist: AttendanceSummaryComputation[] = [];
    for (const summary of summaryComputations) {
      const summaryKey = `${summary.employeeId}|${summary.attendanceDate}`;
      const existingSummary = existingSummaryByEmployeeDate.get(summaryKey);
      const shouldForceSummaryUpdate =
        scope.replaceExisting ||
        importedSummaryKeys.has(summaryKey) ||
        autoAppliedCorrectionSummaryKeys.has(summaryKey);
      if (existingSummary && !shouldForceSummaryUpdate) {
        skippedSummaryRows += 1;
        continue;
      }

      summariesToPersist.push(summary);
    }
    const shouldUpsertSummaries = summariesToPersist.some((summary) =>
      existingSummaryByEmployeeDate.has(`${summary.employeeId}|${summary.attendanceDate}`)
    );

    for (const rows of chunk(summariesToPersist, 200)) {
      if (rows.length === 0) continue;

      const insert = tx.insert(attendanceDailySummaries).values(rows);

      if (shouldUpsertSummaries) {
        await insert.onConflictDoUpdate({
          target: [
            attendanceDailySummaries.employeeId,
            attendanceDailySummaries.attendanceDate,
          ],
          set: buildAttendanceSummaryConflictSet(),
        });
      } else {
        await insert.onConflictDoNothing({
          target: [
            attendanceDailySummaries.employeeId,
            attendanceDailySummaries.attendanceDate,
          ],
        });
      }
    }

    await tx
      .update(attendanceImportBatches)
      .set({
        matchedRows,
        unmatchedRows,
        duplicateRows,
        notes: buildBatchNotes([
          parsedAttendance.detectedFormat
            ? `Parsed as ${parsedAttendance.detectedFormat}${
                parsedAttendance.employeeIdentifierHeader
                  ? ` using ${parsedAttendance.employeeIdentifierHeader} as employee ID`
                  : ""
              }.`
            : null,
          ignoredOutOfPeriodCount > 0 && selectedPayrollPeriod
            ? buildBatchNotes([
                `Ignored ${ignoredOutOfPeriodCount} row(s) outside selected payroll period ${selectedPayrollPeriod.code} (${selectedPayrollPeriod.startDate} to ${selectedPayrollPeriod.endDate}).`,
                `Ignored dates: ${ignoredOutOfPeriodDates}.`,
                ignoredOutOfPeriodPayrollCodeRange
                  ? `${ignoredOutOfPeriodPayrollCodeRange}.`
                  : null,
              ])
            : null,
          invalidIdentifierRows > 0
            ? `${invalidIdentifierRows} row(s) were left unmatched because the DTR identifier could not be normalized to a numeric employee number.`
            : null,
          ambiguousRows > 0
            ? `${ambiguousRows} row(s) were left unmatched because the normalized DTR identifier matched multiple employees.`
            : null,
          ignoredOutOfScopeRows > 0
            ? `${ignoredOutOfScopeRows} row(s) were ignored because the DTR identifier belongs outside the manager's assigned departments.`
            : null,
          ignoredUnmatchedRows > 0 && !scope.persistUnmatchedLogs
            ? `${ignoredUnmatchedRows} row(s) were ignored because the DTR identifier did not match an employee in the manager's assigned departments.`
            : null,
          skippedSummaryRows > 0
            ? `${skippedSummaryRows} attendance daily summary row(s) were skipped because replaceExisting was not enabled.`
            : null,
          correctionSuggestionSync.pendingSuggestionCount > 0
            ? `${correctionSuggestionSync.pendingSuggestionCount} DTR correction suggestion(s) are pending review.`
            : null,
        ]),
        status: "Processed",
      })
      .where(eq(attendanceImportBatches.id, createdBatch.id));

    const generatedDtrWorkedRows = selectedPayrollPeriod
      ? await syncGeneratedDtrWorkedExceptionRows({
          tx,
          payrollPeriod: selectedPayrollPeriod,
          employeeIds: matchedEmployeeIds,
        })
      : EMPTY_GENERATED_DTR_EXCEPTION_ROW_SYNC;
    const batch = await tx.query.attendanceImportBatches.findFirst({
      where: eq(attendanceImportBatches.id, createdBatch.id),
    });

    return {
      batch,
      affectedEmployeeIds: matchedEmployeeIds,
      refreshableExceptionRowIds:
        generatedDtrWorkedRows.refreshableExceptionRowIds,
      ignoredOutOfScopeRows,
      ignoredUnmatchedRows,
    };
  });
  const batch = importResult.batch;

  if (batch?.payrollPeriodId) {
    await refreshManualPayrollAttendanceForEmployees({
      actorUserId: scope.actorUserId,
      payrollPeriodId: batch.payrollPeriodId,
      employeeIds: importResult.affectedEmployeeIds,
      refreshableExceptionRowIds: importResult.refreshableExceptionRowIds,
    });
  }

  if (batch) {
    await recordAdminAuditEvent({
      actorUserId: scope.actorUserId,
      entityType: "attendance_import_batch",
      entityId: batch.id,
      action: scope.auditAction,
      details: {
        fileName: batch.sourceFileName,
        payrollPeriodId: batch.payrollPeriodId,
        totalRows: batch.totalRows,
        matchedRows: batch.matchedRows,
        unmatchedRows: batch.unmatchedRows,
        duplicateRows: batch.duplicateRows,
        detectedFormat: parsedAttendance.detectedFormat,
        employeeIdentifierHeader: parsedAttendance.employeeIdentifierHeader,
        replaceExisting: scope.replaceExisting,
        ignoredOutOfScopeRows: importResult.ignoredOutOfScopeRows,
        ignoredUnmatchedRows: importResult.ignoredUnmatchedRows,
        ...scope.auditDetails,
      },
    });
  }

  for (const path of scope.revalidatePaths) {
    revalidatePath(path);
  }
  return batch;
}

export async function importAttendanceLogs(params: AttendanceImportParams) {
  const actor = await requireAdminActor();

  return importAttendanceLogsForScope(params, {
    actorUserId: actor.userId,
    persistUnmatchedLogs: true,
    replaceExisting: params.replaceExisting ?? false,
    revalidatePaths: ["/payroll"],
    auditAction: "attendance.imported",
  });
}

async function getManagerAttendanceScope(accountId: string) {
  const departmentIds = await getManagerDepartmentIds(accountId);

  if (departmentIds.length === 0) {
    return { departmentIds, employeeIds: [] };
  }

  const employeeRows = await db
    .select({
      id: employees.id,
    })
    .from(employees)
    .innerJoin(
      employeesGeneralInfo,
      eq(employees.id, employeesGeneralInfo.employeeId)
    )
    .where(
      and(
        eq(employees.employeeType, DEFAULT_EMPLOYEE_TYPE),
        isNull(employees.deletedAt),
        isNull(employeesGeneralInfo.deletedAt),
        inArray(employeesGeneralInfo.departmentId, departmentIds)
      )
    );

  return {
    departmentIds,
    employeeIds: employeeRows.map((row) => row.id),
  };
}

function serializeManagerAttendanceBatch(
  batch: typeof attendanceImportBatches.$inferSelect,
  scopedMatchedRows: number
) {
  return {
    id: batch.id,
    payrollPeriodId: batch.payrollPeriodId,
    sourceFileName: batch.sourceFileName,
    sourceFormat: batch.sourceFormat,
    status: batch.status,
    totalRows: batch.totalRows,
    matchedRows: batch.matchedRows,
    unmatchedRows: batch.unmatchedRows,
    duplicateRows: batch.duplicateRows,
    scopedMatchedRows,
    notes: batch.notes,
    importedAt: batch.importedAt.toISOString(),
  };
}

export async function listManagerDtrPayrollPeriodsAction(input?: {
  year?: number;
  periodId?: string | null;
}) {
  const auth = await requireManager({ redirectTo: "/" });
  const year =
    Number.isInteger(input?.year) && input!.year! >= 2000 && input!.year! <= 2100
      ? input!.year!
      : new Date().getFullYear();
  const scope = await getManagerAttendanceScope(auth.accountId);

  const periodRows = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.year, year))
    .orderBy(asc(payrollPeriods.startDate));

  const periodIds = periodRows.map((period) => period.id);
  const visibleBatchRows =
    scope.employeeIds.length === 0 || periodIds.length === 0
      ? []
      : await db
          .select({
            periodId: attendanceImportBatches.payrollPeriodId,
            batchId: attendanceImportBatches.id,
          })
          .from(attendanceRawLogs)
          .innerJoin(
            attendanceImportBatches,
            eq(attendanceRawLogs.batchId, attendanceImportBatches.id)
          )
          .where(
            and(
              inArray(attendanceImportBatches.payrollPeriodId, periodIds),
              isNotNull(attendanceRawLogs.employeeId),
              inArray(attendanceRawLogs.employeeId, scope.employeeIds)
            )
          );
  const batchIdsByPeriod = new Map<string, Set<string>>();
  for (const row of visibleBatchRows) {
    if (!row.periodId) continue;
    const batchIds = batchIdsByPeriod.get(row.periodId) ?? new Set<string>();
    batchIds.add(row.batchId);
    batchIdsByPeriod.set(row.periodId, batchIds);
  }

  const today = new Date().toISOString().slice(0, 10);
  const selectedPeriodId =
    periodRows.some((period) => period.id === input?.periodId)
      ? input!.periodId!
      : periodRows.find(
          (period) => period.startDate <= today && period.endDate >= today
        )?.id ??
        [...periodRows].reverse().find((period) => period.endDate <= today)?.id ??
        periodRows[0]?.id ??
        null;

  return {
    year,
    selectedPeriodId,
    periods: periodRows.map((period) => ({
      id: period.id,
      code: period.code,
      payrollTerms: period.payrollTerms,
      cycle: period.cycle,
      year: period.year,
      month: period.month,
      startDate: period.startDate,
      endDate: period.endDate,
      nominalPayDate: period.nominalPayDate,
      adjustedPayDate: period.adjustedPayDate,
      status: period.status,
      attendanceBatchCount: batchIdsByPeriod.get(period.id)?.size ?? 0,
    })),
    managerEmployeeCount: scope.employeeIds.length,
  };
}

export async function listManagerDtrImportBatchesAction(payrollPeriodId: string) {
  const auth = await requireManager({ redirectTo: "/" });
  const scope = await getManagerAttendanceScope(auth.accountId);
  if (scope.employeeIds.length === 0) return [];

  const rawBatchRows = await db
    .select({
      batchId: attendanceImportBatches.id,
    })
    .from(attendanceRawLogs)
    .innerJoin(
      attendanceImportBatches,
      eq(attendanceRawLogs.batchId, attendanceImportBatches.id)
    )
    .where(
      and(
        eq(attendanceImportBatches.payrollPeriodId, payrollPeriodId),
        isNotNull(attendanceRawLogs.employeeId),
        inArray(attendanceRawLogs.employeeId, scope.employeeIds)
      )
    );
  const scopedRowCountByBatchId = new Map<string, number>();
  for (const row of rawBatchRows) {
    scopedRowCountByBatchId.set(
      row.batchId,
      (scopedRowCountByBatchId.get(row.batchId) ?? 0) + 1
    );
  }

  const batchIds = [...scopedRowCountByBatchId.keys()];
  if (batchIds.length === 0) return [];

  const batchRows = await db
    .select()
    .from(attendanceImportBatches)
    .where(inArray(attendanceImportBatches.id, batchIds))
    .orderBy(desc(attendanceImportBatches.importedAt));

  return batchRows.map((batch) =>
    serializeManagerAttendanceBatch(
      batch,
      scopedRowCountByBatchId.get(batch.id) ?? 0
    )
  );
}

export async function importManagerDtrLogsAction(params: AttendanceImportParams) {
  const auth = await requireManager();
  const scope = await getManagerAttendanceScope(auth.accountId);

  if (!params.payrollPeriodId) {
    throw new Error("Select a payroll period before importing DTR files.");
  }
  if (scope.employeeIds.length === 0) {
    throw new Error("Manager account is not assigned to a department.");
  }

  const batch = await importAttendanceLogsForScope(
    {
      fileName: params.fileName,
      contentBase64: params.contentBase64,
      payrollPeriodId: params.payrollPeriodId,
      replaceExisting: false,
    },
    {
      actorUserId: auth.accountId,
      sourceHashScope: `manager-departments:${[...scope.departmentIds]
        .sort((left, right) => left - right)
        .join(",")}`,
      employeeIds: scope.employeeIds,
      persistUnmatchedLogs: false,
      replaceExisting: false,
      revalidatePaths: ["/managerDtrFiles", "/payroll"],
      auditAction: "attendance.manager_imported",
      auditDetails: {
        managerAccountId: auth.accountId,
        departmentIds: scope.departmentIds,
      },
    }
  );

  return batch
    ? serializeManagerAttendanceBatch(batch, batch.matchedRows)
    : null;
}

export async function getManagerAttendancePeriodDtrAction(payrollPeriodId: string) {
  const auth = await requireManager({ redirectTo: "/" });
  const scope = await getManagerAttendanceScope(auth.accountId);
  const sourceData = await loadAttendancePeriodPersistedSummarySourceData(
    db,
    payrollPeriodId,
    undefined,
    { employeeIds: scope.employeeIds }
  );
  const employeesForView =
    buildAttendanceDtrEmployeesFromPersistedSummaries(sourceData);

  return {
    payrollPeriod: serializeAttendancePayrollPeriod(sourceData.payrollPeriod),
    employees: employeesForView,
  };
}

export async function getManagerAttendanceDtrHeldRowsAction(periodId: string) {
  const auth = await requireManager({ redirectTo: "/" });
  const scope = await getManagerAttendanceScope(auth.accountId);
  return loadAttendanceDtrHeldRows(periodId, scope.employeeIds);
}

export async function submitManagerAttendanceDtrHoldRowsAction(input: unknown) {
  const auth = await requireManager();
  const parsed = attendanceDtrHoldApprovalSchema.parse(input);
  const attendanceDates = [...new Set(parsed.attendanceDates)].sort((left, right) =>
    left.localeCompare(right)
  );

  const scope = await getManagerAttendanceScope(auth.accountId);
  if (!scope.employeeIds.includes(parsed.employeeId)) {
    throw new Error("Employee is not assigned to one of this manager's departments.");
  }

  const heldRows = await loadAttendanceDtrHeldRows(
    parsed.sourcePayrollPeriodId,
    scope.employeeIds
  );
  const heldRowsForEmployee = heldRows.rows.filter(
    (row) => row.employeeId === parsed.employeeId
  );
  const heldDateSet = new Set(
    heldRowsForEmployee.map((row) => row.attendanceDate)
  );
  const nonHeldDate = attendanceDates.find(
    (attendanceDate) => !heldDateSet.has(attendanceDate)
  );
  if (nonHeldDate) {
    throw new Error("One or more selected dates are no longer held.");
  }
  const selectedHeldRows = attendanceDates
    .map((attendanceDate) =>
      heldRowsForEmployee.find((row) => row.attendanceDate === attendanceDate)
    )
    .filter((row): row is (typeof heldRowsForEmployee)[number] => Boolean(row));
  const intendedWorkedMinutes = selectedHeldRows.reduce(
    (total, row) => total + row.intendedWorkedMinutes,
    0
  );
  const submissionTotals: AttendanceHoldApprovalMinutes = {
    workedMinutes: Math.max(
      0,
      intendedWorkedMinutes - parsed.lateMinutes - parsed.undertimeMinutes
    ),
    lateMinutes: parsed.lateMinutes,
    undertimeMinutes: parsed.undertimeMinutes,
    overtimeMinutes: parsed.overtimeMinutes,
  };

  const result = await db.transaction(async (tx) => {
    const [sourcePeriod, targetPeriod] = await Promise.all([
      tx.query.payrollPeriods.findFirst({
        where: eq(payrollPeriods.id, parsed.sourcePayrollPeriodId),
      }),
      tx.query.payrollPeriods.findFirst({
        where: eq(payrollPeriods.id, parsed.targetPayrollPeriodId),
      }),
    ]);

    if (!sourcePeriod) throw new Error("Source payroll period not found.");
    if (!targetPeriod) throw new Error("Target payroll period not found.");

    const outsideSourcePeriod = attendanceDates.find(
      (attendanceDate) =>
        attendanceDate < sourcePeriod.startDate ||
        attendanceDate > sourcePeriod.endDate
    );
    if (outsideSourcePeriod) {
      throw new Error("One or more held dates are outside the source payroll period.");
    }

    const previousSubmissions = await tx
      .select()
      .from(attendanceDtrHoldApprovals)
      .where(
        and(
          eq(
            attendanceDtrHoldApprovals.sourcePayrollPeriodId,
            parsed.sourcePayrollPeriodId
          ),
          eq(attendanceDtrHoldApprovals.employeeId, parsed.employeeId),
          inArray(attendanceDtrHoldApprovals.attendanceDate, attendanceDates)
        )
      );

    if (previousSubmissions.some((submission) => submission.status === "Approved")) {
      throw new Error("Approved held DTR rows can no longer be edited by a manager.");
    }

    const splitSubmissions = splitAttendanceHoldApprovalMinutes(
      submissionTotals,
      attendanceDates
    );
    await tx
      .insert(attendanceDtrHoldApprovals)
      .values(
        splitSubmissions.map((submission) => ({
          sourcePayrollPeriodId: parsed.sourcePayrollPeriodId,
          targetPayrollPeriodId: parsed.targetPayrollPeriodId,
          employeeId: parsed.employeeId,
          attendanceDate: submission.attendanceDate,
          status: "Pending",
          workedMinutes: submission.workedMinutes,
          lateMinutes: submission.lateMinutes,
          undertimeMinutes: submission.undertimeMinutes,
          overtimeMinutes: submission.overtimeMinutes,
          notes: parsed.notes ?? null,
          approvedByUserId: null,
          approvedAt: null,
        }))
      )
      .onConflictDoUpdate({
        target: [
          attendanceDtrHoldApprovals.sourcePayrollPeriodId,
          attendanceDtrHoldApprovals.employeeId,
          attendanceDtrHoldApprovals.attendanceDate,
        ],
        set: {
          targetPayrollPeriodId: sql`excluded.target_payroll_period_id`,
          status: sql`excluded.status`,
          workedMinutes: sql`excluded.worked_minutes`,
          lateMinutes: sql`excluded.late_minutes`,
          undertimeMinutes: sql`excluded.undertime_minutes`,
          overtimeMinutes: sql`excluded.overtime_minutes`,
          notes: sql`excluded.notes`,
          approvedByUserId: null,
          approvedAt: null,
          updatedAt: new Date(),
        },
      });

    return {
      sourcePayrollPeriodCode: sourcePeriod.code,
      targetPayrollPeriodCode: targetPeriod.code,
      submittedDateCount: attendanceDates.length,
    };
  });

  revalidatePath("/managerDtrFiles");
  revalidatePath("/payroll");

  return result;
}

export async function revertAttendanceImportBatchAction(batchId: string) {
  const actor = await requireAdminActor();
  const batch = await db.query.attendanceImportBatches.findFirst({
    where: eq(attendanceImportBatches.id, batchId),
  });

  if (!batch) {
    throw new Error("Attendance import batch not found.");
  }

  const payrollPeriod = batch.payrollPeriodId
    ? await db.query.payrollPeriods.findFirst({
        where: eq(payrollPeriods.id, batch.payrollPeriodId),
      })
    : null;

  if (batch.payrollPeriodId && !payrollPeriod) {
    throw new Error("The payroll period for this attendance import was not found.");
  }

  if (payrollPeriod) {
    const [blockingRun] = await db
      .select({
        id: payrollRuns.id,
        status: payrollRuns.status,
      })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.payrollPeriodId, payrollPeriod.id),
          inArray(payrollRuns.status, ["Approved", "Posted"])
        )
      )
      .limit(1);

    if (blockingRun) {
      throw new Error(
        `Attendance import revert is blocked because payroll period ${payrollPeriod.code} already has a ${blockingRun.status} payroll run.`
      );
    }
  }

  const revertResult = await db.transaction(async (tx) => {
    const rawLogRows = await tx
      .select({
        id: attendanceRawLogs.id,
        employeeId: attendanceRawLogs.employeeId,
        logDate: attendanceRawLogs.logDate,
      })
      .from(attendanceRawLogs)
      .where(eq(attendanceRawLogs.batchId, batch.id));

    const deletedSummaries = await tx
      .delete(attendanceDailySummaries)
      .where(
        sql`${attendanceDailySummaries.sourceBatchId} = ${batch.id}
          OR EXISTS (
            SELECT 1
            FROM ${attendanceRawLogs}
            WHERE ${attendanceRawLogs.batchId} = ${batch.id}
              AND ${attendanceRawLogs.employeeId} = ${attendanceDailySummaries.employeeId}
              AND ${attendanceRawLogs.logDate} = ${attendanceDailySummaries.attendanceDate}
          )`
      )
      .returning({
        id: attendanceDailySummaries.id,
        employeeId: attendanceDailySummaries.employeeId,
        attendanceDate: attendanceDailySummaries.attendanceDate,
      });

    const affectedDtrKeyByValue = new Map<
      string,
      { employeeId: string; attendanceDate: string }
    >();
    for (const row of rawLogRows) {
      if (!row.employeeId) continue;
      affectedDtrKeyByValue.set(`${row.employeeId}|${row.logDate}`, {
        employeeId: row.employeeId,
        attendanceDate: row.logDate,
      });
    }
    for (const row of deletedSummaries) {
      affectedDtrKeyByValue.set(`${row.employeeId}|${row.attendanceDate}`, {
        employeeId: row.employeeId,
        attendanceDate: row.attendanceDate,
      });
    }
    const affectedDtrKeys = [...affectedDtrKeyByValue.values()];
    const affectedEmployeeIds = [
      ...new Set(affectedDtrKeys.map((row) => row.employeeId)),
    ];
    const affectedDates = [
      ...new Set(affectedDtrKeys.map((row) => row.attendanceDate)),
    ];

    const holdApprovalKeyPredicate =
      payrollPeriod && affectedDtrKeys.length > 0
        ? affectedDtrKeys.length === 1
          ? and(
              eq(
                attendanceDtrHoldApprovals.employeeId,
                affectedDtrKeys[0].employeeId
              ),
              eq(
                attendanceDtrHoldApprovals.attendanceDate,
                affectedDtrKeys[0].attendanceDate
              )
            )
          : or(
              ...affectedDtrKeys.map((key) =>
                and(
                  eq(attendanceDtrHoldApprovals.employeeId, key.employeeId),
                  eq(attendanceDtrHoldApprovals.attendanceDate, key.attendanceDate)
                )
              )
            )
        : undefined;
    const holdOverrideKeyPredicate =
      payrollPeriod && affectedDtrKeys.length > 0
        ? affectedDtrKeys.length === 1
          ? and(
              eq(
                employeeAttendanceDayStatusOverrides.employeeId,
                affectedDtrKeys[0].employeeId
              ),
              eq(
                employeeAttendanceDayStatusOverrides.attendanceDate,
                affectedDtrKeys[0].attendanceDate
              )
            )
          : or(
              ...affectedDtrKeys.map((key) =>
                and(
                  eq(employeeAttendanceDayStatusOverrides.employeeId, key.employeeId),
                  eq(
                    employeeAttendanceDayStatusOverrides.attendanceDate,
                    key.attendanceDate
                  )
                )
              )
            )
        : undefined;
    const deletedHoldOverrides =
      payrollPeriod && holdOverrideKeyPredicate
        ? await tx
            .delete(employeeAttendanceDayStatusOverrides)
            .where(
              and(
                eq(
                  employeeAttendanceDayStatusOverrides.payrollPeriodId,
                  payrollPeriod.id
                ),
                eq(employeeAttendanceDayStatusOverrides.status, "Hold"),
                holdOverrideKeyPredicate
              )
            )
            .returning({ id: employeeAttendanceDayStatusOverrides.id })
        : [];
    const holdApprovalWhere =
      payrollPeriod && holdApprovalKeyPredicate
        ? and(
            eq(attendanceDtrHoldApprovals.sourcePayrollPeriodId, payrollPeriod.id),
            eq(attendanceDtrHoldApprovals.status, "Approved"),
            holdApprovalKeyPredicate
          )
        : undefined;
    const previousHoldApprovals = holdApprovalWhere
      ? await tx
          .select()
          .from(attendanceDtrHoldApprovals)
          .where(holdApprovalWhere)
      : [];
    const deletedHoldApprovals = holdApprovalWhere
      ? await tx
          .delete(attendanceDtrHoldApprovals)
          .where(holdApprovalWhere)
          .returning({ id: attendanceDtrHoldApprovals.id })
      : [];

    const affectedTargetPeriodsById = new Map<
      string,
      {
        payrollPeriodId: string;
        payrollPeriodCode: string;
        employeeIds: Set<string>;
        refreshableExceptionRowIds: string[];
        generatedAccountCodeRowCount: number;
        staleRunCount: number;
      }
    >();
    const targetRebuildKeys = [
      ...new Set(
        previousHoldApprovals.map(
          (approval) => `${approval.targetPayrollPeriodId}|${approval.employeeId}`
        )
      ),
    ];
    for (const targetRebuildKey of targetRebuildKeys) {
      const [targetPayrollPeriodId, employeeId] = targetRebuildKey.split("|");
      if (!targetPayrollPeriodId || !employeeId) continue;

      const rebuilt = await rebuildHeldDtrExceptionRowsForTargetPeriod({
        tx,
        actorUserId: actor.userId,
        targetPayrollPeriodId,
        employeeId,
      });
      const current = affectedTargetPeriodsById.get(targetPayrollPeriodId) ?? {
        payrollPeriodId: targetPayrollPeriodId,
        payrollPeriodCode: rebuilt.payrollPeriod.code,
        employeeIds: new Set<string>(),
        refreshableExceptionRowIds: [],
        generatedAccountCodeRowCount: 0,
        staleRunCount: 0,
      };
      current.employeeIds.add(employeeId);
      current.refreshableExceptionRowIds.push(
        ...rebuilt.refreshableExceptionRowIds
      );
      current.generatedAccountCodeRowCount += rebuilt.generatedAccountCodeRowCount;
      current.staleRunCount += rebuilt.staleRunCount;
      affectedTargetPeriodsById.set(targetPayrollPeriodId, current);
    }
    const affectedTargetPeriods = [...affectedTargetPeriodsById.values()].map(
      (targetPeriod) => ({
        payrollPeriodId: targetPeriod.payrollPeriodId,
        payrollPeriodCode: targetPeriod.payrollPeriodCode,
        employeeIds: [...targetPeriod.employeeIds],
        refreshableExceptionRowIds: [
          ...new Set(targetPeriod.refreshableExceptionRowIds),
        ],
        generatedAccountCodeRowCount: targetPeriod.generatedAccountCodeRowCount,
        staleRunCount: targetPeriod.staleRunCount,
      })
    );

    await tx
      .delete(attendanceImportBatches)
      .where(eq(attendanceImportBatches.id, batch.id));

    const staleRunCount = payrollPeriod
      ? await markPayrollPeriodRunsStale({
          tx,
          payrollPeriodId: payrollPeriod.id,
          payrollPeriodCode: payrollPeriod.code,
          actorUserId: actor.userId,
        })
      : 0;
    const generatedDtrWorkedRows = payrollPeriod
      ? await syncGeneratedDtrWorkedExceptionRows({
          tx,
          payrollPeriod,
          employeeIds: affectedEmployeeIds,
        })
      : EMPTY_GENERATED_DTR_EXCEPTION_ROW_SYNC;

    return {
      result: {
        batchId: batch.id,
        sourceFileName: batch.sourceFileName,
        payrollPeriodCode: payrollPeriod?.code ?? null,
        rawLogCount: rawLogRows.length,
        summaryCount: deletedSummaries.length,
        affectedEmployeeCount: affectedEmployeeIds.length,
        affectedDateCount: affectedDates.length,
        staleRunCount,
        deletedHoldOverrideCount: deletedHoldOverrides.length,
        deletedHoldApprovalCount: deletedHoldApprovals.length,
        affectedTargetPeriods,
        targetStaleRunCount: affectedTargetPeriods.reduce(
          (total, targetPeriod) => total + targetPeriod.staleRunCount,
          0
        ),
      },
      affectedEmployeeIds,
      refreshableExceptionRowIds:
        generatedDtrWorkedRows.refreshableExceptionRowIds,
      affectedTargetPeriods,
    };
  });
  const result = revertResult.result;

  if (payrollPeriod) {
    await refreshManualPayrollAttendanceForEmployees({
      actorUserId: actor.userId,
      payrollPeriodId: payrollPeriod.id,
      employeeIds: revertResult.affectedEmployeeIds,
      refreshableExceptionRowIds: revertResult.refreshableExceptionRowIds,
    });
  }
  for (const targetPeriod of revertResult.affectedTargetPeriods) {
    await refreshManualPayrollAttendanceForEmployees({
      actorUserId: actor.userId,
      payrollPeriodId: targetPeriod.payrollPeriodId,
      employeeIds: targetPeriod.employeeIds,
      refreshableExceptionRowIds: targetPeriod.refreshableExceptionRowIds,
    });
  }

  await recordAdminAuditEvent({
    actorUserId: actor.userId,
    entityType: "attendance_import_batch",
    entityId: batch.id,
    action: "attendance.import_reverted",
    details: {
      sourceFileName: batch.sourceFileName,
      payrollPeriodId: batch.payrollPeriodId,
      payrollPeriodCode: result.payrollPeriodCode,
      rawLogCount: result.rawLogCount,
      summaryCount: result.summaryCount,
      affectedEmployeeCount: result.affectedEmployeeCount,
      affectedDateCount: result.affectedDateCount,
      staleRunCount: result.staleRunCount,
      deletedHoldOverrideCount: result.deletedHoldOverrideCount,
      deletedHoldApprovalCount: result.deletedHoldApprovalCount,
      affectedTargetPeriods: result.affectedTargetPeriods,
      targetStaleRunCount: result.targetStaleRunCount,
    },
  });

  revalidatePath("/payroll");
  return result;
}

export async function refreshAttendancePeriodSummariesAction(payrollPeriodId: string) {
  const actor = await requireAdminActor();
  const sourceData = await loadAttendancePeriodSourceData(db, payrollPeriodId);

  if (sourceData.rawLogs.length === 0 || sourceData.employeeRecords.length === 0) {
    throw new Error(
      "No matched attendance logs are available yet for the selected payroll period."
    );
  }

  const matchedEmployeeIds = sourceData.employeeRecords.map((employee) => employee.id);
  const resolvedApprovedLeaves = await resolveApprovedLeaveFlags(sourceData.approvedLeaves);
  const sourceParsedLogs = mapAttendanceRawRowsToParsedLogs(sourceData.rawLogs);
  const correctionSuggestions = buildAttendanceCorrectionSuggestionComputations({
    employees: sourceData.employeeRecords.map((employee) => ({
      id: employee.id,
      employeeNo: employee.employeeNo,
      timekeeping: employee.timekeeping ?? null,
    })),
    logs: sourceParsedLogs,
    approvedLeaves: resolvedApprovedLeaves,
    shiftAssignments: sourceData.shiftAssignments,
    weeklyPatterns: sourceData.weeklyPatterns,
    shiftTableBreaksByShiftTableId: sourceData.shiftTableBreaksByShiftTableId,
    allowedAttendanceDateRange: {
      startDate: sourceData.payrollPeriod.startDate,
      endDate: sourceData.payrollPeriod.endDate,
    },
  });

  const summaryRefreshResult = await db.transaction(async (tx) => {
    const staleRunCount = await markPayrollPeriodRunsStale({
      tx,
      payrollPeriodId: sourceData.payrollPeriod.id,
      payrollPeriodCode: sourceData.payrollPeriod.code,
      actorUserId: actor.userId,
    });

    // Insert corrections first so that auto-approved ones (e.g. Same-Direction
    // Duplicate) are in the DB before summaries are computed and saved.
    const correctionSuggestionSync = await syncAttendanceCorrectionSuggestions({
      tx,
      payrollPeriod: sourceData.payrollPeriod,
      employeeIds: matchedEmployeeIds,
      suggestions: correctionSuggestions,
    });

    // Reload approved corrections to include any that were just auto-approved.
    const approvedCorrectionsAfterSync = await tx
      .select()
      .from(attendanceDtrCorrections)
      .where(
        and(
          eq(attendanceDtrCorrections.payrollPeriodId, sourceData.payrollPeriod.id),
          inArray(attendanceDtrCorrections.employeeId, matchedEmployeeIds),
          eq(attendanceDtrCorrections.status, "Approved"),
          gte(
            attendanceDtrCorrections.attendanceDate,
            sourceData.payrollPeriod.startDate
          ),
          lte(
            attendanceDtrCorrections.attendanceDate,
            sourceData.payrollPeriod.endDate
          )
        )
      );

    const summaryComputations = buildAttendanceSummaryComputations({
      employees: sourceData.employeeRecords.map((employee) => ({
        id: employee.id,
        employeeNo: employee.employeeNo,
        timekeeping: employee.timekeeping ?? null,
      })),
      logs: sourceParsedLogs,
      approvedLeaves: resolvedApprovedLeaves,
      shiftAssignments: sourceData.shiftAssignments,
      weeklyPatterns: sourceData.weeklyPatterns,
      shiftTableBreaksByShiftTableId: sourceData.shiftTableBreaksByShiftTableId,
      approvedCorrections: mapApprovedCorrectionRows(approvedCorrectionsAfterSync),
      allowedAttendanceDateRange: {
        startDate: sourceData.payrollPeriod.startDate,
        endDate: sourceData.payrollPeriod.endDate,
      },
    });

    await tx
      .delete(attendanceDailySummaries)
      .where(
        and(
          inArray(attendanceDailySummaries.employeeId, matchedEmployeeIds),
          gte(attendanceDailySummaries.attendanceDate, sourceData.payrollPeriod.startDate),
          lte(attendanceDailySummaries.attendanceDate, sourceData.payrollPeriod.endDate)
        )
      );

    for (const rows of chunk(summaryComputations, 200)) {
      if (rows.length === 0) continue;
      await tx.insert(attendanceDailySummaries).values(rows);
    }

    const generatedDtrWorkedRows = await syncGeneratedDtrWorkedExceptionRows({
      tx,
      payrollPeriod: sourceData.payrollPeriod,
      employeeIds: matchedEmployeeIds,
    });

    return {
      staleRunCount,
      summaryCount: summaryComputations.length,
      pendingSuggestionCount: correctionSuggestionSync.pendingSuggestionCount,
      refreshableExceptionRowIds:
        generatedDtrWorkedRows.refreshableExceptionRowIds,
    };
  });
  const { staleRunCount } = summaryRefreshResult;

  await refreshManualPayrollAttendanceForEmployees({
    actorUserId: actor.userId,
    payrollPeriodId: sourceData.payrollPeriod.id,
    employeeIds: matchedEmployeeIds,
    refreshableExceptionRowIds: summaryRefreshResult.refreshableExceptionRowIds,
  });

  await recordAdminAuditEvent({
    actorUserId: actor.userId,
    entityType: "attendance_daily_summaries",
    entityId: sourceData.payrollPeriod.id,
    action: "attendance.summaries_refreshed",
    details: {
      payrollPeriodId: sourceData.payrollPeriod.id,
      payrollPeriodCode: sourceData.payrollPeriod.code,
      employeeCount: matchedEmployeeIds.length,
      rawLogCount: sourceData.rawLogs.length,
      summaryCount: summaryRefreshResult.summaryCount,
      pendingSuggestionCount: summaryRefreshResult.pendingSuggestionCount,
      staleRunCount,
    },
  });

  revalidatePath("/payroll");
  return {
    payrollPeriodCode: sourceData.payrollPeriod.code,
    employeeCount: matchedEmployeeIds.length,
    rawLogCount: sourceData.rawLogs.length,
    summaryCount: summaryRefreshResult.summaryCount,
    pendingSuggestionCount: summaryRefreshResult.pendingSuggestionCount,
    staleRunCount,
  };
}

function serializeAttendancePayrollPeriod(
  payrollPeriod: typeof payrollPeriods.$inferSelect
) {
  return {
    id: payrollPeriod.id,
    code: payrollPeriod.code,
    startDate: payrollPeriod.startDate,
    endDate: payrollPeriod.endDate,
    adjustedPayDate: payrollPeriod.adjustedPayDate,
    nominalPayDate: payrollPeriod.nominalPayDate,
    cycle: payrollPeriod.cycle,
    status: payrollPeriod.status,
  };
}

async function buildAttendanceDtrEmployees(
  sourceData: AttendancePeriodSourceData
): Promise<AttendanceDtrEmployeeView[]> {
  const resolvedApprovedLeaves = await resolveApprovedLeaveFlags(sourceData.approvedLeaves);
  const detailRows = buildAttendancePeriodDetailRows({
    employees: sourceData.employeeRecords.map((employee) => ({
      id: employee.id,
      employeeNo: employee.employeeNo,
      timekeeping: employee.timekeeping ?? null,
    })),
    logs: mapAttendanceRawRowsToParsedLogs(sourceData.rawLogs),
    approvedLeaves: resolvedApprovedLeaves,
    shiftAssignments: sourceData.shiftAssignments,
    weeklyPatterns: sourceData.weeklyPatterns,
    shiftTableBreaksByShiftTableId: sourceData.shiftTableBreaksByShiftTableId,
    approvedCorrections: mapApprovedCorrectionRows(sourceData.approvedCorrections),
    startDate: sourceData.payrollPeriod.startDate,
    endDate: sourceData.payrollPeriod.endDate,
  });

  const rowsByEmployeeId = new Map<string, typeof detailRows>();
  for (const row of detailRows) {
    const current = rowsByEmployeeId.get(row.employeeId) ?? [];
    current.push(row);
    rowsByEmployeeId.set(row.employeeId, current);
  }
  const periodOverrideByEmployeeId = new Map(
    sourceData.periodOverrides.map((override) => [override.employeeId, override])
  );
  const statusOverrideByEmployeeDate = new Map(
    sourceData.dayStatusOverrides.map((override) => [
      `${override.employeeId}|${override.attendanceDate}`,
      override.status as AttendanceDtrManualStatus,
    ])
  );
  const dayTypeOverrideByEmployeeDate = new Map(
    sourceData.dayTypeOverrides.map((override) => [
      `${override.employeeId}|${override.attendanceDate}`,
      override.dayType as AttendanceDtrDayType,
    ])
  );
  const calendarDayTypeByDate = new Map(
    [...buildHolidayTypeByDate(sourceData.holidayRows).entries()].map(
      ([attendanceDate, holidayType]) => [
        attendanceDate,
        getAttendanceDtrDayTypeFromHolidayType(holidayType),
      ]
    )
  );

  const sourceFilesByEmployeeId = new Map<
    string,
    Map<string, { batchId: string; sourceFileName: string; punchCount: number }>
  >();

  for (const row of sourceData.rawLogs) {
    if (!row.employeeId) continue;

    const currentFiles = sourceFilesByEmployeeId.get(row.employeeId) ?? new Map();
    const currentFile = currentFiles.get(row.batchId) ?? {
      batchId: row.batchId,
      sourceFileName: row.sourceFileName,
      punchCount: 0,
    };

    currentFile.punchCount += 1;
    currentFiles.set(row.batchId, currentFile);
    sourceFilesByEmployeeId.set(row.employeeId, currentFiles);
  }

  return [...sourceData.employeeRecords]
    .sort((left, right) =>
      buildEmployeeDisplayName(left).localeCompare(buildEmployeeDisplayName(right))
    )
    .map((employee) => {
      const rows = rowsByEmployeeId.get(employee.id) ?? [];
      const periodOverride = periodOverrideByEmployeeId.get(employee.id) ?? null;
      const effectiveRows = rows.map((row) => {
        const manualStatus =
          statusOverrideByEmployeeDate.get(`${employee.id}|${row.attendanceDate}`) ??
          null;
        const calendarDayType =
          calendarDayTypeByDate.get(row.attendanceDate) ?? "Regular Day";
        const manualDayType =
          dayTypeOverrideByEmployeeDate.get(
            `${employee.id}|${row.attendanceDate}`
          ) ?? null;

        return {
          source: row,
          computedStatus: getComputedAttendanceDtrStatus(row),
          manualStatus,
          calendarDayType,
          manualDayType,
          effectiveDayType: manualDayType ?? calendarDayType,
          effective: applyAttendanceDtrEffectiveStatus(row, manualStatus),
        };
      });
      const sourceFiles = [
        ...(sourceFilesByEmployeeId.get(employee.id)?.values() ?? []),
      ].sort((left, right) =>
        left.sourceFileName.localeCompare(right.sourceFileName)
      );
      const departmentMetadata = getEmployeeDepartmentMetadata(
        sourceData.departmentByEmployeeId,
        employee.id
      );

      return {
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        employeeType: employee.employeeType,
        employeeName: buildEmployeeDisplayName(employee),
        departmentId: departmentMetadata.departmentId,
        departmentName: departmentMetadata.departmentName,
        departmentCode: departmentMetadata.departmentCode,
        hasDtrRecord: rows.length > 0,
        sourceFiles,
        rows: effectiveRows.map((row) => ({
          attendanceDate: row.effective.attendanceDate,
          dayName: row.effective.dayName,
          rawPunches: row.source.rawPunches
            .map((value) => formatTimeValue(value))
            .filter((value): value is string => Boolean(value)),
          firstInAt: formatTimeValue(row.source.firstInAt),
          lastOutAt: formatTimeValue(row.source.lastOutAt),
          scheduledInTime: row.effective.scheduledInTime,
          scheduledOutTime: row.effective.scheduledOutTime,
          scheduledMinutes: row.effective.scheduledMinutes,
          workedMinutes: row.effective.workedMinutes,
          lateMinutes: row.effective.lateMinutes,
          undertimeMinutes: row.effective.undertimeMinutes,
          overtimeMinutes: row.effective.overtimeMinutes,
          paidLeaveMinutes: row.effective.paidLeaveMinutes,
          unpaidLeaveMinutes: row.effective.unpaidLeaveMinutes,
          absentMinutes: row.effective.absentMinutes,
          isRestDay: row.effective.isRestDay,
          anomalyFlags: normalizeAttendanceDtrAnomalyFlags(
            row.effective.anomalyFlags
          ),
          computedStatus: row.computedStatus,
          manualStatus: row.manualStatus,
          effectiveStatus:
            row.manualStatus ?? getComputedAttendanceDtrStatus(row.effective),
          isStatusOverridden: row.manualStatus != null,
          holdApprovalStatus: null,
          holdApprovalTargetPayrollPeriodCode: null,
          calendarDayType: row.calendarDayType,
          manualDayType: row.manualDayType,
          effectiveDayType: row.effectiveDayType,
          isDayTypeOverridden: row.manualDayType != null,
        })),
        totals: buildAttendanceDtrTotals(
          effectiveRows.map((row) => row.effective),
          periodOverride
        ),
      };
    });
}

function buildAttendanceDtrEmployeesFromPersistedSummaries(
  sourceData: AttendancePeriodPersistedSummarySourceData
): AttendanceDtrEmployeeView[] {
  const rowsByEmployeeId = new Map<
    string,
    Array<typeof attendanceDailySummaries.$inferSelect>
  >();
  for (const row of sourceData.summaryRows) {
    const current = rowsByEmployeeId.get(row.employeeId) ?? [];
    current.push(row);
    rowsByEmployeeId.set(row.employeeId, current);
  }

  const periodOverrideByEmployeeId = new Map(
    sourceData.periodOverrides.map((override) => [override.employeeId, override])
  );
  const statusOverrideByEmployeeDate = new Map(
    sourceData.dayStatusOverrides.map((override) => [
      `${override.employeeId}|${override.attendanceDate}`,
      override.status as AttendanceDtrManualStatus,
    ])
  );
  const dayTypeOverrideByEmployeeDate = new Map(
    sourceData.dayTypeOverrides.map((override) => [
      `${override.employeeId}|${override.attendanceDate}`,
      override.dayType as AttendanceDtrDayType,
    ])
  );
  const holdApprovalByEmployeeDate = new Map(
    sourceData.holdApprovalRows.map((approval) => [
      `${approval.employeeId}|${approval.attendanceDate}`,
      approval,
    ])
  );
  const calendarDayTypeByDate = new Map(
    [...buildHolidayTypeByDate(sourceData.holidayRows).entries()].map(
      ([attendanceDate, holidayType]) => [
        attendanceDate,
        getAttendanceDtrDayTypeFromHolidayType(holidayType),
      ]
    )
  );

  return [...sourceData.employeeRecords]
    .sort((left, right) =>
      buildEmployeeDisplayName(left).localeCompare(buildEmployeeDisplayName(right))
    )
    .map((employee) => {
      const summaryRows = (rowsByEmployeeId.get(employee.id) ?? []).sort(
        (left, right) => left.attendanceDate.localeCompare(right.attendanceDate)
      );
      const periodOverride = periodOverrideByEmployeeId.get(employee.id) ?? null;
      const sourceFiles = [
        ...(sourceData.sourceFilesByEmployeeId.get(employee.id)?.values() ?? []),
      ].sort((left, right) =>
        left.sourceFileName.localeCompare(right.sourceFileName)
      );
      const departmentMetadata = getEmployeeDepartmentMetadata(
        sourceData.departmentByEmployeeId,
        employee.id
      );
      const effectiveRowsForTotals: Array<
        typeof attendanceDailySummaries.$inferSelect & { rawPunches: Date[] }
      > = [];
      const rows = summaryRows.map((summary) => {
        const manualStatus =
          statusOverrideByEmployeeDate.get(
            `${employee.id}|${summary.attendanceDate}`
          ) ?? null;
        const calendarDayType =
          calendarDayTypeByDate.get(summary.attendanceDate) ?? "Regular Day";
        const manualDayType =
          dayTypeOverrideByEmployeeDate.get(
            `${employee.id}|${summary.attendanceDate}`
          ) ?? null;
        const rawPunches =
          sourceData.rawPunchesByEmployeeDate.get(
            `${employee.id}|${summary.attendanceDate}`
          ) ?? [];
        const source = {
          ...summary,
          dayName: formatAttendanceDayName(summary.attendanceDate),
          rawPunches,
        };
        const computedStatus = getComputedAttendanceDtrStatus(source);
        const effective = applyAttendanceDtrEffectiveStatus(source, manualStatus);
        const holdApproval =
          holdApprovalByEmployeeDate.get(
            `${employee.id}|${summary.attendanceDate}`
          ) ?? null;
        effectiveRowsForTotals.push(effective);

        return {
          attendanceDate: effective.attendanceDate,
          dayName: source.dayName,
          rawPunches: rawPunches
            .map((value) => formatTimeValue(value))
            .filter((value): value is string => Boolean(value)),
          firstInAt: formatTimeValue(effective.firstInAt),
          lastOutAt: formatTimeValue(effective.lastOutAt),
          scheduledInTime: effective.scheduledInTime,
          scheduledOutTime: effective.scheduledOutTime,
          scheduledMinutes: effective.scheduledMinutes,
          workedMinutes: effective.workedMinutes,
          lateMinutes: effective.lateMinutes,
          undertimeMinutes: effective.undertimeMinutes,
          overtimeMinutes: effective.overtimeMinutes,
          paidLeaveMinutes: effective.paidLeaveMinutes,
          unpaidLeaveMinutes: effective.unpaidLeaveMinutes,
          absentMinutes: effective.absentMinutes,
          isRestDay: effective.isRestDay,
          anomalyFlags: normalizeAttendanceDtrAnomalyFlags(
            effective.anomalyFlags
          ),
          computedStatus,
          manualStatus,
          effectiveStatus:
            manualStatus ?? getComputedAttendanceDtrStatus(effective),
          isStatusOverridden: manualStatus != null,
          holdApprovalStatus:
            holdApproval?.status === "Approved" ? ("Approved" as const) : null,
          holdApprovalTargetPayrollPeriodCode:
            holdApproval?.status === "Approved"
              ? holdApproval.targetPayrollPeriodCode
              : null,
          calendarDayType,
          manualDayType,
          effectiveDayType: manualDayType ?? calendarDayType,
          isDayTypeOverridden: manualDayType != null,
        };
      });

      return {
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        employeeType: employee.employeeType,
        employeeName: buildEmployeeDisplayName(employee),
        departmentId: departmentMetadata.departmentId,
        departmentName: departmentMetadata.departmentName,
        departmentCode: departmentMetadata.departmentCode,
        hasDtrRecord: summaryRows.length > 0,
        sourceFiles,
        rows,
        totals: buildAttendanceDtrTotals(effectiveRowsForTotals, periodOverride),
      };
    });
}

function toAttendanceDtrSummary(
  employee: AttendanceDtrEmployeeView
): AttendanceDtrEmployeeSummaryView {
  return {
    employeeId: employee.employeeId,
    employeeNo: employee.employeeNo,
    employeeType: employee.employeeType,
    employeeName: employee.employeeName,
    departmentId: employee.departmentId,
    departmentName: employee.departmentName,
    departmentCode: employee.departmentCode,
    hasDtrRecord: employee.hasDtrRecord,
    sourceFiles: employee.sourceFiles,
    totals: employee.totals,
  };
}

export async function getAttendancePeriodDtrAction(
  payrollPeriodId: string
): Promise<AttendanceDtrView> {
  await requireAdminActor();
  const sourceData = await loadAttendancePeriodSourceData(db, payrollPeriodId);
  const employeesForView = await buildAttendanceDtrEmployees(sourceData);

  return {
    payrollPeriod: serializeAttendancePayrollPeriod(sourceData.payrollPeriod),
    employees: employeesForView,
  };
}

export async function getAttendancePeriodDtrSummaryAction(
  payrollPeriodId: string
): Promise<AttendanceDtrSummaryView> {
  await requireAdminActor();
  const sourceData = await loadAttendancePeriodPersistedSummarySourceData(
    db,
    payrollPeriodId
  );
  const employeesForView =
    buildAttendanceDtrEmployeesFromPersistedSummaries(sourceData);

  return {
    payrollPeriod: serializeAttendancePayrollPeriod(sourceData.payrollPeriod),
    employees: employeesForView.map(toAttendanceDtrSummary),
  };
}

export async function getAttendancePeriodDtrEmployeeRowsAction(
  payrollPeriodId: string,
  employeeId: string
): Promise<AttendanceDtrEmployeeRowsView> {
  await requireAdminActor();
  const sourceData = await loadAttendancePeriodPersistedSummarySourceData(
    db,
    payrollPeriodId,
    employeeId
  );
  const employeesForView =
    buildAttendanceDtrEmployeesFromPersistedSummaries(sourceData);
  const employee = employeesForView.find((item) => item.employeeId === employeeId);

  return {
    employeeId,
    rows: employee?.rows ?? [],
  };
}

function serializeAttendanceCorrectionPayload(
  payload: AttendanceCorrectionPayload | unknown
) {
  const normalized =
    payload && typeof payload === "object"
      ? (payload as Partial<AttendanceCorrectionPayload>)
      : {};

  return {
    rawPunches: Array.isArray(normalized.rawPunches) ? normalized.rawPunches : [],
    ignoredRawLogIds: Array.isArray(normalized.ignoredRawLogIds)
      ? normalized.ignoredRawLogIds.filter(
          (value): value is number => Number.isInteger(value)
        )
      : [],
    syntheticPunches: Array.isArray(normalized.syntheticPunches)
      ? normalized.syntheticPunches
      : [],
    effectivePunches: Array.isArray(normalized.effectivePunches)
      ? normalized.effectivePunches
      : [],
    proposedMetrics:
      normalized.proposedMetrics && typeof normalized.proposedMetrics === "object"
        ? normalized.proposedMetrics
        : null,
  };
}

function serializeAttendanceCorrection(
  row: typeof attendanceDtrCorrections.$inferSelect,
  employee: typeof employees.$inferSelect | null,
  departmentMetadata: EmployeeDepartmentMetadata
): AttendanceDtrCorrectionView {
  const payload = serializeAttendanceCorrectionPayload(row.payload);

  return {
    id: row.id,
    payrollPeriodId: row.payrollPeriodId,
    employeeId: row.employeeId,
    employeeNo: employee?.employeeNo ?? "",
    employeeType: employee?.employeeType ?? DEFAULT_EMPLOYEE_TYPE,
    employeeName: employee ? buildEmployeeDisplayName(employee) : "Unknown employee",
    departmentId: departmentMetadata.departmentId,
    departmentName: departmentMetadata.departmentName,
    departmentCode: departmentMetadata.departmentCode,
    attendanceDate: row.attendanceDate,
    correctionType: row.correctionType as AttendanceDtrCorrectionType,
    status: row.status as AttendanceDtrCorrectionStatus,
    confidence: row.confidence,
    reason: row.reason,
    rawPunches: payload.rawPunches,
    ignoredRawLogIds: payload.ignoredRawLogIds,
    syntheticPunches: payload.syntheticPunches,
    effectivePunches: payload.effectivePunches,
    proposedMetrics: payload.proposedMetrics,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getAttendanceDtrCorrectionsAction(
  payrollPeriodId: string
): Promise<AttendanceDtrCorrectionQueueView> {
  const payrollPeriod = await db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, payrollPeriodId),
  });

  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  const correctionRows = await db
    .select()
    .from(attendanceDtrCorrections)
    .where(eq(attendanceDtrCorrections.payrollPeriodId, payrollPeriodId))
    .orderBy(
      asc(attendanceDtrCorrections.status),
      asc(attendanceDtrCorrections.attendanceDate),
      asc(attendanceDtrCorrections.correctionType)
    );
  const employeeIds = [
    ...new Set(correctionRows.map((row) => row.employeeId)),
  ];
  const employeeRows =
    employeeIds.length === 0
      ? []
      : await db.query.employees.findMany({
          where: inArray(employees.id, employeeIds),
        });
  const employeeById = new Map(employeeRows.map((employee) => [employee.id, employee]));
  const departmentByEmployeeId = await loadEmployeeDepartmentMetadataByEmployeeId(
    employeeIds,
    db
  );

  return {
    payrollPeriod: serializeAttendancePayrollPeriod(payrollPeriod),
    corrections: correctionRows.map((row) =>
      serializeAttendanceCorrection(
        row,
        employeeById.get(row.employeeId) ?? null,
        getEmployeeDepartmentMetadata(departmentByEmployeeId, row.employeeId)
      )
    ),
  };
}

const attendanceDtrPeriodOverrideSchema = z.object({
  payrollPeriodId: z.string().uuid(),
  employeeId: z.string().uuid(),
  presentDays: z.number().finite().min(0).nullable().optional(),
  workedMinutes: z.number().int().min(0).nullable().optional(),
  lateMinutes: z.number().int().min(0).nullable().optional(),
  undertimeMinutes: z.number().int().min(0).nullable().optional(),
  overtimeMinutes: z.number().int().min(0).nullable().optional(),
});

const attendanceDtrHoldApprovalSchema = z.object({
  sourcePayrollPeriodId: z.string().uuid(),
  targetPayrollPeriodId: z.string().uuid(),
  employeeId: z.string().uuid(),
  attendanceDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .min(1),
  workedMinutes: z.number().int().min(0),
  lateMinutes: z.number().int().min(0),
  undertimeMinutes: z.number().int().min(0),
  overtimeMinutes: z.number().int().min(0),
  notes: z.string().trim().max(500).optional(),
});

const attendanceDtrHoldResetSchema = z.object({
  sourcePayrollPeriodId: z.string().uuid(),
  employeeId: z.string().uuid(),
  attendanceDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .min(1),
});

const attendanceDtrCorrectionReviewSchema = z.object({
  payrollPeriodId: z.string().uuid(),
  correctionIds: z.array(z.string().uuid()).min(1),
  status: z.enum(["Approved", "Rejected"]),
});

const GENERATED_DTR_OVERRIDE_SOURCES: PayrollExceptionDtrOverrideSource[] = [
  "DTR_WORKED",
  "DTR_TARDINESS",
  "DTR_UNDERTIME",
  "DTR_REGULAR_OVERTIME",
];

const HELD_DTR_OVERRIDE_SOURCES = [
  "DTR_HOLD_WORKED",
  "DTR_HOLD_TARDINESS",
  "DTR_HOLD_UNDERTIME",
  "DTR_HOLD_REGULAR_OVERTIME",
] as const satisfies readonly PayrollExceptionDtrOverrideSource[];

type HeldDtrOverrideSource = (typeof HELD_DTR_OVERRIDE_SOURCES)[number];

const HELD_DTR_ACCOUNT_CODE_CONFIG = {
  DTR_HOLD_WORKED: {
    code: "HOLD-REG",
    accountType: "Regular Hours",
    description: "Held DTR Worked/Regular Hours",
    dailyRate: "1.0000",
    monthlyRate: "1.0000",
  },
  DTR_HOLD_TARDINESS: {
    code: "HOLD-LATE",
    accountType: "Other Deduction",
    description: "Held DTR Late/Tardiness",
    dailyRate: null,
    monthlyRate: null,
  },
  DTR_HOLD_UNDERTIME: {
    code: "HOLD-UT",
    accountType: "Unpaid Leaves/Absences",
    description: "Held DTR Undertime/Absence",
    dailyRate: null,
    monthlyRate: null,
  },
  DTR_HOLD_REGULAR_OVERTIME: {
    code: "HOLD-OT",
    accountType: "Overtime",
    description: "Held DTR Regular Overtime",
    dailyRate: "1.2500",
    monthlyRate: "1.2500",
  },
} as const;

type DtrPeriodOverrideValues = {
  presentDays: number | null;
  workedMinutes: number | null;
  lateMinutes: number | null;
  undertimeMinutes: number | null;
  overtimeMinutes: number | null;
};

type AttendanceHoldApprovalMinutes = {
  workedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
};

type GeneratedDtrAccountCodeRow = typeof accountCode.$inferSelect;
type GeneratedDtrExceptionRowInsert =
  typeof employeePayrollExceptionRows.$inferInsert;
type GeneratedDtrHolidayCalendarRow = {
  holidayDate: string;
  holidayDate2: string | null;
  holidayType: OvertimeHolidayType;
  checkDate1: string | null;
  checkDate2: string | null;
  requireCheckDate1: boolean;
  requireCheckDate2: boolean;
};
type GeneratedDtrHolidayCheckRequirementWithPriority =
  GeneratedDtrHolidayCheckDateRequirement & {
    holidayType: OvertimeHolidayType;
  };
type GeneratedDtrHolidayWorkedRow = {
  attendanceDate: string;
  holidayType: OvertimeHolidayType;
  dayType: AttendanceDtrDayType;
  isRestDay: boolean;
  account: GeneratedDtrAccountCodeRow;
  quantityMinutes: number;
  checkRequirement: GeneratedDtrHolidayCheckDateRequirement;
};
type GeneratedDtrHolidayOvertimeRow = {
  attendanceDate: string;
  holidayType: OvertimeHolidayType;
  dayType: AttendanceDtrDayType;
  account: GeneratedDtrAccountCodeRow | null;
  dailyOvertimeMinutes: number;
  overrideCapacityMinutes: number;
  overtimeCategory: OvertimeCategory;
  checkRequirement: GeneratedDtrHolidayCheckDateRequirement;
};
type GeneratedDtrBranchCalendarOverrideRow = {
  attendanceDate: string;
  regularAccount: GeneratedDtrAccountCodeRow;
  overtimeAccount: GeneratedDtrAccountCodeRow;
  regularMinutes: number;
  overtimeMinutes: number;
};
type GeneratedDtrExceptionRowSyncResult = {
  generatedAccountCodeRowCount: number;
  refreshableExceptionRowIds: string[];
};

const EMPTY_GENERATED_DTR_EXCEPTION_ROW_SYNC: GeneratedDtrExceptionRowSyncResult = {
  generatedAccountCodeRowCount: 0,
  refreshableExceptionRowIds: [],
};

function normalizeGeneratedDtrAccountText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function getGeneratedDtrAccountCode(args: {
  source: PayrollExceptionDtrOverrideSource;
  accountRows: GeneratedDtrAccountCodeRow[];
}) {
  if (args.source === "DTR_WORKED") {
    return (
      args.accountRows.find((row) => row.accountType === "Regular Hours") ??
      null
    );
  }

  if (args.source === "DTR_TARDINESS") {
    return (
      args.accountRows.find((row) =>
        normalizeGeneratedDtrAccountText(row.description).includes("tardiness")
      ) ?? null
    );
  }

  if (args.source === "DTR_UNDERTIME") {
    return (
      args.accountRows.find((row) => {
        if (row.accountType !== "Unpaid Leaves/Absences") return false;
        const code = normalizeGeneratedDtrAccountText(row.accountCode);
        const description = normalizeGeneratedDtrAccountText(row.description);
        return (
          code.includes("leave without pay") ||
          code.includes("lwop") ||
          description.includes("leave without pay") ||
          description.includes("lwop")
        );
      }) ?? null
    );
  }

  return (
    args.accountRows.find((row) => {
      if (row.accountType !== "Overtime") return false;
      const code = normalizeGeneratedDtrAccountText(row.accountCode);
      const description = normalizeGeneratedDtrAccountText(row.description);
      return (
        code.includes("regular overtime") ||
        description.includes("regular overtime")
      );
    }) ?? null
  );
}

function createGeneratedDtrExceptionRow(args: {
  payrollPeriodId: string;
  employeeId: string;
  attendanceDate: string;
  source: PayrollExceptionDtrOverrideSource;
  account: GeneratedDtrAccountCodeRow;
  quantityMinutes: number;
  amountOverride?: string | null;
  generatedFrom?: "override" | "computed";
  sourceLabel?: string;
  dayType?: AttendanceDtrDayType | null;
  overtimeCategory?: OvertimeCategory | null;
}) {
  const defaultSourceLabel =
    args.source === "DTR_WORKED"
      ? "Worked"
      : args.source === "DTR_TARDINESS"
        ? "Late"
        : args.source === "DTR_UNDERTIME"
          ? "Undertime"
          : "Regular Overtime";
  const sourceLabel = args.sourceLabel ?? defaultSourceLabel;
  const sourceDescription =
    args.source === "DTR_WORKED" && args.generatedFrom === "computed"
      ? "imported Semimonthly DTR Worked hours"
      : args.generatedFrom === "computed"
        ? `imported Semimonthly DTR ${sourceLabel} hours`
      : `Semimonthly DTR ${sourceLabel} override`;

  return {
    payrollPeriodId: args.payrollPeriodId,
    employeeId: args.employeeId,
    attendanceDate: args.attendanceDate,
    exceptionType: null,
    workedStatus: null,
    dayType: args.dayType ?? null,
    customPayrollCodeId: null,
    accountCodeId: args.account.id,
    accountCodeSnapshot: args.account.accountCode,
    accountTypeSnapshot: args.account.accountType,
    accountDescriptionSnapshot: args.account.description,
    accountMonth13thPaySnapshot: args.account.month13thPay,
    accountNonTaxableSnapshot: args.account.nonTaxable,
    overtimeCategory:
      args.source === "DTR_REGULAR_OVERTIME"
        ? args.overtimeCategory ?? "REGULAR_DAY"
        : null,
    quantityMinutes: args.quantityMinutes,
    quantityDays: null,
    amountOverride: args.amountOverride ?? null,
    remarks: `Generated from ${sourceDescription}.`,
    dtrOverrideSource: args.source,
    updatedAt: new Date(),
  } satisfies typeof employeePayrollExceptionRows.$inferInsert;
}

function normalizeHeldDtrRateMultiplier(value: string | number | null | undefined) {
  const numericValue = Number(value);
  return (Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : 1.25
  ).toFixed(4);
}

function getHeldDtrSourceLabel(source: HeldDtrOverrideSource) {
  if (source === "DTR_HOLD_WORKED") return "Worked/Regular Hours";
  if (source === "DTR_HOLD_TARDINESS") return "Late/Tardiness";
  if (source === "DTR_HOLD_UNDERTIME") return "Undertime/Absence";
  return "Regular Overtime";
}

function createHeldDtrExceptionRow(args: {
  payrollPeriodId: string;
  employeeId: string;
  attendanceDate: string;
  source: HeldDtrOverrideSource;
  account: GeneratedDtrAccountCodeRow;
  quantityMinutes: number;
}) {
  const isQuantityOnlyDeduction =
    args.source === "DTR_HOLD_TARDINESS" ||
    args.source === "DTR_HOLD_UNDERTIME";

  return {
    payrollPeriodId: args.payrollPeriodId,
    employeeId: args.employeeId,
    attendanceDate: args.attendanceDate,
    exceptionType: null,
    workedStatus: null,
    dayType: null,
    customPayrollCodeId: null,
    accountCodeId: args.account.id,
    accountCodeSnapshot: args.account.accountCode,
    accountTypeSnapshot: args.account.accountType,
    accountDescriptionSnapshot: args.account.description,
    accountMonth13thPaySnapshot: args.account.month13thPay,
    accountNonTaxableSnapshot: args.account.nonTaxable,
    overtimeCategory:
      args.source === "DTR_HOLD_REGULAR_OVERTIME" ? "REGULAR_DAY" : null,
    quantityMinutes: args.quantityMinutes,
    quantityDays: null,
    amountOverride: isQuantityOnlyDeduction ? "0.00" : null,
    remarks: `Generated from approved Held DTR ${getHeldDtrSourceLabel(
      args.source
    )}.`,
    dtrOverrideSource: args.source,
    updatedAt: new Date(),
  } satisfies typeof employeePayrollExceptionRows.$inferInsert;
}

function getEffectiveHolidayTypeForDate(args: {
  attendanceDate: string;
  manualDayTypeByDate: Map<string, AttendanceDtrDayType>;
  calendarHolidayTypeByDate: Map<string, OvertimeHolidayType>;
}) {
  const manualDayType = args.manualDayTypeByDate.get(args.attendanceDate);

  if (manualDayType) {
    return getHolidayTypeFromAttendanceDtrDayType(manualDayType);
  }

  return args.calendarHolidayTypeByDate.get(args.attendanceDate) ?? null;
}

function buildBranchCalendarOverrideScopeMaps(
  rows: Array<typeof branchCalendarAccountCodeOverrides.$inferSelect>
) {
  return {
    allDepartmentsByDate: new Map(
      rows
        .filter((row) => row.departmentId == null)
        .map((row) => [row.attendanceDate, row] as const)
    ),
    departmentByDateScope: new Map(
      rows
        .filter((row) => row.departmentId != null)
        .map(
          (row) =>
            [`${row.attendanceDate}:${row.departmentId}`, row] as const
        )
    ),
  };
}

function getEffectiveBranchCalendarOverride(args: {
  attendanceDate: string;
  departmentId: number | null | undefined;
  maps: ReturnType<typeof buildBranchCalendarOverrideScopeMaps>;
}) {
  const departmentOverride =
    args.departmentId != null
      ? args.maps.departmentByDateScope.get(
          `${args.attendanceDate}:${args.departmentId}`
        )
      : null;

  return (
    departmentOverride ??
    args.maps.allDepartmentsByDate.get(args.attendanceDate) ??
    null
  );
}

function getBranchCalendarRegularMinutes(
  row: Pick<
    typeof attendanceDailySummaries.$inferSelect,
    | "workedMinutes"
    | "regularMinutes"
    | "lateMinutes"
    | "undertimeMinutes"
    | "isRestDay"
  >
) {
  if (row.isRestDay || (row.workedMinutes <= 0 && row.regularMinutes <= 0)) {
    return 0;
  }

  return Math.max(
    0,
    ATTENDANCE_DTR_WORKED_MINUTES_PER_PRESENT_DAY -
      Math.max(0, Math.round(row.lateMinutes)) -
      Math.max(0, Math.round(row.undertimeMinutes))
  );
}

function buildBranchCalendarOverrideRowsForGeneratedDtr(args: {
  rows: Array<typeof attendanceDailySummaries.$inferSelect>;
  departmentId: number | null | undefined;
  overrideMaps: ReturnType<typeof buildBranchCalendarOverrideScopeMaps>;
  accountById: Map<number, GeneratedDtrAccountCodeRow>;
  manualDayTypeByDate: Map<string, AttendanceDtrDayType>;
  calendarHolidayTypeByDate: Map<string, OvertimeHolidayType>;
}) {
  const branchRows: GeneratedDtrBranchCalendarOverrideRow[] = [];

  for (const row of args.rows) {
    if (row.isRestDay) continue;
    const holidayType = getEffectiveHolidayTypeForDate({
      attendanceDate: row.attendanceDate,
      manualDayTypeByDate: args.manualDayTypeByDate,
      calendarHolidayTypeByDate: args.calendarHolidayTypeByDate,
    });
    if (holidayType) continue;

    const override = getEffectiveBranchCalendarOverride({
      attendanceDate: row.attendanceDate,
      departmentId: args.departmentId,
      maps: args.overrideMaps,
    });
    if (!override) continue;

    const regularAccount = args.accountById.get(override.regularAccountCodeId);
    const overtimeAccount = args.accountById.get(override.overtimeAccountCodeId);
    if (!regularAccount || !overtimeAccount) {
      continue;
    }

    const regularMinutes = getBranchCalendarRegularMinutes(row);
    const overtimeMinutes = Math.max(0, Math.round(row.overtimeMinutes));
    if (regularMinutes <= 0 && overtimeMinutes <= 0) continue;

    branchRows.push({
      attendanceDate: row.attendanceDate,
      regularAccount,
      overtimeAccount,
      regularMinutes,
      overtimeMinutes,
    });
  }

  return branchRows;
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getHolidayPriority(holidayType: OvertimeHolidayType) {
  if (holidayType === "Regular") return 4;
  if (holidayType === "Special Non-Working") return 3;
  if (holidayType === "Company") return 2;
  return 1;
}

function buildHolidayCheckRequirementByDate(
  holidays: GeneratedDtrHolidayCalendarRow[]
) {
  const requirementByDate = new Map<
    string,
    GeneratedDtrHolidayCheckDateRequirement & { holidayType: OvertimeHolidayType }
  >();

  for (const holiday of holidays) {
    const start = parseDateOnly(holiday.holidayDate);
    const end = parseDateOnly(holiday.holidayDate2 ?? holiday.holidayDate);
    const cursor = new Date(start.getTime());

    while (cursor <= end) {
      const dateKey = formatDateOnly(cursor);
      const existing = requirementByDate.get(dateKey);

      if (
        !existing ||
        getHolidayPriority(holiday.holidayType) >
          getHolidayPriority(existing.holidayType)
      ) {
        requirementByDate.set(dateKey, {
          holidayType: holiday.holidayType,
          checkDate1: holiday.checkDate1,
          checkDate2: holiday.checkDate2,
          requireCheckDate1: holiday.requireCheckDate1,
          requireCheckDate2: holiday.requireCheckDate2,
        });
      }

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return requirementByDate;
}

function getRequiredHolidayCheckDates(holidays: GeneratedDtrHolidayCalendarRow[]) {
  return [
    ...new Set(
      holidays.flatMap((holiday) => [
        holiday.requireCheckDate1 && holiday.checkDate1 ? holiday.checkDate1 : null,
        holiday.requireCheckDate2 && holiday.checkDate2 ? holiday.checkDate2 : null,
      ])
    ),
  ].filter((date): date is string => Boolean(date));
}

function buildCheckDateAttendanceByDate(
  rows: Array<{
    attendanceDate: string;
    workedMinutes: number;
    regularMinutes: number;
    lateMinutes: number;
    undertimeMinutes: number;
  }>
) {
  return new Map(
    rows.map((row) => [
      row.attendanceDate,
      {
        attendanceDate: row.attendanceDate,
        workedMinutes: row.workedMinutes,
        regularMinutes: row.regularMinutes,
        lateMinutes: row.lateMinutes,
        undertimeMinutes: row.undertimeMinutes,
      } satisfies GeneratedDtrHolidayCheckDateAttendance,
    ])
  );
}

function buildHolidayWorkedRowsForGeneratedDtr(args: {
  rows: Array<{
    attendanceDate: string;
    scheduledMinutes: number;
    workedMinutes: number;
    regularMinutes: number;
    lateMinutes: number;
    undertimeMinutes: number;
    isRestDay: boolean;
  }>;
  manualDayTypeByDate: Map<string, AttendanceDtrDayType>;
  calendarHolidayTypeByDate: Map<string, OvertimeHolidayType>;
  holidayCheckRequirementByDate: Map<
    string,
    GeneratedDtrHolidayCheckRequirementWithPriority
  >;
  checkDateAttendanceByDate: Map<string, GeneratedDtrHolidayCheckDateAttendance>;
  holidayAccountByType: Map<OvertimeHolidayType, GeneratedDtrAccountCodeRow>;
  restDayHolidayAccountByType: Map<
    OvertimeHolidayType,
    GeneratedDtrAccountCodeRow
  >;
}) {
  return args.rows.flatMap((row): GeneratedDtrHolidayWorkedRow[] => {
    const holidayType = getEffectiveHolidayTypeForDate({
      attendanceDate: row.attendanceDate,
      manualDayTypeByDate: args.manualDayTypeByDate,
      calendarHolidayTypeByDate: args.calendarHolidayTypeByDate,
    });
    if (!holidayType) return [];

    const checkRequirement =
      args.holidayCheckRequirementByDate.get(row.attendanceDate) ?? null;
    if (
      !isGeneratedDtrHolidayCheckRequirementSatisfied({
        requirement: checkRequirement,
        attendanceByDate: args.checkDateAttendanceByDate,
      })
    ) {
      return [];
    }

    const account = row.isRestDay
      ? args.restDayHolidayAccountByType.get(holidayType) ??
        args.holidayAccountByType.get(holidayType)
      : args.holidayAccountByType.get(holidayType);
    if (!account) return [];

    const quantityMinutes = getGeneratedDtrHolidayWorkedMinutes(row);
    if (quantityMinutes <= 0) return [];

    return [
      {
        attendanceDate: row.attendanceDate,
        holidayType,
        dayType: getAttendanceDtrDayTypeFromHolidayType(holidayType),
        isRestDay: row.isRestDay,
        account,
        quantityMinutes,
        checkRequirement: checkRequirement ?? {},
      },
    ];
  });
}

function buildHolidayOvertimeRowsForGeneratedDtr(args: {
  rows: Array<{
    attendanceDate: string;
    scheduledMinutes: number;
    workedMinutes: number;
    regularMinutes: number;
    lateMinutes: number;
    undertimeMinutes: number;
    overtimeMinutes: number;
    isRestDay: boolean;
  }>;
  manualDayTypeByDate: Map<string, AttendanceDtrDayType>;
  calendarHolidayTypeByDate: Map<string, OvertimeHolidayType>;
  holidayCheckRequirementByDate: Map<
    string,
    GeneratedDtrHolidayCheckRequirementWithPriority
  >;
  checkDateAttendanceByDate: Map<string, GeneratedDtrHolidayCheckDateAttendance>;
  holidayOvertimeAccountByType: Map<
    OvertimeHolidayType,
    GeneratedDtrAccountCodeRow
  >;
  restDayHolidayOvertimeAccountByType: Map<
    OvertimeHolidayType,
    GeneratedDtrAccountCodeRow
  >;
}) {
  return args.rows.flatMap((row): GeneratedDtrHolidayOvertimeRow[] => {
    const holidayType = getEffectiveHolidayTypeForDate({
      attendanceDate: row.attendanceDate,
      manualDayTypeByDate: args.manualDayTypeByDate,
      calendarHolidayTypeByDate: args.calendarHolidayTypeByDate,
    });
    if (!holidayType) return [];

    const checkRequirement =
      args.holidayCheckRequirementByDate.get(row.attendanceDate) ?? null;
    if (
      !isGeneratedDtrHolidayCheckRequirementSatisfied({
        requirement: checkRequirement,
        attendanceByDate: args.checkDateAttendanceByDate,
      })
    ) {
      return [];
    }

    const fallbackOvertimeCapacityMinutes =
      getGeneratedDtrHolidayOvertimeCapacityMinutes(row);
    const dailyOvertimeMinutes =
      row.overtimeMinutes > 0
        ? Math.max(0, Math.round(row.overtimeMinutes))
        : row.isRestDay
          ? fallbackOvertimeCapacityMinutes
          : 0;
    const overrideCapacityMinutes =
      dailyOvertimeMinutes > 0
        ? dailyOvertimeMinutes
        : fallbackOvertimeCapacityMinutes;
    if (dailyOvertimeMinutes <= 0 && overrideCapacityMinutes <= 0) return [];
    const account = row.isRestDay
      ? args.restDayHolidayOvertimeAccountByType.get(holidayType) ??
        args.holidayOvertimeAccountByType.get(holidayType) ??
        null
      : args.holidayOvertimeAccountByType.get(holidayType) ?? null;

    return [
      {
        attendanceDate: row.attendanceDate,
        holidayType,
        dayType: getAttendanceDtrDayTypeFromHolidayType(holidayType),
        account,
        dailyOvertimeMinutes,
        overrideCapacityMinutes,
        overtimeCategory: resolveOvertimeCategory({
          isRestDay: row.isRestDay,
          holidayType,
        }),
        checkRequirement: checkRequirement ?? {},
      },
    ];
  });
}

function buildHolidayAccountByType(args: {
  accountRows: GeneratedDtrAccountCodeRow[];
  mappingRows: Array<typeof holidayTypeAccountCodes.$inferSelect>;
  accountCodeField:
    | "accountCodeId"
    | "overtimeAccountCodeId"
    | "restDayAccountCodeId"
    | "restDayOvertimeAccountCodeId";
  accountType: "Sunday/Holiday" | "Overtime";
}) {
  const accountById = new Map(args.accountRows.map((row) => [row.id, row]));
  const holidayAccountByType = new Map<
    OvertimeHolidayType,
    GeneratedDtrAccountCodeRow
  >();

  for (const mapping of args.mappingRows) {
    const accountCodeId = mapping[args.accountCodeField];
    if (!accountCodeId) continue;
    const account = accountById.get(accountCodeId);
    if (!account || account.accountType !== args.accountType) continue;
    holidayAccountByType.set(mapping.holidayType as OvertimeHolidayType, account);
  }

  return holidayAccountByType;
}

async function fetchHolidayRowsForGeneratedDtr(args: {
  tx: AttendanceTransaction;
  startDate: string;
  endDate: string;
}) {
  const rows = await args.tx
    .select({
      holidayDate: holidayYearCalendar.holidayDate,
      holidayDate2: holidayYearCalendar.holidayDate2,
      checkDate1: holidayYearCalendar.checkDate1,
      checkDate2: holidayYearCalendar.checkDate2,
      requireCheckDate1: holidayYearCalendar.requireCheckDate1,
      requireCheckDate2: holidayYearCalendar.requireCheckDate2,
      holidayType: holidayYearCalendar.holidayType,
    })
    .from(holidayYearCalendar)
    .where(
      and(
        eq(holidayYearCalendar.status, "Confirmed"),
        isNotNull(holidayYearCalendar.holidayDate),
        lte(holidayYearCalendar.holidayDate, args.endDate),
        sql`coalesce(${holidayYearCalendar.holidayDate2}, ${holidayYearCalendar.holidayDate}) >= ${args.startDate}`
      )
    )
    .orderBy(asc(holidayYearCalendar.holidayDate));

  return rows.filter(
    (
      row
    ): row is {
      holidayDate: string;
      holidayDate2: string | null;
      checkDate1: string | null;
      checkDate2: string | null;
      requireCheckDate1: boolean;
      requireCheckDate2: boolean;
      holidayType: OvertimeHolidayType;
    } => row.holidayDate != null
  );
}

async function getHeldDtrRegularOvertimeMultiplier(tx: AttendanceTransaction) {
  const [regularOvertimeRule] = await tx
    .select({ rateMultiplier: overtimeRules.rateMultiplier })
    .from(overtimeRules)
    .where(eq(overtimeRules.category, "REGULAR_DAY"))
    .orderBy(asc(overtimeRules.minutesFrom), asc(overtimeRules.id))
    .limit(1);

  return normalizeHeldDtrRateMultiplier(regularOvertimeRule?.rateMultiplier);
}

async function ensureHeldDtrAccountCodes(tx: AttendanceTransaction) {
  const heldAccountCodes = HELD_DTR_OVERRIDE_SOURCES.map(
    (source) => HELD_DTR_ACCOUNT_CODE_CONFIG[source].code
  );
  const existingRows = await tx
    .select()
    .from(accountCode)
    .where(inArray(accountCode.accountCode, heldAccountCodes))
    .orderBy(asc(accountCode.accountCode), asc(accountCode.id));
  const accountByCode = new Map<string, GeneratedDtrAccountCodeRow>();

  for (const row of existingRows) {
    if (!accountByCode.has(row.accountCode)) {
      accountByCode.set(row.accountCode, row);
    }
  }

  const missingSources = HELD_DTR_OVERRIDE_SOURCES.filter(
    (source) => !accountByCode.has(HELD_DTR_ACCOUNT_CODE_CONFIG[source].code)
  );

  if (missingSources.length > 0) {
    const regularOvertimeMultiplier =
      missingSources.includes("DTR_HOLD_REGULAR_OVERTIME")
        ? await getHeldDtrRegularOvertimeMultiplier(tx)
        : null;
    const insertedRows = await tx
      .insert(accountCode)
      .values(
        missingSources.map((source) => {
          const config = HELD_DTR_ACCOUNT_CODE_CONFIG[source];
          const isRegularOvertime = source === "DTR_HOLD_REGULAR_OVERTIME";

          return {
            accountCode: config.code,
            accountType: config.accountType,
            description: config.description,
            dailyRate: isRegularOvertime
              ? regularOvertimeMultiplier
              : config.dailyRate,
            monthlyRate: isRegularOvertime
              ? regularOvertimeMultiplier
              : config.monthlyRate,
            month13thPay: false,
            nonTaxable: false,
            deminimis: false,
            healthInsurance: false,
          } satisfies typeof accountCode.$inferInsert;
        })
      )
      .returning();

    for (const row of insertedRows) {
      accountByCode.set(row.accountCode, row);
    }
  }

  const accountBySource = new Map<HeldDtrOverrideSource, GeneratedDtrAccountCodeRow>();
  for (const source of HELD_DTR_OVERRIDE_SOURCES) {
    const code = HELD_DTR_ACCOUNT_CODE_CONFIG[source].code;
    const account = accountByCode.get(code);
    if (!account) {
      throw new Error(`Create the ${code} held DTR account code before approval.`);
    }
    accountBySource.set(source, account);
  }

  return accountBySource;
}

function buildGeneratedDtrWorkedExceptionRow(args: {
  payrollPeriodId: string;
  employeeId: string;
  attendanceDate: string;
  overrides: Pick<
    DtrPeriodOverrideValues,
    "workedMinutes" | "lateMinutes" | "undertimeMinutes"
  >;
  computed: Pick<
    AttendanceDtrTotalsView["computed"],
    "presentDays" | "workedMinutes" | "lateMinutes" | "undertimeMinutes"
  >;
  accountRows: GeneratedDtrAccountCodeRow[];
  holidayWorkedRows?: GeneratedDtrHolidayWorkedRow[];
  branchCalendarOverrideRows?: GeneratedDtrBranchCalendarOverrideRow[];
}): GeneratedDtrExceptionRowInsert[] {
  const effectiveWorkedMinutes = computeNetDtrWorkedMinutes({
    presentDays: args.computed.presentDays,
    lateMinutes: args.overrides.lateMinutes ?? args.computed.lateMinutes,
    undertimeMinutes:
      args.overrides.undertimeMinutes ?? args.computed.undertimeMinutes,
    workedMinutesOverride: args.overrides.workedMinutes,
  });
  const additionalRestDayHolidayWorkedMinutes = (args.holidayWorkedRows ?? [])
    .filter((row) => row.isRestDay)
    .reduce((total, row) => total + Math.max(0, row.quantityMinutes), 0);
  let remainingWorkedMinutes = Math.max(
    0,
    effectiveWorkedMinutes + additionalRestDayHolidayWorkedMinutes
  );
  if (remainingWorkedMinutes <= 0) return [];

  const rows: GeneratedDtrExceptionRowInsert[] = [];
  const sortedHolidayRows = [...(args.holidayWorkedRows ?? [])].sort((left, right) =>
    left.attendanceDate.localeCompare(right.attendanceDate)
  );

  for (const holidayRow of sortedHolidayRows) {
    const quantityMinutes = Math.min(
      remainingWorkedMinutes,
      Math.max(0, holidayRow.quantityMinutes)
    );
    if (quantityMinutes <= 0) continue;

    rows.push(
      createGeneratedDtrExceptionRow({
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: holidayRow.attendanceDate,
        source: "DTR_WORKED",
        account: holidayRow.account,
        quantityMinutes,
        generatedFrom:
          args.overrides.workedMinutes != null ||
          args.overrides.lateMinutes != null ||
          args.overrides.undertimeMinutes != null
            ? "override"
            : "computed",
        sourceLabel: `${holidayRow.holidayType} Holiday Worked`,
        dayType: holidayRow.dayType,
      })
    );
    remainingWorkedMinutes -= quantityMinutes;
  }

  if (remainingWorkedMinutes <= 0) return rows;

  const sortedBranchCalendarRows = [
    ...(args.branchCalendarOverrideRows ?? []),
  ].sort((left, right) => left.attendanceDate.localeCompare(right.attendanceDate));

  for (const overrideRow of sortedBranchCalendarRows) {
    const quantityMinutes = Math.min(
      remainingWorkedMinutes,
      Math.max(0, overrideRow.regularMinutes)
    );
    if (quantityMinutes <= 0) continue;

    rows.push(
      createGeneratedDtrExceptionRow({
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: overrideRow.attendanceDate,
        source: "DTR_WORKED",
        account: overrideRow.regularAccount,
        quantityMinutes,
        generatedFrom:
          args.overrides.workedMinutes != null ||
          args.overrides.lateMinutes != null ||
          args.overrides.undertimeMinutes != null
            ? "override"
            : "computed",
        sourceLabel: "Branch Calendar Regular Hours",
      })
    );
    remainingWorkedMinutes -= quantityMinutes;
  }

  if (remainingWorkedMinutes <= 0) return rows;

  const account = getGeneratedDtrAccountCode({
    source: "DTR_WORKED",
    accountRows: args.accountRows,
  });
  if (!account) {
    throw new Error(
      "Create a Regular Hours account code before syncing DTR Worked hours."
    );
  }

  rows.push(
    createGeneratedDtrExceptionRow({
      payrollPeriodId: args.payrollPeriodId,
      employeeId: args.employeeId,
      attendanceDate: args.attendanceDate,
      source: "DTR_WORKED",
      account,
      quantityMinutes: remainingWorkedMinutes,
      generatedFrom:
        args.overrides.workedMinutes != null ||
        args.overrides.lateMinutes != null ||
        args.overrides.undertimeMinutes != null
          ? "override"
          : "computed",
    })
  );

  return rows;
}

function buildGeneratedDtrOvertimeExceptionRows(args: {
  payrollPeriodId: string;
  employeeId: string;
  attendanceDate: string;
  overrides: Pick<DtrPeriodOverrideValues, "overtimeMinutes">;
  computed: Pick<AttendanceDtrTotalsView["computed"], "overtimeMinutes">;
  accountRows: GeneratedDtrAccountCodeRow[];
  holidayOvertimeRows?: GeneratedDtrHolidayOvertimeRow[];
  branchCalendarOverrideRows?: GeneratedDtrBranchCalendarOverrideRow[];
}): GeneratedDtrExceptionRowInsert[] {
  const isOverride = args.overrides.overtimeMinutes != null;
  const effectiveOvertimeMinutes = Math.max(
    0,
    Math.round(args.overrides.overtimeMinutes ?? args.computed.overtimeMinutes)
  );
  if (effectiveOvertimeMinutes <= 0) return [];

  let remainingOvertimeMinutes = effectiveOvertimeMinutes;
  const rows: GeneratedDtrExceptionRowInsert[] = [];
  const sortedHolidayRows = [...(args.holidayOvertimeRows ?? [])].sort(
    (left, right) => left.attendanceDate.localeCompare(right.attendanceDate)
  );

  for (const holidayRow of sortedHolidayRows) {
    const holidayCapacityMinutes = isOverride
      ? holidayRow.overrideCapacityMinutes
      : holidayRow.dailyOvertimeMinutes;
    const quantityMinutes = Math.min(
      remainingOvertimeMinutes,
      Math.max(0, holidayCapacityMinutes)
    );
    if (quantityMinutes <= 0) continue;

    if (holidayRow.account) {
      rows.push(
        createGeneratedDtrExceptionRow({
          payrollPeriodId: args.payrollPeriodId,
          employeeId: args.employeeId,
          attendanceDate: holidayRow.attendanceDate,
          source: "DTR_REGULAR_OVERTIME",
          account: holidayRow.account,
          quantityMinutes,
          generatedFrom: isOverride ? "override" : "computed",
          sourceLabel: `${holidayRow.holidayType} Holiday Overtime`,
          dayType: holidayRow.dayType,
          overtimeCategory: holidayRow.overtimeCategory,
        })
      );
    }

    remainingOvertimeMinutes -= quantityMinutes;
  }

  if (remainingOvertimeMinutes <= 0) return rows;

  const sortedBranchCalendarRows = [
    ...(args.branchCalendarOverrideRows ?? []),
  ].sort((left, right) => left.attendanceDate.localeCompare(right.attendanceDate));

  for (const overrideRow of sortedBranchCalendarRows) {
    const quantityMinutes = Math.min(
      remainingOvertimeMinutes,
      Math.max(0, overrideRow.overtimeMinutes)
    );
    if (quantityMinutes <= 0) continue;

    rows.push(
      createGeneratedDtrExceptionRow({
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: overrideRow.attendanceDate,
        source: "DTR_REGULAR_OVERTIME",
        account: overrideRow.overtimeAccount,
        quantityMinutes,
        generatedFrom: isOverride ? "override" : "computed",
        sourceLabel: "Branch Calendar Regular Overtime",
        overtimeCategory: "REGULAR_DAY",
      })
    );
    remainingOvertimeMinutes -= quantityMinutes;
  }

  if (remainingOvertimeMinutes <= 0) return rows;

  const account = getGeneratedDtrAccountCode({
    source: "DTR_REGULAR_OVERTIME",
    accountRows: args.accountRows,
  });
  if (!account) {
    throw new Error(
      "Create an Overtime account code with Regular Overtime in the code or description before saving a Regular Overtime DTR override."
    );
  }

  rows.push(
    createGeneratedDtrExceptionRow({
      payrollPeriodId: args.payrollPeriodId,
      employeeId: args.employeeId,
      attendanceDate: args.attendanceDate,
      source: "DTR_REGULAR_OVERTIME",
      account,
      quantityMinutes: remainingOvertimeMinutes,
      generatedFrom: isOverride ? "override" : "computed",
    })
  );

  return rows;
}

function buildGeneratedDtrExceptionRows(args: {
  payrollPeriodId: string;
  employeeId: string;
  attendanceDate: string;
  overrides: DtrPeriodOverrideValues;
  computed: AttendanceDtrTotalsView["computed"];
  absentDays: number;
  accountRows: GeneratedDtrAccountCodeRow[];
  holidayWorkedRows?: GeneratedDtrHolidayWorkedRow[];
  holidayOvertimeRows?: GeneratedDtrHolidayOvertimeRow[];
  branchCalendarOverrideRows?: GeneratedDtrBranchCalendarOverrideRow[];
}) {
  const rows: GeneratedDtrExceptionRowInsert[] = [];
  rows.push(...buildGeneratedDtrWorkedExceptionRow(args));

  const lateMinutes = Math.max(
    0,
    Math.round(args.overrides.lateMinutes ?? args.computed.lateMinutes)
  );
  if (lateMinutes > 0) {
    const account = getGeneratedDtrAccountCode({
      source: "DTR_TARDINESS",
      accountRows: args.accountRows,
    });
    if (!account) {
      throw new Error(
        "Create a Tardiness account code before syncing DTR Late hours."
      );
    }
    rows.push(
      createGeneratedDtrExceptionRow({
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: args.attendanceDate,
        source: "DTR_TARDINESS",
        account,
        quantityMinutes: lateMinutes,
        amountOverride: "0.00",
        generatedFrom: args.overrides.lateMinutes != null ? "override" : "computed",
      })
    );
  }

  const dtrUndertimeMinutes = Math.max(
    0,
    Math.round(args.overrides.undertimeMinutes ?? args.computed.undertimeMinutes)
  );
  const lwopMinutes = computeGeneratedDtrLwopMinutes({
    undertimeMinutes: dtrUndertimeMinutes,
    absentDays: args.absentDays,
  });
  if (lwopMinutes > 0) {
    const account = getGeneratedDtrAccountCode({
      source: "DTR_UNDERTIME",
      accountRows: args.accountRows,
    });
    if (!account) {
      throw new Error(
        "Create a Leave Without Pay account code before syncing DTR Undertime / Absence hours."
      );
    }
    const hasAbsenceMinutes = lwopMinutes > dtrUndertimeMinutes;
    rows.push(
      createGeneratedDtrExceptionRow({
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: args.attendanceDate,
        source: "DTR_UNDERTIME",
        account,
        quantityMinutes: lwopMinutes,
        amountOverride: "0.00",
        generatedFrom:
          args.overrides.undertimeMinutes != null ? "override" : "computed",
        sourceLabel: hasAbsenceMinutes
          ? dtrUndertimeMinutes > 0
            ? "Undertime / Absences"
            : "Absences"
          : "Undertime",
      })
    );
  }

  rows.push(...buildGeneratedDtrOvertimeExceptionRows(args));

  return rows;
}

async function replaceGeneratedDtrExceptionRowsForEmployee(args: {
  tx: AttendanceTransaction;
  payrollPeriodId: string;
  employeeId: string;
  attendanceDate: string;
  overrides: DtrPeriodOverrideValues;
  computed: AttendanceDtrTotalsView["computed"];
  absentDays: number;
}) {
  const deletedRows = await args.tx
    .delete(employeePayrollExceptionRows)
    .where(
      and(
        eq(employeePayrollExceptionRows.payrollPeriodId, args.payrollPeriodId),
        eq(employeePayrollExceptionRows.employeeId, args.employeeId),
        inArray(
          employeePayrollExceptionRows.dtrOverrideSource,
          GENERATED_DTR_OVERRIDE_SOURCES
        )
      )
    )
    .returning({ id: employeePayrollExceptionRows.id });

  const payrollPeriod = await args.tx.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, args.payrollPeriodId),
  });
  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  const [
    accountRows,
    holidayMappingRows,
    holidayRows,
    summaryRows,
    dayStatusOverrideRows,
    dayTypeOverrideRows,
    branchOverrideRows,
    employeeGeneralInfoRow,
  ] = await Promise.all([
    args.tx
      .select()
      .from(accountCode)
      .orderBy(asc(accountCode.accountCode), asc(accountCode.id)),
    args.tx.select().from(holidayTypeAccountCodes),
    fetchHolidayRowsForGeneratedDtr({
      tx: args.tx,
      startDate: payrollPeriod.startDate,
      endDate: payrollPeriod.endDate,
    }),
    args.tx
      .select()
      .from(attendanceDailySummaries)
      .where(
        and(
          eq(attendanceDailySummaries.employeeId, args.employeeId),
          gte(attendanceDailySummaries.attendanceDate, payrollPeriod.startDate),
          lte(attendanceDailySummaries.attendanceDate, payrollPeriod.endDate)
        )
      ),
    args.tx
      .select()
      .from(employeeAttendanceDayStatusOverrides)
      .where(
        and(
          eq(employeeAttendanceDayStatusOverrides.payrollPeriodId, args.payrollPeriodId),
          eq(employeeAttendanceDayStatusOverrides.employeeId, args.employeeId),
          gte(employeeAttendanceDayStatusOverrides.attendanceDate, payrollPeriod.startDate),
          lte(employeeAttendanceDayStatusOverrides.attendanceDate, payrollPeriod.endDate)
        )
      ),
    args.tx
      .select()
      .from(employeeAttendanceDayTypeOverrides)
      .where(
        and(
          eq(employeeAttendanceDayTypeOverrides.payrollPeriodId, args.payrollPeriodId),
          eq(employeeAttendanceDayTypeOverrides.employeeId, args.employeeId),
          gte(employeeAttendanceDayTypeOverrides.attendanceDate, payrollPeriod.startDate),
          lte(employeeAttendanceDayTypeOverrides.attendanceDate, payrollPeriod.endDate)
        )
      ),
    args.tx
      .select()
      .from(branchCalendarAccountCodeOverrides)
      .where(
        and(
          gte(branchCalendarAccountCodeOverrides.attendanceDate, payrollPeriod.startDate),
          lte(branchCalendarAccountCodeOverrides.attendanceDate, payrollPeriod.endDate)
        )
      ),
    args.tx.query.employeesGeneralInfo.findFirst({
      where: eq(employeesGeneralInfo.employeeId, args.employeeId),
    }),
  ]);
  const statusOverrideByDate = new Map(
    dayStatusOverrideRows.map((override) => [
      override.attendanceDate,
      override.status as AttendanceDtrManualStatus,
    ])
  );
  const manualDayTypeByDate = new Map(
    dayTypeOverrideRows.map((override) => [
      override.attendanceDate,
      override.dayType as AttendanceDtrDayType,
    ])
  );
  const effectiveRows = summaryRows.map((row) =>
    applyAttendanceDtrEffectiveStatus(
      row,
      statusOverrideByDate.get(row.attendanceDate) ?? null
    )
  );
  const requiredHolidayCheckDates = getRequiredHolidayCheckDates(holidayRows);
  const checkDateSummaryRows =
    requiredHolidayCheckDates.length === 0
      ? []
      : await args.tx
          .select()
          .from(attendanceDailySummaries)
          .where(
            and(
              eq(attendanceDailySummaries.employeeId, args.employeeId),
              inArray(
                attendanceDailySummaries.attendanceDate,
                requiredHolidayCheckDates
              )
            )
          );
  const checkDateAttendanceByDate =
    buildCheckDateAttendanceByDate(checkDateSummaryRows);
  for (const row of effectiveRows) {
    if (requiredHolidayCheckDates.includes(row.attendanceDate)) {
      checkDateAttendanceByDate.set(row.attendanceDate, {
        attendanceDate: row.attendanceDate,
        workedMinutes: row.workedMinutes,
        regularMinutes: row.regularMinutes,
        lateMinutes: row.lateMinutes,
        undertimeMinutes: row.undertimeMinutes,
      });
    }
  }
  const calendarHolidayTypeByDate = buildHolidayTypeByDate(holidayRows);
  const holidayCheckRequirementByDate =
    buildHolidayCheckRequirementByDate(holidayRows);
  const holidayAccountByType = buildHolidayAccountByType({
    accountRows,
    mappingRows: holidayMappingRows,
    accountCodeField: "accountCodeId",
    accountType: "Sunday/Holiday",
  });
  const restDayHolidayAccountByType = buildHolidayAccountByType({
    accountRows,
    mappingRows: holidayMappingRows,
    accountCodeField: "restDayAccountCodeId",
    accountType: "Sunday/Holiday",
  });
  const holidayOvertimeAccountByType = buildHolidayAccountByType({
    accountRows,
    mappingRows: holidayMappingRows,
    accountCodeField: "overtimeAccountCodeId",
    accountType: "Overtime",
  });
  const restDayHolidayOvertimeAccountByType = buildHolidayAccountByType({
    accountRows,
    mappingRows: holidayMappingRows,
    accountCodeField: "restDayOvertimeAccountCodeId",
    accountType: "Overtime",
  });
  const holidayWorkedRows = buildHolidayWorkedRowsForGeneratedDtr({
    rows: effectiveRows,
    manualDayTypeByDate,
    calendarHolidayTypeByDate,
    holidayCheckRequirementByDate,
    checkDateAttendanceByDate,
    holidayAccountByType,
    restDayHolidayAccountByType,
  });
  const holidayOvertimeRows = buildHolidayOvertimeRowsForGeneratedDtr({
    rows: effectiveRows,
    manualDayTypeByDate,
    calendarHolidayTypeByDate,
    holidayCheckRequirementByDate,
    checkDateAttendanceByDate,
    holidayOvertimeAccountByType,
    restDayHolidayOvertimeAccountByType,
  });
  const accountById = new Map(accountRows.map((row) => [row.id, row] as const));
  const branchCalendarOverrideRows =
    buildBranchCalendarOverrideRowsForGeneratedDtr({
      rows: effectiveRows,
      departmentId: employeeGeneralInfoRow?.departmentId ?? null,
      overrideMaps: buildBranchCalendarOverrideScopeMaps(branchOverrideRows),
      accountById,
      manualDayTypeByDate,
      calendarHolidayTypeByDate,
    });
  const generatedRows = buildGeneratedDtrExceptionRows({
    payrollPeriodId: args.payrollPeriodId,
    employeeId: args.employeeId,
    attendanceDate: args.attendanceDate,
    overrides: args.overrides,
    computed: args.computed,
    absentDays: args.absentDays,
    accountRows,
    holidayWorkedRows,
    holidayOvertimeRows,
    branchCalendarOverrideRows,
  });
  const insertedRows =
    generatedRows.length > 0
      ? await args.tx
          .insert(employeePayrollExceptionRows)
          .values(generatedRows)
          .returning({ id: employeePayrollExceptionRows.id })
      : [];

  return {
    generatedAccountCodeRowCount: generatedRows.length,
    refreshableExceptionRowIds: [...deletedRows, ...insertedRows].map((row) => row.id),
  } satisfies GeneratedDtrExceptionRowSyncResult;
}

async function syncGeneratedDtrWorkedExceptionRows(args: {
  tx: AttendanceTransaction;
  payrollPeriod: Pick<typeof payrollPeriods.$inferSelect, "id" | "startDate" | "endDate">;
  employeeIds: string[];
}) {
  const employeeIds = [...new Set(args.employeeIds)];
  if (employeeIds.length === 0) return EMPTY_GENERATED_DTR_EXCEPTION_ROW_SYNC;

  const summaryRows = await args.tx
    .select()
    .from(attendanceDailySummaries)
    .where(
      and(
        inArray(attendanceDailySummaries.employeeId, employeeIds),
        gte(attendanceDailySummaries.attendanceDate, args.payrollPeriod.startDate),
        lte(attendanceDailySummaries.attendanceDate, args.payrollPeriod.endDate)
      )
    );
  const periodOverrideRows = await args.tx
    .select()
    .from(employeeAttendancePeriodOverrides)
    .where(
      and(
        eq(employeeAttendancePeriodOverrides.payrollPeriodId, args.payrollPeriod.id),
        inArray(employeeAttendancePeriodOverrides.employeeId, employeeIds)
      )
    );
  const dayStatusOverrideRows = await args.tx
    .select()
    .from(employeeAttendanceDayStatusOverrides)
    .where(
      and(
        eq(employeeAttendanceDayStatusOverrides.payrollPeriodId, args.payrollPeriod.id),
        inArray(employeeAttendanceDayStatusOverrides.employeeId, employeeIds),
        gte(
          employeeAttendanceDayStatusOverrides.attendanceDate,
          args.payrollPeriod.startDate
        ),
        lte(
          employeeAttendanceDayStatusOverrides.attendanceDate,
          args.payrollPeriod.endDate
        )
      )
    );
  const dayTypeOverrideRows = await args.tx
    .select()
    .from(employeeAttendanceDayTypeOverrides)
    .where(
      and(
        eq(employeeAttendanceDayTypeOverrides.payrollPeriodId, args.payrollPeriod.id),
        inArray(employeeAttendanceDayTypeOverrides.employeeId, employeeIds),
        gte(
          employeeAttendanceDayTypeOverrides.attendanceDate,
          args.payrollPeriod.startDate
        ),
        lte(
          employeeAttendanceDayTypeOverrides.attendanceDate,
          args.payrollPeriod.endDate
        )
      )
    );
  const accountRows = await args.tx
    .select()
    .from(accountCode)
    .orderBy(asc(accountCode.accountCode), asc(accountCode.id));
  const holidayMappingRows = await args.tx.select().from(holidayTypeAccountCodes);
  const holidayRows = await fetchHolidayRowsForGeneratedDtr({
    tx: args.tx,
    startDate: args.payrollPeriod.startDate,
    endDate: args.payrollPeriod.endDate,
  });
  const branchOverrideRows = await args.tx
    .select()
    .from(branchCalendarAccountCodeOverrides)
    .where(
      and(
        gte(branchCalendarAccountCodeOverrides.attendanceDate, args.payrollPeriod.startDate),
        lte(branchCalendarAccountCodeOverrides.attendanceDate, args.payrollPeriod.endDate)
      )
    );
  const employeeDepartmentRows = await args.tx
    .select({
      employeeId: employeesGeneralInfo.employeeId,
      departmentId: employeesGeneralInfo.departmentId,
    })
    .from(employeesGeneralInfo)
    .where(inArray(employeesGeneralInfo.employeeId, employeeIds));
  const requiredHolidayCheckDates = getRequiredHolidayCheckDates(holidayRows);
  const checkDateSummaryRows =
    requiredHolidayCheckDates.length === 0
      ? []
      : await args.tx
          .select()
          .from(attendanceDailySummaries)
          .where(
            and(
              inArray(attendanceDailySummaries.employeeId, employeeIds),
              inArray(
                attendanceDailySummaries.attendanceDate,
                requiredHolidayCheckDates
              )
            )
          );
  const holidayAccountByType = buildHolidayAccountByType({
    accountRows,
    mappingRows: holidayMappingRows,
    accountCodeField: "accountCodeId",
    accountType: "Sunday/Holiday",
  });
  const holidayOvertimeAccountByType = buildHolidayAccountByType({
    accountRows,
    mappingRows: holidayMappingRows,
    accountCodeField: "overtimeAccountCodeId",
    accountType: "Overtime",
  });
  const restDayHolidayAccountByType = buildHolidayAccountByType({
    accountRows,
    mappingRows: holidayMappingRows,
    accountCodeField: "restDayAccountCodeId",
    accountType: "Sunday/Holiday",
  });
  const restDayHolidayOvertimeAccountByType = buildHolidayAccountByType({
    accountRows,
    mappingRows: holidayMappingRows,
    accountCodeField: "restDayOvertimeAccountCodeId",
    accountType: "Overtime",
  });
  const calendarHolidayTypeByDate = buildHolidayTypeByDate(holidayRows);
  const holidayCheckRequirementByDate =
    buildHolidayCheckRequirementByDate(holidayRows);
  const summaryRowsByEmployeeId = new Map<
    string,
    Array<typeof attendanceDailySummaries.$inferSelect>
  >();
  for (const row of summaryRows) {
    const rows = summaryRowsByEmployeeId.get(row.employeeId) ?? [];
    rows.push(row);
    summaryRowsByEmployeeId.set(row.employeeId, rows);
  }
  const checkDateSummaryRowsByEmployeeId = new Map<
    string,
    Array<typeof attendanceDailySummaries.$inferSelect>
  >();
  for (const row of checkDateSummaryRows) {
    const rows = checkDateSummaryRowsByEmployeeId.get(row.employeeId) ?? [];
    rows.push(row);
    checkDateSummaryRowsByEmployeeId.set(row.employeeId, rows);
  }
  const periodOverrideByEmployeeId = new Map(
    periodOverrideRows.map((row) => [row.employeeId, row])
  );
  const departmentIdByEmployeeId = new Map(
    employeeDepartmentRows.map((row) => [row.employeeId, row.departmentId] as const)
  );
  const accountById = new Map(accountRows.map((row) => [row.id, row] as const));
  const branchOverrideMaps =
    buildBranchCalendarOverrideScopeMaps(branchOverrideRows);
  const statusOverrideByEmployeeDate = new Map(
    dayStatusOverrideRows.map((override) => [
      `${override.employeeId}|${override.attendanceDate}`,
      override.status as AttendanceDtrManualStatus,
    ])
  );
  const dayTypeOverrideByEmployeeDate = new Map(
    dayTypeOverrideRows.map((override) => [
      `${override.employeeId}|${override.attendanceDate}`,
      override.dayType as AttendanceDtrDayType,
    ])
  );
  const generatedRows = employeeIds.flatMap((employeeId) => {
    const periodOverride = periodOverrideByEmployeeId.get(employeeId) ?? null;
    const effectiveRows = (summaryRowsByEmployeeId.get(employeeId) ?? []).map(
      (row) =>
        applyAttendanceDtrEffectiveStatus(
          row,
          statusOverrideByEmployeeDate.get(`${employeeId}|${row.attendanceDate}`) ??
            null
        )
    );
    const checkDateAttendanceByDate = buildCheckDateAttendanceByDate(
      checkDateSummaryRowsByEmployeeId.get(employeeId) ?? []
    );
    for (const row of effectiveRows) {
      if (requiredHolidayCheckDates.includes(row.attendanceDate)) {
        checkDateAttendanceByDate.set(row.attendanceDate, {
          attendanceDate: row.attendanceDate,
          workedMinutes: row.workedMinutes,
          regularMinutes: row.regularMinutes,
          lateMinutes: row.lateMinutes,
          undertimeMinutes: row.undertimeMinutes,
        });
      }
    }
    const totals = buildAttendanceDtrTotals(effectiveRows, periodOverride);
    const manualDayTypeByDate = new Map<string, AttendanceDtrDayType>();
    for (const row of effectiveRows) {
      const dayType = dayTypeOverrideByEmployeeDate.get(
        `${employeeId}|${row.attendanceDate}`
      );
      if (dayType) manualDayTypeByDate.set(row.attendanceDate, dayType);
    }
    const holidayWorkedRows = buildHolidayWorkedRowsForGeneratedDtr({
      rows: effectiveRows,
      manualDayTypeByDate,
      calendarHolidayTypeByDate,
      holidayCheckRequirementByDate,
      checkDateAttendanceByDate,
      holidayAccountByType,
      restDayHolidayAccountByType,
    });
    const holidayOvertimeRows = buildHolidayOvertimeRowsForGeneratedDtr({
      rows: effectiveRows,
      manualDayTypeByDate,
      calendarHolidayTypeByDate,
      holidayCheckRequirementByDate,
      checkDateAttendanceByDate,
      holidayOvertimeAccountByType,
      restDayHolidayOvertimeAccountByType,
    });
    const branchCalendarOverrideRows =
      buildBranchCalendarOverrideRowsForGeneratedDtr({
        rows: effectiveRows,
        departmentId: departmentIdByEmployeeId.get(employeeId) ?? null,
        overrideMaps: branchOverrideMaps,
        accountById,
        manualDayTypeByDate,
        calendarHolidayTypeByDate,
      });

    return buildGeneratedDtrExceptionRows({
      payrollPeriodId: args.payrollPeriod.id,
      employeeId,
      attendanceDate: args.payrollPeriod.startDate,
      overrides: totals.overrides,
      computed: totals.computed,
      absentDays: totals.absentDays,
      accountRows,
      holidayWorkedRows,
      holidayOvertimeRows,
      branchCalendarOverrideRows,
    });
  });

  const deletedRows = await args.tx
    .delete(employeePayrollExceptionRows)
    .where(
      and(
        eq(employeePayrollExceptionRows.payrollPeriodId, args.payrollPeriod.id),
        inArray(employeePayrollExceptionRows.employeeId, employeeIds),
        inArray(
          employeePayrollExceptionRows.dtrOverrideSource,
          GENERATED_DTR_OVERRIDE_SOURCES
        )
      )
    )
    .returning({ id: employeePayrollExceptionRows.id });
  const insertedRows =
    generatedRows.length > 0
      ? await args.tx
          .insert(employeePayrollExceptionRows)
          .values(generatedRows)
          .returning({ id: employeePayrollExceptionRows.id })
      : [];

  return {
    generatedAccountCodeRowCount: generatedRows.length,
    refreshableExceptionRowIds: [...deletedRows, ...insertedRows].map((row) => row.id),
  } satisfies GeneratedDtrExceptionRowSyncResult;
}

function getDtrTotalsForEmployee(
  sourceData: AttendancePeriodPersistedSummarySourceData,
  employeeId: string
): Pick<AttendanceDtrTotalsView, "computed" | "absentDays"> {
  const employee = buildAttendanceDtrEmployeesFromPersistedSummaries(
    sourceData
  ).find((item) => item.employeeId === employeeId);
  if (employee) {
    return {
      computed: employee.totals.computed,
      absentDays: employee.totals.absentDays,
    };
  }

  const periodOverride =
    sourceData.periodOverrides.find((row) => row.employeeId === employeeId) ?? null;
  const totals = buildAttendanceDtrTotals([], periodOverride);
  return {
    computed: totals.computed,
    absentDays: totals.absentDays,
  };
}

async function refreshManualPayrollAttendanceForEmployees(args: {
  actorUserId: string;
  payrollPeriodId: string;
  employeeIds: string[];
  refreshableExceptionRowIds?: string[];
}) {
  const employeeIds = [...new Set(args.employeeIds)];
  let refreshedEntryCount = 0;

  for (const employeeId of employeeIds) {
    const latestManualBaseline = await computeManualPayrollLatestBaseline(
      args.payrollPeriodId,
      employeeId
    );
    const manualPayrollRefresh =
      await refreshManualPayrollAttendanceLinesFromBaseline({
        actorUserId: args.actorUserId,
        payrollPeriodId: args.payrollPeriodId,
        employeeId,
        latestBaseline: latestManualBaseline,
        refreshableExceptionRowIds: args.refreshableExceptionRowIds,
      });

    if (manualPayrollRefresh.refreshed) {
      refreshedEntryCount += 1;
    }
  }

  return { refreshedEntryCount };
}

export async function refreshGeneratedDtrRowsForBranchCalendarAccountCodeOverride(args: {
  actorUserId: string;
  attendanceDate: string;
  departmentId?: number | null;
}) {
  const refreshTasks: Array<{
    payrollPeriodId: string;
    employeeIds: string[];
    refreshableExceptionRowIds: string[];
  }> = [];

  const result = await db.transaction(async (tx) => {
    const periods = await tx
      .select()
      .from(payrollPeriods)
      .where(
        and(
          eq(payrollPeriods.status, "Open"),
          lte(payrollPeriods.startDate, args.attendanceDate),
          gte(payrollPeriods.endDate, args.attendanceDate)
        )
      );

    let generatedAccountCodeRowCount = 0;
    let staleRunCount = 0;
    let affectedEmployeeCount = 0;

    for (const payrollPeriod of periods) {
      const employeeRows =
        args.departmentId != null
          ? await tx
              .select({ employeeId: attendanceDailySummaries.employeeId })
              .from(attendanceDailySummaries)
              .innerJoin(
                employeesGeneralInfo,
                eq(attendanceDailySummaries.employeeId, employeesGeneralInfo.employeeId)
              )
              .where(
                and(
                  eq(attendanceDailySummaries.attendanceDate, args.attendanceDate),
                  eq(employeesGeneralInfo.departmentId, args.departmentId)
                )
              )
          : await tx
              .select({ employeeId: attendanceDailySummaries.employeeId })
              .from(attendanceDailySummaries)
              .where(eq(attendanceDailySummaries.attendanceDate, args.attendanceDate));
      const employeeIds = [
        ...new Set(employeeRows.map((row) => row.employeeId)),
      ];

      if (employeeIds.length === 0) continue;

      staleRunCount += await markPayrollPeriodRunsStale({
        tx,
        payrollPeriodId: payrollPeriod.id,
        payrollPeriodCode: payrollPeriod.code,
        actorUserId: args.actorUserId,
        notes:
          "Marked stale because Branch Calendar day account-code settings changed.",
      });

      const generatedDtrRows = await syncGeneratedDtrWorkedExceptionRows({
        tx,
        payrollPeriod,
        employeeIds,
      });

      generatedAccountCodeRowCount +=
        generatedDtrRows.generatedAccountCodeRowCount;
      affectedEmployeeCount += employeeIds.length;
      refreshTasks.push({
        payrollPeriodId: payrollPeriod.id,
        employeeIds,
        refreshableExceptionRowIds:
          generatedDtrRows.refreshableExceptionRowIds,
      });
    }

    return {
      affectedPayrollPeriodCount: periods.length,
      affectedEmployeeCount,
      generatedAccountCodeRowCount,
      staleRunCount,
    };
  });

  let refreshedEntryCount = 0;
  for (const task of refreshTasks) {
    const refreshResult = await refreshManualPayrollAttendanceForEmployees({
      actorUserId: args.actorUserId,
      payrollPeriodId: task.payrollPeriodId,
      employeeIds: task.employeeIds,
      refreshableExceptionRowIds: task.refreshableExceptionRowIds,
    });
    refreshedEntryCount += refreshResult.refreshedEntryCount;
  }

  return {
    ...result,
    refreshedEntryCount,
  };
}

export async function refreshGeneratedDtrRowsForHolidayCalendarChange(args: {
  actorUserId: string;
  startDate: string;
  endDate: string;
}) {
  const refreshTasks: Array<{
    payrollPeriodId: string;
    employeeIds: string[];
    refreshableExceptionRowIds: string[];
  }> = [];

  const result = await db.transaction(async (tx) => {
    const periods = await tx
      .select()
      .from(payrollPeriods)
      .where(
        and(
          eq(payrollPeriods.status, "Open"),
          lte(payrollPeriods.startDate, args.endDate),
          gte(payrollPeriods.endDate, args.startDate)
        )
      );

    let generatedAccountCodeRowCount = 0;
    let staleRunCount = 0;
    let affectedEmployeeCount = 0;

    for (const payrollPeriod of periods) {
      const employeeRows = await tx
        .select({ employeeId: attendanceDailySummaries.employeeId })
        .from(attendanceDailySummaries)
        .where(
          and(
            gte(attendanceDailySummaries.attendanceDate, payrollPeriod.startDate),
            lte(attendanceDailySummaries.attendanceDate, payrollPeriod.endDate)
          )
        );
      const employeeIds = [
        ...new Set(employeeRows.map((row) => row.employeeId)),
      ];

      if (employeeIds.length === 0) continue;

      staleRunCount += await markPayrollPeriodRunsStale({
        tx,
        payrollPeriodId: payrollPeriod.id,
        payrollPeriodCode: payrollPeriod.code,
        actorUserId: args.actorUserId,
        notes: "Marked stale because holiday check-date settings changed.",
      });

      const generatedDtrRows = await syncGeneratedDtrWorkedExceptionRows({
        tx,
        payrollPeriod,
        employeeIds,
      });

      generatedAccountCodeRowCount +=
        generatedDtrRows.generatedAccountCodeRowCount;
      affectedEmployeeCount += employeeIds.length;
      refreshTasks.push({
        payrollPeriodId: payrollPeriod.id,
        employeeIds,
        refreshableExceptionRowIds:
          generatedDtrRows.refreshableExceptionRowIds,
      });
    }

    return {
      affectedPayrollPeriodCount: periods.length,
      affectedEmployeeCount,
      generatedAccountCodeRowCount,
      staleRunCount,
    };
  });

  let refreshedEntryCount = 0;
  for (const task of refreshTasks) {
    const refreshResult = await refreshManualPayrollAttendanceForEmployees({
      actorUserId: args.actorUserId,
      payrollPeriodId: task.payrollPeriodId,
      employeeIds: task.employeeIds,
      refreshableExceptionRowIds: task.refreshableExceptionRowIds,
    });
    refreshedEntryCount += refreshResult.refreshedEntryCount;
  }

  return {
    ...result,
    refreshedEntryCount,
  };
}

function addAttendanceHoldMinutes(
  left: AttendanceHoldApprovalMinutes,
  right: AttendanceHoldApprovalMinutes
): AttendanceHoldApprovalMinutes {
  return {
    workedMinutes: left.workedMinutes + right.workedMinutes,
    lateMinutes: left.lateMinutes + right.lateMinutes,
    undertimeMinutes: left.undertimeMinutes + right.undertimeMinutes,
    overtimeMinutes: left.overtimeMinutes + right.overtimeMinutes,
  };
}

function splitAttendanceHoldMinutesAcrossDates(
  total: number,
  count: number
): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, index) =>
    base + (index < remainder ? 1 : 0)
  );
}

function splitAttendanceHoldApprovalMinutes(
  totals: AttendanceHoldApprovalMinutes,
  dates: string[]
) {
  const worked = splitAttendanceHoldMinutesAcrossDates(
    totals.workedMinutes,
    dates.length
  );
  const late = splitAttendanceHoldMinutesAcrossDates(
    totals.lateMinutes,
    dates.length
  );
  const undertime = splitAttendanceHoldMinutesAcrossDates(
    totals.undertimeMinutes,
    dates.length
  );
  const overtime = splitAttendanceHoldMinutesAcrossDates(
    totals.overtimeMinutes,
    dates.length
  );

  return dates.map((attendanceDate, index) => ({
    attendanceDate,
    workedMinutes: worked[index] ?? 0,
    lateMinutes: late[index] ?? 0,
    undertimeMinutes: undertime[index] ?? 0,
    overtimeMinutes: overtime[index] ?? 0,
  }));
}

async function rebuildHeldDtrExceptionRowsForTargetPeriod(args: {
  tx: AttendanceTransaction;
  actorUserId: string;
  targetPayrollPeriodId: string;
  employeeId: string;
}) {
  const payrollPeriod = await args.tx.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, args.targetPayrollPeriodId),
  });

  if (!payrollPeriod) {
    throw new Error("Target payroll period not found.");
  }

  const approvalRows = await args.tx
    .select()
    .from(attendanceDtrHoldApprovals)
    .where(
      and(
        eq(attendanceDtrHoldApprovals.targetPayrollPeriodId, args.targetPayrollPeriodId),
        eq(attendanceDtrHoldApprovals.employeeId, args.employeeId),
        eq(attendanceDtrHoldApprovals.status, "Approved")
      )
    );
  const totals = approvalRows.reduce<AttendanceHoldApprovalMinutes>(
    (current, approval) =>
      addAttendanceHoldMinutes(current, {
        workedMinutes: approval.workedMinutes,
        lateMinutes: approval.lateMinutes,
        undertimeMinutes: approval.undertimeMinutes,
        overtimeMinutes: approval.overtimeMinutes,
      }),
    {
      workedMinutes: 0,
      lateMinutes: 0,
      undertimeMinutes: 0,
      overtimeMinutes: 0,
    }
  );
  const accountBySource = await ensureHeldDtrAccountCodes(args.tx);
  const heldRows: GeneratedDtrExceptionRowInsert[] = [];

  if (totals.workedMinutes > 0) {
    heldRows.push(
      createHeldDtrExceptionRow({
        payrollPeriodId: args.targetPayrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: payrollPeriod.startDate,
        source: "DTR_HOLD_WORKED",
        account: accountBySource.get("DTR_HOLD_WORKED")!,
        quantityMinutes: totals.workedMinutes,
      })
    );
  }

  if (totals.lateMinutes > 0) {
    heldRows.push(
      createHeldDtrExceptionRow({
        payrollPeriodId: args.targetPayrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: payrollPeriod.startDate,
        source: "DTR_HOLD_TARDINESS",
        account: accountBySource.get("DTR_HOLD_TARDINESS")!,
        quantityMinutes: totals.lateMinutes,
      })
    );
  }

  if (totals.undertimeMinutes > 0) {
    heldRows.push(
      createHeldDtrExceptionRow({
        payrollPeriodId: args.targetPayrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: payrollPeriod.startDate,
        source: "DTR_HOLD_UNDERTIME",
        account: accountBySource.get("DTR_HOLD_UNDERTIME")!,
        quantityMinutes: totals.undertimeMinutes,
      })
    );
  }

  if (totals.overtimeMinutes > 0) {
    heldRows.push(
      createHeldDtrExceptionRow({
        payrollPeriodId: args.targetPayrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: payrollPeriod.startDate,
        source: "DTR_HOLD_REGULAR_OVERTIME",
        account: accountBySource.get("DTR_HOLD_REGULAR_OVERTIME")!,
        quantityMinutes: totals.overtimeMinutes,
      })
    );
  }

  const deletedRows = await args.tx
    .delete(employeePayrollExceptionRows)
    .where(
      and(
        eq(employeePayrollExceptionRows.payrollPeriodId, args.targetPayrollPeriodId),
        eq(employeePayrollExceptionRows.employeeId, args.employeeId),
        inArray(
          employeePayrollExceptionRows.dtrOverrideSource,
          [...HELD_DTR_OVERRIDE_SOURCES]
        )
      )
    )
    .returning({ id: employeePayrollExceptionRows.id });
  const insertedRows =
    heldRows.length > 0
      ? await args.tx
          .insert(employeePayrollExceptionRows)
          .values(heldRows)
          .returning({ id: employeePayrollExceptionRows.id })
      : [];
  const staleRunCount =
    deletedRows.length > 0 || insertedRows.length > 0
      ? await markPayrollPeriodRunsStale({
          tx: args.tx,
          payrollPeriodId: payrollPeriod.id,
          payrollPeriodCode: payrollPeriod.code,
          actorUserId: args.actorUserId,
          notes:
            "Marked stale because approved Attendance Hold account-code rows changed.",
        })
      : 0;

  return {
    payrollPeriod,
    totals,
    staleRunCount,
    refreshableExceptionRowIds: [...deletedRows, ...insertedRows].map(
      (row) => row.id
    ),
    generatedAccountCodeRowCount: insertedRows.length,
  };
}

export async function reviewAttendanceDtrCorrectionsAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = attendanceDtrCorrectionReviewSchema.parse(input);
  const payrollPeriod = await db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, parsed.payrollPeriodId),
  });

  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  const result = await db.transaction(async (tx) => {
    const correctionRows = await tx
      .select()
      .from(attendanceDtrCorrections)
      .where(
        and(
          eq(attendanceDtrCorrections.payrollPeriodId, parsed.payrollPeriodId),
          inArray(attendanceDtrCorrections.id, parsed.correctionIds)
        )
      );

    if (correctionRows.length === 0) {
      throw new Error("No DTR correction suggestions were found.");
    }

    const reviewedAt = new Date();
    await tx
      .update(attendanceDtrCorrections)
      .set({
        status: parsed.status,
        reviewedByUserId: actor.userId,
        reviewedAt,
        updatedAt: reviewedAt,
      })
      .where(
        and(
          eq(attendanceDtrCorrections.payrollPeriodId, parsed.payrollPeriodId),
          inArray(attendanceDtrCorrections.id, correctionRows.map((row) => row.id))
        )
      );

    const affectedEmployeeIds = [
      ...new Set(correctionRows.map((row) => row.employeeId)),
    ];
    let summaryCount = 0;
    let staleRunCount = 0;
    let generatedDtrRows = EMPTY_GENERATED_DTR_EXCEPTION_ROW_SYNC;

    if (parsed.status === "Approved") {
      const sourceData = await loadAttendancePeriodSourceData(
        tx,
        parsed.payrollPeriodId
      );
      const affectedEmployeeSet = new Set(affectedEmployeeIds);
      const affectedEmployeeRecords = sourceData.employeeRecords.filter((employee) =>
        affectedEmployeeSet.has(employee.id)
      );
      const resolvedApprovedLeaves = await resolveApprovedLeaveFlags(
        sourceData.approvedLeaves,
        tx
      );
      const summaryComputations = buildAttendanceSummaryComputations({
        employees: affectedEmployeeRecords.map((employee) => ({
          id: employee.id,
          employeeNo: employee.employeeNo,
          timekeeping: employee.timekeeping ?? null,
        })),
        logs: mapAttendanceRawRowsToParsedLogs(sourceData.rawLogs),
        approvedLeaves: resolvedApprovedLeaves,
        shiftAssignments: sourceData.shiftAssignments,
        weeklyPatterns: sourceData.weeklyPatterns,
        shiftTableBreaksByShiftTableId: sourceData.shiftTableBreaksByShiftTableId,
        approvedCorrections: mapApprovedCorrectionRows(
          sourceData.approvedCorrections
        ),
        allowedAttendanceDateRange: {
          startDate: payrollPeriod.startDate,
          endDate: payrollPeriod.endDate,
        },
      });
      summaryCount = summaryComputations.length;

      staleRunCount = await markPayrollPeriodRunsStale({
        tx,
        payrollPeriodId: payrollPeriod.id,
        payrollPeriodCode: payrollPeriod.code,
        actorUserId: actor.userId,
        notes: "Marked stale because approved DTR correction suggestions changed attendance summaries.",
      });

      await tx
        .delete(attendanceDailySummaries)
        .where(
          and(
            inArray(attendanceDailySummaries.employeeId, affectedEmployeeIds),
            gte(attendanceDailySummaries.attendanceDate, payrollPeriod.startDate),
            lte(attendanceDailySummaries.attendanceDate, payrollPeriod.endDate)
          )
        );

      for (const rows of chunk(summaryComputations, 200)) {
        if (rows.length === 0) continue;
        await tx.insert(attendanceDailySummaries).values(rows);
      }

      generatedDtrRows = await syncGeneratedDtrWorkedExceptionRows({
        tx,
        payrollPeriod,
        employeeIds: affectedEmployeeIds,
      });
    }

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "attendance_dtr_corrections",
      entityId: parsed.payrollPeriodId,
      action:
        parsed.status === "Approved"
          ? "attendance.dtr_corrections.approved"
          : "attendance.dtr_corrections.rejected",
      details: {
        payrollPeriodId: parsed.payrollPeriodId,
        payrollPeriodCode: payrollPeriod.code,
        correctionIds: correctionRows.map((row) => row.id),
        correctionCount: correctionRows.length,
        affectedEmployeeIds,
        summaryCount,
        generatedAccountCodeRowCount:
          generatedDtrRows.generatedAccountCodeRowCount,
        staleRunCount,
      },
      database: tx,
    });

    return {
      payrollPeriodCode: payrollPeriod.code,
      reviewedCount: correctionRows.length,
      affectedEmployeeIds,
      summaryCount,
      staleRunCount,
      ...generatedDtrRows,
    };
  });

  if (parsed.status === "Approved") {
    await refreshManualPayrollAttendanceForEmployees({
      actorUserId: actor.userId,
      payrollPeriodId: parsed.payrollPeriodId,
      employeeIds: result.affectedEmployeeIds,
      refreshableExceptionRowIds: result.refreshableExceptionRowIds,
    });
  }

  revalidatePath("/payroll");
  return result;
}

async function getPayrollExceptionWorkspaceForEmployee(args: {
  payrollPeriodId: string;
  employeeId: string;
}): Promise<PayrollExceptionWorkspaceView> {
  const [rows, recurringRows, loanRows, accountCodeOptions] = await Promise.all([
    getEmployeePayrollExceptionRows({
      payrollPeriodId: args.payrollPeriodId,
      employeeId: args.employeeId,
    }),
    getEmployeePayrollRecurringEntryRows({
      payrollPeriodId: args.payrollPeriodId,
      employeeId: args.employeeId,
    }),
    getEmployeePayrollScheduledLoanRows({
      payrollPeriodId: args.payrollPeriodId,
      employeeId: args.employeeId,
    }),
    getPayrollExceptionAccountCodeOptions(),
  ]);

  return {
    rows,
    recurringRows,
    loanRows,
    accountCodeOptions,
  };
}

const attendanceDtrDayStatusOverrideSchema = z.object({
  payrollPeriodId: z.string().uuid(),
  employeeId: z.string().uuid(),
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(attendanceDtrManualStatusValues).nullable().optional(),
});

const attendanceDtrDayStatusOverridesSchema = z.object({
  payrollPeriodId: z.string().uuid(),
  employeeId: z.string().uuid(),
  changes: z
    .array(
      z.object({
        attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        status: z.enum(attendanceDtrManualStatusValues).nullable().optional(),
      })
    )
    .min(1),
});

const attendanceDtrDayOverridesSchema = z.object({
  payrollPeriodId: z.string().uuid(),
  employeeId: z.string().uuid(),
  changes: z
    .array(
      z.object({
        attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        status: z.enum(attendanceDtrManualStatusValues).nullable().optional(),
        dayType: z.enum(attendanceDtrDayTypeValues).nullable().optional(),
      })
    )
    .min(1),
});

export async function saveAttendanceDtrPeriodOverrideAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = attendanceDtrPeriodOverrideSchema.parse(input);
  const sourceData = await loadAttendancePeriodPersistedSummarySourceData(
    db,
    parsed.payrollPeriodId,
    parsed.employeeId
  );
  const payrollPeriod = sourceData.payrollPeriod;
  const dtrTotals = getDtrTotalsForEmployee(sourceData, parsed.employeeId);

  const overrides = {
    presentDays: parsed.presentDays ?? null,
    workedMinutes: parsed.workedMinutes ?? null,
    lateMinutes: parsed.lateMinutes ?? null,
    undertimeMinutes: parsed.undertimeMinutes ?? null,
    overtimeMinutes: parsed.overtimeMinutes ?? null,
  };
  const isClearing = Object.values(overrides).every((value) => value == null);

  const result = await db.transaction(async (tx) => {
    const staleRunCount = await markPayrollPeriodRunsStale({
      tx,
      payrollPeriodId: payrollPeriod.id,
      payrollPeriodCode: payrollPeriod.code,
      actorUserId: actor.userId,
      notes: "Marked stale because semimonthly DTR period overrides changed.",
    });

    if (isClearing) {
      await tx
        .delete(employeeAttendancePeriodOverrides)
        .where(
          and(
            eq(employeeAttendancePeriodOverrides.payrollPeriodId, parsed.payrollPeriodId),
            eq(employeeAttendancePeriodOverrides.employeeId, parsed.employeeId)
          )
        );
    } else {
      await tx
        .insert(employeeAttendancePeriodOverrides)
        .values({
          payrollPeriodId: parsed.payrollPeriodId,
          employeeId: parsed.employeeId,
          presentDays:
            overrides.presentDays != null ? String(overrides.presentDays) : null,
          workedMinutes: overrides.workedMinutes,
          lateMinutes: overrides.lateMinutes,
          undertimeMinutes: overrides.undertimeMinutes,
          overtimeMinutes: overrides.overtimeMinutes,
        })
        .onConflictDoUpdate({
          target: [
            employeeAttendancePeriodOverrides.payrollPeriodId,
            employeeAttendancePeriodOverrides.employeeId,
          ],
          set: {
            presentDays:
              overrides.presentDays != null ? String(overrides.presentDays) : null,
            workedMinutes: overrides.workedMinutes,
            lateMinutes: overrides.lateMinutes,
            undertimeMinutes: overrides.undertimeMinutes,
            overtimeMinutes: overrides.overtimeMinutes,
            updatedAt: new Date(),
          },
        });
    }

    const generatedDtrRows = await replaceGeneratedDtrExceptionRowsForEmployee({
      tx,
      payrollPeriodId: parsed.payrollPeriodId,
      employeeId: parsed.employeeId,
      attendanceDate: payrollPeriod.startDate,
      overrides,
      computed: dtrTotals.computed,
      absentDays: dtrTotals.absentDays,
    });

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "employee_attendance_period_override",
      entityId: `${parsed.payrollPeriodId}:${parsed.employeeId}`,
      action: isClearing
        ? "attendance.dtr_period_override.cleared"
        : "attendance.dtr_period_override.updated",
      details: {
        payrollPeriodId: parsed.payrollPeriodId,
        payrollPeriodCode: payrollPeriod.code,
        employeeId: parsed.employeeId,
        overrides,
        generatedAccountCodeRowCount:
          generatedDtrRows.generatedAccountCodeRowCount,
        staleRunCount,
      },
      database: tx,
    });

    return {
      ...generatedDtrRows,
      staleRunCount,
    };
  });
  const latestManualBaseline = await computeManualPayrollLatestBaseline(
    parsed.payrollPeriodId,
    parsed.employeeId
  );
  const manualPayrollRefresh =
    await refreshManualPayrollAttendanceLinesFromBaseline({
      actorUserId: actor.userId,
      payrollPeriodId: parsed.payrollPeriodId,
      employeeId: parsed.employeeId,
      latestBaseline: latestManualBaseline,
      refreshableExceptionRowIds: result.refreshableExceptionRowIds,
    });
  const resultForReturn = {
    staleRunCount: result.staleRunCount,
  };

  return {
    payrollPeriodCode: payrollPeriod.code,
    manualPayrollRefresh,
    ...resultForReturn,
  };
}

export async function saveAttendanceDtrPeriodOverridesWithAccountCodesAction(
  input: unknown
) {
  const actor = await requireAdminActor();
  const parsed = attendanceDtrPeriodOverrideSchema.parse(input);
  const sourceData = await loadAttendancePeriodPersistedSummarySourceData(
    db,
    parsed.payrollPeriodId,
    parsed.employeeId
  );
  const payrollPeriod = sourceData.payrollPeriod;
  const employee = buildAttendanceDtrEmployeesFromPersistedSummaries(
    sourceData
  ).find((item) => item.employeeId === parsed.employeeId);

  if (!employee) {
    throw new Error("Employee DTR summary not found.");
  }

  const overrides: DtrPeriodOverrideValues = {
    presentDays: parsed.presentDays ?? null,
    workedMinutes: parsed.workedMinutes ?? null,
    lateMinutes: parsed.lateMinutes ?? null,
    undertimeMinutes: parsed.undertimeMinutes ?? null,
    overtimeMinutes: parsed.overtimeMinutes ?? null,
  };
  const isClearing = Object.values(overrides).every((value) => value == null);

  const result = await db.transaction(async (tx) => {
    const staleRunCount = await markPayrollPeriodRunsStale({
      tx,
      payrollPeriodId: payrollPeriod.id,
      payrollPeriodCode: payrollPeriod.code,
      actorUserId: actor.userId,
      notes:
        "Marked stale because semimonthly DTR period overrides and generated account-code rows changed.",
    });

    if (isClearing) {
      await tx
        .delete(employeeAttendancePeriodOverrides)
        .where(
          and(
            eq(
              employeeAttendancePeriodOverrides.payrollPeriodId,
              parsed.payrollPeriodId
            ),
            eq(employeeAttendancePeriodOverrides.employeeId, parsed.employeeId)
          )
        );
    } else {
      await tx
        .insert(employeeAttendancePeriodOverrides)
        .values({
          payrollPeriodId: parsed.payrollPeriodId,
          employeeId: parsed.employeeId,
          presentDays:
            overrides.presentDays != null ? String(overrides.presentDays) : null,
          workedMinutes: overrides.workedMinutes,
          lateMinutes: overrides.lateMinutes,
          undertimeMinutes: overrides.undertimeMinutes,
          overtimeMinutes: overrides.overtimeMinutes,
        })
        .onConflictDoUpdate({
          target: [
            employeeAttendancePeriodOverrides.payrollPeriodId,
            employeeAttendancePeriodOverrides.employeeId,
          ],
          set: {
            presentDays:
              overrides.presentDays != null
                ? String(overrides.presentDays)
                : null,
            workedMinutes: overrides.workedMinutes,
            lateMinutes: overrides.lateMinutes,
            undertimeMinutes: overrides.undertimeMinutes,
            overtimeMinutes: overrides.overtimeMinutes,
            updatedAt: new Date(),
          },
        });
    }

    const generatedDtrRows = await replaceGeneratedDtrExceptionRowsForEmployee({
      tx,
      payrollPeriodId: parsed.payrollPeriodId,
      employeeId: parsed.employeeId,
      attendanceDate: payrollPeriod.startDate,
      overrides,
      computed: employee.totals.computed,
      absentDays: employee.totals.absentDays,
    });

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "employee_attendance_period_override",
      entityId: `${parsed.payrollPeriodId}:${parsed.employeeId}`,
      action: isClearing
        ? "attendance.dtr_period_override.cleared_with_account_codes"
        : "attendance.dtr_period_override.updated_with_account_codes",
      details: {
        payrollPeriodId: parsed.payrollPeriodId,
        payrollPeriodCode: payrollPeriod.code,
        employeeId: parsed.employeeId,
        overrides,
        generatedAccountCodeRowCount:
          generatedDtrRows.generatedAccountCodeRowCount,
        staleRunCount,
      },
      database: tx,
    });

    return {
      ...generatedDtrRows,
      staleRunCount,
    };
  });

  const latestManualBaseline = await computeManualPayrollLatestBaseline(
    parsed.payrollPeriodId,
    parsed.employeeId
  );
  const manualPayrollRefresh =
    await refreshManualPayrollAttendanceLinesFromBaseline({
      actorUserId: actor.userId,
      payrollPeriodId: parsed.payrollPeriodId,
      employeeId: parsed.employeeId,
      latestBaseline: latestManualBaseline,
      refreshableExceptionRowIds: result.refreshableExceptionRowIds,
    });
  const [rows, recurringRows, loanRows, accountCodeOptions] = await Promise.all([
    getEmployeePayrollExceptionRows({
      payrollPeriodId: parsed.payrollPeriodId,
      employeeId: parsed.employeeId,
    }),
    getEmployeePayrollRecurringEntryRows({
      payrollPeriodId: parsed.payrollPeriodId,
      employeeId: parsed.employeeId,
    }),
    getEmployeePayrollScheduledLoanRows({
      payrollPeriodId: parsed.payrollPeriodId,
      employeeId: parsed.employeeId,
    }),
    getPayrollExceptionAccountCodeOptions(),
  ]);
  const payrollExceptionWorkspace: PayrollExceptionWorkspaceView = {
    rows,
    recurringRows,
    loanRows,
    accountCodeOptions,
  };

  const resultForReturn = {
    generatedAccountCodeRowCount: result.generatedAccountCodeRowCount,
    staleRunCount: result.staleRunCount,
  };

  return {
    payrollPeriodCode: payrollPeriod.code,
    manualPayrollRefresh,
    payrollExceptionWorkspace,
    ...resultForReturn,
  };
}

export async function approveAttendanceDtrHoldRowsAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = attendanceDtrHoldApprovalSchema.parse(input);
  const attendanceDates = [...new Set(parsed.attendanceDates)].sort((left, right) =>
    left.localeCompare(right)
  );
  const approvalTotals: AttendanceHoldApprovalMinutes = {
    workedMinutes: parsed.workedMinutes,
    lateMinutes: parsed.lateMinutes,
    undertimeMinutes: parsed.undertimeMinutes,
    overtimeMinutes: parsed.overtimeMinutes,
  };

  const result = await db.transaction(async (tx) => {
    const [sourcePeriod, targetPeriod] = await Promise.all([
      tx.query.payrollPeriods.findFirst({
        where: eq(payrollPeriods.id, parsed.sourcePayrollPeriodId),
      }),
      tx.query.payrollPeriods.findFirst({
        where: eq(payrollPeriods.id, parsed.targetPayrollPeriodId),
      }),
    ]);

    if (!sourcePeriod) throw new Error("Source payroll period not found.");
    if (!targetPeriod) throw new Error("Target payroll period not found.");

    const outsideSourcePeriod = attendanceDates.find(
      (attendanceDate) =>
        attendanceDate < sourcePeriod.startDate ||
        attendanceDate > sourcePeriod.endDate
    );
    if (outsideSourcePeriod) {
      throw new Error("One or more held dates are outside the source payroll period.");
    }

    const [manualRows, summaryRows, previousApprovals] = await Promise.all([
      tx
        .select({
          attendanceDate: employeeAttendanceDayStatusOverrides.attendanceDate,
        })
        .from(employeeAttendanceDayStatusOverrides)
        .where(
          and(
            eq(
              employeeAttendanceDayStatusOverrides.payrollPeriodId,
              parsed.sourcePayrollPeriodId
            ),
            eq(employeeAttendanceDayStatusOverrides.employeeId, parsed.employeeId),
            eq(employeeAttendanceDayStatusOverrides.status, "Hold"),
            inArray(employeeAttendanceDayStatusOverrides.attendanceDate, attendanceDates)
          )
        ),
      tx
        .select()
        .from(attendanceDailySummaries)
        .where(
          and(
            eq(attendanceDailySummaries.employeeId, parsed.employeeId),
            inArray(attendanceDailySummaries.attendanceDate, attendanceDates)
          )
        ),
      tx
        .select()
        .from(attendanceDtrHoldApprovals)
        .where(
          and(
            eq(
              attendanceDtrHoldApprovals.sourcePayrollPeriodId,
              parsed.sourcePayrollPeriodId
            ),
            eq(attendanceDtrHoldApprovals.employeeId, parsed.employeeId),
            inArray(attendanceDtrHoldApprovals.attendanceDate, attendanceDates)
          )
        ),
    ]);

    const manualHeldDates = new Set(
      manualRows.map((row) => row.attendanceDate)
    );
    const autoHeldDates = new Set(
      summaryRows
        .filter((summary) => {
          const flags = normalizeAttendanceDtrAnomalyFlags(
            summary.anomalyFlags ?? null
          );
          const hasHoldFlag =
            flags.includes("ODD_PUNCH_COUNT") || flags.includes("MISSING_OUT");
          return hasHoldFlag && !flags.includes("DOUBLE_PUNCH");
        })
        .map((summary) => summary.attendanceDate)
    );

    const nonHeldDate = attendanceDates.find(
      (attendanceDate) =>
        !manualHeldDates.has(attendanceDate) && !autoHeldDates.has(attendanceDate)
    );
    if (nonHeldDate) {
      throw new Error("One or more selected dates are no longer held.");
    }

    const affectedTargetPeriods = new Map<
      string,
      {
        payrollPeriodCode: string;
        refreshableExceptionRowIds: string[];
        generatedAccountCodeRowCount: number;
        staleRunCount: number;
      }
    >();
    const affectedTargetPeriodIds = new Set([
      ...previousApprovals.map((approval) => approval.targetPayrollPeriodId),
      parsed.targetPayrollPeriodId,
    ]);

    const approvedAt = new Date();
    const splitApprovals = splitAttendanceHoldApprovalMinutes(
      approvalTotals,
      attendanceDates
    );
    await tx
      .insert(attendanceDtrHoldApprovals)
      .values(
        splitApprovals.map((approval) => ({
          sourcePayrollPeriodId: parsed.sourcePayrollPeriodId,
          targetPayrollPeriodId: parsed.targetPayrollPeriodId,
          employeeId: parsed.employeeId,
          attendanceDate: approval.attendanceDate,
          status: "Approved",
          workedMinutes: approval.workedMinutes,
          lateMinutes: approval.lateMinutes,
          undertimeMinutes: approval.undertimeMinutes,
          overtimeMinutes: approval.overtimeMinutes,
          notes: parsed.notes ?? null,
          approvedByUserId: actor.userId,
          approvedAt,
        }))
      )
      .onConflictDoUpdate({
        target: [
          attendanceDtrHoldApprovals.sourcePayrollPeriodId,
          attendanceDtrHoldApprovals.employeeId,
          attendanceDtrHoldApprovals.attendanceDate,
        ],
        set: {
          targetPayrollPeriodId: sql`excluded.target_payroll_period_id`,
          status: sql`excluded.status`,
          workedMinutes: sql`excluded.worked_minutes`,
          lateMinutes: sql`excluded.late_minutes`,
          undertimeMinutes: sql`excluded.undertime_minutes`,
          overtimeMinutes: sql`excluded.overtime_minutes`,
          notes: sql`excluded.notes`,
          approvedByUserId: sql`excluded.approved_by_user_id`,
          approvedAt: sql`excluded.approved_at`,
          updatedAt: new Date(),
        },
      });

    for (const targetPayrollPeriodId of affectedTargetPeriodIds) {
      const rebuilt = await rebuildHeldDtrExceptionRowsForTargetPeriod({
        tx,
        actorUserId: actor.userId,
        targetPayrollPeriodId,
        employeeId: parsed.employeeId,
      });
      if (
        rebuilt.refreshableExceptionRowIds.length === 0 &&
        rebuilt.generatedAccountCodeRowCount === 0 &&
        rebuilt.staleRunCount === 0
      ) {
        continue;
      }
      const current = affectedTargetPeriods.get(targetPayrollPeriodId) ?? {
        payrollPeriodCode: rebuilt.payrollPeriod.code,
        refreshableExceptionRowIds: [],
        generatedAccountCodeRowCount: 0,
        staleRunCount: 0,
      };
      current.refreshableExceptionRowIds.push(
        ...rebuilt.refreshableExceptionRowIds
      );
      current.generatedAccountCodeRowCount +=
        rebuilt.generatedAccountCodeRowCount;
      current.staleRunCount += rebuilt.staleRunCount;
      affectedTargetPeriods.set(targetPayrollPeriodId, current);
    }

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "attendance_dtr_hold_approval",
      entityId: `${parsed.sourcePayrollPeriodId}:${parsed.employeeId}`,
      action: "attendance.dtr_hold.approved",
      details: {
        sourcePayrollPeriodId: parsed.sourcePayrollPeriodId,
        sourcePayrollPeriodCode: sourcePeriod.code,
        targetPayrollPeriodId: parsed.targetPayrollPeriodId,
        targetPayrollPeriodCode: targetPeriod.code,
        employeeId: parsed.employeeId,
        attendanceDates,
        approvalTotals,
        previousApprovalCount: previousApprovals.length,
        affectedTargetPeriods: [...affectedTargetPeriods.entries()].map(
          ([payrollPeriodId, affected]) => ({
            payrollPeriodId,
            ...affected,
          })
        ),
      },
      database: tx,
    });

    return {
      sourcePayrollPeriodCode: sourcePeriod.code,
      targetPayrollPeriodCode: targetPeriod.code,
      approvedDateCount: attendanceDates.length,
      affectedTargetPeriods: [...affectedTargetPeriods.entries()].map(
        ([payrollPeriodId, affected]) => ({
          payrollPeriodId,
          ...affected,
          refreshableExceptionRowIds: [
            ...new Set(affected.refreshableExceptionRowIds),
          ],
        })
      ),
    };
  });

  for (const affected of result.affectedTargetPeriods) {
    await refreshManualPayrollAttendanceForEmployees({
      actorUserId: actor.userId,
      payrollPeriodId: affected.payrollPeriodId,
      employeeIds: [parsed.employeeId],
      refreshableExceptionRowIds: affected.refreshableExceptionRowIds,
    });
  }

  revalidatePath("/payroll");

  return result;
}

export async function resetAttendanceDtrHoldRowsAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = attendanceDtrHoldResetSchema.parse(input);
  const attendanceDates = [...new Set(parsed.attendanceDates)].sort((left, right) =>
    left.localeCompare(right)
  );

  const result = await db.transaction(async (tx) => {
    const sourcePeriod = await tx.query.payrollPeriods.findFirst({
      where: eq(payrollPeriods.id, parsed.sourcePayrollPeriodId),
    });

    if (!sourcePeriod) throw new Error("Source payroll period not found.");

    const outsideSourcePeriod = attendanceDates.find(
      (attendanceDate) =>
        attendanceDate < sourcePeriod.startDate ||
        attendanceDate > sourcePeriod.endDate
    );
    if (outsideSourcePeriod) {
      throw new Error("One or more held dates are outside the source payroll period.");
    }

    const previousSubmissions = await tx
      .select()
      .from(attendanceDtrHoldApprovals)
      .where(
        and(
          eq(
            attendanceDtrHoldApprovals.sourcePayrollPeriodId,
            parsed.sourcePayrollPeriodId
          ),
          eq(attendanceDtrHoldApprovals.employeeId, parsed.employeeId),
          inArray(attendanceDtrHoldApprovals.attendanceDate, attendanceDates)
        )
      );

    if (previousSubmissions.length === 0) {
      throw new Error("No pending or approved held DTR rows were found to reset.");
    }

    await tx
      .delete(attendanceDtrHoldApprovals)
      .where(
        and(
          eq(
            attendanceDtrHoldApprovals.sourcePayrollPeriodId,
              parsed.sourcePayrollPeriodId
          ),
          eq(attendanceDtrHoldApprovals.employeeId, parsed.employeeId),
          inArray(attendanceDtrHoldApprovals.attendanceDate, attendanceDates)
        )
      );

    const affectedTargetPeriods = new Map<
      string,
      {
        payrollPeriodCode: string;
        refreshableExceptionRowIds: string[];
        generatedAccountCodeRowCount: number;
        staleRunCount: number;
      }
    >();
    const affectedTargetPeriodIds = new Set(
      previousSubmissions
        .filter((submission) => submission.status === "Approved")
        .map((submission) => submission.targetPayrollPeriodId)
    );

    for (const targetPayrollPeriodId of affectedTargetPeriodIds) {
      const rebuilt = await rebuildHeldDtrExceptionRowsForTargetPeriod({
        tx,
        actorUserId: actor.userId,
        targetPayrollPeriodId,
        employeeId: parsed.employeeId,
      });
      const current = affectedTargetPeriods.get(targetPayrollPeriodId) ?? {
        payrollPeriodCode: rebuilt.payrollPeriod.code,
        refreshableExceptionRowIds: [],
        generatedAccountCodeRowCount: 0,
        staleRunCount: 0,
      };
      current.refreshableExceptionRowIds.push(
        ...rebuilt.refreshableExceptionRowIds
      );
      current.generatedAccountCodeRowCount +=
        rebuilt.generatedAccountCodeRowCount;
      current.staleRunCount += rebuilt.staleRunCount;
      affectedTargetPeriods.set(targetPayrollPeriodId, current);
    }

    const resetAttendanceDates = previousSubmissions
      .map((submission) => submission.attendanceDate)
      .sort((left, right) => left.localeCompare(right));

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "attendance_dtr_hold_approval",
      entityId: `${parsed.sourcePayrollPeriodId}:${parsed.employeeId}`,
      action: "attendance.dtr_hold.reset",
      details: {
        sourcePayrollPeriodId: parsed.sourcePayrollPeriodId,
        sourcePayrollPeriodCode: sourcePeriod.code,
        employeeId: parsed.employeeId,
        attendanceDates: resetAttendanceDates,
        previousSubmissionCount: previousSubmissions.length,
        previousApprovedCount: previousSubmissions.filter(
          (submission) => submission.status === "Approved"
        ).length,
        affectedTargetPeriods: [...affectedTargetPeriods.entries()].map(
          ([payrollPeriodId, affected]) => ({
            payrollPeriodId,
            ...affected,
          })
        ),
      },
      database: tx,
    });

    return {
      sourcePayrollPeriodCode: sourcePeriod.code,
      resetDateCount: previousSubmissions.length,
      affectedTargetPeriods: [...affectedTargetPeriods.entries()].map(
        ([payrollPeriodId, affected]) => ({
          payrollPeriodId,
          ...affected,
          refreshableExceptionRowIds: [
            ...new Set(affected.refreshableExceptionRowIds),
          ],
        })
      ),
    };
  });

  for (const affected of result.affectedTargetPeriods) {
    await refreshManualPayrollAttendanceForEmployees({
      actorUserId: actor.userId,
      payrollPeriodId: affected.payrollPeriodId,
      employeeIds: [parsed.employeeId],
      refreshableExceptionRowIds: affected.refreshableExceptionRowIds,
    });
  }

  revalidatePath("/payroll");

  return result;
}

export async function saveAttendanceDtrDayOverridesAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = attendanceDtrDayOverridesSchema.parse(input);
  const payrollPeriod = await db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, parsed.payrollPeriodId),
  });

  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  const changesByDate = new Map<
    string,
    {
      attendanceDate: string;
      hasStatus: boolean;
      status: AttendanceDtrManualStatus | null;
      hasDayType: boolean;
      dayType: AttendanceDtrDayType | null;
    }
  >();

  for (const change of parsed.changes) {
    const current = changesByDate.get(change.attendanceDate) ?? {
      attendanceDate: change.attendanceDate,
      hasStatus: false,
      status: null,
      hasDayType: false,
      dayType: null,
    };

    if (Object.prototype.hasOwnProperty.call(change, "status")) {
      current.hasStatus = true;
      current.status = change.status ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(change, "dayType")) {
      current.hasDayType = true;
      current.dayType = change.dayType ?? null;
    }

    changesByDate.set(change.attendanceDate, current);
  }

  const changes = [...changesByDate.values()]
    .filter((change) => change.hasStatus || change.hasDayType)
    .sort((left, right) => left.attendanceDate.localeCompare(right.attendanceDate));

  if (changes.length === 0) {
    throw new Error("No DTR row override changes were provided.");
  }

  const outsidePeriodChange = changes.find(
    (change) =>
      change.attendanceDate < payrollPeriod.startDate ||
      change.attendanceDate > payrollPeriod.endDate
  );

  if (outsidePeriodChange) {
    throw new Error("One or more attendance dates are outside the selected payroll period.");
  }

  const result = await db.transaction(async (tx) => {
    const staleRunCount = await markPayrollPeriodRunsStale({
      tx,
      payrollPeriodId: payrollPeriod.id,
      payrollPeriodCode: payrollPeriod.code,
      actorUserId: actor.userId,
      notes: "Marked stale because semimonthly DTR row overrides changed.",
    });

    const statusClearDates = changes
      .filter((change) => change.hasStatus && change.status == null)
      .map((change) => change.attendanceDate);
    const statusChanges = changes.filter(
      (change) => change.hasStatus && change.status != null
    ) as Array<(typeof changes)[number] & { status: AttendanceDtrManualStatus }>;
    const dayTypeClearDates = changes
      .filter((change) => change.hasDayType && change.dayType == null)
      .map((change) => change.attendanceDate);
    const dayTypeChanges = changes.filter(
      (change) => change.hasDayType && change.dayType != null
    ) as Array<(typeof changes)[number] & { dayType: AttendanceDtrDayType }>;

    if (statusClearDates.length > 0) {
      await tx
        .delete(employeeAttendanceDayStatusOverrides)
        .where(
          and(
            eq(employeeAttendanceDayStatusOverrides.payrollPeriodId, parsed.payrollPeriodId),
            eq(employeeAttendanceDayStatusOverrides.employeeId, parsed.employeeId),
            inArray(employeeAttendanceDayStatusOverrides.attendanceDate, statusClearDates)
          )
        );
    }

    if (statusChanges.length > 0) {
      await tx
        .insert(employeeAttendanceDayStatusOverrides)
        .values(
          statusChanges.map((change) => ({
            payrollPeriodId: parsed.payrollPeriodId,
            employeeId: parsed.employeeId,
            attendanceDate: change.attendanceDate,
            status: change.status,
          }))
        )
        .onConflictDoUpdate({
          target: [
            employeeAttendanceDayStatusOverrides.payrollPeriodId,
            employeeAttendanceDayStatusOverrides.employeeId,
            employeeAttendanceDayStatusOverrides.attendanceDate,
          ],
          set: {
            status: sql`excluded.status`,
            updatedAt: new Date(),
          },
        });
    }

    if (dayTypeClearDates.length > 0) {
      await tx
        .delete(employeeAttendanceDayTypeOverrides)
        .where(
          and(
            eq(employeeAttendanceDayTypeOverrides.payrollPeriodId, parsed.payrollPeriodId),
            eq(employeeAttendanceDayTypeOverrides.employeeId, parsed.employeeId),
            inArray(employeeAttendanceDayTypeOverrides.attendanceDate, dayTypeClearDates)
          )
        );
    }

    if (dayTypeChanges.length > 0) {
      await tx
        .insert(employeeAttendanceDayTypeOverrides)
        .values(
          dayTypeChanges.map((change) => ({
            payrollPeriodId: parsed.payrollPeriodId,
            employeeId: parsed.employeeId,
            attendanceDate: change.attendanceDate,
            dayType: change.dayType,
          }))
        )
        .onConflictDoUpdate({
          target: [
            employeeAttendanceDayTypeOverrides.payrollPeriodId,
            employeeAttendanceDayTypeOverrides.employeeId,
            employeeAttendanceDayTypeOverrides.attendanceDate,
          ],
          set: {
            dayType: sql`excluded.day_type`,
            updatedAt: new Date(),
          },
        });
    }

    const generatedDtrRows = await syncGeneratedDtrWorkedExceptionRows({
      tx,
      payrollPeriod,
      employeeIds: [parsed.employeeId],
    });

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "employee_attendance_day_overrides",
      entityId: `${parsed.payrollPeriodId}:${parsed.employeeId}`,
      action: "attendance.dtr_day_overrides.bulk_updated",
      details: {
        payrollPeriodId: parsed.payrollPeriodId,
        payrollPeriodCode: payrollPeriod.code,
        employeeId: parsed.employeeId,
        changes,
        statusChangedCount: statusClearDates.length + statusChanges.length,
        dayTypeChangedCount: dayTypeClearDates.length + dayTypeChanges.length,
        generatedAccountCodeRowCount:
          generatedDtrRows.generatedAccountCodeRowCount,
        staleRunCount,
      },
      database: tx,
    });

    return {
      changedCount: changes.length,
      statusChangedCount: statusClearDates.length + statusChanges.length,
      dayTypeChangedCount: dayTypeClearDates.length + dayTypeChanges.length,
      ...generatedDtrRows,
      staleRunCount,
    };
  });
  const latestManualBaseline = await computeManualPayrollLatestBaseline(
    parsed.payrollPeriodId,
    parsed.employeeId
  );
  const manualPayrollRefresh =
    await refreshManualPayrollAttendanceLinesFromBaseline({
      actorUserId: actor.userId,
      payrollPeriodId: parsed.payrollPeriodId,
      employeeId: parsed.employeeId,
      latestBaseline: latestManualBaseline,
      refreshableExceptionRowIds: result.refreshableExceptionRowIds,
    });
  const payrollExceptionWorkspace = await getPayrollExceptionWorkspaceForEmployee({
    payrollPeriodId: parsed.payrollPeriodId,
    employeeId: parsed.employeeId,
  });

  return {
    payrollPeriodCode: payrollPeriod.code,
    manualPayrollRefresh,
    payrollExceptionWorkspace,
    changedCount: result.changedCount,
    statusChangedCount: result.statusChangedCount,
    dayTypeChangedCount: result.dayTypeChangedCount,
    generatedAccountCodeRowCount: result.generatedAccountCodeRowCount,
    staleRunCount: result.staleRunCount,
  };
}

export async function saveAttendanceDtrDayStatusOverridesAction(input: unknown) {
  const parsed = attendanceDtrDayStatusOverridesSchema.parse(input);

  return saveAttendanceDtrDayOverridesAction({
    payrollPeriodId: parsed.payrollPeriodId,
    employeeId: parsed.employeeId,
    changes: parsed.changes.map((change) => ({
      attendanceDate: change.attendanceDate,
      status: change.status ?? null,
    })),
  });
}

export async function saveAttendanceDtrDayStatusOverrideAction(input: unknown) {
  const parsed = attendanceDtrDayStatusOverrideSchema.parse(input);

  return saveAttendanceDtrDayOverridesAction({
    payrollPeriodId: parsed.payrollPeriodId,
    employeeId: parsed.employeeId,
    changes: [
      {
        attendanceDate: parsed.attendanceDate,
        status: parsed.status ?? null,
      },
    ],
  });
}

export async function getAttendanceImportBatchUnmatchedDiagnosticsAction(
  batchId: string
): Promise<AttendanceImportBatchDiagnosticsView> {
  await requireAdminActor();
  const batch = await db.query.attendanceImportBatches.findFirst({
    where: eq(attendanceImportBatches.id, batchId),
  });

  if (!batch) {
    throw new Error("Attendance import batch not found.");
  }

  const rows = await db
    .select({
      id: attendanceRawLogs.id,
      employeeNo: attendanceRawLogs.employeeNo,
      sourceLine: attendanceRawLogs.sourceLine,
      loggedAt: attendanceRawLogs.loggedAt,
      logDate: attendanceRawLogs.logDate,
      logTime: attendanceRawLogs.logTime,
      deviceId: attendanceRawLogs.deviceId,
      siteCode: attendanceRawLogs.siteCode,
      rawText: attendanceRawLogs.rawText,
    })
    .from(attendanceRawLogs)
    .where(
      and(
        eq(attendanceRawLogs.batchId, batch.id),
        isNull(attendanceRawLogs.employeeId)
      )
    )
    .orderBy(
      asc(attendanceRawLogs.employeeNo),
      asc(attendanceRawLogs.logDate),
      asc(attendanceRawLogs.logTime),
      asc(attendanceRawLogs.id)
    );

  const groupedRows = new Map<
    string,
    AttendanceImportBatchDiagnosticsView["groups"][number]["rows"]
  >();

  for (const row of rows) {
    const currentRows = groupedRows.get(row.employeeNo) ?? [];
    currentRows.push({
      id: row.id,
      employeeNo: row.employeeNo,
      sourceLine: row.sourceLine ?? null,
      loggedAt: row.loggedAt.toISOString(),
      logDate: row.logDate,
      logTime: row.logTime,
      deviceId: row.deviceId ?? null,
      siteCode: row.siteCode ?? null,
      rawText: row.rawText ?? null,
    });
    groupedRows.set(row.employeeNo, currentRows);
  }

  const groups = [...groupedRows.entries()]
    .map(([employeeNo, groupRows]) => {
      const dates = groupRows.map((row) => row.logDate).sort();
      const sourceLines = groupRows
        .map((row) => row.sourceLine)
        .filter((sourceLine): sourceLine is number => sourceLine != null)
        .sort((left, right) => left - right);

      return {
        employeeNo,
        rowCount: groupRows.length,
        startDate: dates[0] ?? "-",
        endDate: dates[dates.length - 1] ?? "-",
        firstSourceLine: sourceLines[0] ?? null,
        lastSourceLine: sourceLines[sourceLines.length - 1] ?? null,
        sampleRawText: groupRows.find((row) => row.rawText)?.rawText ?? null,
        rows: groupRows,
      };
    })
    .sort((left, right) => {
      const countComparison = right.rowCount - left.rowCount;
      if (countComparison !== 0) return countComparison;
      return left.employeeNo.localeCompare(right.employeeNo);
    });

  return {
    batchId: batch.id,
    totalUnmatchedRows: rows.length,
    groups,
  };
}

export async function getAttendanceImportBatch(batchId: string) {
  await requireAdminActor();
  return db.query.attendanceImportBatches.findFirst({
    where: eq(attendanceImportBatches.id, batchId),
    with: {
      rawLogs: true,
    },
  });
}

async function loadAttendanceDtrHeldRows(
  periodId: string,
  employeeScopeIds?: string[]
): Promise<AttendanceDtrHeldRowsView> {
  const period = await db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, periodId),
  });
  if (!period) throw new Error("Payroll period not found");

  const periodView = {
    id: period.id,
    code: period.code,
    startDate: period.startDate,
    endDate: period.endDate,
    adjustedPayDate: period.adjustedPayDate,
    nominalPayDate: period.nominalPayDate,
    cycle: period.cycle as "A" | "B",
    status: period.status,
  };

  const scopedEmployeeIds = employeeScopeIds
    ? [...new Set(employeeScopeIds)]
    : undefined;
  if (scopedEmployeeIds && scopedEmployeeIds.length === 0) {
    return { payrollPeriod: periodView, rows: [] };
  }

  // Fetch manually-held overrides for this period
  const manualOverrides = await db
    .select({
      employeeId: employeeAttendanceDayStatusOverrides.employeeId,
      attendanceDate: employeeAttendanceDayStatusOverrides.attendanceDate,
    })
    .from(employeeAttendanceDayStatusOverrides)
    .where(
      and(
        eq(employeeAttendanceDayStatusOverrides.payrollPeriodId, periodId),
        eq(employeeAttendanceDayStatusOverrides.status, "Hold"),
        scopedEmployeeIds
          ? inArray(employeeAttendanceDayStatusOverrides.employeeId, scopedEmployeeIds)
          : sql`TRUE`
      )
    );

  // Fetch all daily summaries for the period that have ODD_PUNCH_COUNT or MISSING_OUT flags
  const flaggedSummaries = await db
    .select()
    .from(attendanceDailySummaries)
    .where(
      and(
        gte(attendanceDailySummaries.attendanceDate, period.startDate),
        lte(attendanceDailySummaries.attendanceDate, period.endDate),
        scopedEmployeeIds
          ? inArray(attendanceDailySummaries.employeeId, scopedEmployeeIds)
          : sql`TRUE`,
        or(
          like(attendanceDailySummaries.anomalyFlags, "%ODD_PUNCH_COUNT%"),
          like(attendanceDailySummaries.anomalyFlags, "%MISSING_OUT%")
        )
      )
    );

  // Confirm flags after normalization (guards against partial text matches).
  // Exclude rows where DOUBLE_PUNCH is present — that flag means an approved
  // duplicate correction already resolved the odd punch count.
  const autoFlaggedSummaries = flaggedSummaries.filter((s) => {
    const flags = normalizeAttendanceDtrAnomalyFlags(s.anomalyFlags ?? null);
    const hasHoldFlag = flags.includes("ODD_PUNCH_COUNT") || flags.includes("MISSING_OUT");
    const isResolvedByDoublePunch = flags.includes("DOUBLE_PUNCH");
    return hasHoldFlag && !isResolvedByDoublePunch;
  });

  // Build a unified set of (employeeId, attendanceDate, source) entries.
  // Manual overrides take precedence — if a row is both flagged and manually held, mark it "manual".
  type HeldEntry = {
    employeeId: string;
    attendanceDate: string;
    source: "auto" | "manual";
  };

  const entryMap = new Map<string, HeldEntry>();

  for (const s of autoFlaggedSummaries) {
    const key = `${s.employeeId}|${s.attendanceDate}`;
    entryMap.set(key, {
      employeeId: s.employeeId,
      attendanceDate: s.attendanceDate,
      source: "auto",
    });
  }

  for (const o of manualOverrides) {
    const key = `${o.employeeId}|${o.attendanceDate}`;
    entryMap.set(key, {
      employeeId: o.employeeId,
      attendanceDate: o.attendanceDate,
      source: "manual",
    });
  }

  const allEntries = [...entryMap.values()];

  if (allEntries.length === 0) {
    return { payrollPeriod: periodView, rows: [] };
  }

  const allEmployeeIds = [...new Set(allEntries.map((e) => e.employeeId))];
  const heldKeys = new Set(
    allEntries.map((e) => `${e.employeeId}|${e.attendanceDate}`)
  );

  const [
    employeeRows,
    departmentMetadataByEmployeeId,
    summaryRows,
    rawPunchRows,
  ] = await Promise.all([
    db.select().from(employees).where(inArray(employees.id, allEmployeeIds)),
    loadEmployeeDepartmentMetadataByEmployeeId(allEmployeeIds, db),
    db
      .select()
      .from(attendanceDailySummaries)
      .where(
        and(
          inArray(attendanceDailySummaries.employeeId, allEmployeeIds),
          gte(attendanceDailySummaries.attendanceDate, period.startDate),
          lte(attendanceDailySummaries.attendanceDate, period.endDate)
        )
      ),
    db
      .select({
        employeeId: attendanceRawLogs.employeeId,
        logDate: attendanceRawLogs.logDate,
        loggedAt: attendanceRawLogs.loggedAt,
      })
      .from(attendanceRawLogs)
      .innerJoin(
        attendanceImportBatches,
        eq(attendanceRawLogs.batchId, attendanceImportBatches.id)
      )
      .where(
        and(
          eq(attendanceImportBatches.payrollPeriodId, periodId),
          isNotNull(attendanceRawLogs.employeeId),
          inArray(attendanceRawLogs.employeeId, allEmployeeIds),
          gte(attendanceRawLogs.logDate, period.startDate),
          lte(attendanceRawLogs.logDate, period.endDate)
        )
      )
      .orderBy(
        asc(attendanceRawLogs.employeeId),
        asc(attendanceRawLogs.logDate),
        asc(attendanceRawLogs.loggedAt),
        asc(attendanceRawLogs.id)
      ),
  ]);

  const summaryByKey = new Map(
    summaryRows.map((s) => [`${s.employeeId}|${s.attendanceDate}`, s])
  );
  const rawPunchesByKey = new Map<string, string[]>();

  for (const row of rawPunchRows) {
    if (!row.employeeId) continue;

    const key = `${row.employeeId}|${row.logDate}`;
    if (!heldKeys.has(key)) continue;

    const formatted = formatTimeValue(row.loggedAt);
    if (!formatted) continue;

    const punches = rawPunchesByKey.get(key) ?? [];
    punches.push(formatted);
    rawPunchesByKey.set(key, punches);
  }

  const approvalRows = await db
    .select()
    .from(attendanceDtrHoldApprovals)
    .where(
      and(
        eq(attendanceDtrHoldApprovals.sourcePayrollPeriodId, periodId),
        inArray(attendanceDtrHoldApprovals.employeeId, allEmployeeIds),
        gte(attendanceDtrHoldApprovals.attendanceDate, period.startDate),
        lte(attendanceDtrHoldApprovals.attendanceDate, period.endDate)
      )
    );
  const targetPayrollPeriodIds = [
    ...new Set(approvalRows.map((row) => row.targetPayrollPeriodId)),
  ];
  const targetPayrollPeriods =
    targetPayrollPeriodIds.length > 0
      ? await db
          .select({
            id: payrollPeriods.id,
            code: payrollPeriods.code,
          })
          .from(payrollPeriods)
          .where(inArray(payrollPeriods.id, targetPayrollPeriodIds))
      : [];
  const targetPayrollPeriodCodeById = new Map(
    targetPayrollPeriods.map((targetPeriod) => [
      targetPeriod.id,
      targetPeriod.code,
    ])
  );
  const approvalByKey = new Map(
    approvalRows.map((approval) => [
      `${approval.employeeId}|${approval.attendanceDate}`,
      approval,
    ])
  );

  const employeeById = new Map(employeeRows.map((e) => [e.id, e]));
  const FALLBACK_HELD_DTR_WORKED_MINUTES = 8 * 60;

  const rows = allEntries
    .map((entry) => {
      const employee = employeeById.get(entry.employeeId);
      if (!employee) return null;

      const key = `${entry.employeeId}|${entry.attendanceDate}`;
      const summary = summaryByKey.get(key);
      const departmentMetadata =
        departmentMetadataByEmployeeId.get(entry.employeeId) ?? null;

      const anomalyFlags = normalizeAttendanceDtrAnomalyFlags(
        summary?.anomalyFlags ?? null
      );
      if (anomalyFlags.includes("DOUBLE_PUNCH")) return null;
      const approval = approvalByKey.get(key) ?? null;
      const scheduledMinutes = summary?.scheduledMinutes ?? 0;
      const intendedWorkedMinutes =
        scheduledMinutes > 0 ? scheduledMinutes : FALLBACK_HELD_DTR_WORKED_MINUTES;
      const workedBaselineSource =
        scheduledMinutes > 0
          ? ("schedule" as const)
          : ("fallback_8_hours" as const);

      return {
        employeeId: employee.id,
        employeeNo: employee.employeeNo,
        employeeName: buildEmployeeDisplayName(employee),
        departmentId: departmentMetadata?.departmentId ?? null,
        departmentName: departmentMetadata?.departmentName ?? null,
        departmentCode: departmentMetadata?.departmentCode ?? null,
        attendanceDate: entry.attendanceDate,
        dayName: formatAttendanceDayName(entry.attendanceDate),
        anomalyFlags,
        scheduledInTime: summary?.scheduledInTime ?? null,
        scheduledOutTime: summary?.scheduledOutTime ?? null,
        scheduledMinutes,
        workedMinutes: summary?.workedMinutes ?? 0,
        intendedWorkedMinutes,
        workedBaselineSource,
        lateMinutes: summary?.lateMinutes ?? 0,
        undertimeMinutes: summary?.undertimeMinutes ?? 0,
        overtimeMinutes: summary?.overtimeMinutes ?? 0,
        rawPunches: rawPunchesByKey.get(key) ?? [],
        source: entry.source,
        approvalStatus:
          approval?.status === "Approved"
            ? ("Approved" as const)
            : approval?.status === "Pending"
              ? ("Pending" as const)
              : ("Hold" as const),
        targetPayrollPeriodId: approval?.targetPayrollPeriodId ?? null,
        targetPayrollPeriodCode: approval
          ? targetPayrollPeriodCodeById.get(approval.targetPayrollPeriodId) ?? null
          : null,
        approvedWorkedMinutes: approval?.workedMinutes ?? null,
        approvedLateMinutes: approval?.lateMinutes ?? null,
        approvedUndertimeMinutes: approval?.undertimeMinutes ?? null,
        approvedOvertimeMinutes: approval?.overtimeMinutes ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => {
      const byName = a.employeeName.localeCompare(b.employeeName);
      if (byName !== 0) return byName;
      const byNumber = a.employeeNo.localeCompare(b.employeeNo);
      if (byNumber !== 0) return byNumber;
      return a.attendanceDate.localeCompare(b.attendanceDate);
    });

  return { payrollPeriod: periodView, rows };
}

export async function getAttendanceDtrHeldRowsAction(periodId: string) {
  await requireAdminActor();
  return loadAttendanceDtrHeldRows(periodId);
}

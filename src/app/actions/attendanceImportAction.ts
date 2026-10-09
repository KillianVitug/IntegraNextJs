"use server";
import { calculateGeneratedDtrRows, EMPTY_GENERATED_DTR_EXCEPTION_ROW_SYNC, fetchHolidayRowsForGeneratedDtr, getRequiredHolidayCheckDates, buildHolidayAccountByType, buildHolidayCheckRequirementByDate, buildDtrMetricOverrideByEmployeeDate, applyAttendanceDtrMetricOverride, buildCheckDateAttendanceByDate, buildAttendanceDtrTotals, buildHolidayWorkedRowsForGeneratedDtr, getEffectiveHolidayTypeForDate, buildHolidayOvertimeRowsForGeneratedDtr, buildGeneratedDtrExceptionRows, GENERATED_DTR_OVERRIDE_SOURCES } from "@/lib/payroll/generatedDtrCalculation";
import type { AttendanceTransaction, GeneratedDtrExceptionRowSyncResult, GeneratedDtrAccountCodeRow, DtrPeriodOverrideValues, GeneratedDtrExceptionRowInsert } from "@/lib/payroll/generatedDtrCalculation";
import { lockEditableAttendancePeriod, withAttendanceFinancialRefresh } from "@/lib/payroll/attendanceFinancialRefresh";
import { workTreatments } from "@/db/attendanceWorkbenchSchema";
import { assertFileAttendanceBatch } from "@/lib/payroll/validation";
import { loadEffectiveAttendanceRawLogs, loadEffectiveAttendanceCorrections } from "@/lib/payroll/effectiveAttendanceInputs";
import { attendanceSourceVersion, confirmAttendanceSourceSummaryRefresh, lockAttendancePayrollInput } from "@/lib/payroll/attendanceSourceGuard";

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
import { db, type DbClient } from "@/db";
import { accountCode, adminAuditEvents, attendanceDailySummaries, attendanceDtrCorrections, attendanceDtrHoldApprovals, attendanceImportBatches, attendanceRawLogs, branchCalendarAccountCodeOverrides, employeeAttendanceDayStatusOverrides, employeeAttendanceDayMetricOverrides, employeeAttendanceDayTypeOverrides, employeeAttendancePeriodOverrides, employeePayrollExceptionRows, employeeShiftAssignments, employeeWeeklyShiftPatterns, employees, employeesGeneralInfo, employeesLeaveRecords, employeesSalary, employeesTimekeeping, holidayTypeAccountCodes, leaveTypes, overtimeRules, payrollPeriods, payrollRuns, shiftTableBreaks } from "@/db/schema";
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
  currentDepartmentMemberStatusCondition,
  isPayrollEligibleEmploymentStatus,
} from "@/lib/employmentStatus";
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
import { applyAttendanceDtrEffectiveStatus, attendanceDtrDayTypeValues, attendanceDtrManualStatusValues, computeAttendanceHoldWorkedMinutes, computeAccumulatedLatePenaltyMinutes, computePayrollTardinessMinutes, getAttendanceDtrDayTypeFromHolidayType, getComputedAttendanceDtrStatus, normalizeAttendanceDtrAnomalyFlags, type AttendanceDtrDayType, type AttendanceDtrManualStatus } from "@/lib/payroll/dtrOverrides";
import { buildHolidayTypeByDate, type OvertimeHolidayType } from "@/lib/payroll/overtime";
import {
  computeManualPayrollLatestBaseline,
  createOrRecomputePayrollRun,
} from "@/lib/payroll/engine";
import { refreshManualPayrollAttendanceLinesFromBaseline } from "@/lib/payroll/manualPayroll";

import {
  buildBranchCalendarOverrideRowsForGeneratedDtr,
  buildBranchCalendarOverrideScopeMaps,
} from "@/lib/payroll/branchCalendarAccountCodes";
import {
  getEmployeePayrollExceptionRows,
  getEmployeePayrollManualLeaveAccountCodeRows,
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
  dayMetricOverrides: Array<typeof employeeAttendanceDayMetricOverrides.$inferSelect>;
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
  dayMetricOverrides: Array<typeof employeeAttendanceDayMetricOverrides.$inferSelect>;
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
      isPayrollEligibleEmploymentStatus(employee.generalInfo?.employmentStatus) &&
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
    rawLogId: row.id > 0 ? row.id : null,
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

  // Drizzle decodes PostgreSQL timestamp-without-timezone as UTC. These fields
  // already contain Philippine wall time; applying the host offset adds 8 hours.
  const hours = String(value.getUTCHours()).padStart(2, "0");
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  const seconds = String(value.getUTCSeconds()).padStart(2, "0");

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









async function loadAttendancePeriodSourceData(
  database: AttendanceDatabase,
  payrollPeriodId: string,
  employeeId?: string,
  options?: { employeeIds?: string[] }
): Promise<AttendancePeriodSourceData> {
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
      rawLogs: [],
      employeeRecords: [],
      departmentByEmployeeId: new Map(),
      approvedLeaves: [],
      shiftAssignments: [],
      weeklyPatterns: [],
      shiftTableBreaksByShiftTableId: new Map(),
      approvedCorrections: [],
      periodOverrides: [],
      dayStatusOverrides: [],
      dayMetricOverrides: [],
      dayTypeOverrides: [],
      holidayRows: (await fetchConfirmedHolidayRowsForRange(
        payrollPeriod.startDate,
        payrollPeriod.endDate
      )) as AttendancePeriodSourceData["holidayRows"],
    };
  }

  const rawLogs: AttendancePeriodRawLogRow[] = await loadEffectiveAttendanceRawLogs(database, {
    payrollPeriodId, employeeIds: employeeId ? [employeeId] : scopedEmployeeIds,
    startDate: payrollPeriod.startDate, endDate: payrollPeriod.endDate,
    neighborDays: process.env.ATTENDANCE_SOURCE_ENABLED === "true" ? "api" : "none",
  });

  const rawEmployeeIds: string[] = [
    ...new Set(
      rawLogs
        .map((row) => row.employeeId)
        .filter((employeeId): employeeId is string => Boolean(employeeId))
    ),
  ];
  if(process.env.ATTENDANCE_WORKBENCH_ENABLED==="true"){
    const prior=await database.select({employeeId:attendanceDailySummaries.employeeId}).from(attendanceDailySummaries).where(and(gte(attendanceDailySummaries.attendanceDate,payrollPeriod.startDate),lte(attendanceDailySummaries.attendanceDate,payrollPeriod.endDate)));
    const decided=await database.select({employeeId:workTreatments.employeeId}).from(workTreatments).where(and(eq(workTreatments.periodId,payrollPeriodId),eq(workTreatments.active,true)));
    for(const row of [...prior,...decided])if(!rawEmployeeIds.includes(row.employeeId)&&(!employeeId||row.employeeId===employeeId)&&(!scopedEmployeeIds||scopedEmployeeIds.includes(row.employeeId)))rawEmployeeIds.push(row.employeeId);
  }
  const employeeRecords: AttendancePeriodEmployeeRecord[] =
    rawEmployeeIds.length === 0
      ? []
      : (
          await database.query.employees.findMany({
          where: and(
            inArray(employees.id, rawEmployeeIds),
            eq(employees.employeeType, DEFAULT_EMPLOYEE_TYPE),
            isNull(employees.deletedAt),
          ),
          with: {
            generalInfo: true,
            timekeeping: true,
          },
        })
        ).filter((employee) =>
          isPayrollEligibleEmploymentStatus(employee.generalInfo?.employmentStatus)
        );
  const employeeIds = employeeRecords.map((employee) => employee.id);
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
  const dayMetricOverrides: Array<
    typeof employeeAttendanceDayMetricOverrides.$inferSelect
  > =
    employeeIds.length === 0
      ? []
      : await database
          .select()
          .from(employeeAttendanceDayMetricOverrides)
          .where(
            and(
              eq(employeeAttendanceDayMetricOverrides.payrollPeriodId, payrollPeriodId),
              inArray(employeeAttendanceDayMetricOverrides.employeeId, employeeIds),
              gte(employeeAttendanceDayMetricOverrides.attendanceDate, payrollPeriod.startDate),
              lte(employeeAttendanceDayMetricOverrides.attendanceDate, payrollPeriod.endDate)
            )
          );
  const approvedCorrections = await loadEffectiveAttendanceCorrections(database, {
    payrollPeriodId, employeeIds, startDate: payrollPeriod.startDate, endDate: payrollPeriod.endDate,
  });
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
    dayMetricOverrides,
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
      dayMetricOverrides: [],
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
    dayMetricOverrides,
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
          .from(employeeAttendanceDayMetricOverrides)
          .where(
            and(
              eq(employeeAttendanceDayMetricOverrides.payrollPeriodId, payrollPeriodId),
              inArray(employeeAttendanceDayMetricOverrides.employeeId, employeeIds),
              gte(employeeAttendanceDayMetricOverrides.attendanceDate, payrollPeriod.startDate),
              lte(employeeAttendanceDayMetricOverrides.attendanceDate, payrollPeriod.endDate)
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
    dayMetricOverrides:
      dayMetricOverrides as Array<
        typeof employeeAttendanceDayMetricOverrides.$inferSelect
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
  await lockEditableAttendancePeriod(args.tx, args.payrollPeriodId);
  const affectedRuns = await args.tx
    .select({
      id: payrollRuns.id,
      status: payrollRuns.status,
    })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.payrollPeriodId, args.payrollPeriodId),sql`coalesce(${payrollRuns.inputSnapshot}->>'payrollGroup','Legacy') <> 'Monthly'`))
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

  const changedRuns = await args.tx
    .update(payrollRuns)
    .set({
      status: "Stale",
      reviewedAt: null,
      reviewedByUserId: null,
      approvedAt: null,
      approvedByUserId: null,
      updatedAt: new Date(),
    })
    .where(and(inArray(payrollRuns.id, staleRunIds), inArray(payrollRuns.status, ["Draft", "Reviewed"])))
    .returning({ id: payrollRuns.id });

  if (changedRuns.length !== staleRunIds.length) {
    throw new Error("Payroll changed while attendance was being saved. Refresh and retry; no attendance changes were saved.");
  }

  for (const { id: runId } of changedRuns) {
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

  return changedRuns.length;
}

export type ManagerDtrPayrollSyncResult = {
  status: "computed" | "skipped" | "failed" | "blocked";
  payrollPeriodCode: string | null;
  payrollRunId?: string | null;
  payrollRunNumber?: number | null;
  message: string;
};

function getPayrollRunBlockedMessage(payrollPeriodCode: string, status: string) {
  return `Manager DTR updates are blocked because payroll period ${payrollPeriodCode} already has a ${status} run. Ask HR/Admin to void or reverse the run before changing DTR data.`;
}

async function getPayrollPeriodForManagerDtrSync(payrollPeriodId: string, database: DbClient = db) {
  const payrollPeriod = await database.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, payrollPeriodId),
  });

  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  return payrollPeriod;
}

async function assertManagerDtrPayrollPeriodCanChange(payrollPeriodId: string, database: DbClient = db) {
  const payrollPeriod = await getPayrollPeriodForManagerDtrSync(payrollPeriodId, database);
  if (payrollPeriod.status !== "Open") throw new Error("This payroll period is closed. Use the adjustment process; no DTR changes were saved.");
  const [blockingRun] = await database
    .select({
      status: payrollRuns.status,
      runNumber: payrollRuns.runNumber,
    })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.payrollPeriodId, payrollPeriodId),
        inArray(payrollRuns.status, ["Approved", "Posted"])
      )
    )
    .orderBy(desc(payrollRuns.createdAt))
    .limit(1);

  if (blockingRun) {
    throw new Error(
      `${getPayrollRunBlockedMessage(
        payrollPeriod.code,
        blockingRun.status
      )} Blocking run: #${blockingRun.runNumber}.`
    );
  }

  return payrollPeriod;
}

async function syncManagerDtrPayrollPeriod(args: {
  actorUserId: string;
  payrollPeriodId: string;
  markStale?: boolean;
  staleNotes?: string;
}): Promise<ManagerDtrPayrollSyncResult> {
  const payrollPeriod = await getPayrollPeriodForManagerDtrSync(
    args.payrollPeriodId
  );

  try {
    await assertManagerDtrPayrollPeriodCanChange(args.payrollPeriodId);

    if (args.markStale ?? true) {
      await db.transaction(async (tx) => {
        await lockAttendancePayrollInput(tx);
        await assertManagerDtrPayrollPeriodCanChange(args.payrollPeriodId, tx);
        await markPayrollPeriodRunsStale({
          tx,
          payrollPeriodId: payrollPeriod.id,
          payrollPeriodCode: payrollPeriod.code,
          actorUserId: args.actorUserId,
          notes:
            args.staleNotes ??
            "Marked stale because manager DTR updates changed attendance totals.",
        });
      });
    }

    const run = await createOrRecomputePayrollRun(
      payrollPeriod.id,
      args.actorUserId,
      { bypassTemporaryReadinessCategories: true }
    );

    revalidatePath("/payroll");
    revalidatePath("/managerDtrFiles");

    return {
      status: "computed",
      payrollPeriodCode: payrollPeriod.code,
      payrollRunId: run?.id ?? null,
      payrollRunNumber: run?.runNumber ?? null,
      message: run?.runNumber
        ? `Payroll recomputed. Admin Payroll now shows Run #${run.runNumber} with the latest manager DTR totals.`
        : "Payroll recomputed with the latest manager DTR totals.",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Payroll recompute failed.";
    const blocked = /already has a (Approved|Posted) run/i.test(message);

    return {
      status: blocked ? "blocked" : "failed",
      payrollPeriodCode: payrollPeriod.code,
      payrollRunId: null,
      payrollRunNumber: null,
      message,
    };
  }
}

export async function syncManagerDtrPayrollPeriodAction(
  payrollPeriodId: string,
  options: { markStale?: boolean; staleNotes?: string } = {}
) {
  const auth = await requireManager();
  const scope = await getManagerAttendanceScope(auth.accountId);

  if (!payrollPeriodId) {
    throw new Error("Select a payroll period before recomputing payroll.");
  }
  if (scope.employeeIds.length === 0) {
    throw new Error("Manager account is not assigned to a department.");
  }

  return syncManagerDtrPayrollPeriod({
    actorUserId: auth.accountId,
    payrollPeriodId,
    markStale: options.markStale,
    staleNotes: options.staleNotes,
  });
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

type AttendanceImportAuditDetails = {
  payrollPeriodId?: string | null;
  departmentIds?: number[];
};

function parseAttendanceImportAuditDetails(
  value: string | null
): AttendanceImportAuditDetails {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const payrollPeriodId =
      typeof parsed.payrollPeriodId === "string" ? parsed.payrollPeriodId : null;
    const departmentIds = Array.isArray(parsed.departmentIds)
      ? parsed.departmentIds.filter(
          (departmentId): departmentId is number =>
            Number.isInteger(departmentId)
        )
      : [];

    return {
      payrollPeriodId,
      departmentIds,
    };
  } catch {
    return {};
  }
}

function getUnmatchedIdentifierReason(args: {
  employeeNo: string;
  employeeByNormalizedKey: Map<
    string,
    {
      id: string;
      generalInfo?: { departmentId: number | null } | null;
    }
  >;
  ambiguousNormalizedKeys: Set<string>;
  managerDepartmentIds?: Set<number>;
  managerEmployeeIds?: Set<string>;
}) {
  const normalizedEmployeeKey = normalizeAttendanceEmployeeKey(args.employeeNo);

  if (!normalizedEmployeeKey) {
    return "Invalid DTR identifier";
  }

  if (args.ambiguousNormalizedKeys.has(normalizedEmployeeKey)) {
    return "Duplicate or ambiguous employee number";
  }

  const employee = args.employeeByNormalizedKey.get(normalizedEmployeeKey) ?? null;
  if (
    employee &&
    (args.managerEmployeeIds
      ? !args.managerEmployeeIds.has(employee.id)
      : args.managerDepartmentIds && employee.generalInfo?.departmentId != null
        ? !args.managerDepartmentIds.has(employee.generalInfo.departmentId)
        : false)
  ) {
    return "Outside manager assigned departments";
  }

  return "No employee match";
}

async function buildAttendanceImportBatchUnmatchedDiagnostics(args: {
  batchId: string;
  managerDepartmentIds?: number[];
  managerEmployeeIds?: string[];
}): Promise<AttendanceImportBatchDiagnosticsView> {
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
        eq(attendanceRawLogs.batchId, args.batchId),
        isNull(attendanceRawLogs.employeeId)
      )
    )
    .orderBy(
      asc(attendanceRawLogs.employeeNo),
      asc(attendanceRawLogs.logDate),
      asc(attendanceRawLogs.logTime),
      asc(attendanceRawLogs.id)
    );

  const employeeRows = await db.query.employees.findMany({
    where: and(
      eq(employees.employeeType, DEFAULT_EMPLOYEE_TYPE),
      isNull(employees.deletedAt)
    ),
    columns: {
      id: true,
      employeeNo: true,
    },
    with: {
      generalInfo: true,
    },
  });
  const { employeeByNormalizedKey, ambiguousNormalizedKeys } =
    buildEmployeeLookup(
      employeeRows.filter((employee) =>
        isPayrollEligibleEmploymentStatus(employee.generalInfo?.employmentStatus)
      )
    );
  const managerDepartmentIds = args.managerDepartmentIds
    ? new Set(args.managerDepartmentIds)
    : undefined;
  const managerEmployeeIds = args.managerEmployeeIds
    ? new Set(args.managerEmployeeIds)
    : undefined;
  const groupedRows = new Map<
    string,
    {
      employeeNo: string;
      reason: string;
      rows: AttendanceImportBatchDiagnosticsView["groups"][number]["rows"];
    }
  >();

  for (const row of rows) {
    const reason = getUnmatchedIdentifierReason({
      employeeNo: row.employeeNo,
      employeeByNormalizedKey,
      ambiguousNormalizedKeys,
      managerDepartmentIds,
      managerEmployeeIds,
    });
    const groupKey = `${row.employeeNo}\u0000${reason}`;
    const group = groupedRows.get(groupKey) ?? {
      employeeNo: row.employeeNo,
      reason,
      rows: [],
    };

    group.rows.push({
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
    groupedRows.set(groupKey, group);
  }

  const groups = [...groupedRows.values()]
    .map((group) => {
      const dates = group.rows.map((row) => row.logDate).sort();
      const sourceLines = group.rows
        .map((row) => row.sourceLine)
        .filter((sourceLine): sourceLine is number => sourceLine != null)
        .sort((left, right) => left - right);

      return {
        employeeNo: group.employeeNo,
        reason: group.reason,
        rowCount: group.rows.length,
        startDate: dates[0] ?? "-",
        endDate: dates[dates.length - 1] ?? "-",
        firstSourceLine: sourceLines[0] ?? null,
        lastSourceLine: sourceLines[sourceLines.length - 1] ?? null,
        sampleRawText: group.rows.find((row) => row.rawText)?.rawText ?? null,
        rows: group.rows,
      };
    })
    .sort((left, right) => {
      const countComparison = right.rowCount - left.rowCount;
      if (countComparison !== 0) return countComparison;
      const employeeComparison = left.employeeNo.localeCompare(right.employeeNo);
      if (employeeComparison !== 0) return employeeComparison;
      return left.reason.localeCompare(right.reason);
    });

  return {
    batchId: args.batchId,
    totalUnmatchedRows: rows.length,
    groups,
  };
}

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
      generalInfo: true,
      timekeeping: true,
    },
  });
  const { employeeByNormalizedKey, ambiguousNormalizedKeys } =
    buildEmployeeLookup(
      employeeRecords.filter((employee) =>
        isPayrollEligibleEmploymentStatus(employee.generalInfo?.employmentStatus)
      )
    );
  const outOfScopeEmployeeRows =
    scopedEmployeeIds && scopedEmployeeIds.length > 0
      ? await db.query.employees.findMany({
          where: and(
            eq(employees.employeeType, DEFAULT_EMPLOYEE_TYPE),
            isNull(employees.deletedAt),
          ),
          columns: {
            id: true,
            employeeNo: true,
          },
          with: {
            generalInfo: true,
          },
        })
      : [];
  const outOfScopeEmployeeLookup =
    scopedEmployeeIds && scopedEmployeeIds.length > 0
      ? buildEmployeeLookup(
          outOfScopeEmployeeRows.filter((employee) =>
            isPayrollEligibleEmploymentStatus(employee.generalInfo?.employmentStatus)
          )
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

  const batch = await db.transaction(async (tx) => {
    await lockAttendancePayrollInput(tx);
    if (selectedPayrollPeriod) {
      if (scope.employeeIds) await assertManagerDtrPayrollPeriodCanChange(selectedPayrollPeriod.id, tx);
    }
    // Serialize retries with the same file, including requests that both passed
    // the early read before either import had committed.
    const priorBatch = await tx.query.attendanceImportBatches.findFirst({ where: and(eq(attendanceImportBatches.sourceHash, sourceHash), params.payrollPeriodId ? eq(attendanceImportBatches.payrollPeriodId, params.payrollPeriodId) : isNull(attendanceImportBatches.payrollPeriodId)) });
    if (priorBatch) return priorBatch;
    const existingHashes = new Set<string>();
    for (const hashes of chunk(normalizedHashes, 500)) {
      if (hashes.length === 0) continue;
      const rows = await tx.select({ normalizedHash: attendanceRawLogs.normalizedHash })
        .from(attendanceRawLogs).where(inArray(attendanceRawLogs.normalizedHash, hashes));
      for (const row of rows) if (row.normalizedHash) existingHashes.add(row.normalizedHash);
    }
    if (selectedPayrollPeriod) {
      await markPayrollPeriodRunsStale({ tx, payrollPeriodId: selectedPayrollPeriod.id, payrollPeriodCode: selectedPayrollPeriod.code, actorUserId: scope.actorUserId, notes: "Marked stale because attendance logs were imported." });
    }
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
    const summaryRawRows = !summaryCoverageRange ? [] : await loadEffectiveAttendanceRawLogs(tx, {
      employeeIds: matchedEmployeeIds, startDate: summaryCoverageRange.startDate,
      endDate: summaryCoverageRange.endDate, neighborDays: "all",
    });

    const summaryParsedLogs = summaryRawRows.map((row) => ({
      rawLogId: "id" in row && row.id > 0 ? row.id : null,
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
    const approvedCorrectionsAfterSync = !summaryCoverageRange || !selectedPayrollPeriod ? [] : await loadEffectiveAttendanceCorrections(tx, {
      employeeIds: matchedEmployeeIds, payrollPeriodId: selectedPayrollPeriod.id,
      startDate: summaryCoverageRange.startDate, endDate: summaryCoverageRange.endDate,
    });

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
            ? `${ignoredOutOfScopeRows} row(s) were left unmatched because the DTR identifier belongs outside the manager's assigned departments.`
            : null,
          ignoredUnmatchedRows > 0
            ? scope.persistUnmatchedLogs
              ? `${ignoredUnmatchedRows} row(s) were left unmatched because the DTR identifier did not match an employee.`
              : `${ignoredUnmatchedRows} row(s) were ignored because the DTR identifier did not match an employee in the manager's assigned departments.`
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

    const importResult = {
      batch,
      affectedEmployeeIds: matchedEmployeeIds,
      refreshableExceptionRowIds:
        generatedDtrWorkedRows.refreshableExceptionRowIds,
      ignoredOutOfScopeRows,
      ignoredUnmatchedRows,
    };

    if (batch?.payrollPeriodId) {
      await refreshManualPayrollAttendanceForEmployees({
        database: tx,
        actorUserId: scope.actorUserId,
        payrollPeriodId: batch.payrollPeriodId,
        employeeIds: importResult.affectedEmployeeIds,
        refreshableExceptionRowIds: importResult.refreshableExceptionRowIds,
      });
    }

    if (batch) {
      await recordAdminAuditEvent({
        database: tx,
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

    return batch;
  });

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
        currentDepartmentMemberStatusCondition(),
        inArray(employeesGeneralInfo.departmentId, departmentIds)
      )
    );

  return {
    departmentIds,
    employeeIds: employeeRows.map((row) => row.id),
  };
}

async function getManagerOwnedDtrImportBatchIds(
  accountId: string,
  payrollPeriodIds?: string[]
) {
  const auditRows = await db
    .select({
      entityId: adminAuditEvents.entityId,
      details: adminAuditEvents.details,
    })
    .from(adminAuditEvents)
    .where(
      and(
        eq(adminAuditEvents.actorUserId, accountId),
        eq(adminAuditEvents.entityType, "attendance_import_batch"),
        eq(adminAuditEvents.action, "attendance.manager_imported"),
        isNotNull(adminAuditEvents.entityId)
      )
    );
  const payrollPeriodIdSet = payrollPeriodIds
    ? new Set(payrollPeriodIds)
    : null;
  const batchIds = new Set<string>();

  for (const row of auditRows) {
    if (!row.entityId) continue;

    const details = parseAttendanceImportAuditDetails(row.details);
    if (
      payrollPeriodIdSet &&
      (!details.payrollPeriodId ||
        !payrollPeriodIdSet.has(details.payrollPeriodId))
    ) {
      continue;
    }

    batchIds.add(row.entityId);
  }

  return batchIds;
}

function serializeManagerAttendanceBatch(
  batch: typeof attendanceImportBatches.$inferSelect,
  scopedMatchedRows: number,
  canViewUnmatchedDiagnostics: boolean
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
    canViewUnmatchedDiagnostics,
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
  const managerOwnedBatchIds =
    periodIds.length === 0
      ? new Set<string>()
      : await getManagerOwnedDtrImportBatchIds(auth.accountId, periodIds);
  const managerOwnedBatchRows =
    managerOwnedBatchIds.size === 0
      ? []
      : await db
          .select({
            id: attendanceImportBatches.id,
            payrollPeriodId: attendanceImportBatches.payrollPeriodId,
          })
          .from(attendanceImportBatches)
          .where(inArray(attendanceImportBatches.id, [...managerOwnedBatchIds]));
  for (const row of managerOwnedBatchRows) {
    if (!row.payrollPeriodId) continue;
    const batchIds = batchIdsByPeriod.get(row.payrollPeriodId) ?? new Set<string>();
    batchIds.add(row.id);
    batchIdsByPeriod.set(row.payrollPeriodId, batchIds);
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

  const managerOwnedBatchIds = await getManagerOwnedDtrImportBatchIds(
    auth.accountId,
    [payrollPeriodId]
  );
  const batchIds = [
    ...new Set([...scopedRowCountByBatchId.keys(), ...managerOwnedBatchIds]),
  ];
  if (batchIds.length === 0) return [];

  const batchRows = await db
    .select()
    .from(attendanceImportBatches)
    .where(inArray(attendanceImportBatches.id, batchIds))
    .orderBy(desc(attendanceImportBatches.importedAt));

  return batchRows.map((batch) =>
    serializeManagerAttendanceBatch(
      batch,
      scopedRowCountByBatchId.get(batch.id) ?? 0,
      managerOwnedBatchIds.has(batch.id)
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
  await assertManagerDtrPayrollPeriodCanChange(params.payrollPeriodId);

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
      persistUnmatchedLogs: true,
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
    ? serializeManagerAttendanceBatch(batch, batch.matchedRows, true)
    : null;
}

export async function refreshManagerAttendancePeriodSummariesAction(
  payrollPeriodId: string
) {
  const auth = await requireManager();
  const scope = await getManagerAttendanceScope(auth.accountId);

  if (!payrollPeriodId) {
    throw new Error("Select a payroll period before refreshing DTR summaries.");
  }
  if (scope.employeeIds.length === 0) {
    throw new Error("Manager account is not assigned to a department.");
  }

  await assertManagerDtrPayrollPeriodCanChange(payrollPeriodId);

  const refreshResult = await refreshAttendancePeriodSummariesForScope({
    actorUserId: auth.accountId,
    payrollPeriodId,
    employeeIds: scope.employeeIds,
    revalidatePaths: ["/managerDtrFiles", "/payroll"],
    auditAction: "attendance.manager_summaries_refreshed",
    auditDetails: {
      managerAccountId: auth.accountId,
      departmentIds: scope.departmentIds,
    },
  });
  const payrollRecompute = await syncManagerDtrPayrollPeriod({
    actorUserId: auth.accountId,
    payrollPeriodId,
    markStale: false,
  });

  return {
    ...refreshResult,
    payrollRecompute,
  };
}

export async function markManagerDtrPayrollStaleAction(payrollPeriodId: string) {
  const auth = await requireManager();
  const scope = await getManagerAttendanceScope(auth.accountId);

  if (!payrollPeriodId) {
    throw new Error("Select a payroll period before updating DTR summaries.");
  }
  if (scope.employeeIds.length === 0) {
    throw new Error("Manager account is not assigned to a department.");
  }

  const payrollPeriod = await db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, payrollPeriodId),
  });
  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  await db.transaction(async (tx) => {
    await lockAttendancePayrollInput(tx);
    await assertManagerDtrPayrollPeriodCanChange(payrollPeriodId, tx);
    await markPayrollPeriodRunsStale({
      tx,
      payrollPeriodId,
      payrollPeriodCode: payrollPeriod.code,
      actorUserId: auth.accountId,
      notes: "Marked stale because manager DTR updates changed attendance totals.",
    });
  });

  revalidatePath("/payroll");
  revalidatePath("/managerDtrFiles");

  return {
    payrollPeriodCode: payrollPeriod.code,
  };
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

export async function getManagerAttendanceImportBatchUnmatchedDiagnosticsAction(
  batchId: string
): Promise<AttendanceImportBatchDiagnosticsView> {
  const auth = await requireManager({ redirectTo: "/" });
  const scope = await getManagerAttendanceScope(auth.accountId);
  const batch = await db.query.attendanceImportBatches.findFirst({
    where: eq(attendanceImportBatches.id, batchId),
  });

  if (!batch) {
    throw new Error("Attendance import batch not found.");
  }

  const managerOwnedBatchIds = await getManagerOwnedDtrImportBatchIds(
    auth.accountId,
    batch.payrollPeriodId ? [batch.payrollPeriodId] : undefined
  );
  const managerOwnsBatch = managerOwnedBatchIds.has(batch.id);
  const branchVisibleRows =
    scope.employeeIds.length === 0
      ? []
      : await db
          .select({ id: attendanceRawLogs.id })
          .from(attendanceRawLogs)
          .where(
            and(
              eq(attendanceRawLogs.batchId, batch.id),
              isNotNull(attendanceRawLogs.employeeId),
              inArray(attendanceRawLogs.employeeId, scope.employeeIds)
            )
          )
          .limit(1);

  if (!managerOwnsBatch && branchVisibleRows.length === 0) {
    throw new Error("Attendance import batch not found.");
  }

  if (!managerOwnsBatch) {
    return {
      batchId: batch.id,
      totalUnmatchedRows: 0,
      groups: [],
    };
  }

  return buildAttendanceImportBatchUnmatchedDiagnostics({
    batchId: batch.id,
    managerEmployeeIds: scope.employeeIds,
  });
}

export async function submitManagerAttendanceDtrHoldRowsAction(input: unknown) {
  const auth = await requireManager();
  const parsed = attendanceDtrHoldApprovalSchema.parse(input);
  const attendanceDates = [...new Set(parsed.attendanceDates)].sort((left, right) =>
    left.localeCompare(right)
  );
  const targetPayrollPeriodId = parsed.targetPayrollPeriodId;

  const scope = await getManagerAttendanceScope(auth.accountId);
  if (!scope.employeeIds.includes(parsed.employeeId)) {
    throw new Error("Employee is not assigned to one of this manager's departments.");
  }
  await assertManagerDtrPayrollPeriodCanChange(parsed.sourcePayrollPeriodId);
  await assertManagerDtrPayrollPeriodCanChange(targetPayrollPeriodId);

  const result = await db.transaction(async (tx) => {
    await lockAttendancePayrollInput(tx);
    await assertManagerDtrPayrollPeriodCanChange(parsed.sourcePayrollPeriodId, tx);
    await assertManagerDtrPayrollPeriodCanChange(targetPayrollPeriodId, tx);
    const heldRows = await loadAttendanceDtrHeldRows(
      parsed.sourcePayrollPeriodId,
      scope.employeeIds, tx
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
      workedMinutes: computeAttendanceHoldWorkedMinutes({
        intendedWorkedMinutes,
        lateMinutes: parsed.lateMinutes,
        undertimeMinutes: parsed.undertimeMinutes,
      }),
      lateMinutes: parsed.lateMinutes,
      undertimeMinutes: parsed.undertimeMinutes,
      overtimeMinutes: parsed.overtimeMinutes,
    };

    const [sourcePeriod, targetPeriod] = await Promise.all([
      tx.query.payrollPeriods.findFirst({
        where: eq(payrollPeriods.id, parsed.sourcePayrollPeriodId),
      }),
      tx.query.payrollPeriods.findFirst({
        where: eq(payrollPeriods.id, targetPayrollPeriodId),
      }),
    ]);

    if (!sourcePeriod) throw new Error("Source payroll period not found.");
    if (!targetPeriod) throw new Error("Target payroll period not found.");
    if (targetPeriod.startDate < sourcePeriod.startDate) {
      throw new Error(
        "Target payroll period must be the selected period or a future period."
      );
    }

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
      ...previousSubmissions.map((submission) => submission.targetPayrollPeriodId),
      targetPayrollPeriodId,
    ]);

    for (const affectedId of new Set([parsed.sourcePayrollPeriodId, ...affectedTargetPeriodIds])) {
      await assertManagerDtrPayrollPeriodCanChange(affectedId, tx);
      const affectedPeriod = await lockEditableAttendancePeriod(tx, affectedId);
      const staleRunCount = await markPayrollPeriodRunsStale({ tx, payrollPeriodId: affectedId, payrollPeriodCode: affectedPeriod.code, actorUserId: auth.accountId, notes: "Marked stale because held attendance was approved or retargeted." });
      affectedTargetPeriods.set(affectedId, { payrollPeriodCode: affectedPeriod.code, refreshableExceptionRowIds: [], generatedAccountCodeRowCount: 0, staleRunCount });
    }
    const approvedAt = new Date();
    const splitSubmissions = splitAttendanceHoldApprovalMinutes(
      submissionTotals,
      attendanceDates
    );
    await tx
      .insert(attendanceDtrHoldApprovals)
      .values(
        splitSubmissions.map((submission) => ({
          sourcePayrollPeriodId: parsed.sourcePayrollPeriodId,
          targetPayrollPeriodId,
          employeeId: parsed.employeeId,
          attendanceDate: submission.attendanceDate,
          status: "Approved",
          workedMinutes: submission.workedMinutes,
          lateMinutes: submission.lateMinutes,
          undertimeMinutes: submission.undertimeMinutes,
          overtimeMinutes: submission.overtimeMinutes,
          notes: parsed.notes ?? null,
          approvedByUserId: auth.accountId,
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

    for (const affectedTargetPeriodId of affectedTargetPeriodIds) {
      const rebuilt = await rebuildHeldDtrExceptionRowsForTargetPeriod({
        tx,
        actorUserId: auth.accountId,
        targetPayrollPeriodId: affectedTargetPeriodId,
        employeeId: parsed.employeeId,
      });
      if (
        rebuilt.refreshableExceptionRowIds.length === 0 &&
        rebuilt.generatedAccountCodeRowCount === 0 &&
        rebuilt.staleRunCount === 0
      ) {
        continue;
      }
      const current = affectedTargetPeriods.get(affectedTargetPeriodId) ?? {
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
      affectedTargetPeriods.set(affectedTargetPeriodId, current);
    }

    await recordAdminAuditEvent({
      actorUserId: auth.accountId,
      entityType: "attendance_dtr_hold_approval",
      entityId: `${parsed.sourcePayrollPeriodId}:${parsed.employeeId}`,
      action: "attendance.manager_dtr_hold.auto_approved",
      details: {
        sourcePayrollPeriodId: parsed.sourcePayrollPeriodId,
        sourcePayrollPeriodCode: sourcePeriod.code,
        targetPayrollPeriodId,
        targetPayrollPeriodCode: targetPeriod.code,
        employeeId: parsed.employeeId,
        attendanceDates,
        approvalTotals: submissionTotals,
        previousSubmissionCount: previousSubmissions.length,
        affectedTargetPeriods: [...affectedTargetPeriods.entries()].map(
          ([payrollPeriodId, affected]) => ({
            payrollPeriodId,
            ...affected,
          })
        ),
      },
      database: tx,
    });

    const result = {
      sourcePayrollPeriodCode: sourcePeriod.code,
      targetPayrollPeriodCode: targetPeriod.code,
      submittedDateCount: attendanceDates.length,
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

    for (const affected of result.affectedTargetPeriods) {
      await refreshManualPayrollAttendanceForEmployees({
        database: tx,
        actorUserId: auth.accountId,
        payrollPeriodId: affected.payrollPeriodId,
        employeeIds: [parsed.employeeId],
        refreshableExceptionRowIds: affected.refreshableExceptionRowIds,
        refreshHeldDtrLines: true,
      });
    }

    return result;
  });

  const recomputePeriodIds = [
    ...new Set([
      targetPayrollPeriodId,
      ...result.affectedTargetPeriods.map((affected) => affected.payrollPeriodId),
    ]),
  ];
  const payrollRecompute = await Promise.all(
    recomputePeriodIds.map((payrollPeriodId) =>
      syncManagerDtrPayrollPeriod({
        actorUserId: auth.accountId,
        payrollPeriodId,
        markStale: false,
      })
    )
  );

  revalidatePath("/managerDtrFiles");
  revalidatePath("/payroll");

  return {
    ...result,
    payrollRecompute,
  };
}

export async function saveManagerAttendanceDtrDayMetricOverrideAction(
  input: unknown
) {
  const auth = await requireManager();
  const parsed = managerAttendanceDtrDayMetricOverrideSchema.parse(input);
  const scope = await getManagerAttendanceScope(auth.accountId);

  if (!scope.employeeIds.includes(parsed.employeeId)) {
    throw new Error("Employee is not assigned to one of this manager's departments.");
  }

  const payrollPeriod = await db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, parsed.payrollPeriodId),
  });
  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }
  await assertManagerDtrPayrollPeriodCanChange(payrollPeriod.id);

  if (
    parsed.attendanceDate < payrollPeriod.startDate ||
    parsed.attendanceDate > payrollPeriod.endDate
  ) {
    throw new Error("Attendance date is outside the selected payroll period.");
  }

  const summaryRow = await db.query.attendanceDailySummaries.findFirst({
    where: and(
      eq(attendanceDailySummaries.employeeId, parsed.employeeId),
      eq(attendanceDailySummaries.attendanceDate, parsed.attendanceDate)
    ),
  });
  if (!summaryRow) {
    throw new Error("DTR summary row not found.");
  }

  const overrideValues = {
    lateMinutes: parsed.lateMinutes ?? null,
    undertimeMinutes: parsed.undertimeMinutes ?? null,
    overtimeMinutes: parsed.overtimeMinutes ?? null,
  };
  const isClearing = Object.values(overrideValues).every(
    (value) => value == null
  );

  const result = await db.transaction(async (tx) => {
    await lockAttendancePayrollInput(tx);
    await assertManagerDtrPayrollPeriodCanChange(parsed.payrollPeriodId, tx);
    const currentSummary = await tx.query.attendanceDailySummaries.findFirst({
      where: and(eq(attendanceDailySummaries.employeeId, parsed.employeeId), eq(attendanceDailySummaries.attendanceDate, parsed.attendanceDate)),
    });
    if (!currentSummary) throw new Error("DTR summary row was removed. Refresh before editing this date.");
    const staleRunCount = await markPayrollPeriodRunsStale({
      tx,
      payrollPeriodId: payrollPeriod.id,
      payrollPeriodCode: payrollPeriod.code,
      actorUserId: auth.accountId,
      notes: "Marked stale because manager DTR row metric overrides changed.",
    });

    if (isClearing) {
      await tx
        .delete(employeeAttendanceDayMetricOverrides)
        .where(
          and(
            eq(
              employeeAttendanceDayMetricOverrides.payrollPeriodId,
              parsed.payrollPeriodId
            ),
            eq(employeeAttendanceDayMetricOverrides.employeeId, parsed.employeeId),
            eq(
              employeeAttendanceDayMetricOverrides.attendanceDate,
              parsed.attendanceDate
            )
          )
        );
    } else {
      await tx
        .insert(employeeAttendanceDayMetricOverrides)
        .values({
          payrollPeriodId: parsed.payrollPeriodId,
          employeeId: parsed.employeeId,
          attendanceDate: parsed.attendanceDate,
          ...overrideValues,
        })
        .onConflictDoUpdate({
          target: [
            employeeAttendanceDayMetricOverrides.payrollPeriodId,
            employeeAttendanceDayMetricOverrides.employeeId,
            employeeAttendanceDayMetricOverrides.attendanceDate,
          ],
          set: {
            lateMinutes: sql`excluded.late_minutes`,
            undertimeMinutes: sql`excluded.undertime_minutes`,
            overtimeMinutes: sql`excluded.overtime_minutes`,
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
      actorUserId: auth.accountId,
      entityType: "employee_attendance_day_metric_override",
      entityId: `${parsed.payrollPeriodId}:${parsed.employeeId}:${parsed.attendanceDate}`,
      action: isClearing
        ? "attendance.manager_dtr_day_metric_override.cleared"
        : "attendance.manager_dtr_day_metric_override.updated",
      details: {
        payrollPeriodId: parsed.payrollPeriodId,
        payrollPeriodCode: payrollPeriod.code,
        employeeId: parsed.employeeId,
        attendanceDate: parsed.attendanceDate,
        overrides: overrideValues,
        departmentIds: scope.departmentIds,
        generatedAccountCodeRowCount:
          generatedDtrRows.generatedAccountCodeRowCount,
        staleRunCount,
      },
      database: tx,
    });

    const manualPayrollRefresh = await refreshManualPayrollAttendanceForEmployees({
      database: tx,
      actorUserId: auth.accountId,
      payrollPeriodId: parsed.payrollPeriodId,
      employeeIds: [parsed.employeeId],
      refreshableExceptionRowIds: generatedDtrRows.refreshableExceptionRowIds,
    });
    return {
      manualPayrollRefresh,
      ...generatedDtrRows,
      staleRunCount,
    };
  });


  revalidatePath("/managerDtrFiles");
  revalidatePath("/payroll");

  const payrollRecompute = await syncManagerDtrPayrollPeriod({
    actorUserId: auth.accountId,
    payrollPeriodId: parsed.payrollPeriodId,
    markStale: false,
  });

  return {
    payrollPeriodCode: payrollPeriod.code,
    attendanceDate: parsed.attendanceDate,
    cleared: isClearing,
    manualPayrollRefresh: result.manualPayrollRefresh,
    generatedAccountCodeRowCount: result.generatedAccountCodeRowCount,
    staleRunCount: result.staleRunCount,
    payrollRecompute,
  };
}

type AttendanceImportBatchRevertRawLog = {
  id: number;
  employeeId: string | null;
  logDate: string;
};

type AttendanceImportBatchRevertOptions = {
  actorUserId: string;
  managerScope?: boolean;
  auditAction: string;
  auditDetails?: Record<string, unknown>;
  revalidatePaths: string[];
  validateRawLogs?: (rawLogRows: AttendanceImportBatchRevertRawLog[]) => void;
};

async function revertAttendanceImportBatchForActor(
  batchId: string,
  options: AttendanceImportBatchRevertOptions
) {
  const batch = await db.query.attendanceImportBatches.findFirst({
    where: eq(attendanceImportBatches.id, batchId),
  });

  if (!batch) {
    throw new Error("Attendance import batch not found.");
  }

  assertFileAttendanceBatch(batch.sourceFormat);

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

  const result = await db.transaction(async (tx) => {
    await lockAttendancePayrollInput(tx);
    if (payrollPeriod) {
      await assertManagerDtrPayrollPeriodCanChange(payrollPeriod.id, tx);
      await lockEditableAttendancePeriod(tx, payrollPeriod.id);
    }
    const currentBatch = await tx.query.attendanceImportBatches.findFirst({ where: eq(attendanceImportBatches.id, batch.id) });
    if (!currentBatch) throw new Error("Attendance import batch was already removed. Refresh the file list.");
    const rawLogRows = await tx
      .select({
        id: attendanceRawLogs.id,
        employeeId: attendanceRawLogs.employeeId,
        logDate: attendanceRawLogs.logDate,
      })
      .from(attendanceRawLogs)
      .where(eq(attendanceRawLogs.batchId, batch.id));

    options.validateRawLogs?.(rawLogRows);

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
      if (options.managerScope) await assertManagerDtrPayrollPeriodCanChange(targetPayrollPeriodId, tx);

      const rebuilt = await rebuildHeldDtrExceptionRowsForTargetPeriod({
        tx,
        actorUserId: options.actorUserId,
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
          actorUserId: options.actorUserId,
        })
      : 0;
    const generatedDtrWorkedRows = payrollPeriod
      ? await syncGeneratedDtrWorkedExceptionRows({
          tx,
          payrollPeriod,
          employeeIds: affectedEmployeeIds,
        })
      : EMPTY_GENERATED_DTR_EXCEPTION_ROW_SYNC;

    const revertResult = {
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
    const result = revertResult.result;

    if (payrollPeriod) {
      await refreshManualPayrollAttendanceForEmployees({
        database: tx,
        actorUserId: options.actorUserId,
        payrollPeriodId: payrollPeriod.id,
        employeeIds: revertResult.affectedEmployeeIds,
        refreshableExceptionRowIds: revertResult.refreshableExceptionRowIds,
      });
    }
    for (const targetPeriod of revertResult.affectedTargetPeriods) {
      await refreshManualPayrollAttendanceForEmployees({
        database: tx,
        actorUserId: options.actorUserId,
        payrollPeriodId: targetPeriod.payrollPeriodId,
        employeeIds: targetPeriod.employeeIds,
        refreshableExceptionRowIds: targetPeriod.refreshableExceptionRowIds,
        refreshHeldDtrLines: true,
      });
    }

    await recordAdminAuditEvent({
      database: tx,
      actorUserId: options.actorUserId,
      entityType: "attendance_import_batch",
      entityId: batch.id,
      action: options.auditAction,
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
        ...options.auditDetails,
      },
    });

    return result;
  });

  for (const path of options.revalidatePaths) {
    revalidatePath(path);
  }
  return result;
}

export async function revertAttendanceImportBatchAction(batchId: string) {
  const actor = await requireAdminActor();

  return revertAttendanceImportBatchForActor(batchId, {
    actorUserId: actor.userId,
    auditAction: "attendance.import_reverted",
    revalidatePaths: ["/payroll"],
  });
}

export async function revertManagerDtrImportBatchAction(batchId: string) {
  const auth = await requireManager();
  const scope = await getManagerAttendanceScope(auth.accountId);

  if (scope.employeeIds.length === 0) {
    throw new Error("Manager account is not assigned to a department.");
  }

  const batch = await db.query.attendanceImportBatches.findFirst({
    where: eq(attendanceImportBatches.id, batchId),
  });
  if (!batch) {
    throw new Error("Attendance import batch not found.");
  }
  if (batch.payrollPeriodId) {
    await assertManagerDtrPayrollPeriodCanChange(batch.payrollPeriodId);
  }

  const allowedEmployeeIds = new Set(scope.employeeIds);

  return revertAttendanceImportBatchForActor(batchId, {
    actorUserId: auth.accountId,
    managerScope: true,
    auditAction: "attendance.manager_import_removed",
    auditDetails: {
      managerAccountId: auth.accountId,
      departmentIds: scope.departmentIds,
    },
    revalidatePaths: ["/managerDtrFiles", "/payroll"],
    validateRawLogs(rawLogRows) {
      if (rawLogRows.length === 0) {
        throw new Error("No removable DTR logs were found for this import.");
      }

      const hasOutOfScopeRow = rawLogRows.some(
        (row) => !row.employeeId || !allowedEmployeeIds.has(row.employeeId)
      );

      if (hasOutOfScopeRow) {
        throw new Error(
          "This DTR import includes rows outside your assigned departments. Ask Admin to remove it."
        );
      }
    },
  });
}

function isAttendanceSummaryHeld(summary: AttendanceHoldRefreshSummaryRow) {
  const flags = normalizeAttendanceDtrAnomalyFlags(summary.anomalyFlags ?? null);
  const hasHoldFlag =
    flags.includes("ODD_PUNCH_COUNT") || flags.includes("MISSING_OUT");
  return hasHoldFlag && !flags.includes("DOUBLE_PUNCH");
}

function getAttendanceHoldRefreshMinutes(
  summary: AttendanceHoldRefreshSummaryRow | null | undefined
): AttendanceHoldApprovalMinutes {
  const scheduledMinutes = summary?.scheduledMinutes ?? 0;
  const intendedWorkedMinutes =
    scheduledMinutes > 0 ? scheduledMinutes : FALLBACK_HELD_DTR_WORKED_MINUTES;
  const lateMinutes = summary?.lateMinutes ?? 0;
  const undertimeMinutes = summary?.undertimeMinutes ?? 0;

  return {
    workedMinutes: computeAttendanceHoldWorkedMinutes({
      intendedWorkedMinutes,
      lateMinutes,
      undertimeMinutes,
    }),
    lateMinutes,
    undertimeMinutes,
    overtimeMinutes: summary?.overtimeMinutes ?? 0,
  };
}

async function refreshUnapprovedAttendanceHoldApprovals(args: {
  tx: AttendanceTransaction;
  payrollPeriod: typeof payrollPeriods.$inferSelect;
  employeeIds: string[];
  summaries: AttendanceHoldRefreshSummaryRow[];
  dayStatusOverrides: Array<typeof employeeAttendanceDayStatusOverrides.$inferSelect>;
}) {
  const employeeIds = [...new Set(args.employeeIds)];
  if (employeeIds.length === 0) {
    return {
      refreshedHoldApprovalCount: 0,
      deletedHoldApprovalCount: 0,
      clearedManualHoldOverrideCount: 0,
    };
  }

  const summaryByKey = new Map(
    args.summaries.map((summary) => [
      `${summary.employeeId}|${summary.attendanceDate}`,
      summary,
    ])
  );
  const heldKeys = new Set<string>();

  for (const summary of args.summaries) {
    if (isAttendanceSummaryHeld(summary)) {
      heldKeys.add(`${summary.employeeId}|${summary.attendanceDate}`);
    }
  }

  const unapprovedRows = await args.tx
    .select()
    .from(attendanceDtrHoldApprovals)
    .where(
      and(
        eq(attendanceDtrHoldApprovals.sourcePayrollPeriodId, args.payrollPeriod.id),
        inArray(attendanceDtrHoldApprovals.employeeId, employeeIds),
        gte(attendanceDtrHoldApprovals.attendanceDate, args.payrollPeriod.startDate),
        lte(attendanceDtrHoldApprovals.attendanceDate, args.payrollPeriod.endDate),
        sql`${attendanceDtrHoldApprovals.status} <> 'Approved'`
      )
    );

  let refreshedHoldApprovalCount = 0;
  let deletedHoldApprovalCount = 0;
  let clearedManualHoldOverrideCount = 0;

  for (const row of unapprovedRows) {
    const key = `${row.employeeId}|${row.attendanceDate}`;

    if (!heldKeys.has(key)) {
      await args.tx
        .delete(attendanceDtrHoldApprovals)
        .where(eq(attendanceDtrHoldApprovals.id, row.id));
      deletedHoldApprovalCount += 1;
      continue;
    }

    const minutes = getAttendanceHoldRefreshMinutes(summaryByKey.get(key));
    await args.tx
      .update(attendanceDtrHoldApprovals)
      .set({
        workedMinutes: minutes.workedMinutes,
        lateMinutes: minutes.lateMinutes,
        undertimeMinutes: minutes.undertimeMinutes,
        overtimeMinutes: minutes.overtimeMinutes,
        updatedAt: new Date(),
      })
      .where(eq(attendanceDtrHoldApprovals.id, row.id));
    refreshedHoldApprovalCount += 1;
  }

  const staleManualHoldOverrides = args.dayStatusOverrides.filter(
    (override) =>
      override.status === "Hold" &&
      employeeIds.includes(override.employeeId) &&
      override.attendanceDate >= args.payrollPeriod.startDate &&
      override.attendanceDate <= args.payrollPeriod.endDate &&
      !heldKeys.has(`${override.employeeId}|${override.attendanceDate}`)
  );

  for (const override of staleManualHoldOverrides) {
    await args.tx
      .delete(employeeAttendanceDayStatusOverrides)
      .where(eq(employeeAttendanceDayStatusOverrides.id, override.id));
    clearedManualHoldOverrideCount += 1;
  }

  return {
    refreshedHoldApprovalCount,
    deletedHoldApprovalCount,
    clearedManualHoldOverrideCount,
  };
}

async function refreshAttendancePeriodSummariesForScope(args: {
  actorUserId: string;
  payrollPeriodId: string;
  employeeIds?: string[];
  revalidatePaths: string[];
  auditAction: string;
  auditDetails?: Record<string, unknown>;
}) {
  const result=await withAttendanceFinancialRefresh(db,args.payrollPeriodId,async tx=>{
  if (args.employeeIds) await assertManagerDtrPayrollPeriodCanChange(args.payrollPeriodId, tx);
  const sourceVersion = await attendanceSourceVersion(args.payrollPeriodId,tx);
  const sourceData = await loadAttendancePeriodSourceData(
    tx,
    args.payrollPeriodId,
    undefined,
    args.employeeIds ? { employeeIds: args.employeeIds } : undefined
  );

  if (process.env.ATTENDANCE_WORKBENCH_ENABLED!=="true" && (sourceData.rawLogs.length === 0 || sourceData.employeeRecords.length === 0)) {
    throw new Error(
      "No matched attendance logs are available yet for the selected payroll period."
    );
  }

  const matchedEmployeeIds = sourceData.employeeRecords.map((employee) => employee.id);
  const resolvedApprovedLeaves = await resolveApprovedLeaveFlags(sourceData.approvedLeaves,tx);
  const sourceParsedLogs = mapAttendanceRawRowsToParsedLogs(sourceData.rawLogs);
  const decisions=process.env.ATTENDANCE_WORKBENCH_ENABLED==="true"?await tx.select().from(workTreatments).where(and(eq(workTreatments.periodId,args.payrollPeriodId),eq(workTreatments.active,true))):[];
  const decidedDays=new Set(decisions.filter(d=>(d.payload as {kind?:string})?.kind==="AdminDecision").map(d=>`${d.employeeId}|${d.day}`));
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

  const summaryRefreshResult = await (async () => {
    await confirmAttendanceSourceSummaryRefresh(tx, args.payrollPeriodId, sourceVersion, false);
    const staleRunCount = await markPayrollPeriodRunsStale({
      tx,
      payrollPeriodId: sourceData.payrollPeriod.id,
      payrollPeriodCode: sourceData.payrollPeriod.code,
      actorUserId: args.actorUserId,
    });

    // Insert corrections first so that auto-approved ones (e.g. Same-Direction
    // Duplicate) are in the DB before summaries are computed and saved.
    const correctionSuggestionSync = await syncAttendanceCorrectionSuggestions({
      tx,
      payrollPeriod: sourceData.payrollPeriod,
      employeeIds: matchedEmployeeIds,
      suggestions: correctionSuggestions.filter(row=>!decidedDays.has(`${row.employeeId}|${row.attendanceDate}`)),
    });

    // Reload approved corrections to include any that were just auto-approved.
    const approvedCorrectionsAfterSync = await loadEffectiveAttendanceCorrections(tx, {
      payrollPeriodId: sourceData.payrollPeriod.id, employeeIds: matchedEmployeeIds,
      startDate: sourceData.payrollPeriod.startDate, endDate: sourceData.payrollPeriod.endDate,
    });

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
      approvedCorrections: mapApprovedCorrectionRows(approvedCorrectionsAfterSync.filter(row=>!decidedDays.has(`${row.employeeId}|${row.attendanceDate}`))),
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
    const holdRefresh = await refreshUnapprovedAttendanceHoldApprovals({
      tx,
      payrollPeriod: sourceData.payrollPeriod,
      employeeIds: matchedEmployeeIds,
      summaries: summaryComputations,
      dayStatusOverrides: sourceData.dayStatusOverrides,
    });

    return {
      staleRunCount,
      summaryCount: summaryComputations.length,
      pendingSuggestionCount: correctionSuggestionSync.pendingSuggestionCount,
      generatedAccountCodeRowCount:
        generatedDtrWorkedRows.generatedAccountCodeRowCount,
      refreshableExceptionRowIds:
        generatedDtrWorkedRows.refreshableExceptionRowIds,
      refreshedHoldApprovalCount: holdRefresh.refreshedHoldApprovalCount,
      deletedHoldApprovalCount: holdRefresh.deletedHoldApprovalCount,
      clearedManualHoldOverrideCount:
        holdRefresh.clearedManualHoldOverrideCount,
    };
  })();
  const { staleRunCount } = summaryRefreshResult;

  await refreshManualPayrollAttendanceForEmployees({
    database:tx,
    actorUserId: args.actorUserId,
    payrollPeriodId: sourceData.payrollPeriod.id,
    employeeIds: matchedEmployeeIds,
    refreshableExceptionRowIds: summaryRefreshResult.refreshableExceptionRowIds,
  });

  // Only a successful full-period rebuild (including manual-payroll refresh) clears the guard.
  await confirmAttendanceSourceSummaryRefresh(tx, args.payrollPeriodId, sourceVersion, !args.employeeIds);

  await recordAdminAuditEvent({
    database:tx,
    actorUserId: args.actorUserId,
    entityType: "attendance_daily_summaries",
    entityId: sourceData.payrollPeriod.id,
    action: args.auditAction,
    details: {
      payrollPeriodId: sourceData.payrollPeriod.id,
      payrollPeriodCode: sourceData.payrollPeriod.code,
      employeeCount: matchedEmployeeIds.length,
      rawLogCount: sourceData.rawLogs.length,
      summaryCount: summaryRefreshResult.summaryCount,
      pendingSuggestionCount: summaryRefreshResult.pendingSuggestionCount,
      generatedAccountCodeRowCount:
        summaryRefreshResult.generatedAccountCodeRowCount,
      staleRunCount,
      refreshedHoldApprovalCount:
        summaryRefreshResult.refreshedHoldApprovalCount,
      deletedHoldApprovalCount: summaryRefreshResult.deletedHoldApprovalCount,
      clearedManualHoldOverrideCount:
        summaryRefreshResult.clearedManualHoldOverrideCount,
      ...args.auditDetails,
    },
  });

  return {
    payrollPeriodCode: sourceData.payrollPeriod.code,
    employeeCount: matchedEmployeeIds.length,
    rawLogCount: sourceData.rawLogs.length,
    summaryCount: summaryRefreshResult.summaryCount,
    pendingSuggestionCount: summaryRefreshResult.pendingSuggestionCount,
    generatedAccountCodeRowCount:
      summaryRefreshResult.generatedAccountCodeRowCount,
    staleRunCount,
    refreshedHoldApprovalCount:
      summaryRefreshResult.refreshedHoldApprovalCount,
    deletedHoldApprovalCount: summaryRefreshResult.deletedHoldApprovalCount,
    clearedManualHoldOverrideCount:
      summaryRefreshResult.clearedManualHoldOverrideCount,
  };
  });
  for(const path of args.revalidatePaths)revalidatePath(path);
  return result;
}

export async function refreshAttendancePeriodSummariesAction(payrollPeriodId: string) {
  const actor = await requireAdminActor();
  return refreshAttendancePeriodSummariesForScope({
    actorUserId: actor.userId,
    payrollPeriodId,
    revalidatePaths: ["/payroll", "/managerDtrFiles"],
    auditAction: "attendance.summaries_refreshed",
  });
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
  const metricOverrideByEmployeeDate = buildDtrMetricOverrideByEmployeeDate(
    sourceData.dayMetricOverrides
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
        const metricOverride =
          metricOverrideByEmployeeDate.get(
            `${employee.id}|${row.attendanceDate}`
          ) ?? null;
        const effectiveMetrics = applyAttendanceDtrMetricOverride(
          row,
          metricOverride
        );

        return {
          source: row,
          computedStatus: getComputedAttendanceDtrStatus(row),
          manualStatus,
          calendarDayType,
          manualDayType,
          effectiveDayType: manualDayType ?? calendarDayType,
          metricOverride,
          effective: applyAttendanceDtrEffectiveStatus(
            effectiveMetrics,
            manualStatus
          ),
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
          biometricWorkedMinutes: row.source.workedMinutes,
          biometricLateMinutes: row.source.lateMinutes,
          biometricUndertimeMinutes: row.source.undertimeMinutes,
          biometricOvertimeMinutes: row.source.overtimeMinutes,
          isLateOverridden: row.metricOverride?.lateMinutes != null,
          isUndertimeOverridden: row.metricOverride?.undertimeMinutes != null,
          isOvertimeOverridden: row.metricOverride?.overtimeMinutes != null,
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
  const metricOverrideByEmployeeDate = buildDtrMetricOverrideByEmployeeDate(
    sourceData.dayMetricOverrides
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
        const metricOverride =
          metricOverrideByEmployeeDate.get(
            `${employee.id}|${summary.attendanceDate}`
          ) ?? null;
        const effectiveMetrics = applyAttendanceDtrMetricOverride(
          source,
          metricOverride
        );
        const effective = applyAttendanceDtrEffectiveStatus(
          effectiveMetrics,
          manualStatus
        );
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
          biometricWorkedMinutes: source.workedMinutes,
          biometricLateMinutes: source.lateMinutes,
          biometricUndertimeMinutes: source.undertimeMinutes,
          biometricOvertimeMinutes: source.overtimeMinutes,
          isLateOverridden: metricOverride?.lateMinutes != null,
          isUndertimeOverridden: metricOverride?.undertimeMinutes != null,
          isOvertimeOverridden: metricOverride?.overtimeMinutes != null,
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

export async function getAttendancePeriodBundleAction(
  payrollPeriodId: string
): Promise<{
  summary: AttendanceDtrSummaryView;
  heldRows: AttendanceDtrHeldRowsView;
}> {
  await requireAdminActor();
  const [sourceData, heldRows] = await Promise.all([
    loadAttendancePeriodPersistedSummarySourceData(db, payrollPeriodId),
    loadAttendanceDtrHeldRows(payrollPeriodId),
  ]);
  const employeesForView =
    buildAttendanceDtrEmployeesFromPersistedSummaries(sourceData);

  return {
    summary: {
      payrollPeriod: serializeAttendancePayrollPeriod(sourceData.payrollPeriod),
      employees: employeesForView.map(toAttendanceDtrSummary),
    },
    heldRows,
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
  workedManuallyEdited: z.boolean().optional(),
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


const HELD_DTR_OVERRIDE_SOURCES = [
  "DTR_HOLD_WORKED",
  "DTR_HOLD_TARDINESS",
  "DTR_HOLD_UNDERTIME",
  "DTR_HOLD_REGULAR_OVERTIME",
] as const satisfies readonly PayrollExceptionDtrOverrideSource[];

type HeldDtrOverrideSource = (typeof HELD_DTR_OVERRIDE_SOURCES)[number];

const HELD_DTR_ACCOUNT_CODE_CONFIG = {
  DTR_HOLD_WORKED: {
    code: "1-REG",
    accountType: "Regular Hours",
    description: "Held DTR Worked/Regular Hours",
    dailyRate: "1.0000",
    monthlyRate: "1.0000",
  },
  DTR_HOLD_TARDINESS: {
    code: "9-LATE",
    accountType: "Other Deduction",
    description: "Held DTR Late/Tardiness",
    dailyRate: null,
    monthlyRate: null,
  },
  DTR_HOLD_UNDERTIME: {
    code: "6-UT",
    accountType: "Unpaid Leaves/Absences",
    description: "Held DTR Undertime/Absence",
    dailyRate: null,
    monthlyRate: null,
  },
  DTR_HOLD_REGULAR_OVERTIME: {
    code: "2-OT",
    accountType: "Overtime",
    description: "Held DTR Regular Overtime",
    dailyRate: "1.2500",
    monthlyRate: "1.2500",
  },
} as const;


type AttendanceHoldApprovalMinutes = {
  workedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
};

type AttendanceHoldRefreshSummaryRow = Pick<
  typeof attendanceDailySummaries.$inferInsert,
  | "employeeId"
  | "attendanceDate"
  | "anomalyFlags"
  | "scheduledMinutes"
  | "lateMinutes"
  | "undertimeMinutes"
  | "overtimeMinutes"
>;








const FALLBACK_HELD_DTR_WORKED_MINUTES = 8 * 60;





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
    dayMetricOverrideRows,
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
      .from(employeeAttendanceDayMetricOverrides)
      .where(
        and(
          eq(employeeAttendanceDayMetricOverrides.payrollPeriodId, args.payrollPeriodId),
          eq(employeeAttendanceDayMetricOverrides.employeeId, args.employeeId),
          gte(employeeAttendanceDayMetricOverrides.attendanceDate, payrollPeriod.startDate),
          lte(employeeAttendanceDayMetricOverrides.attendanceDate, payrollPeriod.endDate)
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
  const metricOverrideByDate = new Map(
    dayMetricOverrideRows.map((override) => [override.attendanceDate, override])
  );
  const effectiveRows = summaryRows.map((row) =>
    applyAttendanceDtrEffectiveStatus(
      applyAttendanceDtrMetricOverride(
        row,
        metricOverrideByDate.get(row.attendanceDate) ?? null
      ),
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
      isBranchCalendarDateEligible: (row) =>
        !getEffectiveHolidayTypeForDate({
          attendanceDate: row.attendanceDate,
          manualDayTypeByDate,
          calendarHolidayTypeByDate,
        }),
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

  const generatedRows = await calculateGeneratedDtrRows(args);

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
  database?:DbClient;
  actorUserId: string;
  payrollPeriodId: string;
  employeeIds: string[];
  refreshableExceptionRowIds?: string[];
  refreshHeldDtrLines?: boolean;
}) {
  const database=args.database??db;
  const monthlyEmployees=args.employeeIds.length?await database.select({id:employeesSalary.employeeId}).from(employeesSalary).where(and(inArray(employeesSalary.employeeId,args.employeeIds),sql`${employeesSalary.monthlyRate}>0`)):[];
  const monthlyIds=new Set(monthlyEmployees.map(e=>e.id));
  // DTR refresh must not rewrite explicitly entered monthly salary adjustments.
  const employeeIds = [...new Set(args.employeeIds)].filter(id=>!monthlyIds.has(id));
  let refreshedEntryCount = 0;

  for (const employeeId of employeeIds) {
    const latestManualBaseline = await computeManualPayrollLatestBaseline(
      args.payrollPeriodId,
      employeeId,database
    );
    const manualPayrollRefresh =
      await refreshManualPayrollAttendanceLinesFromBaseline({
        database:args.database,
        actorUserId: args.actorUserId,
        payrollPeriodId: args.payrollPeriodId,
        employeeId,
        latestBaseline: latestManualBaseline,
        refreshableExceptionRowIds: args.refreshableExceptionRowIds,
        refreshHeldDtrLines: args.refreshHeldDtrLines,
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
    await lockAttendancePayrollInput(tx);
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
    await lockAttendancePayrollInput(tx);
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
  await lockEditableAttendancePeriod(args.tx, args.targetPayrollPeriodId);
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
  const heldLatePenaltyMinutes = computeAccumulatedLatePenaltyMinutes(
    totals.lateMinutes
  );
  const heldPayrollTardinessMinutes = computePayrollTardinessMinutes(
    totals.lateMinutes
  );
  const heldWorkedMinutes = Math.max(
    0,
    totals.workedMinutes - heldLatePenaltyMinutes
  );

  if (heldWorkedMinutes > 0) {
    heldRows.push(
      createHeldDtrExceptionRow({
        payrollPeriodId: args.targetPayrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: payrollPeriod.startDate,
        source: "DTR_HOLD_WORKED",
        account: accountBySource.get("DTR_HOLD_WORKED")!,
        quantityMinutes: heldWorkedMinutes,
      })
    );
  }

  if (heldPayrollTardinessMinutes > 0) {
    heldRows.push(
      createHeldDtrExceptionRow({
        payrollPeriodId: args.targetPayrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: payrollPeriod.startDate,
        source: "DTR_HOLD_TARDINESS",
        account: accountBySource.get("DTR_HOLD_TARDINESS")!,
        quantityMinutes: heldPayrollTardinessMinutes,
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
    await lockAttendancePayrollInput(tx);
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
  const leaveRows = await getEmployeePayrollManualLeaveAccountCodeRows({
    payrollPeriodId: args.payrollPeriodId,
    employeeId: args.employeeId,
    accountCodeOptions,
  });

  return {
    rows,
    recurringRows,
    leaveRows,
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

const managerAttendanceDtrDayMetricOverrideSchema = z.object({
  payrollPeriodId: z.string().uuid(),
  employeeId: z.string().uuid(),
  attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lateMinutes: z.number().int().min(0).nullable().optional(),
  undertimeMinutes: z.number().int().min(0).nullable().optional(),
  overtimeMinutes: z.number().int().min(0).nullable().optional(),
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
    await lockAttendancePayrollInput(tx);
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
    await lockAttendancePayrollInput(tx);
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
  const leaveRows = await getEmployeePayrollManualLeaveAccountCodeRows({
    payrollPeriodId: parsed.payrollPeriodId,
    employeeId: parsed.employeeId,
    accountCodeOptions,
  });
  const payrollExceptionWorkspace: PayrollExceptionWorkspaceView = {
    rows,
    recurringRows,
    leaveRows,
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
  const targetPayrollPeriodId = parsed.targetPayrollPeriodId;

  const result = await db.transaction(async (tx) => {
    await lockAttendancePayrollInput(tx);
    const [sourcePeriod, targetPeriod] = await Promise.all([
      tx.query.payrollPeriods.findFirst({
        where: eq(payrollPeriods.id, parsed.sourcePayrollPeriodId),
      }),
      tx.query.payrollPeriods.findFirst({
        where: eq(payrollPeriods.id, targetPayrollPeriodId),
      }),
    ]);

    if (!sourcePeriod) throw new Error("Source payroll period not found.");
    if (!targetPeriod) throw new Error("Target payroll period not found.");
    if (targetPeriod.startDate < sourcePeriod.startDate) {
      throw new Error(
        "Target payroll period must be the selected period or a future period."
      );
    }

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

    const summaryByDate = new Map(
      summaryRows.map((summary) => [summary.attendanceDate, summary])
    );
    const intendedWorkedMinutes = attendanceDates.reduce((total, attendanceDate) => {
      const summary = summaryByDate.get(attendanceDate);
      const scheduledMinutes = summary?.scheduledMinutes ?? 0;
      return (
        total +
        (scheduledMinutes > 0
          ? scheduledMinutes
          : FALLBACK_HELD_DTR_WORKED_MINUTES)
      );
    }, 0);
    const approvalTotals: AttendanceHoldApprovalMinutes = {
      workedMinutes:
        parsed.workedManuallyEdited === true
          ? parsed.workedMinutes
          : computeAttendanceHoldWorkedMinutes({
              intendedWorkedMinutes,
              lateMinutes: parsed.lateMinutes,
              undertimeMinutes: parsed.undertimeMinutes,
            }),
      lateMinutes: parsed.lateMinutes,
      undertimeMinutes: parsed.undertimeMinutes,
      overtimeMinutes: parsed.overtimeMinutes,
    };

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
      targetPayrollPeriodId,
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
          targetPayrollPeriodId,
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
        targetPayrollPeriodId,
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
      refreshHeldDtrLines: true,
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
    await lockAttendancePayrollInput(tx);
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
      refreshHeldDtrLines: true,
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
    await lockAttendancePayrollInput(tx);
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

  const [managerAuditRow] = await db
    .select({
      details: adminAuditEvents.details,
    })
    .from(adminAuditEvents)
    .where(
      and(
        eq(adminAuditEvents.entityType, "attendance_import_batch"),
        eq(adminAuditEvents.entityId, batch.id),
        eq(adminAuditEvents.action, "attendance.manager_imported")
      )
    )
    .orderBy(desc(adminAuditEvents.createdAt))
    .limit(1);
  const managerAuditDetails = parseAttendanceImportAuditDetails(
    managerAuditRow?.details ?? null
  );

  return buildAttendanceImportBatchUnmatchedDiagnostics({
    batchId: batch.id,
    managerDepartmentIds: managerAuditDetails.departmentIds,
  });
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
  employeeScopeIds?: string[],
  database: DbClient = db
): Promise<AttendanceDtrHeldRowsView> {
  const period = await database.query.payrollPeriods.findFirst({
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
  const manualOverrides = await database
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
  const flaggedSummaries = await database
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
    database.query.employees.findMany({
      where: inArray(employees.id, allEmployeeIds),
      with: {
        generalInfo: true,
      },
    }),
    loadEmployeeDepartmentMetadataByEmployeeId(allEmployeeIds, database),
    database
      .select()
      .from(attendanceDailySummaries)
      .where(
        and(
          inArray(attendanceDailySummaries.employeeId, allEmployeeIds),
          gte(attendanceDailySummaries.attendanceDate, period.startDate),
          lte(attendanceDailySummaries.attendanceDate, period.endDate)
        )
      ),
    database
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
          process.env.ATTENDANCE_WORKBENCH_ENABLED === "true" ? sql`not exists(select 1 from attendance_work_exclusions x where x.raw_log_id=${attendanceRawLogs.id} and x.active)` : undefined,
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

  const approvalRows = await database
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
      ? await database
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

  const employeeById = new Map(
    employeeRows
      .filter((employee) =>
        isPayrollEligibleEmploymentStatus(employee.generalInfo?.employmentStatus)
      )
      .map((employee) => [employee.id, employee])
  );
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

import { eachDayOfInterval, format } from "date-fns";
import {
  attendanceDailySummaries,
  employeesTimekeeping,
  shiftTableBreaks,
} from "@/db/schema";
import {
  groupLogsByEmployeeAndAttendanceDate,
  summarizeEmployeeDay,
  type ParsedAttendanceLog,
} from "./attendance";
import {
  applyApprovedAttendanceCorrections,
  detectAttendanceCorrectionSuggestions,
  getApprovedAttendanceCorrectionAnomalyFlags,
  type AttendanceApprovedCorrection,
  type AttendanceCorrectionPayload,
  type AttendanceDtrCorrectionType,
} from "./attendanceCorrections";
import {
  resolveEmployeeScheduleForDate,
  type ShiftAssignmentRecord,
  type WeeklyShiftPatternRecord,
} from "./scheduleResolver";
import { buildDeductibleRegularBreakWindows } from "@/lib/shifts";

export type AttendanceEmployeeRecord = {
  id: string;
  employeeNo: string;
  timekeeping: typeof employeesTimekeeping.$inferSelect | null;
};

export type ShiftTableBreakRecord = typeof shiftTableBreaks.$inferSelect;

export type ApprovedLeaveRecord = {
  employeeId: string;
  leaveStartDate: string | null;
  leaveEndDate: string | null;
  dateFiled: string;
  isPaid?: boolean | null;
};

export type AttendanceSummaryComputation = Pick<
  typeof attendanceDailySummaries.$inferInsert,
  | "employeeId"
  | "shiftAssignmentId"
  | "sourceBatchId"
  | "attendanceDate"
  | "firstInAt"
  | "lastOutAt"
  | "scheduledInTime"
  | "scheduledOutTime"
  | "scheduledMinutes"
  | "workedMinutes"
  | "regularMinutes"
  | "lateMinutes"
  | "undertimeMinutes"
  | "overtimeMinutes"
  | "nightMinutes"
  | "paidLeaveMinutes"
  | "unpaidLeaveMinutes"
  | "absentMinutes"
  | "isRestDay"
  | "anomalyFlags"
>;

export type AttendancePeriodDetailRow = {
  employeeId: string;
  attendanceDate: string;
  dayName: string;
  rawPunches: Date[];
  firstInAt: Date | null;
  lastOutAt: Date | null;
  scheduledInTime: string | null;
  scheduledOutTime: string | null;
  scheduledMinutes: number;
  workedMinutes: number;
  regularMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  paidLeaveMinutes: number;
  unpaidLeaveMinutes: number;
  absentMinutes: number;
  isRestDay: boolean;
  anomalyFlags: string[];
};

export type AttendanceApprovedCorrectionRecord = AttendanceApprovedCorrection & {
  employeeId: string;
  attendanceDate: string;
};

export type AttendanceCorrectionSuggestionComputation = {
  employeeId: string;
  attendanceDate: string;
  correctionType: AttendanceDtrCorrectionType;
  confidence: number;
  reason: string;
  autoApprove?: boolean;
  payload: AttendanceCorrectionPayload;
};

function getHoursPerDay(timekeeping: typeof employeesTimekeeping.$inferSelect | null) {
  const hoursWorked = Number(timekeeping?.hoursWorked ?? 0);
  return hoursWorked > 0 ? hoursWorked : 8;
}

function mergeAnomalyFlags(currentFlags: string[], addedFlags: string[]) {
  return [...new Set([...currentFlags, ...addedFlags])];
}

function buildLeaveCoverageByEmployeeDate(approvedLeaves: ApprovedLeaveRecord[]) {
  const coverageByDate = new Map<
    string,
    {
      paid: boolean;
      unpaid: boolean;
    }
  >();

  for (const leave of approvedLeaves) {
    const start = new Date(`${leave.leaveStartDate ?? leave.dateFiled}T00:00:00`);
    const end = new Date(
      `${leave.leaveEndDate ?? leave.leaveStartDate ?? leave.dateFiled}T00:00:00`
    );
    const cursor = new Date(start.getTime());

    while (cursor <= end) {
      const key = `${leave.employeeId}|${format(cursor, "yyyy-MM-dd")}`;
      const current = coverageByDate.get(key) ?? {
        paid: false,
        unpaid: false,
      };

      if (leave.isPaid === true) {
        current.paid = true;
      } else {
        current.unpaid = true;
      }

      coverageByDate.set(key, current);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return coverageByDate;
}

function resolveShiftWindow(args: {
  employee: AttendanceEmployeeRecord;
  assignments: ShiftAssignmentRecord[];
  weeklyPatterns: WeeklyShiftPatternRecord[];
  attendanceDate: string;
  shiftTableBreaksByShiftTableId: Map<number, ShiftTableBreakRecord[]>;
}) {
  const legacyTimekeeping = args.employee.timekeeping ?? null;
  const resolvedSchedule = resolveEmployeeScheduleForDate({
    attendanceDate: args.attendanceDate,
    assignments: args.assignments,
    weeklyPatterns: args.weeklyPatterns,
    legacyTimekeeping,
  });
  const hoursPerDay =
    resolvedSchedule.source === "LEGACY"
      ? getHoursPerDay(legacyTimekeeping)
      : Math.max(0, resolvedSchedule.hoursPerDay);
  const resolvedShiftTableId =
    resolvedSchedule.source === "OVERRIDE"
      ? resolvedSchedule.overrideAssignment?.shiftTableId ?? null
      : resolvedSchedule.weeklyPatternDay?.shiftTableId ?? null;
  const regularBreakWindows =
    resolvedShiftTableId != null
      ? buildDeductibleRegularBreakWindows(
          args.shiftTableBreaksByShiftTableId.get(resolvedShiftTableId) ?? []
        )
      : [];

  return {
    activeShift: resolvedSchedule.overrideAssignment,
    allowSameDirectionAutoDuplicate:
      resolvedSchedule.source !== "OVERRIDE" ||
      resolvedSchedule.overrideAssignment?.isFlexible !== true,
    hoursPerDay,
    shiftWindow: {
      checkInTime: resolvedSchedule.shiftWindow.checkInTime,
      checkOutTime: resolvedSchedule.shiftWindow.checkOutTime,
      breakMinutes: resolvedSchedule.shiftWindow.breakMinutes ?? 60,
      graceMinutes: resolvedSchedule.shiftWindow.graceMinutes ?? 0,
      hoursPerDay,
      restDay: resolvedSchedule.shiftWindow.restDay,
      regularBreakWindows,
    },
  };
}

function getEmployeeForLog(args: {
  employeeById: Map<string, AttendanceEmployeeRecord>;
  employeeByNumber: Map<string, AttendanceEmployeeRecord>;
  log: ParsedAttendanceLog;
}) {
  if (args.log.employeeId) {
    return args.employeeById.get(args.log.employeeId) ?? null;
  }

  return args.employeeByNumber.get(args.log.employeeNo) ?? null;
}

function buildAttendanceContext(args: {
  employees: AttendanceEmployeeRecord[];
  logs: ParsedAttendanceLog[];
  approvedLeaves: ApprovedLeaveRecord[];
  shiftAssignments: ShiftAssignmentRecord[];
  weeklyPatterns: WeeklyShiftPatternRecord[];
  shiftTableBreaksByShiftTableId: Map<number, ShiftTableBreakRecord[]>;
}) {
  const employeeById = new Map(args.employees.map((employee) => [employee.id, employee]));
  const employeeByNumber = new Map(
    args.employees.map((employee) => [employee.employeeNo, employee])
  );
  const assignmentsByEmployee = new Map<string, ShiftAssignmentRecord[]>();
  const weeklyPatternsByEmployee = new Map<string, WeeklyShiftPatternRecord[]>();

  for (const assignment of args.shiftAssignments) {
    const current = assignmentsByEmployee.get(assignment.employeeId) ?? [];
    current.push(assignment);
    assignmentsByEmployee.set(assignment.employeeId, current);
  }

  for (const pattern of args.weeklyPatterns) {
    const current = weeklyPatternsByEmployee.get(pattern.employeeId) ?? [];
    current.push(pattern);
    weeklyPatternsByEmployee.set(pattern.employeeId, current);
  }

  const leaveCoverageByEmployeeDate = buildLeaveCoverageByEmployeeDate(args.approvedLeaves);
  const groupedLogs = groupLogsByEmployeeAndAttendanceDate(args.logs, (log, attendanceDate) => {
    const employee = getEmployeeForLog({
      employeeById,
      employeeByNumber,
      log,
    });

    if (!employee) return null;

    return resolveShiftWindow({
      employee,
      assignments: assignmentsByEmployee.get(employee.id) ?? [],
      weeklyPatterns: weeklyPatternsByEmployee.get(employee.id) ?? [],
      attendanceDate,
      shiftTableBreaksByShiftTableId: args.shiftTableBreaksByShiftTableId,
    }).shiftWindow;
  });

  return {
    employeeById,
    employeeByNumber,
    assignmentsByEmployee,
    weeklyPatternsByEmployee,
    leaveCoverageByEmployeeDate,
    groupedLogs,
  };
}

function getLeaveMinutesForDate(args: {
  employeeId: string;
  attendanceDate: string;
  hoursPerDay: number;
  leaveCoverageByEmployeeDate: Map<
    string,
    {
      paid: boolean;
      unpaid: boolean;
    }
  >;
}) {
  const leaveCoverage = args.leaveCoverageByEmployeeDate.get(
    `${args.employeeId}|${args.attendanceDate}`
  );
  const dailyMinutes = Math.round(args.hoursPerDay * 60);

  return {
    paidLeaveMinutes: leaveCoverage?.paid ? dailyMinutes : 0,
    unpaidLeaveMinutes: leaveCoverage?.unpaid ? dailyMinutes : 0,
  };
}

function buildAttendanceRow(args: {
  employee: AttendanceEmployeeRecord;
  attendanceDate: string;
  logs: ParsedAttendanceLog[];
  approvedCorrections?: AttendanceApprovedCorrection[];
  assignments: ShiftAssignmentRecord[];
  weeklyPatterns: WeeklyShiftPatternRecord[];
  shiftTableBreaksByShiftTableId: Map<number, ShiftTableBreakRecord[]>;
  leaveCoverageByEmployeeDate: Map<
    string,
    {
      paid: boolean;
      unpaid: boolean;
    }
  >;
}) {
  const {
    activeShift,
    allowSameDirectionAutoDuplicate,
    hoursPerDay,
    shiftWindow,
  } = resolveShiftWindow({
    employee: args.employee,
    assignments: args.assignments,
    weeklyPatterns: args.weeklyPatterns,
    attendanceDate: args.attendanceDate,
    shiftTableBreaksByShiftTableId: args.shiftTableBreaksByShiftTableId,
  });
  const { paidLeaveMinutes, unpaidLeaveMinutes } = getLeaveMinutesForDate({
    employeeId: args.employee.id,
    attendanceDate: args.attendanceDate,
    hoursPerDay,
    leaveCoverageByEmployeeDate: args.leaveCoverageByEmployeeDate,
  });
  const orderedLogs = [...args.logs].sort(
    (left, right) => left.loggedAt.getTime() - right.loggedAt.getTime()
  );
  const effectiveLogs = applyApprovedAttendanceCorrections(
    orderedLogs,
    args.approvedCorrections
  );
  const correctionAnomalyFlags = getApprovedAttendanceCorrectionAnomalyFlags(
    args.approvedCorrections
  );
  const summaryBase = summarizeEmployeeDay(
    args.attendanceDate,
    effectiveLogs,
    shiftWindow,
    paidLeaveMinutes,
    unpaidLeaveMinutes
  );
  const mergedFlags = mergeAnomalyFlags(
    summaryBase.anomalyFlags,
    correctionAnomalyFlags
  );
  const summary = {
    ...summaryBase,
    anomalyFlags: mergedFlags.includes("DOUBLE_PUNCH")
      ? mergedFlags.filter((f) => f !== "ODD_PUNCH_COUNT" && f !== "MISSING_OUT")
      : mergedFlags,
  };

  return {
    activeShift,
    allowSameDirectionAutoDuplicate,
    orderedLogs,
    effectiveLogs,
    shiftWindow,
    summary,
  };
}

function getCoverageDates(startDate: string, endDate: string) {
  return eachDayOfInterval({
    start: new Date(`${startDate}T00:00:00`),
    end: new Date(`${endDate}T00:00:00`),
  }).map((currentDate) => format(currentDate, "yyyy-MM-dd"));
}

function getGroupedEmployeeLogs(
  groupedLogs: Map<string, ParsedAttendanceLog[]>,
  employee: AttendanceEmployeeRecord,
  attendanceDate: string
) {
  const employeeIdLogs =
    groupedLogs.get(`${employee.id}|${attendanceDate}`) ?? [];
  const employeeNoLogs =
    employee.employeeNo === employee.id
      ? []
      : groupedLogs.get(`${employee.employeeNo}|${attendanceDate}`) ?? [];

  return employeeNoLogs.length > 0
    ? [...employeeIdLogs, ...employeeNoLogs]
    : employeeIdLogs;
}

function normalizeSourceBatchId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function getSingleSourceBatchId(logs: ParsedAttendanceLog[]) {
  const sourceBatchIds = [
    ...new Set(
      logs
        .map((log) => normalizeSourceBatchId(log.batchId))
        .filter((value): value is string => value != null)
    ),
  ];

  return sourceBatchIds.length === 1 ? sourceBatchIds[0] : null;
}

function buildApprovedCorrectionLookup(
  corrections: AttendanceApprovedCorrectionRecord[] | undefined
) {
  const lookup = new Map<string, AttendanceApprovedCorrection[]>();

  for (const correction of corrections ?? []) {
    const key = `${correction.employeeId}|${correction.attendanceDate}`;
    const current = lookup.get(key) ?? [];
    current.push(correction);
    lookup.set(key, current);
  }

  return lookup;
}

export function buildAttendancePeriodDetailRows(args: {
  employees: AttendanceEmployeeRecord[];
  logs: ParsedAttendanceLog[];
  approvedLeaves: ApprovedLeaveRecord[];
  shiftAssignments: ShiftAssignmentRecord[];
  weeklyPatterns: WeeklyShiftPatternRecord[];
  shiftTableBreaksByShiftTableId: Map<number, ShiftTableBreakRecord[]>;
  approvedCorrections?: AttendanceApprovedCorrectionRecord[];
  startDate: string;
  endDate: string;
}) {
  const {
    assignmentsByEmployee,
    weeklyPatternsByEmployee,
    groupedLogs,
    leaveCoverageByEmployeeDate,
  } =
    buildAttendanceContext(args);
  const coverageDates = getCoverageDates(args.startDate, args.endDate);
  const approvedCorrectionsByEmployeeDate = buildApprovedCorrectionLookup(
    args.approvedCorrections
  );
  const rows: AttendancePeriodDetailRow[] = [];

  for (const employee of args.employees) {
    const assignments = assignmentsByEmployee.get(employee.id) ?? [];

    for (const attendanceDate of coverageDates) {
      const groupKey = `${employee.id}|${attendanceDate}`;
      const { summary, orderedLogs } = buildAttendanceRow({
        employee,
        attendanceDate,
        logs: groupedLogs.get(groupKey) ?? [],
        approvedCorrections:
          approvedCorrectionsByEmployeeDate.get(groupKey) ?? [],
        assignments,
        weeklyPatterns: weeklyPatternsByEmployee.get(employee.id) ?? [],
        shiftTableBreaksByShiftTableId: args.shiftTableBreaksByShiftTableId,
        leaveCoverageByEmployeeDate,
      });

      rows.push({
        employeeId: employee.id,
        attendanceDate,
        dayName: format(new Date(`${attendanceDate}T00:00:00`), "EEE"),
        rawPunches: orderedLogs.map((log) => log.loggedAt),
        firstInAt: summary.firstInAt,
        lastOutAt: summary.lastOutAt,
        scheduledInTime: summary.scheduledInTime,
        scheduledOutTime: summary.scheduledOutTime,
        scheduledMinutes: summary.scheduledMinutes,
        workedMinutes: summary.workedMinutes,
        regularMinutes: summary.regularMinutes,
        lateMinutes: summary.lateMinutes,
        undertimeMinutes: summary.undertimeMinutes,
        overtimeMinutes: summary.overtimeMinutes,
        nightMinutes: summary.nightMinutes,
        paidLeaveMinutes: summary.paidLeaveMinutes,
        unpaidLeaveMinutes: summary.unpaidLeaveMinutes,
        absentMinutes: summary.absentMinutes,
        isRestDay: summary.isRestDay,
        anomalyFlags: summary.anomalyFlags,
      });
    }
  }

  return rows.sort((left, right) => {
    const employeeComparison = left.employeeId.localeCompare(right.employeeId);
    if (employeeComparison !== 0) return employeeComparison;
    return left.attendanceDate.localeCompare(right.attendanceDate);
  });
}

export function buildAttendanceSummaryComputations(args: {
  employees: AttendanceEmployeeRecord[];
  logs: ParsedAttendanceLog[];
  approvedLeaves: ApprovedLeaveRecord[];
  shiftAssignments: ShiftAssignmentRecord[];
  weeklyPatterns: WeeklyShiftPatternRecord[];
  shiftTableBreaksByShiftTableId: Map<number, ShiftTableBreakRecord[]>;
  approvedCorrections?: AttendanceApprovedCorrectionRecord[];
  allowedAttendanceDateRange?: {
    startDate: string;
    endDate: string;
  };
}) {
  const {
    assignmentsByEmployee,
    weeklyPatternsByEmployee,
    leaveCoverageByEmployeeDate,
    groupedLogs,
  } = buildAttendanceContext(args);
  const computations: AttendanceSummaryComputation[] = [];
  const groupedAttendanceDates = [
    ...new Set(
      [...groupedLogs.keys()]
        .map((groupKey) => groupKey.slice(groupKey.lastIndexOf("|") + 1))
        .filter(Boolean)
    ),
  ].sort();
  const coverageDates =
    args.allowedAttendanceDateRange != null
      ? getCoverageDates(
          args.allowedAttendanceDateRange.startDate,
          args.allowedAttendanceDateRange.endDate
        )
      : groupedAttendanceDates.length > 0
        ? getCoverageDates(
            groupedAttendanceDates[0],
            groupedAttendanceDates[groupedAttendanceDates.length - 1]
          )
        : [];
  const approvedCorrectionsByEmployeeDate = buildApprovedCorrectionLookup(
    args.approvedCorrections
  );

  for (const employee of args.employees) {
    const employeeLogs = coverageDates.flatMap((attendanceDate) =>
      getGroupedEmployeeLogs(groupedLogs, employee, attendanceDate)
    );
    const employeeSourceBatchId = getSingleSourceBatchId(employeeLogs);

    for (const attendanceDate of coverageDates) {
      const logs = getGroupedEmployeeLogs(groupedLogs, employee, attendanceDate);
      const groupKey = `${employee.id}|${attendanceDate}`;
      const { activeShift, summary } = buildAttendanceRow({
        employee,
        attendanceDate,
        logs,
        approvedCorrections:
          approvedCorrectionsByEmployeeDate.get(groupKey) ?? [],
        assignments: assignmentsByEmployee.get(employee.id) ?? [],
        weeklyPatterns: weeklyPatternsByEmployee.get(employee.id) ?? [],
        shiftTableBreaksByShiftTableId: args.shiftTableBreaksByShiftTableId,
        leaveCoverageByEmployeeDate,
      });
      const sourceBatchId =
        getSingleSourceBatchId(logs) ?? employeeSourceBatchId;

      computations.push({
        employeeId: employee.id,
        shiftAssignmentId: activeShift?.id ?? null,
        sourceBatchId,
        attendanceDate: summary.attendanceDate,
        firstInAt: summary.firstInAt,
        lastOutAt: summary.lastOutAt,
        scheduledInTime: summary.scheduledInTime,
        scheduledOutTime: summary.scheduledOutTime,
        scheduledMinutes: summary.scheduledMinutes,
        workedMinutes: summary.workedMinutes,
        regularMinutes: summary.regularMinutes,
        lateMinutes: summary.lateMinutes,
        undertimeMinutes: summary.undertimeMinutes,
        overtimeMinutes: summary.overtimeMinutes,
        nightMinutes: summary.nightMinutes,
        paidLeaveMinutes: summary.paidLeaveMinutes,
        unpaidLeaveMinutes: summary.unpaidLeaveMinutes,
        absentMinutes: summary.absentMinutes,
        isRestDay: summary.isRestDay,
        anomalyFlags:
          summary.anomalyFlags.length > 0 ? JSON.stringify(summary.anomalyFlags) : null,
      });
    }
  }

  return computations.sort((left, right) => {
    const employeeComparison = left.employeeId.localeCompare(right.employeeId);
    if (employeeComparison !== 0) return employeeComparison;
    return left.attendanceDate.localeCompare(right.attendanceDate);
  });
}

export function buildAttendanceCorrectionSuggestionComputations(args: {
  employees: AttendanceEmployeeRecord[];
  logs: ParsedAttendanceLog[];
  approvedLeaves: ApprovedLeaveRecord[];
  shiftAssignments: ShiftAssignmentRecord[];
  weeklyPatterns: WeeklyShiftPatternRecord[];
  shiftTableBreaksByShiftTableId: Map<number, ShiftTableBreakRecord[]>;
  allowedAttendanceDateRange: {
    startDate: string;
    endDate: string;
  };
}) {
  const {
    assignmentsByEmployee,
    weeklyPatternsByEmployee,
    leaveCoverageByEmployeeDate,
    groupedLogs,
  } = buildAttendanceContext(args);
  const coverageDates = getCoverageDates(
    args.allowedAttendanceDateRange.startDate,
    args.allowedAttendanceDateRange.endDate
  );
  const suggestions: AttendanceCorrectionSuggestionComputation[] = [];

  for (const employee of args.employees) {
    const assignments = assignmentsByEmployee.get(employee.id) ?? [];

    for (const attendanceDate of coverageDates) {
      const logs = getGroupedEmployeeLogs(groupedLogs, employee, attendanceDate);
      const {
        allowSameDirectionAutoDuplicate,
        orderedLogs,
        shiftWindow,
        summary,
      } = buildAttendanceRow({
        employee,
        attendanceDate,
        logs,
        assignments,
        weeklyPatterns: weeklyPatternsByEmployee.get(employee.id) ?? [],
        shiftTableBreaksByShiftTableId: args.shiftTableBreaksByShiftTableId,
        leaveCoverageByEmployeeDate,
      });

      suggestions.push(
        ...detectAttendanceCorrectionSuggestions({
          attendanceDate,
          logs: orderedLogs,
          shift: shiftWindow,
          summary,
          allowSameDirectionAutoDuplicate,
        }).map((suggestion) => ({
          employeeId: employee.id,
          attendanceDate,
          correctionType: suggestion.correctionType,
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          autoApprove: suggestion.autoApprove,
          payload: suggestion.payload,
        }))
      );
    }
  }

  return suggestions.sort((left, right) => {
    const employeeComparison = left.employeeId.localeCompare(right.employeeId);
    if (employeeComparison !== 0) return employeeComparison;
    const dateComparison = left.attendanceDate.localeCompare(right.attendanceDate);
    if (dateComparison !== 0) return dateComparison;
    return left.correctionType.localeCompare(right.correctionType);
  });
}

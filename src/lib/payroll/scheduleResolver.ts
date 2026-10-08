import { eachDayOfInterval, format } from "date-fns";
import {
  employeeShiftAssignments,
  employeeWeeklyShiftPatternDays,
  employeeWeeklyShiftPatterns,
  employeesTimekeeping,
  restDayEnum,
} from "@/db/schema";
import type { ShiftWindow } from "./attendance";

type StoredAssignment = typeof employeeShiftAssignments.$inferSelect;
export type ShiftAssignmentRecord = Omit<StoredAssignment, "confirmedSchedule" | "scheduleDecisionId"> & Partial<Pick<StoredAssignment, "confirmedSchedule" | "scheduleDecisionId">>;
type StoredWeeklyDay = typeof employeeWeeklyShiftPatternDays.$inferSelect;
export type WeeklyShiftPatternDayRecord = Omit<StoredWeeklyDay, "scheduleState"> & Partial<Pick<StoredWeeklyDay, "scheduleState">>;
export type WeeklyShiftPatternRecord = typeof employeeWeeklyShiftPatterns.$inferSelect & {
  days: WeeklyShiftPatternDayRecord[];
};
export type LegacyTimekeepingRecord = typeof employeesTimekeeping.$inferSelect | null;
/** A biometrics ID alone is not a pay schedule. Retain configured flexible hours. */
export function hasLegacyPaySchedule(timekeeping:LegacyTimekeepingRecord) {
  return !!(timekeeping?.checkInTime&&timekeeping.checkOutTime)||Number(timekeeping?.hoursWorked??0)>0;
}
export type WeekdayName = (typeof restDayEnum.enumValues)[number];

export type ResolvedEmployeeSchedule = {
  source: "OVERRIDE" | "WEEKLY_PATTERN" | "LEGACY";
  dayName: WeekdayName;
  shiftWindow: ShiftWindow;
  hoursPerDay: number;
  overrideAssignment: ShiftAssignmentRecord | null;
  weeklyPattern: WeeklyShiftPatternRecord | null;
  weeklyPatternDay: WeeklyShiftPatternDayRecord | null;
  configured: boolean;
};

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

/** New nullable storage columns must not invalidate unchanged pre-migration drafts. */
export function scheduleVersionRecord<T extends object>(record: T | null): T | null {
  if (!record) return null;
  const copy = {...record} as Record<string, unknown>;
  for (const key of ["confirmedSchedule", "scheduleDecisionId", "scheduleState"]) {
    if (copy[key] == null) delete copy[key];
  }
  return copy as T;
}

function getDayName(dateKey: string) {
  return format(new Date(`${dateKey}T00:00:00`), "EEEE") as WeekdayName;
}

function getLegacyHoursPerDay(timekeeping: LegacyTimekeepingRecord) {
  const hoursWorked = toAmount(timekeeping?.hoursWorked);
  return hoursWorked > 0 ? hoursWorked : 8;
}

function buildOverrideShiftWindow(
  assignment: ShiftAssignmentRecord | null | undefined
): ShiftWindow {
  const confirmed = assignment?.confirmedSchedule;
  if (confirmed) return {
    checkInTime: confirmed.checkInTime,
    checkOutTime: confirmed.checkOutTime,
    breakMinutes: confirmed.breakMinutes,
    graceMinutes: confirmed.graceMinutes,
    hoursPerDay: confirmed.hoursPerDay,
    restDay: assignment?.restDay ?? null,
  };
  return {
    checkInTime: assignment?.checkInTime ?? null,
    checkOutTime: assignment?.checkOutTime ?? null,
    breakMinutes: assignment?.breakMinutes ?? 0,
    graceMinutes: assignment?.graceMinutes ?? 0,
    hoursPerDay: toAmount(assignment?.hoursPerDay),
    restDay: assignment?.restDay ?? null,
  };
}

function buildWeeklyPatternShiftWindow(args: {
  dayName: WeekdayName;
  patternDay: WeeklyShiftPatternDayRecord | null | undefined;
}): ShiftWindow {
  const patternDay = args.patternDay ?? null;
  if (patternDay?.scheduleState === "unconfigured") {
    return { checkInTime: null, checkOutTime: null, breakMinutes: 0, graceMinutes: 0, hoursPerDay: 0, restDay: null };
  }
  const hoursPerDay = toAmount(patternDay?.hoursPerDay);
  const hasStoredSchedule =
    Boolean(patternDay?.checkInTime) ||
    Boolean(patternDay?.checkOutTime) ||
    hoursPerDay > 0;

  if (!hasStoredSchedule) {
    return {
      checkInTime: null,
      checkOutTime: null,
      breakMinutes: 0,
      graceMinutes: 0,
      hoursPerDay: 0,
      restDay: args.dayName,
    };
  }

  return {
    checkInTime: patternDay?.checkInTime ?? null,
    checkOutTime: patternDay?.checkOutTime ?? null,
    breakMinutes: patternDay?.breakMinutes ?? 0,
    graceMinutes: 0,
    hoursPerDay,
    restDay: null,
  };
}

function buildLegacyShiftWindow(timekeeping: LegacyTimekeepingRecord): ShiftWindow {
  const hoursPerDay = getLegacyHoursPerDay(timekeeping);

  return {
    checkInTime: timekeeping?.checkInTime ?? null,
    checkOutTime: timekeeping?.checkOutTime ?? null,
    breakMinutes: 60,
    graceMinutes: 0,
    hoursPerDay,
    restDay: timekeeping?.restDay ?? null,
  };
}

export function getActiveShiftAssignmentForDate(
  assignments: ShiftAssignmentRecord[],
  dateKey: string
) {
  return (
    [...assignments]
      .filter(
        (assignment) =>
          assignment.effectiveFrom <= dateKey &&
          (!assignment.effectiveTo || assignment.effectiveTo >= dateKey)
      )
      .sort((left, right) => {
        const confirmedComparison = Number(Boolean(right.scheduleDecisionId)) - Number(Boolean(left.scheduleDecisionId));
        if (confirmedComparison !== 0) return confirmedComparison;
        const fromComparison = right.effectiveFrom.localeCompare(left.effectiveFrom);
        if (fromComparison !== 0) return fromComparison;
        return right.id - left.id;
      })[0] ?? null
  );
}

export function getActiveWeeklyShiftPatternForDate(
  patterns: WeeklyShiftPatternRecord[],
  dateKey: string
) {
  return (
    [...patterns]
      .filter(
        (pattern) =>
          pattern.effectiveFrom <= dateKey &&
          (!pattern.effectiveTo || pattern.effectiveTo >= dateKey)
      )
      .sort((left, right) => {
        const idComparison = right.id - left.id;
        if (idComparison !== 0) return idComparison;
        return right.effectiveFrom.localeCompare(left.effectiveFrom);
      })[0] ?? null
  );
}

export function resolveEmployeeScheduleForDate(args: {
  attendanceDate: string;
  assignments: ShiftAssignmentRecord[];
  weeklyPatterns: WeeklyShiftPatternRecord[];
  legacyTimekeeping: LegacyTimekeepingRecord;
}): ResolvedEmployeeSchedule {
  const dayName = getDayName(args.attendanceDate);
  const overrideAssignment = getActiveShiftAssignmentForDate(
    args.assignments,
    args.attendanceDate
  );

  if (overrideAssignment) {
    const shiftWindow = buildOverrideShiftWindow(overrideAssignment);

    return {
      source: "OVERRIDE",
      dayName,
      shiftWindow,
      hoursPerDay: overrideAssignment.confirmedSchedule?.hoursPerDay ?? toAmount(overrideAssignment.hoursPerDay),
      overrideAssignment,
      weeklyPattern: null,
      weeklyPatternDay: null,
      configured: overrideAssignment.confirmedSchedule?.kind !== "unconfigured",
    };
  }

  const weeklyPattern = getActiveWeeklyShiftPatternForDate(
    args.weeklyPatterns,
    args.attendanceDate
  );
  if (weeklyPattern) {
    const weeklyPatternDay =
      weeklyPattern.days.find((day) => day.weekday === dayName) ?? null;
    const shiftWindow = buildWeeklyPatternShiftWindow({
      dayName,
      patternDay: weeklyPatternDay,
    });

    return {
      source: "WEEKLY_PATTERN",
      dayName,
      shiftWindow,
      hoursPerDay: toAmount(weeklyPatternDay?.hoursPerDay),
      overrideAssignment: null,
      weeklyPattern,
      weeklyPatternDay,
      configured: weeklyPatternDay?.scheduleState !== "unconfigured",
    };
  }

  const shiftWindow = buildLegacyShiftWindow(args.legacyTimekeeping);

  return {
    source: "LEGACY",
    dayName,
    shiftWindow,
    hoursPerDay: getLegacyHoursPerDay(args.legacyTimekeeping),
    overrideAssignment: null,
    weeklyPattern: null,
    weeklyPatternDay: null,
    configured: hasLegacyPaySchedule(args.legacyTimekeeping),
  };
}

export function isResolvedScheduleRestDay(resolvedSchedule: ResolvedEmployeeSchedule) {
  return resolvedSchedule.shiftWindow.restDay === resolvedSchedule.dayName;
}

export function getPrimaryResolvedScheduleForPeriod(args: {
  assignments: ShiftAssignmentRecord[];
  weeklyPatterns: WeeklyShiftPatternRecord[];
  legacyTimekeeping: LegacyTimekeepingRecord;
  startDate: string;
  endDate: string;
}) {
  const coverageDates = eachDayOfInterval({
    start: new Date(`${args.startDate}T00:00:00`),
    end: new Date(`${args.endDate}T00:00:00`),
  }).map((currentDate) => format(currentDate, "yyyy-MM-dd"));

  for (const attendanceDate of coverageDates) {
    const resolvedSchedule = resolveEmployeeScheduleForDate({
      attendanceDate,
      assignments: args.assignments,
      weeklyPatterns: args.weeklyPatterns,
      legacyTimekeeping: args.legacyTimekeeping,
    });

    if (
      resolvedSchedule.hoursPerDay > 0 &&
      !isResolvedScheduleRestDay(resolvedSchedule)
    ) {
      return resolvedSchedule;
    }
  }

  return resolveEmployeeScheduleForDate({
    attendanceDate: args.startDate,
    assignments: args.assignments,
    weeklyPatterns: args.weeklyPatterns,
    legacyTimekeeping: args.legacyTimekeeping,
  });
}

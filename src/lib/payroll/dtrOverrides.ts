export const attendanceDtrManualStatusValues = [
  "Present",
  "Absent",
  "Rest Day",
  "Rest Day Work",
  "No Logs",
  "Hold",
] as const;

export type AttendanceDtrManualStatus =
  (typeof attendanceDtrManualStatusValues)[number];

export const attendanceDtrDayTypeValues = [
  "Regular Day",
  "Legal/Regular Holiday",
  "Special Non-Working Holiday",
  "Special Working Holiday",
  "Company Holiday",
] as const;

export type AttendanceDtrDayType = (typeof attendanceDtrDayTypeValues)[number];

export type AttendanceDtrHolidayType =
  | "Regular"
  | "Special Non-Working"
  | "Special Working"
  | "Company";

export type AttendanceDtrMetrics = {
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
  firstInAt?: unknown | null;
  lastOutAt?: unknown | null;
  rawPunches?: unknown[] | null;
  anomalyFlags?: string[] | string | null;
};

export function getAttendanceDtrDayTypeFromHolidayType(
  holidayType: AttendanceDtrHolidayType | null | undefined
): AttendanceDtrDayType {
  if (holidayType === "Regular") return "Legal/Regular Holiday";
  if (holidayType === "Special Non-Working") {
    return "Special Non-Working Holiday";
  }
  if (holidayType === "Special Working") return "Special Working Holiday";
  if (holidayType === "Company") return "Company Holiday";
  return "Regular Day";
}

export function getHolidayTypeFromAttendanceDtrDayType(
  dayType: AttendanceDtrDayType | null | undefined
): AttendanceDtrHolidayType | null {
  if (dayType === "Legal/Regular Holiday") return "Regular";
  if (dayType === "Special Non-Working Holiday") return "Special Non-Working";
  if (dayType === "Special Working Holiday") return "Special Working";
  if (dayType === "Company Holiday") return "Company";
  return null;
}

export function isAttendanceDtrNonWorkingDayType(
  dayType: AttendanceDtrDayType | null | undefined
) {
  return (
    dayType === "Legal/Regular Holiday" ||
    dayType === "Special Non-Working Holiday" ||
    dayType === "Company Holiday"
  );
}

export function getAttendanceDtrDayTypePayMultiplier(args: {
  dayType: AttendanceDtrDayType | null | undefined;
  isRestDay: boolean;
}) {
  if (args.dayType === "Legal/Regular Holiday") {
    return args.isRestDay ? 2.6 : 2;
  }

  if (
    args.dayType === "Special Non-Working Holiday" ||
    args.dayType === "Company Holiday"
  ) {
    return args.isRestDay ? 1.5 : 1.3;
  }

  if (args.isRestDay) {
    return 1.3;
  }

  return 1;
}

export type AttendanceDtrPeriodOverride = {
  presentDays?: string | number | null;
  workedMinutes?: number | null;
  lateMinutes?: number | null;
  undertimeMinutes?: number | null;
  overtimeMinutes?: number | null;
};

export const ATTENDANCE_DTR_WORKED_MINUTES_PER_PRESENT_DAY = 8 * 60;

export function computeDefaultDtrWorkedMinutes(
  presentDays: string | number | null | undefined
) {
  const numericPresentDays = Number(presentDays ?? 0);
  if (!Number.isFinite(numericPresentDays) || numericPresentDays <= 0) {
    return 0;
  }

  return Math.round(
    numericPresentDays * ATTENDANCE_DTR_WORKED_MINUTES_PER_PRESENT_DAY
  );
}

export function computeNetDtrWorkedMinutes(args: {
  presentDays: string | number | null | undefined;
  lateMinutes?: number | null;
  undertimeMinutes?: number | null;
  workedMinutesOverride?: number | null;
}) {
  if (args.workedMinutesOverride != null) {
    return Math.max(0, Math.round(args.workedMinutesOverride));
  }

  const baseWorkedMinutes = computeDefaultDtrWorkedMinutes(args.presentDays);
  const lateMinutes = Math.max(0, Math.round(args.lateMinutes ?? 0));
  const undertimeMinutes = Math.max(0, Math.round(args.undertimeMinutes ?? 0));

  return Math.max(0, baseWorkedMinutes - lateMinutes - undertimeMinutes);
}

function toNumber(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function normalizeAttendanceDtrAnomalyFlags(
  flags: AttendanceDtrMetrics["anomalyFlags"]
) {
  let normalized: string[];

  if (Array.isArray(flags)) {
    normalized = flags;
  } else if (!flags) {
    return [];
  } else {
    try {
      const parsed = JSON.parse(flags);
      normalized = Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [];
    } catch {
      normalized = flags
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }

  if (normalized.includes("DOUBLE_PUNCH")) {
    return normalized.filter(
      (f) => f !== "ODD_PUNCH_COUNT" && f !== "MISSING_OUT"
    );
  }

  return normalized;
}

export function hasUnresolvedAttendanceDtrHoldFlag(
  flags: AttendanceDtrMetrics["anomalyFlags"]
) {
  const normalized = normalizeAttendanceDtrAnomalyFlags(flags);
  return (
    normalized.includes("ODD_PUNCH_COUNT") ||
    normalized.includes("MISSING_OUT")
  );
}

export function hasAttendanceDtrPunches(row: AttendanceDtrMetrics) {
  return (
    (row.rawPunches?.length ?? 0) > 0 ||
    row.firstInAt != null ||
    row.lastOutAt != null
  );
}

export function getComputedAttendanceDtrStatus(row: AttendanceDtrMetrics) {
  if (hasUnresolvedAttendanceDtrHoldFlag(row.anomalyFlags)) {
    return "Hold";
  }

  if (row.isRestDay) {
    return hasAttendanceDtrPunches(row) ? "Rest Day Work" : "Rest Day";
  }

  if (hasAttendanceDtrPunches(row)) {
    return "Present";
  }

  if (row.paidLeaveMinutes > 0) {
    return "Paid Leave";
  }

  if (row.unpaidLeaveMinutes > 0) {
    return "Unpaid Leave";
  }

  if (row.absentMinutes > 0) {
    return "Absent";
  }

  if (normalizeAttendanceDtrAnomalyFlags(row.anomalyFlags).includes("NO_LOGS")) {
    return "No Logs";
  }

  return "-";
}

function getScheduledAttendanceMinutes(row: AttendanceDtrMetrics) {
  return row.scheduledMinutes > 0 ? row.scheduledMinutes : 480;
}

function getPositiveAttendanceMinutes(row: AttendanceDtrMetrics) {
  return Math.max(
    0,
    getScheduledAttendanceMinutes(row) - row.paidLeaveMinutes - row.unpaidLeaveMinutes
  );
}

function getAbsentAttendanceMinutes(row: AttendanceDtrMetrics) {
  if (row.isRestDay) return 0;
  return getPositiveAttendanceMinutes(row);
}

export function applyAttendanceDtrStatusOverride<
  T extends AttendanceDtrMetrics,
>(row: T, manualStatus: AttendanceDtrManualStatus | null | undefined): T {
  if (!manualStatus) return row;

  const next = { ...row };

  if (manualStatus === "Present") {
    const positiveMinutes = getPositiveAttendanceMinutes(row);
    next.isRestDay = false;
    next.absentMinutes = 0;
    next.regularMinutes =
      row.regularMinutes > 0 ? row.regularMinutes : positiveMinutes;
    next.workedMinutes =
      row.workedMinutes > 0 ? row.workedMinutes : next.regularMinutes;
    return next;
  }

  if (manualStatus === "Absent") {
    next.isRestDay = false;
    next.workedMinutes = 0;
    next.regularMinutes = 0;
    next.lateMinutes = 0;
    next.undertimeMinutes = 0;
    next.overtimeMinutes = 0;
    next.nightMinutes = 0;
    next.absentMinutes = getPositiveAttendanceMinutes(row);
    return next;
  }

  if (manualStatus === "Rest Day") {
    next.isRestDay = true;
    next.workedMinutes = 0;
    next.regularMinutes = 0;
    next.lateMinutes = 0;
    next.undertimeMinutes = 0;
    next.overtimeMinutes = 0;
    next.nightMinutes = 0;
    next.absentMinutes = 0;
    return next;
  }

  if (manualStatus === "Rest Day Work") {
    next.isRestDay = true;
    next.regularMinutes = 0;
    next.lateMinutes = 0;
    next.undertimeMinutes = 0;
    next.absentMinutes = 0;
    return next;
  }

  if (manualStatus === "Hold") {
    next.isRestDay = false;
    next.workedMinutes = 0;
    next.regularMinutes = 0;
    next.lateMinutes = 0;
    next.undertimeMinutes = 0;
    next.overtimeMinutes = 0;
    next.nightMinutes = 0;
    next.absentMinutes = 0;
    return next;
  }

  next.workedMinutes = 0;
  next.regularMinutes = 0;
  next.lateMinutes = 0;
  next.undertimeMinutes = 0;
  next.overtimeMinutes = 0;
  next.nightMinutes = 0;
  next.absentMinutes = getAbsentAttendanceMinutes(row);
  return next;
}

export function applyAttendanceDtrComputedHold<T extends AttendanceDtrMetrics>(
  row: T
): T {
  if (!hasUnresolvedAttendanceDtrHoldFlag(row.anomalyFlags)) return row;

  return {
    ...row,
    isRestDay: false,
    workedMinutes: 0,
    regularMinutes: 0,
    lateMinutes: 0,
    undertimeMinutes: 0,
    overtimeMinutes: 0,
    nightMinutes: 0,
    absentMinutes: 0,
  };
}

export function applyAttendanceDtrEffectiveStatus<
  T extends AttendanceDtrMetrics,
>(row: T, manualStatus: AttendanceDtrManualStatus | null | undefined): T {
  return manualStatus
    ? applyAttendanceDtrStatusOverride(row, manualStatus)
    : applyAttendanceDtrComputedHold(row);
}

export function normalizeAttendanceDtrPeriodOverride(
  override: AttendanceDtrPeriodOverride | null | undefined
) {
  return {
    presentDays: toNumber(override?.presentDays),
    workedMinutes: override?.workedMinutes ?? null,
    lateMinutes: override?.lateMinutes ?? null,
    undertimeMinutes: override?.undertimeMinutes ?? null,
    overtimeMinutes: override?.overtimeMinutes ?? null,
  };
}

import { duplicateBursts, DUPLICATE_SUGGEST_MS } from "./attendanceDuplicateModel";
import {
  ATTENDANCE_SPLIT_SHIFT_INCOMPLETE_PUNCHES_FLAG,
  attendanceWallClockTime,
  summarizeEmployeeDay,
  type DailyAttendanceSummarySeed,
  type ParsedAttendanceLog,
  type ShiftWindow,
} from "./attendance";

export const attendanceDtrCorrectionTypeValues = [
  "Duplicate Punch",
  "Missing Out",
  "No Logs",
  "Ambiguous Sequence",
  "Same-Direction Duplicate",
] as const;

export type AttendanceDtrCorrectionType =
  (typeof attendanceDtrCorrectionTypeValues)[number];

export const attendanceDtrCorrectionStatusValues = [
  "Pending",
  "Approved",
  "Rejected",
] as const;

export type AttendanceDtrCorrectionStatus =
  (typeof attendanceDtrCorrectionStatusValues)[number];

export const ATTENDANCE_DTR_DUPLICATE_WINDOW_MINUTES = DUPLICATE_SUGGEST_MS / 60_000;

export type AttendanceCorrectionPunch = {
  rawLogId: number | null;
  employeeNo: string;
  employeeId: string | null;
  loggedAt: string;
  logDate: string;
  logTime: string;
  direction: ParsedAttendanceLog["direction"];
  sourceLine: number | null;
  rawText: string | null;
  deviceId: string | null;
  siteCode: string | null;
  synthetic: boolean;
};

export type AttendanceCorrectionMetrics = Pick<
  DailyAttendanceSummarySeed,
  | "firstInAt"
  | "lastOutAt"
  | "scheduledMinutes"
  | "workedMinutes"
  | "regularMinutes"
  | "lateMinutes"
  | "undertimeMinutes"
  | "overtimeMinutes"
  | "nightMinutes"
  | "absentMinutes"
  | "anomalyFlags"
>;

export type AttendanceCorrectionPayload = {
  rawPunches: AttendanceCorrectionPunch[];
  ignoredRawLogIds: number[];
  syntheticPunches: AttendanceCorrectionPunch[];
  effectivePunches: AttendanceCorrectionPunch[];
  proposedMetrics: AttendanceCorrectionMetrics | null;
};

export type AttendanceCorrectionSuggestionSeed = {
  correctionType: AttendanceDtrCorrectionType;
  confidence: number;
  reason: string;
  autoApprove?: boolean;
  payload: AttendanceCorrectionPayload;
};

export type AttendanceApprovedCorrection = {
  correctionType: AttendanceDtrCorrectionType;
  payload: AttendanceCorrectionPayload | unknown;
};

export const ATTENDANCE_DOUBLE_PUNCH_FLAG = "DOUBLE_PUNCH";
const DUPLICATE_CORRECTION_TYPES = new Set<AttendanceDtrCorrectionType>([
  "Duplicate Punch",
  "Same-Direction Duplicate",
]);

function parseTimeToMinutes(value: string | null | undefined) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function getScheduledOutAt(attendanceDate: string, shift: ShiftWindow) {
  const inMinutes = parseTimeToMinutes(shift.checkInTime);
  const outMinutes = parseTimeToMinutes(shift.checkOutTime);
  if (inMinutes == null || outMinutes == null) return null;

  const scheduledOutAt = new Date(`${attendanceDate}T00:00:00Z`);
  scheduledOutAt.setUTCMinutes(outMinutes, 0, 0);

  if (outMinutes <= inMinutes) {
    scheduledOutAt.setUTCDate(scheduledOutAt.getUTCDate() + 1);
  }

  return scheduledOutAt;
}

function serializePunch(log: ParsedAttendanceLog): AttendanceCorrectionPunch {
  return {
    rawLogId: log.rawLogId ?? null,
    employeeNo: log.employeeNo,
    employeeId: log.employeeId ?? null,
    loggedAt: log.loggedAt.toISOString(),
    logDate: log.logDate,
    logTime: log.logTime,
    direction: log.direction,
    sourceLine: log.sourceLine,
    rawText: log.rawText,
    deviceId: log.deviceId ?? null,
    siteCode: log.siteCode ?? null,
    synthetic: log.isSyntheticCorrection === true,
  };
}

function deserializePunch(punch: AttendanceCorrectionPunch): ParsedAttendanceLog {
  return {
    employeeNo: punch.employeeNo,
    employeeId: punch.employeeId,
    loggedAt: new Date(punch.loggedAt),
    logDate: punch.logDate,
    logTime: punch.logTime,
    direction: punch.direction,
    sourceLine: punch.sourceLine ?? 0,
    rawText: punch.rawText ?? "",
    deviceId: punch.deviceId,
    siteCode: punch.siteCode,
    rawLogId: punch.rawLogId,
    isSyntheticCorrection: punch.synthetic,
  };
}

function buildSyntheticScheduledOutPunch(args: {
  attendanceDate: string;
  logs: ParsedAttendanceLog[];
  shift: ShiftWindow;
}) {
  const firstLog = args.logs[0];
  if (!firstLog) return null;

  const scheduledOutAt = getScheduledOutAt(args.attendanceDate, args.shift);
  if (!scheduledOutAt) return null;

  return serializePunch({
    ...firstLog,
    rawLogId: null,
    loggedAt: new Date(scheduledOutAt.toISOString().slice(0, -1)),
    logDate: scheduledOutAt.toISOString().slice(0, 10),
    logTime: scheduledOutAt.toISOString().slice(11, 19),
    direction: "OUT",
    sourceLine: 0,
    rawText: `Suggested scheduled OUT for ${args.attendanceDate}`,
    deviceId: null,
    siteCode: null,
    isSyntheticCorrection: true,
  });
}

function serializeMetrics(
  summary: DailyAttendanceSummarySeed
): AttendanceCorrectionMetrics {
  return {
    firstInAt: summary.firstInAt,
    lastOutAt: summary.lastOutAt,
    scheduledMinutes: summary.scheduledMinutes,
    workedMinutes: summary.workedMinutes,
    regularMinutes: summary.regularMinutes,
    lateMinutes: summary.lateMinutes,
    undertimeMinutes: summary.undertimeMinutes,
    overtimeMinutes: summary.overtimeMinutes,
    nightMinutes: summary.nightMinutes,
    absentMinutes: summary.absentMinutes,
    anomalyFlags: summary.anomalyFlags,
  };
}

function mergeAnomalyFlags(currentFlags: string[], addedFlags: string[]) {
  return [...new Set([...currentFlags, ...addedFlags])];
}

function withAnomalyFlags(
  summary: DailyAttendanceSummarySeed,
  addedFlags: string[]
): DailyAttendanceSummarySeed {
  if (addedFlags.length === 0) return summary;

  return {
    ...summary,
    anomalyFlags: mergeAnomalyFlags(summary.anomalyFlags, addedFlags),
  };
}

function normalizePayload(
  value: AttendanceCorrectionPayload | unknown
): AttendanceCorrectionPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<AttendanceCorrectionPayload>;

  return {
    rawPunches: Array.isArray(payload.rawPunches) ? payload.rawPunches : [],
    ignoredRawLogIds: Array.isArray(payload.ignoredRawLogIds)
      ? payload.ignoredRawLogIds.filter(
          (rawLogId): rawLogId is number => Number.isInteger(rawLogId)
        )
      : [],
    syntheticPunches: Array.isArray(payload.syntheticPunches)
      ? payload.syntheticPunches
      : [],
    effectivePunches: Array.isArray(payload.effectivePunches)
      ? payload.effectivePunches
      : [],
    proposedMetrics:
      payload.proposedMetrics && typeof payload.proposedMetrics === "object"
        ? (payload.proposedMetrics as AttendanceCorrectionMetrics)
        : null,
  };
}

function buildPayload(args: {
  rawLogs: ParsedAttendanceLog[];
  ignoredRawLogIds: number[];
  syntheticPunches?: AttendanceCorrectionPunch[];
  summary: DailyAttendanceSummarySeed | null;
}) {
  const ignoredIds = new Set(args.ignoredRawLogIds);
  const effectivePunches = [
    ...args.rawLogs
      .filter((log) => log.rawLogId == null || !ignoredIds.has(log.rawLogId))
      .map(serializePunch),
    ...(args.syntheticPunches ?? []),
  ].sort((left, right) => left.loggedAt.localeCompare(right.loggedAt));

  return {
    rawPunches: args.rawLogs.map(serializePunch),
    ignoredRawLogIds: [...ignoredIds],
    syntheticPunches: args.syntheticPunches ?? [],
    effectivePunches,
    proposedMetrics: args.summary ? serializeMetrics(args.summary) : null,
  } satisfies AttendanceCorrectionPayload;
}

export function getApprovedAttendanceCorrectionAnomalyFlags(
  corrections: AttendanceApprovedCorrection[] | undefined
) {
  const flags = new Set<string>();

  for (const correction of corrections ?? []) {
    const payload = normalizePayload(correction.payload);
    if (!payload) continue;

    for (const flag of payload.proposedMetrics?.anomalyFlags ?? []) {
      flags.add(flag);
    }

    if (
      DUPLICATE_CORRECTION_TYPES.has(correction.correctionType) &&
      payload.ignoredRawLogIds.length > 0
    ) {
      flags.add(ATTENDANCE_DOUBLE_PUNCH_FLAG);
    }
  }

  return [...flags];
}

export function applyApprovedAttendanceCorrections(
  logs: ParsedAttendanceLog[],
  corrections: AttendanceApprovedCorrection[] | undefined
) {
  if (!corrections || corrections.length === 0) {
    return [...logs].sort(
      (left, right) => attendanceWallClockTime(left) - attendanceWallClockTime(right)
    );
  }

  const ignoredRawLogIds = new Set<number>();
  const syntheticPunches: AttendanceCorrectionPunch[] = [];

  for (const correction of corrections) {
    const payload = normalizePayload(correction.payload);
    if (!payload) continue;

    for (const rawLogId of payload.ignoredRawLogIds) {
      ignoredRawLogIds.add(rawLogId);
    }

    syntheticPunches.push(...payload.syntheticPunches);
  }

  return [
    ...logs.filter(
      (log) => log.rawLogId == null || !ignoredRawLogIds.has(log.rawLogId)
    ),
    ...syntheticPunches.map(deserializePunch),
  ].sort((left, right) => attendanceWallClockTime(left) - attendanceWallClockTime(right));
}

export function detectAttendanceCorrectionSuggestions(args: {
  attendanceDate: string;
  logs: ParsedAttendanceLog[];
  shift: ShiftWindow;
  summary: DailyAttendanceSummarySeed;
  duplicateWindowMinutes?: number;
  allowSameDirectionAutoDuplicate?: boolean;
}) {
  const rawLogs = [...args.logs].sort((a,b) => attendanceWallClockTime(a)-attendanceWallClockTime(b));
  const suggestions: AttendanceCorrectionSuggestionSeed[] = [];
  const windowMs = Math.max(0, Math.min(DUPLICATE_SUGGEST_MS, (args.duplicateWindowMinutes ?? ATTENDANCE_DTR_DUPLICATE_WINDOW_MINUTES) * 60_000));
  const bursts = duplicateBursts(rawLogs.map((p,i)=>({ id: String(p.rawLogId ?? `missing-${i}`), person:p.employeeId ?? p.employeeNo, type:p.direction, at:attendanceWallClockTime(p), raw:p })), windowMs);
  const duplicateIds = bursts.flatMap(b=>b.removed.flatMap(r=>r.raw.rawLogId==null?[]:[r.raw.rawLogId]));
  // DTR/file rows lack authoritative upload, correction and source-version evidence.
  // Only the source-aware duplicate workflow may automatically void real captures.
  if (duplicateIds.length) suggestions.push({
    correctionType:"Same-Direction Duplicate", confidence:80, autoApprove:false,
    reason:`${duplicateIds.length} same-direction punch(es) fall within an anchored ${windowMs/60_000}-minute window. Review the retained capture and original evidence before approving.`,
    payload:buildPayload({rawLogs, ignoredRawLogIds:duplicateIds, summary:withAnomalyFlags(summarizeEmployeeDay(args.attendanceDate,rawLogs.filter(p=>p.rawLogId==null||!duplicateIds.includes(p.rawLogId)),args.shift,args.summary.paidLeaveMinutes,args.summary.unpaidLeaveMinutes),[ATTENDANCE_DOUBLE_PUNCH_FLAG])}),
  });
  // Pending suggestions cannot remove punches from other correction proposals.
  const duplicateEffectiveLogs = rawLogs;

  if (args.summary.anomalyFlags.includes("NO_LOGS")) {
    suggestions.push({
      correctionType: "No Logs",
      confidence: 100,
      reason:
        "Scheduled workday has no biometric punches and no paid or unpaid leave coverage.",
      payload: buildPayload({
        rawLogs,
        ignoredRawLogIds: [],
        summary: null,
      }),
    });
  }

  const missingOutLogs = duplicateEffectiveLogs;
  const syntheticOutPunch = buildSyntheticScheduledOutPunch({
    attendanceDate: args.attendanceDate,
    logs: missingOutLogs,
    shift: args.shift,
  });
  const hasSplitIncompletePunches = args.summary.anomalyFlags.includes(
    ATTENDANCE_SPLIT_SHIFT_INCOMPLETE_PUNCHES_FLAG
  );

  if (
    hasSplitIncompletePunches &&
    !args.summary.isRestDay &&
    args.summary.scheduledMinutes > 0 &&
    args.summary.paidLeaveMinutes === 0 &&
    args.summary.unpaidLeaveMinutes === 0 &&
    missingOutLogs.length > 0
  ) {
    suggestions.push({
      correctionType: "Ambiguous Sequence",
      confidence: 40,
      reason:
        "Split schedule requires four punches in IN, OUT, IN, OUT order, so the workday needs review before DTR computation.",
      payload: buildPayload({
        rawLogs,
        ignoredRawLogIds: duplicateIds,
        summary: null,
      }),
    });
  } else if (
    !args.summary.isRestDay &&
    args.summary.scheduledMinutes > 0 &&
    args.summary.paidLeaveMinutes === 0 &&
    args.summary.unpaidLeaveMinutes === 0 &&
    missingOutLogs.length === 1 &&
    syntheticOutPunch
  ) {
    const correctedSummary = summarizeEmployeeDay(
      args.attendanceDate,
      [...missingOutLogs, deserializePunch(syntheticOutPunch)],
      args.shift,
      args.summary.paidLeaveMinutes,
      args.summary.unpaidLeaveMinutes
    );

    suggestions.push({
      correctionType: "Missing Out",
      confidence: 80,
      reason:
        "Only one workday punch was found, so the scheduled OUT time is suggested for review.",
      payload: buildPayload({
        rawLogs,
        ignoredRawLogIds: duplicateIds,
        syntheticPunches: [syntheticOutPunch],
        summary: correctedSummary,
      }),
    });
  } else if (
    !args.summary.isRestDay &&
    missingOutLogs.length > 1 &&
    missingOutLogs.length % 2 !== 0
  ) {
    suggestions.push({
      correctionType: "Ambiguous Sequence",
      confidence: 40,
      reason:
        "The workday has an odd number of punches, but more than one possible correction path exists.",
      payload: buildPayload({
        rawLogs,
        ignoredRawLogIds: duplicateIds,
        summary: null,
      }),
    });
  }

  return suggestions;
}

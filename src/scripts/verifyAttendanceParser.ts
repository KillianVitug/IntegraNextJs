import assert from "node:assert/strict";
import {
  assertAttendanceLogsMatchPayrollPeriod,
  formatAttendanceLogDates,
  formatAttendancePayrollCodeRange,
  filterAttendanceLogsForPayrollPeriod,
  normalizeAttendanceEmployeeKey,
  parseAttendanceBuffer,
  summarizeEmployeeDay,
  type ParsedAttendanceLog,
} from "../lib/payroll/attendance";
import {
  ATTENDANCE_DOUBLE_PUNCH_FLAG,
  type AttendanceDtrCorrectionType,
} from "../lib/payroll/attendanceCorrections";
import {
  applyAttendanceDtrEffectiveStatus,
  getComputedAttendanceDtrStatus,
  type AttendanceDtrMetrics,
} from "../lib/payroll/dtrOverrides";
import {
  buildAttendanceCorrectionSuggestionComputations,
  buildAttendanceSummaryComputations,
} from "../lib/payroll/attendanceSync";
import { resolveDetectedOvertimeMinutes } from "../lib/payroll/overtime";
import type { ShiftAssignmentRecord } from "../lib/payroll/scheduleResolver";

type AttendanceParserFixture = {
  name: string;
  fileName: string;
  text: string;
  expectedFormat: string;
  expectedLogs: number;
  expectedDuplicateCount?: number;
  expectedFirstEmployeeNo: string;
  expectedFirstDate: string;
  expectedFirstTime: string;
  expectedFirstDeviceId?: string;
  expectedEmployeeIdentifierHeader?: string | null;
  expectedFirstNormalizedEmployeeKey?: string;
  expectedEmployeeNos?: string[];
};

function captureThrownError(action: () => void) {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }

  assert.fail("Expected action to throw an error.");
}

function buildScheduledLog(
  time: string,
  direction: "IN" | "OUT",
  sourceLine: number
) {
  const logTime = time.length === 5 ? `${time}:00` : time;
  const loggedAt = new Date(`2026-03-02T${logTime}`);

  return {
    employeeNo: "000001",
    loggedAt,
    logDate: "2026-03-02",
    logTime,
    direction,
    sourceLine,
    rawText: `000001,2026-03-02 ${logTime},${direction}`,
  };
}

function summarizeScheduledDay(args: {
  inTime: string;
  outTime: string;
  graceMinutes?: number;
}) {
  return summarizeEmployeeDay(
    "2026-03-02",
    [
      buildScheduledLog(args.inTime, "IN", 1),
      buildScheduledLog(args.outTime, "OUT", 2),
    ],
    {
      checkInTime: "08:00",
      checkOutTime: "17:00",
      breakMinutes: 60,
      graceMinutes: args.graceMinutes ?? 0,
      hoursPerDay: 8,
      restDay: null,
    }
  );
}

function summarizeCustomScheduledDay(args: {
  inTime: string;
  outTime: string;
  checkInTime: string;
  checkOutTime: string;
  breakMinutes: number;
  regularBreakWindows?: Array<{
    fromTime: string;
    toTime: string;
    deductMinutes: number;
  }>;
}) {
  return summarizeEmployeeDay(
    "2026-03-02",
    [
      buildScheduledLog(args.inTime, "IN", 1),
      buildScheduledLog(args.outTime, "OUT", 2),
    ],
    {
      checkInTime: args.checkInTime,
      checkOutTime: args.checkOutTime,
      breakMinutes: args.breakMinutes,
      graceMinutes: 0,
      restDay: null,
      regularBreakWindows: args.regularBreakWindows,
    }
  );
}

const doublePunchEmployee = {
  id: "11111111-1111-1111-1111-111111111111",
  employeeNo: "000001",
  timekeeping: null,
};

function buildRawScheduledLog(
  time: string,
  direction: ParsedAttendanceLog["direction"],
  rawLogId: number
): ParsedAttendanceLog {
  return {
    ...buildScheduledLog(time, direction === "UNSPECIFIED" ? "IN" : direction, rawLogId),
    employeeId: doublePunchEmployee.id,
    rawLogId,
    direction,
  };
}

function buildDoublePunchShiftAssignment(
  isFlexible: boolean
): ShiftAssignmentRecord {
  const timestamp = new Date("2026-01-01T00:00:00");

  return {
    id: isFlexible ? 2 : 1,
    employeeId: doublePunchEmployee.id,
    shiftTableId: null,
    shiftName: isFlexible ? "Flexible Test Shift" : "Fixed Test Shift",
    shiftCode: isFlexible ? "FLEX" : "FIXED",
    shiftSchedule: "Morning",
    effectiveFrom: "2026-03-01",
    effectiveTo: null,
    checkInTime: "08:00:00",
    checkOutTime: "17:00:00",
    breakMinutes: 60,
    paidBreakMinutes: 0,
    graceMinutes: 0,
    restDay: null,
    hoursPerDay: "8.00",
    isFlexible,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function getCorrectionByType<T extends { correctionType: AttendanceDtrCorrectionType }>(
  suggestions: T[],
  correctionType: AttendanceDtrCorrectionType
) {
  return suggestions.find((suggestion) => suggestion.correctionType === correctionType);
}

function parseStoredAnomalyFlags(value: string | null | undefined) {
  if (!value) return [];
  const parsed = JSON.parse(value);
  assert.ok(Array.isArray(parsed));
  return parsed as string[];
}

function toDtrMetrics(
  summary: ReturnType<typeof buildAttendanceSummaryComputations>[number],
  anomalyFlags: AttendanceDtrMetrics["anomalyFlags"] = summary.anomalyFlags
): AttendanceDtrMetrics {
  return {
    scheduledMinutes: summary.scheduledMinutes ?? 0,
    workedMinutes: summary.workedMinutes ?? 0,
    regularMinutes: summary.regularMinutes ?? 0,
    lateMinutes: summary.lateMinutes ?? 0,
    undertimeMinutes: summary.undertimeMinutes ?? 0,
    overtimeMinutes: summary.overtimeMinutes ?? 0,
    nightMinutes: summary.nightMinutes ?? 0,
    paidLeaveMinutes: summary.paidLeaveMinutes ?? 0,
    unpaidLeaveMinutes: summary.unpaidLeaveMinutes ?? 0,
    absentMinutes: summary.absentMinutes ?? 0,
    isRestDay: summary.isRestDay ?? false,
    firstInAt: summary.firstInAt ?? null,
    lastOutAt: summary.lastOutAt ?? null,
    anomalyFlags,
  };
}

const fixtures: AttendanceParserFixture[] = [
  {
    name: "comma CSV with EmployeeNo and DateTime",
    fileName: "comma.csv",
    text: [
      "EmployeeNo,DateTime,Direction,Device",
      "000083,2026-03-01 06:00:00,IN,MAIN",
    ].join("\n"),
    expectedFormat: "comma-delimited DTR",
    expectedLogs: 1,
    expectedFirstEmployeeNo: "000083",
    expectedFirstDate: "2026-03-01",
    expectedFirstTime: "06:00:00",
    expectedEmployeeIdentifierHeader: "EmployeeNo",
  },
  {
    name: "tab-separated .csv with EnNo and whole-line quotes",
    fileName: "tab-export.csv",
    text: [
      '"No\tMchn\tEnNo\t\tName\t\tMode\tIOMd\tDateTime"',
      '"000001\t1\t000000790\tAQUINO        \t1\t0\t2026/03/01  06:54:00"',
      '"000002\t1\t000000633\tEDQUILANE      \t1\t0\t2026/03/01  06:54:00"',
    ].join("\n"),
    expectedFormat: "tab-delimited DTR",
    expectedLogs: 2,
    expectedFirstEmployeeNo: "000000790",
    expectedFirstDate: "2026-03-01",
    expectedFirstTime: "06:54:00",
    expectedEmployeeIdentifierHeader: "EnNo",
  },
  {
    name: "HisGLog tab export uses UID instead of row No or DN",
    fileName: "HisGLog_0001_20260301-MAIN.csv",
    text: [
      "No\tDN\tUID               \tName            \tStatus\tAction\tAPB\tJobCode\tDateTime",
      "000000\t0001\t000000000000000531\tPANTIG      \t00\t01\t0\t000\t2026/02/16 04:24:44",
      "000001\t0001\t000000000000000660\tPURISIMA    \t00\t01\t0\t000\t2026/02/16 04:24:50",
      "000002\t0001\t000000000000000275\tLELIS       \t00\t01\t0\t000\t2026/02/16 04:25:13",
    ].join("\n"),
    expectedFormat: "tab-delimited DTR",
    expectedLogs: 3,
    expectedFirstEmployeeNo: "000000000000000531",
    expectedFirstDate: "2026-02-16",
    expectedFirstTime: "04:24:44",
    expectedFirstDeviceId: "0001",
    expectedEmployeeIdentifierHeader: "UID",
    expectedFirstNormalizedEmployeeKey: "531",
    expectedEmployeeNos: [
      "000000000000000531",
      "000000000000000660",
      "000000000000000275",
    ],
  },
  {
    name: "semicolon DTR with ID, Date, and Time",
    fileName: "semicolon.txt",
    text: [
      "ID;Date;Time;Direction",
      "000001;2026-03-01;07:00:00;I",
    ].join("\n"),
    expectedFormat: "semicolon-delimited DTR",
    expectedLogs: 1,
    expectedFirstEmployeeNo: "000001",
    expectedFirstDate: "2026-03-01",
    expectedFirstTime: "07:00:00",
    expectedEmployeeIdentifierHeader: "ID",
  },
  {
    name: "pipe DTR with UID and DateTime",
    fileName: "pipe.txt",
    text: ["UID|DateTime|Status", "000002|2026/03/01 17:00:00|OUT"].join(
      "\n"
    ),
    expectedFormat: "pipe-delimited DTR",
    expectedLogs: 1,
    expectedFirstEmployeeNo: "000002",
    expectedFirstDate: "2026-03-01",
    expectedFirstTime: "17:00:00",
    expectedEmployeeIdentifierHeader: "UID",
  },
  {
    name: "whitespace DTR with unknown numeric employee number preserved",
    fileName: "whitespace.txt",
    text: [
      "ID Date Time Direction",
      "999999 2026/03/02 08:00:00 IN",
      "999999 2026/03/02 17:00:00 OUT",
    ].join("\n"),
    expectedFormat: "whitespace-delimited DTR",
    expectedLogs: 2,
    expectedFirstEmployeeNo: "999999",
    expectedFirstDate: "2026-03-02",
    expectedFirstTime: "08:00:00",
    expectedEmployeeIdentifierHeader: "ID",
  },
  {
    name: "tab-separated TXT with ID, full datetime Time, and Device ID",
    fileName: "attend-logs-mariveles.txt",
    text: [
      "ID\tName\tDepartment\tTime\tDevice ID\t",
      "883\torlina\tNot Set1\t 2026-03-01     06:51:04\t0",
      "879\ttan\tNot Set1\t 2026-03-01     06:59:23\t0",
    ].join("\n"),
    expectedFormat: "tab-delimited DTR",
    expectedLogs: 2,
    expectedFirstEmployeeNo: "883",
    expectedFirstDate: "2026-03-01",
    expectedFirstTime: "06:51:04",
    expectedFirstDeviceId: "0",
    expectedEmployeeIdentifierHeader: "ID",
  },
  {
    name: "tab-separated TXT does not use Device ID as employee ID",
    fileName: "duplicate-id-headers.txt",
    text: [
      "Device ID\tTime\tID",
      "0\t2026-03-01     06:51:04\t883",
    ].join("\n"),
    expectedFormat: "tab-delimited DTR",
    expectedLogs: 1,
    expectedFirstEmployeeNo: "883",
    expectedFirstDate: "2026-03-01",
    expectedFirstTime: "06:51:04",
    expectedFirstDeviceId: "0",
    expectedEmployeeIdentifierHeader: "ID",
  },
  {
    name: "labeled TXT row with UID",
    fileName: "labeled.txt",
    text: "UID: 000004 DateTime 2026/03/03 06:30:00 IN",
    expectedFormat: "text DTR rows",
    expectedLogs: 1,
    expectedFirstEmployeeNo: "000004",
    expectedFirstDate: "2026-03-03",
    expectedFirstTime: "06:30:00",
    expectedEmployeeIdentifierHeader: null,
  },
  {
    name: "duplicate punches in one file",
    fileName: "duplicates.csv",
    text: [
      "EmployeeNo,DateTime",
      "000005,2026-03-04 08:00:00",
      "000005,2026-03-04 08:00:00",
    ].join("\n"),
    expectedFormat: "comma-delimited DTR",
    expectedLogs: 1,
    expectedDuplicateCount: 1,
    expectedFirstEmployeeNo: "000005",
    expectedFirstDate: "2026-03-04",
    expectedFirstTime: "08:00:00",
    expectedEmployeeIdentifierHeader: "EmployeeNo",
  },
];

const hisGLogFixture = fixtures.find((fixture) =>
  fixture.name.startsWith("HisGLog")
);

assert.ok(hisGLogFixture, "HisGLog fixture is configured.");

for (const fixture of fixtures) {
  const parsed = parseAttendanceBuffer(
    Buffer.from(fixture.text, "utf8"),
    fixture.fileName
  );

  assert.equal(parsed.detectedFormat, fixture.expectedFormat, fixture.name);
  if ("expectedEmployeeIdentifierHeader" in fixture) {
    assert.equal(
      parsed.employeeIdentifierHeader,
      fixture.expectedEmployeeIdentifierHeader ?? null,
      fixture.name
    );
  }
  assert.equal(parsed.logs.length, fixture.expectedLogs, fixture.name);
  assert.equal(
    parsed.duplicateCount,
    fixture.expectedDuplicateCount ?? 0,
    fixture.name
  );

  const [firstLog] = parsed.logs;
  assert.equal(firstLog.employeeNo, fixture.expectedFirstEmployeeNo, fixture.name);
  assert.equal(firstLog.logDate, fixture.expectedFirstDate, fixture.name);
  assert.equal(firstLog.logTime, fixture.expectedFirstTime, fixture.name);
  if (fixture.expectedFirstNormalizedEmployeeKey) {
    assert.equal(
      normalizeAttendanceEmployeeKey(firstLog.employeeNo),
      fixture.expectedFirstNormalizedEmployeeKey,
      fixture.name
    );
  }
  if (fixture.expectedEmployeeNos) {
    assert.deepEqual(
      parsed.logs.map((log) => log.employeeNo),
      fixture.expectedEmployeeNos,
      fixture.name
    );
  }
  if (fixture.expectedFirstDeviceId) {
    assert.equal(firstLog.deviceId, fixture.expectedFirstDeviceId, fixture.name);
  }
}

assert.equal(normalizeAttendanceEmployeeKey("000790"), "790");
assert.equal(normalizeAttendanceEmployeeKey("EMP000790"), "790");
assert.equal(normalizeAttendanceEmployeeKey("EMP-000790"), "790");

const hisGLogParsed = parseAttendanceBuffer(
  Buffer.from(hisGLogFixture.text, "utf8"),
  hisGLogFixture.fileName
);

assert.doesNotThrow(() =>
  assertAttendanceLogsMatchPayrollPeriod({
    logs: hisGLogParsed.logs,
    payrollPeriod: {
      code: "2026-02-B2",
      startDate: "2026-02-16",
      endDate: "2026-02-28",
    },
  })
);

const hisGLogDeniedError = captureThrownError(() =>
  assertAttendanceLogsMatchPayrollPeriod({
    logs: hisGLogParsed.logs,
    payrollPeriod: {
      code: "2026-03-B1",
      startDate: "2026-03-01",
      endDate: "2026-03-15",
    },
  })
);

assert.match(
  hisGLogDeniedError.message,
  /Denied DTR file: no parsed attendance rows matched.*2026-03-B1 \(2026-03-01 to 2026-03-15\).*2026-02-16 to 2026-02-16/
);

assert.match(
  hisGLogDeniedError.message,
  /3 parsed row\(s\) are outside this payroll period/
);
assert.match(
  hisGLogDeniedError.message,
  /Denied DTR dates: 2026-02-16/
);
assert.match(
  hisGLogDeniedError.message,
  /Payroll code range: 000000000000000275 to 000000000000000660 \(3 unique\)/
);
assert.doesNotMatch(hisGLogDeniedError.message, /employee 000000000000000531/);
assert.doesNotMatch(hisGLogDeniedError.message, /line 2/);

const matchingPeriodFilter = filterAttendanceLogsForPayrollPeriod({
  logs: hisGLogParsed.logs,
  payrollPeriod: {
    startDate: "2026-02-16",
    endDate: "2026-02-28",
  },
});

assert.equal(matchingPeriodFilter.logs.length, hisGLogParsed.logs.length);
assert.equal(matchingPeriodFilter.ignoredOutOfPeriodCount, 0);
assert.deepEqual(matchingPeriodFilter.dateRange, {
  startDate: "2026-02-16",
  endDate: "2026-02-16",
});

const nonMatchingPeriodFilter = filterAttendanceLogsForPayrollPeriod({
  logs: hisGLogParsed.logs,
  payrollPeriod: {
    startDate: "2026-03-01",
    endDate: "2026-03-15",
  },
});

assert.equal(nonMatchingPeriodFilter.logs.length, 0);
assert.equal(
  nonMatchingPeriodFilter.ignoredOutOfPeriodCount,
  hisGLogParsed.logs.length
);
assert.deepEqual(nonMatchingPeriodFilter.dateRange, {
  startDate: "2026-02-16",
  endDate: "2026-02-16",
});
assert.equal(nonMatchingPeriodFilter.ignoredDates, "2026-02-16");
assert.equal(
  nonMatchingPeriodFilter.ignoredPayrollCodeRange,
  "Payroll code range: 000000000000000275 to 000000000000000660 (3 unique)"
);

const mixedPeriodFilter = filterAttendanceLogsForPayrollPeriod({
  logs: [
    { logDate: "2026-03-01", employeeNo: "000005" },
    { logDate: "2026-03-16", employeeNo: "000006" },
  ],
  payrollPeriod: {
    startDate: "2026-03-01",
    endDate: "2026-03-15",
  },
});

assert.deepEqual(mixedPeriodFilter.logs, [
  { logDate: "2026-03-01", employeeNo: "000005" },
]);
assert.equal(mixedPeriodFilter.ignoredOutOfPeriodCount, 1);
assert.deepEqual(mixedPeriodFilter.dateRange, {
  startDate: "2026-03-01",
  endDate: "2026-03-16",
});
assert.equal(mixedPeriodFilter.ignoredDates, "2026-03-16");
assert.equal(
  mixedPeriodFilter.ignoredPayrollCodeRange,
  "Payroll code: 000006"
);

const mixedDateTimeParsed = parseAttendanceBuffer(
  Buffer.from(
    [
      "EmployeeNo,DateTime",
      "000005,2026-03-01 08:00:00",
      "000005,2026-03-16 08:00:00",
    ].join("\n"),
    "utf8"
  ),
  "mixed-period.csv"
);

const mixedDateTimePeriodFilter = filterAttendanceLogsForPayrollPeriod({
  logs: mixedDateTimeParsed.logs,
  payrollPeriod: {
    startDate: "2026-03-01",
    endDate: "2026-03-15",
  },
});

assert.equal(mixedDateTimePeriodFilter.logs.length, 1);
assert.equal(mixedDateTimePeriodFilter.logs[0].logDate, "2026-03-01");
assert.equal(mixedDateTimePeriodFilter.ignoredOutOfPeriodCount, 1);
assert.equal(mixedDateTimePeriodFilter.ignoredDates, "2026-03-16");
assert.equal(
  mixedDateTimePeriodFilter.ignoredPayrollCodeRange,
  "Payroll code: 000005"
);

assert.doesNotThrow(() =>
  assertAttendanceLogsMatchPayrollPeriod({
    logs: mixedDateTimeParsed.logs,
    payrollPeriod: {
      code: "2026-03-B1",
      startDate: "2026-03-01",
      endDate: "2026-03-15",
    },
  })
);

const repeatedOutsideParsed = parseAttendanceBuffer(
  Buffer.from(
    [
      "EmployeeNo,DateTime,Direction,Device",
      "000005,2026-02-16 08:00:00,IN,MAIN",
      "000005,2026-02-16 08:00:00,IN,MAIN",
    ].join("\n"),
    "utf8"
  ),
  "repeated-outside.csv"
);

const repeatedOutsideError = captureThrownError(() =>
  assertAttendanceLogsMatchPayrollPeriod({
    logs: repeatedOutsideParsed.logs,
    duplicateLogs: repeatedOutsideParsed.duplicateLogs,
    payrollPeriod: {
      code: "2026-03-B1",
      startDate: "2026-03-01",
      endDate: "2026-03-15",
    },
  })
);

assert.match(
  repeatedOutsideError.message,
  /2 parsed row\(s\) are outside this payroll period/
);
assert.match(
  repeatedOutsideError.message,
  /Denied DTR dates: 2026-02-16/
);
assert.match(repeatedOutsideError.message, /Payroll code: 000005/);
assert.doesNotMatch(repeatedOutsideError.message, /2026-02-16, 2026-02-16/);
assert.doesNotMatch(repeatedOutsideError.message, /repeated 2x/);

assert.equal(
  formatAttendanceLogDates([
    { logDate: "2026-04-01" },
    { logDate: "2026-02-16" },
    { logDate: "2026-04-01" },
    { logDate: "2026-03-16" },
  ]),
  "2026-02-16, 2026-03-16, 2026-04-01"
);

assert.equal(
  formatAttendancePayrollCodeRange([
    { employeeNo: "10" },
    { employeeNo: "2" },
    { employeeNo: "10" },
  ]),
  "Payroll code range: 2 to 10 (2 unique)"
);
assert.equal(
  formatAttendancePayrollCodeRange([{ employeeNo: "SAN-RAMON" }]),
  "Payroll code: SAN-RAMON"
);

assert.equal(summarizeScheduledDay({ inTime: "08:01", outTime: "17:00" }).lateMinutes, 60);
assert.equal(summarizeScheduledDay({ inTime: "08:30", outTime: "17:00" }).lateMinutes, 60);
assert.equal(summarizeScheduledDay({ inTime: "08:31", outTime: "17:00" }).lateMinutes, 60);
assert.equal(summarizeScheduledDay({ inTime: "08:59", outTime: "17:00" }).lateMinutes, 60);
assert.equal(summarizeScheduledDay({ inTime: "09:00", outTime: "17:00" }).lateMinutes, 60);
assert.equal(summarizeScheduledDay({ inTime: "09:10", outTime: "17:00" }).lateMinutes, 60);
assert.equal(
  summarizeScheduledDay({
    inTime: "08:05",
    outTime: "17:00",
    graceMinutes: 5,
  }).lateMinutes,
  0
);
assert.equal(
  summarizeScheduledDay({
    inTime: "08:06",
    outTime: "17:00",
    graceMinutes: 5,
  }).lateMinutes,
  60
);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "17:00" }).undertimeMinutes, 0);
assert.equal(summarizeScheduledDay({ inTime: "08:01", outTime: "17:00" }).undertimeMinutes, 0);
assert.equal(summarizeScheduledDay({ inTime: "08:30", outTime: "17:00" }).undertimeMinutes, 0);
assert.equal(summarizeScheduledDay({ inTime: "08:31", outTime: "17:00" }).undertimeMinutes, 30);
assert.equal(summarizeScheduledDay({ inTime: "09:00", outTime: "17:00" }).undertimeMinutes, 30);
assert.equal(summarizeScheduledDay({ inTime: "09:01", outTime: "17:00" }).undertimeMinutes, 60);
assert.equal(summarizeScheduledDay({ inTime: "09:30", outTime: "17:00" }).undertimeMinutes, 60);
assert.equal(
  summarizeScheduledDay({
    inTime: "08:36",
    outTime: "17:00",
    graceMinutes: 5,
  }).undertimeMinutes,
  30
);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "16:59" }).undertimeMinutes, 0);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "16:01" }).undertimeMinutes, 0);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "16:00" }).undertimeMinutes, 0);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "15:59" }).undertimeMinutes, 30);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "08:01" }).undertimeMinutes, 480);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "08:30" }).undertimeMinutes, 450);
assert.equal(
  summarizeCustomScheduledDay({
    inTime: "06:38:27",
    outTime: "12:01:05",
    checkInTime: "07:00",
    checkOutTime: "16:00",
    breakMinutes: 60,
  }).undertimeMinutes,
  180
);
assert.equal(
  summarizeCustomScheduledDay({
    inTime: "08:00",
    outTime: "12:01",
    checkInTime: "08:00",
    checkOutTime: "17:00",
    breakMinutes: 60,
    regularBreakWindows: [
      {
        fromTime: "12:00",
        toTime: "13:00",
        deductMinutes: 60,
      },
    ],
  }).undertimeMinutes,
  240
);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "17:59" }).overtimeMinutes, 0);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "18:00" }).overtimeMinutes, 60);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "18:10" }).overtimeMinutes, 60);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "18:29" }).overtimeMinutes, 60);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "18:30" }).overtimeMinutes, 90);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "18:59" }).overtimeMinutes, 90);
assert.equal(summarizeScheduledDay({ inTime: "08:00", outTime: "19:10" }).overtimeMinutes, 120);
assert.equal(
  [
    summarizeScheduledDay({ inTime: "08:01", outTime: "17:00" }),
    summarizeScheduledDay({ inTime: "08:01", outTime: "17:00" }),
  ].reduce((total, summary) => total + summary.lateMinutes, 0),
  120
);
assert.equal(
  [
    summarizeScheduledDay({ inTime: "08:00", outTime: "17:59" }),
    summarizeScheduledDay({ inTime: "08:00", outTime: "17:59" }),
  ].reduce((total, summary) => total + summary.overtimeMinutes, 0),
  0
);
assert.equal(
  resolveDetectedOvertimeMinutes({
    scheduleOvertimeMinutes: 0,
    effectiveWorkedMinutes: 8 * 60 + 59,
  }),
  0
);
assert.equal(
  resolveDetectedOvertimeMinutes({
    scheduleOvertimeMinutes: 0,
    effectiveWorkedMinutes: 8 * 60 + 70,
  }),
  60
);
assert.equal(
  resolveDetectedOvertimeMinutes({
    scheduleOvertimeMinutes: 0,
    effectiveWorkedMinutes: 8 * 60 + 90,
  }),
  90
);

const txtTimeFixture = fixtures.find(
  (fixture) => fixture.name === "tab-separated TXT with ID, full datetime Time, and Device ID"
);

assert.ok(txtTimeFixture, "TXT Time fixture is configured.");

const txtTimeParsed = parseAttendanceBuffer(
  Buffer.from(txtTimeFixture.text, "utf8"),
  txtTimeFixture.fileName
);

assert.throws(
  () =>
    assertAttendanceLogsMatchPayrollPeriod({
      logs: txtTimeParsed.logs,
      payrollPeriod: {
        code: "2026-03-B2",
        startDate: "2026-03-16",
        endDate: "2026-03-31",
      },
    }),
  /Denied DTR file: no parsed attendance rows matched.*2026-03-B2 \(2026-03-16 to 2026-03-31\).*2026-03-01 to 2026-03-01.*Denied DTR dates: 2026-03-01/
);

const doublePunchRange = {
  startDate: "2026-03-02",
  endDate: "2026-03-02",
};
const doublePunchLogs = [
  buildRawScheduledLog("08:00", "IN", 1),
  buildRawScheduledLog("08:30", "IN", 2),
  buildRawScheduledLog("17:00", "OUT", 3),
];
const fixedShiftAssignment = buildDoublePunchShiftAssignment(false);
const missingOutSummaries = buildAttendanceSummaryComputations({
  employees: [doublePunchEmployee],
  logs: [buildRawScheduledLog("08:00", "IN", 41)],
  approvedLeaves: [],
  shiftAssignments: [fixedShiftAssignment],
  weeklyPatterns: [],
  shiftTableBreaksByShiftTableId: new Map(),
  allowedAttendanceDateRange: doublePunchRange,
});
const missingOutSummary = missingOutSummaries[0];
const missingOutFlags = parseStoredAnomalyFlags(missingOutSummary.anomalyFlags);
const computedMissingOutRow = toDtrMetrics(missingOutSummary, missingOutFlags);
const autoHeldMissingOutRow = applyAttendanceDtrEffectiveStatus(
  computedMissingOutRow,
  null
);
const manualPresentMissingOutRow = applyAttendanceDtrEffectiveStatus(
  computedMissingOutRow,
  "Present"
);

assert.ok(missingOutFlags.includes("ODD_PUNCH_COUNT"));
assert.ok(missingOutFlags.includes("MISSING_OUT"));
assert.equal(getComputedAttendanceDtrStatus(computedMissingOutRow), "Hold");
assert.equal(autoHeldMissingOutRow.workedMinutes, 0);
assert.equal(autoHeldMissingOutRow.regularMinutes, 0);
assert.equal(autoHeldMissingOutRow.lateMinutes, 0);
assert.equal(autoHeldMissingOutRow.undertimeMinutes, 0);
assert.equal(autoHeldMissingOutRow.overtimeMinutes, 0);
assert.equal(autoHeldMissingOutRow.absentMinutes, 0);
assert.equal(manualPresentMissingOutRow.workedMinutes, 480);
assert.equal(manualPresentMissingOutRow.regularMinutes, 480);

const fixedDoublePunchSuggestions = buildAttendanceCorrectionSuggestionComputations({
  employees: [doublePunchEmployee],
  logs: doublePunchLogs,
  approvedLeaves: [],
  shiftAssignments: [fixedShiftAssignment],
  weeklyPatterns: [],
  shiftTableBreaksByShiftTableId: new Map(),
  allowedAttendanceDateRange: doublePunchRange,
});
const fixedDoublePunchCorrection = getCorrectionByType(
  fixedDoublePunchSuggestions,
  "Same-Direction Duplicate"
);

assert.ok(fixedDoublePunchCorrection);
assert.equal(fixedDoublePunchCorrection.autoApprove, true);
assert.deepEqual(fixedDoublePunchCorrection.payload.ignoredRawLogIds, [2]);
assert.deepEqual(
  fixedDoublePunchCorrection.payload.effectivePunches.map((punch) => punch.logTime),
  ["08:00:00", "17:00:00"]
);
assert.ok(
  fixedDoublePunchCorrection.payload.proposedMetrics?.anomalyFlags.includes(
    ATTENDANCE_DOUBLE_PUNCH_FLAG
  )
);

const fixedDoublePunchSummaries = buildAttendanceSummaryComputations({
  employees: [doublePunchEmployee],
  logs: doublePunchLogs,
  approvedLeaves: [],
  shiftAssignments: [fixedShiftAssignment],
  weeklyPatterns: [],
  shiftTableBreaksByShiftTableId: new Map(),
  approvedCorrections: fixedDoublePunchSuggestions.filter(
    (suggestion) => suggestion.autoApprove === true
  ),
  allowedAttendanceDateRange: doublePunchRange,
});
const fixedDoublePunchFlags = parseStoredAnomalyFlags(
  fixedDoublePunchSummaries[0].anomalyFlags
);

assert.ok(fixedDoublePunchFlags.includes(ATTENDANCE_DOUBLE_PUNCH_FLAG));
assert.equal(fixedDoublePunchFlags.includes("ODD_PUNCH_COUNT"), false);
assert.equal(fixedDoublePunchFlags.includes("MISSING_OUT"), false);
assert.equal(fixedDoublePunchSummaries[0].firstInAt?.getHours(), 8);
assert.equal(fixedDoublePunchSummaries[0].lastOutAt?.getHours(), 17);
assert.equal(fixedDoublePunchSummaries[0].workedMinutes, 480);
assert.equal(
  getComputedAttendanceDtrStatus(toDtrMetrics(fixedDoublePunchSummaries[0])),
  "Present"
);

const shortWindowDoublePunchSuggestions =
  buildAttendanceCorrectionSuggestionComputations({
    employees: [doublePunchEmployee],
    logs: [
      buildRawScheduledLog("08:00", "IN", 11),
      buildRawScheduledLog("08:05", "IN", 12),
      buildRawScheduledLog("17:00", "OUT", 13),
    ],
    approvedLeaves: [],
    shiftAssignments: [fixedShiftAssignment],
    weeklyPatterns: [],
    shiftTableBreaksByShiftTableId: new Map(),
    allowedAttendanceDateRange: doublePunchRange,
  });

assert.equal(
  getCorrectionByType(shortWindowDoublePunchSuggestions, "Duplicate Punch"),
  undefined
);
assert.equal(
  getCorrectionByType(shortWindowDoublePunchSuggestions, "Same-Direction Duplicate")
    ?.autoApprove,
  true
);

const proximityDuplicatePunchSuggestions =
  buildAttendanceCorrectionSuggestionComputations({
    employees: [doublePunchEmployee],
    logs: [
      buildRawScheduledLog("08:00", "IN", 31),
      buildRawScheduledLog("08:05", "OUT", 32),
      buildRawScheduledLog("17:00", "OUT", 33),
    ],
    approvedLeaves: [],
    shiftAssignments: [fixedShiftAssignment],
    weeklyPatterns: [],
    shiftTableBreaksByShiftTableId: new Map(),
    allowedAttendanceDateRange: doublePunchRange,
  });
const proximityDuplicatePunchCorrection = getCorrectionByType(
  proximityDuplicatePunchSuggestions,
  "Duplicate Punch"
);

assert.ok(proximityDuplicatePunchCorrection);
assert.equal(proximityDuplicatePunchCorrection.autoApprove, true);
assert.deepEqual(proximityDuplicatePunchCorrection.payload.ignoredRawLogIds, [32]);
assert.deepEqual(
  proximityDuplicatePunchCorrection.payload.effectivePunches.map(
    (punch) => punch.logTime
  ),
  ["08:00:00", "17:00:00"]
);

const proximityDuplicatePunchSummaries = buildAttendanceSummaryComputations({
  employees: [doublePunchEmployee],
  logs: [
    buildRawScheduledLog("08:00", "IN", 31),
    buildRawScheduledLog("08:05", "OUT", 32),
    buildRawScheduledLog("17:00", "OUT", 33),
  ],
  approvedLeaves: [],
  shiftAssignments: [fixedShiftAssignment],
  weeklyPatterns: [],
  shiftTableBreaksByShiftTableId: new Map(),
  approvedCorrections: proximityDuplicatePunchSuggestions.filter(
    (suggestion) => suggestion.autoApprove === true
  ),
  allowedAttendanceDateRange: doublePunchRange,
});
const proximityDuplicatePunchFlags = parseStoredAnomalyFlags(
  proximityDuplicatePunchSummaries[0].anomalyFlags
);

assert.ok(proximityDuplicatePunchFlags.includes(ATTENDANCE_DOUBLE_PUNCH_FLAG));
assert.equal(proximityDuplicatePunchFlags.includes("ODD_PUNCH_COUNT"), false);
assert.equal(proximityDuplicatePunchFlags.includes("MISSING_OUT"), false);
assert.equal(proximityDuplicatePunchSummaries[0].firstInAt?.getHours(), 8);
assert.equal(proximityDuplicatePunchSummaries[0].lastOutAt?.getHours(), 17);
assert.equal(proximityDuplicatePunchSummaries[0].workedMinutes, 480);

const oppositeDirectionSuggestions = buildAttendanceCorrectionSuggestionComputations({
  employees: [doublePunchEmployee],
  logs: [
    buildRawScheduledLog("08:00", "IN", 21),
    buildRawScheduledLog("08:30", "OUT", 22),
  ],
  approvedLeaves: [],
  shiftAssignments: [fixedShiftAssignment],
  weeklyPatterns: [],
  shiftTableBreaksByShiftTableId: new Map(),
  allowedAttendanceDateRange: doublePunchRange,
});

assert.equal(
  getCorrectionByType(oppositeDirectionSuggestions, "Same-Direction Duplicate"),
  undefined
);

const flexibleDoublePunchSuggestions = buildAttendanceCorrectionSuggestionComputations({
  employees: [doublePunchEmployee],
  logs: doublePunchLogs,
  approvedLeaves: [],
  shiftAssignments: [buildDoublePunchShiftAssignment(true)],
  weeklyPatterns: [],
  shiftTableBreaksByShiftTableId: new Map(),
  allowedAttendanceDateRange: doublePunchRange,
});
const flexibleDoublePunchCorrection = getCorrectionByType(
  flexibleDoublePunchSuggestions,
  "Same-Direction Duplicate"
);

assert.ok(flexibleDoublePunchCorrection);
assert.equal(flexibleDoublePunchCorrection.autoApprove, true);
assert.deepEqual(flexibleDoublePunchCorrection.payload.ignoredRawLogIds, [2]);
assert.deepEqual(
  flexibleDoublePunchCorrection.payload.effectivePunches.map((punch) => punch.logTime),
  ["08:00:00", "17:00:00"]
);

const flexibleDoublePunchSummaries = buildAttendanceSummaryComputations({
  employees: [doublePunchEmployee],
  logs: doublePunchLogs,
  approvedLeaves: [],
  shiftAssignments: [buildDoublePunchShiftAssignment(true)],
  weeklyPatterns: [],
  shiftTableBreaksByShiftTableId: new Map(),
  approvedCorrections: flexibleDoublePunchSuggestions.filter(
    (suggestion) => suggestion.autoApprove === true
  ),
  allowedAttendanceDateRange: doublePunchRange,
});
const flexibleDoublePunchFlags = parseStoredAnomalyFlags(
  flexibleDoublePunchSummaries[0].anomalyFlags
);

assert.ok(flexibleDoublePunchFlags.includes(ATTENDANCE_DOUBLE_PUNCH_FLAG));
assert.equal(flexibleDoublePunchFlags.includes("ODD_PUNCH_COUNT"), false);
assert.equal(flexibleDoublePunchFlags.includes("MISSING_OUT"), false);
assert.equal(flexibleDoublePunchSummaries[0].firstInAt?.getHours(), 8);
assert.equal(flexibleDoublePunchSummaries[0].lastOutAt?.getHours(), 17);
assert.equal(flexibleDoublePunchSummaries[0].workedMinutes, 480);

console.log("Attendance parser fixtures passed.");

import { format } from "date-fns";
import { parse as parseCsv } from "csv-parse/sync";
import {
  roundDtrOvertimeMinutes,
  roundDtrUndertimeMinutes,
  splitDtrLateArrivalMinutes,
} from "./dtrRounding";

export type ParsedAttendanceDirection = "IN" | "OUT" | "UNSPECIFIED";

export type ParsedAttendanceLog = {
  rawLogId?: number | null;
  employeeNo: string;
  employeeId?: string | null;
  batchId?: string | null;
  loggedAt: Date;
  logDate: string;
  logTime: string;
  direction: ParsedAttendanceDirection;
  sourceLine: number;
  rawText: string;
  deviceId?: string | null;
  siteCode?: string | null;
  isSyntheticCorrection?: boolean;
};

export type ShiftWindow = {
  checkInTime: string | null;
  checkOutTime: string | null;
  breakMinutes?: number;
  graceMinutes?: number;
  hoursPerDay?: number;
  restDay?: string | null;
  regularBreakWindows?: ShiftBreakWindow[];
};

export type ShiftBreakWindow = {
  fromTime: string;
  toTime: string;
  deductMinutes: number;
};

export type DailyAttendanceSummarySeed = {
  attendanceDate: string;
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

type AttendanceParseErrorCode = "UNSUPPORTED_ENCODING" | "INVALID_CSV";

export class AttendanceParseError extends Error {
  readonly code: AttendanceParseErrorCode;
  readonly cause?: unknown;

  constructor(
    code: AttendanceParseErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = "AttendanceParseError";
    this.code = code;
    this.cause = options?.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const EMPLOYEE_IDENTIFIER_ALIASES = [
  "employeeno",
  "employeeid",
  "employeecode",
  "empno",
  "empcode",
  "enno",
  "eno",
  "uid",
  "enrollno",
  "enrollnumber",
  "userid",
  "badgenumber",
  "idnumber",
  "employee",
  "id",
];

const DATETIME_ALIASES = [
  "datetime",
  "dateandtime",
  "timestamp",
  "checktime",
  "transactiontime",
  "logtime",
];

const DATE_ALIASES = ["date", "logdate", "checkdate", "transactiondate"];
const TIME_ALIASES = ["time", "checkintime", "checkouttime", "transactiontime"];
const DIRECTION_ALIASES = [
  "direction",
  "state",
  "status",
  "inout",
  "checktype",
];
const DEVICE_ALIASES = [
  "device",
  "deviceid",
  "terminal",
  "terminalid",
  "dn",
  "mchn",
  "machine",
  "machineid",
];
const SITE_ALIASES = ["site", "sitecode", "location", "branch"];

type AttendanceTabularCandidate = {
  delimiter: "," | "\t" | ";" | "|" | null;
  label: string;
};

type AttendanceLine = {
  text: string;
  sourceLine: number;
};

type ParsedAttendanceRecord = {
  logs: ParsedAttendanceLog[];
  detectedFormat: string;
  employeeIdentifierHeader: string | null;
};

const TABULAR_CANDIDATES: AttendanceTabularCandidate[] = [
  { delimiter: ",", label: "comma-delimited DTR" },
  { delimiter: "\t", label: "tab-delimited DTR" },
  { delimiter: ";", label: "semicolon-delimited DTR" },
  { delimiter: "|", label: "pipe-delimited DTR" },
  { delimiter: null, label: "whitespace-delimited DTR" },
];

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeAttendanceEmployeeKey(value: string | null | undefined) {
  if (!value) return null;

  const normalized = value.trim().replace(/^EMP[\s-]*/i, "");
  if (!normalized || !/^\d+$/.test(normalized)) {
    return null;
  }

  const withoutLeadingZeroes = normalized.replace(/^0+/, "");
  return withoutLeadingZeroes || null;
}

export function getAttendanceLogDateRange(
  logs: Array<Pick<ParsedAttendanceLog, "logDate">>
) {
  const sortedDates = logs.map((log) => log.logDate).sort();

  return sortedDates.length === 0
    ? null
    : {
        startDate: sortedDates[0],
        endDate: sortedDates[sortedDates.length - 1],
      };
}

type AttendancePayrollPeriodRange = {
  code?: string | null;
  startDate: string;
  endDate: string;
};

function formatAttendancePayrollPeriodLabel(payrollPeriod: {
  code?: string | null;
  startDate: string;
  endDate: string;
}) {
  return payrollPeriod.code
    ? `${payrollPeriod.code} (${payrollPeriod.startDate} to ${payrollPeriod.endDate})`
    : `${payrollPeriod.startDate} to ${payrollPeriod.endDate}`;
}

function isAttendanceLogWithinPayrollPeriod(
  log: Pick<ParsedAttendanceLog, "logDate">,
  payrollPeriod: Pick<AttendancePayrollPeriodRange, "startDate" | "endDate">
) {
  return (
    log.logDate >= payrollPeriod.startDate &&
    log.logDate <= payrollPeriod.endDate
  );
}

export function formatAttendanceLogDates(
  logs: Array<Pick<ParsedAttendanceLog, "logDate">>
) {
  return [...new Set(logs.map((log) => log.logDate))].sort().join(", ");
}

function compareNumericAttendancePayrollCodes(left: string, right: string) {
  const normalizedLeft = left.replace(/^0+/, "") || "0";
  const normalizedRight = right.replace(/^0+/, "") || "0";

  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length;
  }

  const numericComparison = normalizedLeft.localeCompare(normalizedRight);
  return numericComparison !== 0 ? numericComparison : left.localeCompare(right);
}

export function formatAttendancePayrollCodeRange(
  logs: Array<Pick<ParsedAttendanceLog, "employeeNo">>
) {
  const payrollCodes = [
    ...new Set(
      logs
        .map((log) => log.employeeNo.trim())
        .filter((employeeNo) => Boolean(employeeNo))
    ),
  ];

  if (payrollCodes.length === 0) return "";

  const sortedCodes = payrollCodes.every((code) => /^\d+$/.test(code))
    ? payrollCodes.sort(compareNumericAttendancePayrollCodes)
    : payrollCodes.sort((left, right) => left.localeCompare(right));

  if (sortedCodes.length === 1) {
    return `Payroll code: ${sortedCodes[0]}`;
  }

  return `Payroll code range: ${sortedCodes[0]} to ${
    sortedCodes[sortedCodes.length - 1]
  } (${sortedCodes.length} unique)`;
}

export function assertAttendanceLogsMatchPayrollPeriod(args: {
  logs: Array<Pick<ParsedAttendanceLog, "logDate" | "employeeNo">>;
  duplicateLogs?: Array<Pick<ParsedAttendanceLog, "logDate" | "employeeNo">>;
  payrollPeriod: AttendancePayrollPeriodRange;
}) {
  const allLogs = [...args.logs, ...(args.duplicateLogs ?? [])];
  const attendanceRange = getAttendanceLogDateRange(allLogs);
  if (!attendanceRange) return;

  const matchingCount = allLogs.filter((log) =>
    isAttendanceLogWithinPayrollPeriod(log, args.payrollPeriod)
  ).length;

  if (matchingCount > 0) return;

  const outOfPeriodLogs = allLogs.filter(
    (log) => !isAttendanceLogWithinPayrollPeriod(log, args.payrollPeriod)
  );
  const deniedDates = formatAttendanceLogDates(outOfPeriodLogs);
  const deniedPayrollCodeRange = formatAttendancePayrollCodeRange(outOfPeriodLogs);
  const deniedPayrollCodeDetails = deniedPayrollCodeRange
    ? ` ${deniedPayrollCodeRange}.`
    : "";

  throw new Error(
    `Denied DTR file: no parsed attendance rows matched the selected payroll period ${formatAttendancePayrollPeriodLabel(args.payrollPeriod)}. The file contains attendance dates ${attendanceRange.startDate} to ${attendanceRange.endDate}. ${outOfPeriodLogs.length} parsed row(s) are outside this payroll period. Denied DTR dates: ${deniedDates}.${deniedPayrollCodeDetails} Select the correct payroll period or upload the matching DTR file.`
  );
}

export function filterAttendanceLogsForPayrollPeriod<
  T extends Pick<ParsedAttendanceLog, "logDate" | "employeeNo">,
>(args: {
  logs: T[];
  payrollPeriod: {
    startDate: string;
    endDate: string;
  };
}) {
  const dateRange = getAttendanceLogDateRange(args.logs);
  const logs = args.logs.filter(
    (log) =>
      log.logDate >= args.payrollPeriod.startDate &&
      log.logDate <= args.payrollPeriod.endDate
  );
  const ignoredLogs = args.logs.filter(
    (log) =>
      log.logDate < args.payrollPeriod.startDate ||
      log.logDate > args.payrollPeriod.endDate
  );

  return {
    logs,
    ignoredOutOfPeriodCount: ignoredLogs.length,
    ignoredDates: formatAttendanceLogDates(ignoredLogs),
    ignoredPayrollCodeRange: formatAttendancePayrollCodeRange(ignoredLogs),
    dateRange,
  };
}

function formatDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatTimeOnly(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

function parseDateTimeValue(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const dateTimeMatch =
    /^(\d{4}[-/]\d{1,2}[-/]\d{1,2})[ T]+(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([AP]M))?$/i.exec(
      normalized
    );

  if (dateTimeMatch) {
    const parsed = buildLocalDateTime(
      dateTimeMatch[1],
      dateTimeMatch[2],
      dateTimeMatch[3] ?? null
    );
    if (parsed) return parsed;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateAndTime(dateValue: string, timeValue: string) {
  return parseDateTimeValue(`${dateValue.trim()} ${timeValue.trim()}`);
}

function getAliasEntry(record: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(record).map(([key, value]) => ({
    key,
    normalizedKey: normalizeKey(key),
    value,
  }));

  for (const alias of aliases) {
    const entry = entries.find((candidate) => candidate.normalizedKey === alias);
    if (!entry) continue;

    if (entry.value == null) continue;
    const stringValue = String(entry.value).trim();
    if (!stringValue) continue;

    return {
      key: entry.key,
      value: stringValue,
    };
  }

  return null;
}

function getAliasValue(record: Record<string, unknown>, aliases: string[]) {
  return getAliasEntry(record, aliases)?.value ?? null;
}

function normalizeDirection(rawValue: string | null): ParsedAttendanceDirection {
  if (!rawValue) return "UNSPECIFIED";

  const normalized = rawValue.trim().toUpperCase();
  if (["I", "IN", "CHECKIN", "TIMEIN", "CLOCKIN"].includes(normalized)) {
    return "IN";
  }

  if (["O", "OUT", "CHECKOUT", "TIMEOUT", "CLOCKOUT"].includes(normalized)) {
    return "OUT";
  }

  return "UNSPECIFIED";
}

function parseDateParts(value: string) {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  return { year, month, day };
}

function parseTimeParts(value: string, meridiem?: string | null) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? "0");

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }

  const normalizedMeridiem = meridiem?.trim().toUpperCase();
  if (normalizedMeridiem === "AM" && hours === 12) {
    hours = 0;
  } else if (normalizedMeridiem === "PM" && hours < 12) {
    hours += 12;
  }

  return { hours, minutes, seconds };
}

function buildLocalDateTime(
  dateValue: string,
  timeValue: string,
  meridiem?: string | null
) {
  const dateParts = parseDateParts(dateValue.replace(/\//g, "-"));
  const timeParts = parseTimeParts(timeValue, meridiem);

  if (!dateParts || !timeParts) return null;

  const parsed = new Date(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hours,
    timeParts.minutes,
    timeParts.seconds,
    0
  );

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasAlias(header: string, aliases: string[]) {
  return aliases.includes(normalizeKey(header));
}

function findEmployeeIdentifierHeader(headerCells: string[]) {
  const compactHeaders = compactHeaderCells(headerCells);

  for (const alias of EMPLOYEE_IDENTIFIER_ALIASES) {
    const entry = compactHeaders.find(
      (header) => normalizeKey(header.header) === alias
    );

    if (entry) {
      return entry.header;
    }
  }

  return null;
}

function isDateTimeHeader(header: string) {
  return hasAlias(header, DATETIME_ALIASES);
}

function looksLikeDateOnly(value: string | null | undefined) {
  return Boolean(value && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(value.trim()));
}

function looksLikeTimeOnly(value: string | null | undefined) {
  return Boolean(
    value &&
      /^\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?$/i.test(value.trim())
  );
}

function getAttendanceLines(text: string): AttendanceLine[] {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({
      text: line.trim(),
      sourceLine: index + 1,
    }))
    .filter((line) => Boolean(line.text));
}

function stripWholeLineQuotesForDelimiter(
  line: string,
  delimiter: AttendanceTabularCandidate["delimiter"]
) {
  if (delimiter == null || delimiter === ",") {
    return line;
  }

  const trimmed = line.trim();
  if (trimmed.length < 2 || !trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return line;
  }

  const inner = trimmed.slice(1, -1);
  if (!inner.includes(delimiter)) {
    return line;
  }

  if (inner.includes(`"${delimiter}"`)) {
    return line;
  }

  return inner.replace(/""/g, '"');
}

function stripWholeLineQuotes(line: string) {
  const trimmed = line.trim();
  if (trimmed.length < 2 || !trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return line;
  }

  return trimmed.slice(1, -1).replace(/""/g, '"');
}

function splitDelimitedLine(
  line: string,
  candidate: AttendanceTabularCandidate
) {
  const normalizedLine = stripWholeLineQuotesForDelimiter(
    line,
    candidate.delimiter
  );

  if (candidate.delimiter == null) {
    return stripWholeLineQuotes(normalizedLine)
      .trim()
      .split(/\s+/)
      .map((cell) => cell.trim());
  }

  try {
    const rows = parseCsv(normalizedLine, {
      delimiter: candidate.delimiter,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];

    return rows[0]?.map((cell) => String(cell ?? "").trim()) ?? [];
  } catch {
    return [];
  }
}

function compactHeaderCells(headerCells: string[]) {
  return headerCells
    .map((header, index) => ({
      header: header.trim(),
      index,
    }))
    .filter((entry) => Boolean(entry.header));
}

function hasRecognizedAttendanceHeader(headerCells: string[]) {
  const compactHeaders = compactHeaderCells(headerCells).map(
    (entry) => entry.header
  );
  const hasEmployeeIdentifier = findEmployeeIdentifierHeader(headerCells) != null;
  const hasCombinedDateTime = compactHeaders.some((header) =>
    hasAlias(header, DATETIME_ALIASES)
  );
  const hasTimeColumn = compactHeaders.some((header) =>
    hasAlias(header, TIME_ALIASES)
  );
  const hasSeparateDateAndTime =
    compactHeaders.some((header) => hasAlias(header, DATE_ALIASES)) &&
    hasTimeColumn;

  return hasEmployeeIdentifier && (hasCombinedDateTime || hasSeparateDateAndTime || hasTimeColumn);
}

function setRecordValue(
  record: Record<string, unknown>,
  header: string,
  value: string
) {
  if (!(header in record)) {
    record[header] = value;
    return;
  }

  let suffix = 2;
  let uniqueHeader = `${header} ${suffix}`;
  while (uniqueHeader in record) {
    suffix += 1;
    uniqueHeader = `${header} ${suffix}`;
  }

  record[uniqueHeader] = value;
}

function mapCellsToRecord(headerCells: string[], dataCells: string[]) {
  const headerEntries = compactHeaderCells(headerCells);
  const useOriginalIndexes = dataCells.length === headerCells.length;
  const record: Record<string, unknown> = {};
  let dataCursor = 0;

  for (const entry of headerEntries) {
    const dataIndex = useOriginalIndexes ? entry.index : dataCursor;
    const currentValue = dataCells[dataIndex]?.trim() ?? "";
    const nextValue = dataCells[dataIndex + 1]?.trim() ?? "";

    if (
      isDateTimeHeader(entry.header) &&
      looksLikeDateOnly(currentValue) &&
      looksLikeTimeOnly(nextValue)
    ) {
      setRecordValue(record, entry.header, `${currentValue} ${nextValue}`);
      if (!useOriginalIndexes) {
        dataCursor += 2;
      }
      continue;
    }

    setRecordValue(record, entry.header, currentValue);
    if (!useOriginalIndexes) {
      dataCursor += 1;
    }
  }

  return record;
}

function parseAttendanceRecord(
  record: Record<string, unknown>,
  sourceLine: number,
  rawText: string
): ParsedAttendanceLog | null {
  const employeeNo = getAliasEntry(record, EMPLOYEE_IDENTIFIER_ALIASES)?.value ?? null;
  const combinedDateTime = getAliasValue(record, DATETIME_ALIASES);
  const dateValue = getAliasValue(record, DATE_ALIASES);
  const timeValue = getAliasValue(record, TIME_ALIASES);

  const loggedAt =
    (combinedDateTime && parseDateTimeValue(combinedDateTime)) ||
    (dateValue && timeValue && parseDateAndTime(dateValue, timeValue)) ||
    (timeValue && parseDateTimeValue(timeValue));

  if (!employeeNo || !loggedAt) {
    return null;
  }

  return {
    employeeNo,
    loggedAt,
    logDate: formatDateOnly(loggedAt),
    logTime: formatTimeOnly(loggedAt),
    direction: normalizeDirection(getAliasValue(record, DIRECTION_ALIASES)),
    sourceLine,
    rawText,
    deviceId: getAliasValue(record, DEVICE_ALIASES),
    siteCode: getAliasValue(record, SITE_ALIASES),
  };
}

function parseTabularCandidate(
  lines: AttendanceLine[],
  candidate: AttendanceTabularCandidate
) {
  const headerSearchLines = lines.slice(0, 10);
  const headerLine = headerSearchLines.find((line) =>
    hasRecognizedAttendanceHeader(splitDelimitedLine(line.text, candidate))
  );

  if (!headerLine) {
    return null;
  }

  const headerCells = splitDelimitedLine(headerLine.text, candidate);
  const employeeIdentifierHeader = findEmployeeIdentifierHeader(headerCells);
  const dataLines = lines.filter((line) => line.sourceLine > headerLine.sourceLine);
  const logs = dataLines.flatMap((line) => {
    const dataCells = splitDelimitedLine(line.text, candidate);
    if (dataCells.length === 0) return [];

    const record = mapCellsToRecord(headerCells, dataCells);
    const parsed = parseAttendanceRecord(record, line.sourceLine, line.text);
    return parsed ? [parsed] : [];
  });

  return {
    logs,
    detectedFormat: candidate.label,
    employeeIdentifierHeader,
  } satisfies ParsedAttendanceRecord;
}

function parseTabularLogs(text: string) {
  const lines = getAttendanceLines(text);
  const parsedCandidates = TABULAR_CANDIDATES.flatMap((candidate) => {
    const parsed = parseTabularCandidate(lines, candidate);
    return parsed && parsed.logs.length > 0 ? [parsed] : [];
  });

  if (parsedCandidates.length === 0) {
    return null;
  }

  return parsedCandidates.sort((left, right) => {
    const logCountDifference = right.logs.length - left.logs.length;
    if (logCountDifference !== 0) return logCountDifference;
    return TABULAR_CANDIDATES.findIndex(
      (candidate) => candidate.label === left.detectedFormat
    ) -
      TABULAR_CANDIDATES.findIndex(
        (candidate) => candidate.label === right.detectedFormat
      );
  })[0];
}

function stripLeadingBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function detectUtf16Encoding(buffer: Buffer) {
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return "utf-16le" as const;
    }

    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return "utf-16be" as const;
    }
  }

  const sampleLength = Math.min(buffer.length - (buffer.length % 2), 128);
  if (sampleLength < 4) return null;

  let evenNullBytes = 0;
  let oddNullBytes = 0;

  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] !== 0) continue;

    if (index % 2 === 0) {
      evenNullBytes += 1;
    } else {
      oddNullBytes += 1;
    }
  }

  const minimumNullBytes = Math.max(2, Math.floor(sampleLength / 8));
  if (oddNullBytes >= minimumNullBytes && evenNullBytes * 3 <= oddNullBytes) {
    return "utf-16le" as const;
  }

  if (evenNullBytes >= minimumNullBytes && oddNullBytes * 3 <= evenNullBytes) {
    return "utf-16be" as const;
  }

  return null;
}

function decodeAttendanceText(buffer: Buffer) {
  const encoding =
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
      ? "utf-8"
      : detectUtf16Encoding(buffer) ?? "utf-8";

  try {
    return stripLeadingBom(new TextDecoder(encoding).decode(buffer));
  } catch (error) {
    throw new AttendanceParseError(
      "UNSUPPORTED_ENCODING",
      "Attendance file could not be decoded. Supported encodings are UTF-8 and Unicode/UTF-16.",
      { cause: error }
    );
  }
}

function parseTxtLine(line: string, sourceLine: number): ParsedAttendanceLog | null {
  const labeled = /\b(?:ID|UID|EnNo|Employee\s*No\.?|Employee\s*ID|EmpNo)\b\s*[:=]?\s*([A-Za-z0-9_-]+).*?(\d{4}[-/]\d{1,2}[-/]\d{1,2})[\s,;|]+(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([AP]M))?(?:[,|\s;]+(IN|OUT|I|O))?/i;
  const employeeFirst = /^([A-Za-z0-9_-]+)[,|\s;]+(\d{4}[-/]\d{1,2}[-/]\d{1,2})[,|\s;]+(\d{1,2}:\d{2}(?::\d{2})?)(?:[,|\s;]+(IN|OUT|I|O))?/i;
  const dateFirst = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2})[,|\s;]+(\d{1,2}:\d{2}(?::\d{2})?)[,|\s;]+([A-Za-z0-9_-]+)(?:[,|\s;]+(IN|OUT|I|O))?/i;
  const combined = /^([A-Za-z0-9_-]+)[,|\s;]+(\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)(?:[,|\s;]+(IN|OUT|I|O))?/i;

  const labeledMatch = labeled.exec(line);
  if (labeledMatch) {
    const employeeNo = labeledMatch[1];
    const loggedAt = buildLocalDateTime(
      labeledMatch[2],
      labeledMatch[3],
      labeledMatch[4] ?? null
    );

    if (!loggedAt) return null;

    return {
      employeeNo,
      loggedAt,
      logDate: formatDateOnly(loggedAt),
      logTime: formatTimeOnly(loggedAt),
      direction: normalizeDirection(labeledMatch[5] ?? null),
      sourceLine,
      rawText: line,
    };
  }

  const employeeFirstMatch = employeeFirst.exec(line);
  if (employeeFirstMatch) {
    const employeeNo = employeeFirstMatch[1];
    const loggedAt = parseDateAndTime(employeeFirstMatch[2], employeeFirstMatch[3]);

    if (!loggedAt) return null;

    return {
      employeeNo,
      loggedAt,
      logDate: formatDateOnly(loggedAt),
      logTime: formatTimeOnly(loggedAt),
      direction: normalizeDirection(employeeFirstMatch[4] ?? null),
      sourceLine,
      rawText: line,
    };
  }

  const dateFirstMatch = dateFirst.exec(line);
  if (dateFirstMatch) {
    const employeeNo = dateFirstMatch[3];
    const loggedAt = parseDateAndTime(dateFirstMatch[1], dateFirstMatch[2]);

    if (!loggedAt) return null;

    return {
      employeeNo,
      loggedAt,
      logDate: formatDateOnly(loggedAt),
      logTime: formatTimeOnly(loggedAt),
      direction: normalizeDirection(dateFirstMatch[4] ?? null),
      sourceLine,
      rawText: line,
    };
  }

  const combinedMatch = combined.exec(line);
  if (combinedMatch) {
    const employeeNo = combinedMatch[1];
    const loggedAt = parseDateTimeValue(combinedMatch[2]);

    if (!loggedAt) return null;

    return {
      employeeNo,
      loggedAt,
      logDate: formatDateOnly(loggedAt),
      logTime: formatTimeOnly(loggedAt),
      direction: normalizeDirection(combinedMatch[3] ?? null),
      sourceLine,
      rawText: line,
    };
  }

  return null;
}

function parseTxtLogs(text: string) {
  const logs = getAttendanceLines(text)
    .flatMap((line) => {
      const parsed = parseTxtLine(line.text, line.sourceLine);
      return parsed ? [parsed] : [];
    });

  return {
    logs,
    detectedFormat: "text DTR rows",
    employeeIdentifierHeader: null,
  } satisfies ParsedAttendanceRecord;
}

export function parseAttendanceBuffer(buffer: Buffer, fileName: string) {
  void fileName;
  const text = decodeAttendanceText(buffer);
  const parsedAttendance = parseTabularLogs(text) ?? parseTxtLogs(text);
  const parsedLogs = parsedAttendance.logs;

  const seen = new Set<string>();
  const uniqueLogs: ParsedAttendanceLog[] = [];
  const duplicateLogs: ParsedAttendanceLog[] = [];

  for (const log of parsedLogs) {
    const dedupeKey = [
      log.employeeNo,
      log.logDate,
      log.logTime,
      log.direction,
      log.deviceId ?? "",
    ].join("|");

    if (seen.has(dedupeKey)) {
      duplicateLogs.push(log);
      continue;
    }

    seen.add(dedupeKey);
    uniqueLogs.push(log);
  }

  return {
    logs: uniqueLogs.sort(
      (left, right) => left.loggedAt.getTime() - right.loggedAt.getTime()
    ),
    duplicateLogs,
    duplicateCount: duplicateLogs.length,
    detectedFormat: parsedAttendance.detectedFormat,
    employeeIdentifierHeader: parsedAttendance.employeeIdentifierHeader,
  };
}

function parseTimeToMinutes(value: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function getShiftDurationMinutes(checkInTime: string | null, checkOutTime: string | null) {
  const checkInMinutes = parseTimeToMinutes(checkInTime);
  const checkOutMinutes = parseTimeToMinutes(checkOutTime);
  if (checkInMinutes == null || checkOutMinutes == null) return null;

  return checkOutMinutes <= checkInMinutes
    ? checkOutMinutes + 1440 - checkInMinutes
    : checkOutMinutes - checkInMinutes;
}

function isOvernightShiftWindow(shift: ShiftWindow) {
  const checkInMinutes = parseTimeToMinutes(shift.checkInTime);
  const checkOutMinutes = parseTimeToMinutes(shift.checkOutTime);

  return (
    checkInMinutes != null &&
    checkOutMinutes != null &&
    checkOutMinutes <= checkInMinutes
  );
}

function mapLoggedAtToAttendanceMinutes(args: {
  loggedAt: Date;
  attendanceDate: string;
  shift: ShiftWindow;
}) {
  const baseMinutes = args.loggedAt.getHours() * 60 + args.loggedAt.getMinutes();
  if (!isOvernightShiftWindow(args.shift)) {
    return baseMinutes;
  }

  return formatDateOnly(args.loggedAt) > args.attendanceDate
    ? baseMinutes + 1440
    : baseMinutes;
}

function getNightMinutes(firstInAt: Date | null, lastOutAt: Date | null) {
  if (!firstInAt || !lastOutAt || lastOutAt <= firstInAt) return 0;

  let total = 0;
  const cursor = new Date(firstInAt.getTime());

  while (cursor < lastOutAt) {
    const next = new Date(Math.min(cursor.getTime() + 60_000, lastOutAt.getTime()));
    const hour = cursor.getHours();
    if (hour >= 22 || hour < 6) total += 1;
    cursor.setTime(next.getTime());
  }

  return total;
}

type WorkedSegment = { inAt: Date; outAt: Date };
type TimelineWindow = { startMinutes: number; endMinutes: number };

function getWorkedSegments(logs: ParsedAttendanceLog[]) {
  const segments: WorkedSegment[] = [];

  for (let index = 0; index + 1 < logs.length; index += 2) {
    const inAt = logs[index]?.loggedAt;
    const outAt = logs[index + 1]?.loggedAt;

    if (!inAt || !outAt || outAt <= inAt) {
      continue;
    }

    segments.push({ inAt, outAt });
  }

  return segments;
}

function getNightMinutesFromSegments(segments: WorkedSegment[]) {
  return segments.reduce(
    (total, segment) => total + getNightMinutes(segment.inAt, segment.outAt),
    0
  );
}

function getSegmentDurationMinutes(segment: WorkedSegment | null | undefined) {
  if (!segment || segment.outAt <= segment.inAt) return 0;

  return Math.max(
    0,
    Math.round((segment.outAt.getTime() - segment.inAt.getTime()) / 60_000)
  );
}

function mapAttendanceMinutesToDate(attendanceDate: string, minutes: number) {
  const mapped = new Date(`${attendanceDate}T00:00:00`);
  mapped.setMinutes(minutes, 0, 0);
  return mapped;
}

function mapTimeValueToAttendanceMinutes(args: {
  timeValue: string | null | undefined;
  shift: ShiftWindow;
  scheduledInMinutes: number;
}) {
  const baseMinutes = parseTimeToMinutes(args.timeValue ?? null);
  if (baseMinutes == null) return null;

  return isOvernightShiftWindow(args.shift) && baseMinutes < args.scheduledInMinutes
    ? baseMinutes + 1440
    : baseMinutes;
}

function mergeTimelineWindows(windows: TimelineWindow[]) {
  if (windows.length === 0) return [];

  const orderedWindows = [...windows].sort(
    (left, right) => left.startMinutes - right.startMinutes
  );
  const mergedWindows: TimelineWindow[] = [orderedWindows[0]];

  for (const window of orderedWindows.slice(1)) {
    const currentWindow = mergedWindows[mergedWindows.length - 1];
    if (window.startMinutes <= currentWindow.endMinutes) {
      currentWindow.endMinutes = Math.max(currentWindow.endMinutes, window.endMinutes);
      continue;
    }

    mergedWindows.push({ ...window });
  }

  return mergedWindows;
}

function buildPayableTimelineWindows(args: {
  shift: ShiftWindow;
  scheduledInMinutes: number;
  scheduledEndMinutes: number;
}) {
  const excludedBreakWindows = mergeTimelineWindows(
    (args.shift.regularBreakWindows ?? []).flatMap((breakWindow) => {
      if (breakWindow.deductMinutes <= 0) return [];

      const breakStartMinutes = mapTimeValueToAttendanceMinutes({
        timeValue: breakWindow.fromTime,
        shift: args.shift,
        scheduledInMinutes: args.scheduledInMinutes,
      });
      const breakEndBaseMinutes = mapTimeValueToAttendanceMinutes({
        timeValue: breakWindow.toTime,
        shift: args.shift,
        scheduledInMinutes: args.scheduledInMinutes,
      });

      if (breakStartMinutes == null || breakEndBaseMinutes == null) {
        return [];
      }

      const breakEndMinutes =
        breakEndBaseMinutes <= breakStartMinutes
          ? breakEndBaseMinutes + 1440
          : breakEndBaseMinutes;
      const excludedEndMinutes = Math.min(
        breakStartMinutes + breakWindow.deductMinutes,
        breakEndMinutes
      );
      const startMinutes = Math.max(args.scheduledInMinutes, breakStartMinutes);
      const endMinutes = Math.min(args.scheduledEndMinutes, excludedEndMinutes);

      if (endMinutes <= startMinutes) {
        return [];
      }

      return [
        {
          startMinutes,
          endMinutes,
        } satisfies TimelineWindow,
      ];
    })
  );

  if (excludedBreakWindows.length === 0) {
    return null;
  }

  const payableWindows: TimelineWindow[] = [];
  let cursor = args.scheduledInMinutes;

  for (const breakWindow of excludedBreakWindows) {
    if (breakWindow.startMinutes > cursor) {
      payableWindows.push({
        startMinutes: cursor,
        endMinutes: breakWindow.startMinutes,
      });
    }

    cursor = Math.max(cursor, breakWindow.endMinutes);
  }

  if (cursor < args.scheduledEndMinutes) {
    payableWindows.push({
      startMinutes: cursor,
      endMinutes: args.scheduledEndMinutes,
    });
  }

  return payableWindows;
}

function intersectWorkedSegmentsWithTimelineWindows(args: {
  attendanceDate: string;
  shift: ShiftWindow;
  segments: WorkedSegment[];
  timelineWindows: TimelineWindow[];
}) {
  return args.segments.flatMap((segment) => {
    const inMinutes = mapLoggedAtToAttendanceMinutes({
      loggedAt: segment.inAt,
      attendanceDate: args.attendanceDate,
      shift: args.shift,
    });
    const outMinutes = mapLoggedAtToAttendanceMinutes({
      loggedAt: segment.outAt,
      attendanceDate: args.attendanceDate,
      shift: args.shift,
    });

    return args.timelineWindows.flatMap((window) => {
      const clippedInMinutes = Math.max(inMinutes, window.startMinutes);
      const clippedOutMinutes = Math.min(outMinutes, window.endMinutes);

      if (clippedOutMinutes <= clippedInMinutes) {
        return [];
      }

      return [
        {
          inAt: mapAttendanceMinutesToDate(args.attendanceDate, clippedInMinutes),
          outAt: mapAttendanceMinutesToDate(args.attendanceDate, clippedOutMinutes),
        } satisfies WorkedSegment,
      ];
    });
  });
}

function getRemainingPayableMinutesAfterOut(args: {
  actualOutMinutes: number;
  scheduledEndMinutes: number;
  breakMinutes: number;
  payableTimelineWindows: TimelineWindow[] | null;
}) {
  if (args.payableTimelineWindows) {
    return args.payableTimelineWindows.reduce((total, window) => {
      const remainingStartMinutes = Math.max(args.actualOutMinutes, window.startMinutes);
      const remainingEndMinutes = Math.min(args.scheduledEndMinutes, window.endMinutes);

      return total + Math.max(0, remainingEndMinutes - remainingStartMinutes);
    }, 0);
  }

  return Math.max(
    0,
    args.scheduledEndMinutes - args.actualOutMinutes - args.breakMinutes
  );
}

export function summarizeEmployeeDay(
  attendanceDate: string,
  logs: ParsedAttendanceLog[],
  shift: ShiftWindow,
  paidLeaveMinutes = 0,
  unpaidLeaveMinutes = 0
): DailyAttendanceSummarySeed {
  const orderedLogs = [...logs].sort(
    (left, right) => left.loggedAt.getTime() - right.loggedAt.getTime()
  );

  const firstInAt = orderedLogs[0]?.loggedAt ?? null;
  const workedSegments = getWorkedSegments(orderedLogs);
  const lastCompletedOutAt =
    workedSegments.length > 0
      ? workedSegments[workedSegments.length - 1]?.outAt ?? null
      : null;
  const lastOutAt = lastCompletedOutAt;

  const scheduledInMinutes = parseTimeToMinutes(shift.checkInTime);
  const scheduledDurationMinutes = getShiftDurationMinutes(
    shift.checkInTime,
    shift.checkOutTime
  );
  const breakMinutes = shift.breakMinutes ?? 0;
  const graceMinutes = shift.graceMinutes ?? 0;
  const scheduledEndMinutes =
    scheduledInMinutes != null && scheduledDurationMinutes != null
      ? scheduledInMinutes + scheduledDurationMinutes
      : null;
  const dayName = format(new Date(`${attendanceDate}T00:00:00`), "EEEE");
  const isRestDay = shift.restDay != null && shift.restDay === dayName;
  const payableTimelineWindows =
    !isRestDay &&
    scheduledInMinutes != null &&
    scheduledEndMinutes != null
      ? buildPayableTimelineWindows({
          shift,
          scheduledInMinutes,
          scheduledEndMinutes,
        })
      : null;
  const payableSegments =
    !isRestDay &&
    scheduledInMinutes != null &&
    scheduledEndMinutes != null
      ? intersectWorkedSegmentsWithTimelineWindows({
          attendanceDate,
          shift,
          segments: workedSegments,
          timelineWindows:
            payableTimelineWindows ?? [
              {
                startMinutes: scheduledInMinutes,
                endMinutes: scheduledEndMinutes,
              },
            ],
        })
      : workedSegments;
  const usesExplicitPayableWindows = payableTimelineWindows != null;

  let workedMinutes = 0;
  if (workedSegments.length === 1 && orderedLogs.length === 2) {
    const payableMinutes = payableSegments.reduce(
      (total, segment) => total + getSegmentDurationMinutes(segment),
      0
    );
    workedMinutes = Math.max(
      0,
      payableMinutes - (usesExplicitPayableWindows ? 0 : breakMinutes)
    );
  } else if (payableSegments.length > 0) {
    workedMinutes = payableSegments.reduce(
      (total, segment) => total + getSegmentDurationMinutes(segment),
      0
    );
  }

  let scheduledMinutes = 0;
  if (scheduledDurationMinutes != null) {
    scheduledMinutes = Math.max(0, scheduledDurationMinutes - breakMinutes);
  } else if (shift.hoursPerDay != null) {
    scheduledMinutes = Math.round(shift.hoursPerDay * 60);
  }
  const anomalyFlags: string[] = [];

  if (
    !firstInAt &&
    !isRestDay &&
    paidLeaveMinutes === 0 &&
    unpaidLeaveMinutes === 0 &&
    scheduledMinutes > 0
  ) {
    anomalyFlags.push("NO_LOGS");
  }

  if (orderedLogs.length % 2 !== 0) {
    anomalyFlags.push("ODD_PUNCH_COUNT");
    anomalyFlags.push("MISSING_OUT");
  }

  const actualInMinutes =
    firstInAt != null
      ? mapLoggedAtToAttendanceMinutes({
          loggedAt: firstInAt,
          attendanceDate,
          shift,
        })
      : null;
  const actualOutMinutes =
    lastOutAt != null
      ? mapLoggedAtToAttendanceMinutes({
          loggedAt: lastOutAt,
          attendanceDate,
          shift,
        })
      : null;

  const rawLateMinutes =
    !isRestDay &&
    actualInMinutes != null &&
    scheduledInMinutes != null &&
    actualInMinutes > scheduledInMinutes + graceMinutes
      ? actualInMinutes - scheduledInMinutes - graceMinutes
      : 0;

  const rawUndertimeMinutes =
    !isRestDay &&
    actualOutMinutes != null &&
    scheduledEndMinutes != null &&
    actualOutMinutes < scheduledEndMinutes
      ? getRemainingPayableMinutesAfterOut({
          actualOutMinutes,
          scheduledEndMinutes,
          breakMinutes,
          payableTimelineWindows,
        })
      : 0;

  const rawOvertimeMinutes =
    actualOutMinutes != null &&
    scheduledEndMinutes != null &&
    actualOutMinutes > scheduledEndMinutes
      ? actualOutMinutes - scheduledEndMinutes
      : 0;
  const lateArrival = splitDtrLateArrivalMinutes(rawLateMinutes);
  const lateMinutes = lateArrival.lateMinutes;
  const undertimeMinutes = Math.min(
    roundDtrUndertimeMinutes(rawUndertimeMinutes) +
      lateArrival.undertimeMinutes,
    scheduledMinutes
  );
  const overtimeMinutes = roundDtrOvertimeMinutes(rawOvertimeMinutes);

  const regularMinutes = isRestDay
    ? 0
    : Math.max(0, Math.min(workedMinutes, scheduledMinutes));

  const absentMinutes =
    !isRestDay && !firstInAt && scheduledMinutes > 0
      ? Math.max(0, scheduledMinutes - paidLeaveMinutes - unpaidLeaveMinutes)
      : 0;

  return {
    attendanceDate,
    firstInAt,
    lastOutAt,
    scheduledInTime: shift.checkInTime,
    scheduledOutTime: shift.checkOutTime,
    scheduledMinutes,
    workedMinutes,
    regularMinutes,
    lateMinutes,
    undertimeMinutes,
    overtimeMinutes,
    nightMinutes: getNightMinutesFromSegments(payableSegments),
    paidLeaveMinutes,
    unpaidLeaveMinutes,
    absentMinutes,
    isRestDay,
    anomalyFlags,
  };
}

export function groupLogsByEmployeeAndAttendanceDate(
  logs: ParsedAttendanceLog[],
  resolveShiftWindow?: (log: ParsedAttendanceLog, attendanceDate: string) => ShiftWindow | null
) {
  const grouped = new Map<string, ParsedAttendanceLog[]>();

  for (const log of logs) {
    let attendanceDate = log.logDate;

    if (resolveShiftWindow) {
      const previousDate = formatDateOnly(
        new Date(log.loggedAt.getTime() - 24 * 60 * 60 * 1000)
      );
      const previousShift = resolveShiftWindow(log, previousDate);
      const previousOutMinutes = parseTimeToMinutes(previousShift?.checkOutTime ?? null);
      const currentLogMinutes = log.loggedAt.getHours() * 60 + log.loggedAt.getMinutes();

      if (
        previousShift &&
        isOvernightShiftWindow(previousShift) &&
        previousOutMinutes != null &&
        currentLogMinutes <= previousOutMinutes
      ) {
        attendanceDate = previousDate;
      }
    }

    const identity = log.employeeId?.trim() || log.employeeNo;
    const key = `${identity}|${attendanceDate}`;
    const current = grouped.get(key) ?? [];
    current.push(log);
    grouped.set(key, current);
  }

  return grouped;
}

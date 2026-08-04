import { normalizeAttendanceEmployeeKey } from "./attendance";
import type { PayrollExceptionAccountType } from "./payrollExceptions";
import { DEFAULT_EMPLOYEE_TYPE } from "@/utils/employeeCode";

const PAYROLL_ACCOUNT_CODE_IMPORT_REQUIRED_HEADERS = [
  "Payroll Period",
  "Employee No",
  "Account Code",
] as const;
const PAYROLL_ACCOUNT_CODE_IMPORT_VALUE_HEADERS = [
  "Amount",
  "No. Of Hour(s)",
  "No. Of Minute(s)",
] as const;
export const PAYROLL_ACCOUNT_CODE_IMPORT_PREVIEW_LIMIT = 25;

export type PayrollAccountCodeImportParsedRow = {
  sourceLine: number;
  payrollPeriodCode: string;
  employeeNo: string;
  accountCode: string;
  amount: number | null;
  hours: number | null;
  minutes: number | null;
};

export type PayrollAccountCodeImportSkippedRow = {
  sourceLine: number;
  payrollPeriodCode?: string;
  employeeNo?: string;
  accountCode?: string;
  reason: string;
};

export type PayrollAccountCodeImportParseResult = {
  totalRows: number;
  rows: PayrollAccountCodeImportParsedRow[];
  skippedRows: PayrollAccountCodeImportSkippedRow[];
};

export type ResolvedPayrollAccountCodeImportRow =
  PayrollAccountCodeImportParsedRow & {
    employeeId: string;
    accountCodeId: number;
    accountType: PayrollExceptionAccountType | null;
    accountDescription: string | null;
    accountMonth13thPay: boolean;
    accountNonTaxable: boolean;
  };

export type CombinedPayrollAccountCodeImportRow = {
  sourceLine: number;
  employeeId: string;
  accountCodeId: number;
  accountCode: string;
  accountType: PayrollExceptionAccountType | null;
  accountDescription: string | null;
  accountMonth13thPay: boolean;
  accountNonTaxable: boolean;
  amount: number | null;
  quantityMinutes: number;
};

export type PayrollAccountCodeImportResult = {
  batchId: string | null;
  fileName: string;
  payrollPeriodId: string;
  payrollPeriodCode: string;
  totalRows: number;
  insertedRowCount: number;
  updatedRowCount: number;
  importedRowCount: number;
  skippedPeriodMismatchCount: number;
  skippedInvalidRowCount: number;
  skippedRows: PayrollAccountCodeImportSkippedRow[];
  affectedEmployeeCount: number;
  affectedEmployeeIds: string[];
  staleRunCount: number;
};

export type PayrollAccountCodeImportEmployeeLookupRow = {
  id: string;
  employeeNo: string;
  employeeType: string | null;
};

export function buildPayrollAccountCodeImportEmployeeLookup(
  employeeRows: PayrollAccountCodeImportEmployeeLookupRow[]
) {
  const employeeByNormalizedKey = new Map<
    string,
    PayrollAccountCodeImportEmployeeLookupRow
  >();
  const ambiguousEmployeeKeys = new Set<string>();

  for (const employee of employeeRows) {
    if (employee.employeeType !== DEFAULT_EMPLOYEE_TYPE) continue;

    const normalizedKey = normalizeAttendanceEmployeeKey(employee.employeeNo);
    if (!normalizedKey) continue;

    if (employeeByNormalizedKey.has(normalizedKey)) {
      employeeByNormalizedKey.delete(normalizedKey);
      ambiguousEmployeeKeys.add(normalizedKey);
      continue;
    }

    if (!ambiguousEmployeeKeys.has(normalizedKey)) {
      employeeByNormalizedKey.set(normalizedKey, employee);
    }
  }

  return { employeeByNormalizedKey, ambiguousEmployeeKeys };
}

function stripLeadingBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function roundMoney(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function decodeUtf16Be(buffer: Buffer) {
  const swapped = Buffer.alloc(buffer.length);

  for (let index = 0; index < buffer.length; index += 2) {
    swapped[index] = buffer[index + 1] ?? 0;
    swapped[index + 1] = buffer[index] ?? 0;
  }

  return swapped.toString("utf16le");
}

export function decodePayrollAccountCodeImportText(contentBase64: string) {
  const buffer = Buffer.from(contentBase64, "base64");

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return stripLeadingBom(buffer.subarray(2).toString("utf16le"));
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return stripLeadingBom(decodeUtf16Be(buffer.subarray(2)));
  }

  const sampleLength = Math.min(buffer.length - (buffer.length % 2), 128);
  if (sampleLength >= 4) {
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
    if (oddNullBytes >= minimumNullBytes && oddNullBytes > evenNullBytes * 2) {
      return stripLeadingBom(buffer.toString("utf16le"));
    }
    if (evenNullBytes >= minimumNullBytes && evenNullBytes > oddNullBytes * 2) {
      return stripLeadingBom(decodeUtf16Be(buffer));
    }
  }

  return stripLeadingBom(buffer.toString("utf8"));
}

function normalizeImportHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitPayrollAccountCodeImportLine(line: string) {
  return line.split("\t").map((cell) => cell.trim());
}

function parseImportNumber(value: string | undefined) {
  const trimmed = value?.replace(/,/g, "").trim() ?? "";
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

export function appendPayrollAccountCodeImportDiagnostic(
  diagnostics: PayrollAccountCodeImportSkippedRow[],
  skippedRow: PayrollAccountCodeImportSkippedRow
) {
  diagnostics.push(skippedRow);
}

export function parsePayrollAccountCodeImportText(
  text: string
): PayrollAccountCodeImportParseResult {
  const lines = stripLeadingBom(text)
    .split(/\r?\n/)
    .map((line, index) => ({ sourceLine: index + 1, text: line }))
    .filter((line) => line.text.trim());
  const skippedRows: PayrollAccountCodeImportSkippedRow[] = [];

  if (lines.length === 0) {
    return {
      totalRows: 0,
      rows: [],
      skippedRows: [{ sourceLine: 1, reason: "The import file is empty." }],
    };
  }

  const headerCells = splitPayrollAccountCodeImportLine(lines[0].text);
  const headerIndexes = new Map(
    headerCells.map((header, index) => [normalizeImportHeader(header), index])
  );
  const getHeaderIndex = (header: string) =>
    headerIndexes.get(normalizeImportHeader(header)) ?? -1;
  const missingHeaders = PAYROLL_ACCOUNT_CODE_IMPORT_REQUIRED_HEADERS.filter(
    (header) => getHeaderIndex(header) === -1
  );

  if (missingHeaders.length > 0) {
    return {
      totalRows: Math.max(0, lines.length - 1),
      rows: [],
      skippedRows: [
        {
          sourceLine: lines[0].sourceLine,
          reason: `Missing required column(s): ${missingHeaders.join(", ")}.`,
        },
      ],
    };
  }

  const payrollPeriodIndex = getHeaderIndex("Payroll Period");
  const employeeNoIndex = getHeaderIndex("Employee No");
  const accountCodeIndex = getHeaderIndex("Account Code");
  const amountIndex = getHeaderIndex("Amount");
  const hoursIndex = getHeaderIndex("No. Of Hour(s)");
  const minutesIndex = getHeaderIndex("No. Of Minute(s)");
  const rows: PayrollAccountCodeImportParsedRow[] = [];

  for (const line of lines.slice(1)) {
    const cells = splitPayrollAccountCodeImportLine(line.text);
    const payrollPeriodCode = cells[payrollPeriodIndex]?.trim() ?? "";
    const employeeNo = cells[employeeNoIndex]?.trim() ?? "";
    const accountCode = cells[accountCodeIndex]?.trim() ?? "";
    const amount = parseImportNumber(amountIndex >= 0 ? cells[amountIndex] : "");
    const hours = parseImportNumber(hoursIndex >= 0 ? cells[hoursIndex] : "");
    const minutes = parseImportNumber(minutesIndex >= 0 ? cells[minutesIndex] : "");

    const baseSkippedRow = {
      sourceLine: line.sourceLine,
      payrollPeriodCode,
      employeeNo,
      accountCode,
    };

    if (!payrollPeriodCode || !employeeNo || !accountCode) {
      appendPayrollAccountCodeImportDiagnostic(skippedRows, {
        ...baseSkippedRow,
        reason: "Payroll Period, Employee No, and Account Code are required.",
      });
      continue;
    }

    if (
      Number.isNaN(amount) ||
      Number.isNaN(hours) ||
      Number.isNaN(minutes)
    ) {
      appendPayrollAccountCodeImportDiagnostic(skippedRows, {
        ...baseSkippedRow,
        reason: "Amount, hours, and minutes must be non-negative numbers.",
      });
      continue;
    }

    const hasAmount = amount != null;
    const hasHours = hours != null;
    const hasMinutes = minutes != null;
    if (!hasAmount && !hasHours && !hasMinutes) {
      appendPayrollAccountCodeImportDiagnostic(skippedRows, {
        ...baseSkippedRow,
        reason: `At least one value column is required: ${PAYROLL_ACCOUNT_CODE_IMPORT_VALUE_HEADERS.join(", ")}.`,
      });
      continue;
    }

    rows.push({
      sourceLine: line.sourceLine,
      payrollPeriodCode,
      employeeNo,
      accountCode,
      amount,
      hours,
      minutes,
    });
  }

  return {
    totalRows: Math.max(0, lines.length - 1),
    rows,
    skippedRows,
  };
}

export function getPayrollAccountCodeImportDuplicateKey(args: {
  employeeId: string;
  accountCodeId: number;
  accountType: PayrollExceptionAccountType | null;
}) {
  return [
    args.employeeId,
    args.accountCodeId,
    args.accountType === "Overtime" ? "REGULAR_DAY" : "__none__",
  ].join(":");
}

export function combinePayrollAccountCodeImportRows(
  rows: ResolvedPayrollAccountCodeImportRow[]
): CombinedPayrollAccountCodeImportRow[] {
  const combinedRows = new Map<string, CombinedPayrollAccountCodeImportRow>();

  for (const row of rows) {
    const key = getPayrollAccountCodeImportDuplicateKey(row);
    const existing = combinedRows.get(key);
    const rowAmount = row.amount ?? 0;
    const rowQuantityMinutes =
      Math.floor(row.hours ?? 0) * 60 + Math.floor(row.minutes ?? 0);

    if (existing) {
      combinedRows.set(key, {
        ...existing,
        amount:
          existing.amount == null && row.amount == null
            ? null
            : roundMoney((existing.amount ?? 0) + rowAmount),
        quantityMinutes: existing.quantityMinutes + rowQuantityMinutes,
      });
      continue;
    }

    combinedRows.set(key, {
      sourceLine: row.sourceLine,
      employeeId: row.employeeId,
      accountCodeId: row.accountCodeId,
      accountCode: row.accountCode,
      accountType: row.accountType,
      accountDescription: row.accountDescription,
      accountMonth13thPay: row.accountMonth13thPay,
      accountNonTaxable: row.accountNonTaxable,
      amount: row.amount == null ? null : roundMoney(row.amount),
      quantityMinutes: rowQuantityMinutes,
    });
  }

  return [...combinedRows.values()];
}

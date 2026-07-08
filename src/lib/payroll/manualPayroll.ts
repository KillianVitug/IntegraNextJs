import { db } from "@/db";
import {
  accountCode,
  department,
  employeeShiftAssignments,
  employeeWeeklyShiftPatterns,
  employees,
  employeesGeneralInfo,
  employeesLoans,
  employeesSalary,
  employeesTimekeeping,
  loanInstallments,
  manualPayrollEntries,
  manualPayrollEntryLines,
  payrollPeriods,
  payrollRunEmployees,
  payrollRunLines,
  payrollRuns,
} from "@/db/schema";
import type {
  ManualPayrollAccountCodeOptionView,
  ManualPayrollEntryFieldsView,
  ManualPayrollEntryLineView,
  ManualPayrollEntryWorkspaceView,
  ManualPayrollLineSummaryBucket,
  ManualPayrollRateContextView,
  PayrollAccountCodeEmployeeView,
  PayrollComputationModeView,
  PayrollRunPeriodView,
} from "@/app/(ntg)/payroll/types";
import { recordAdminAuditEvent, recordPayrollRunEvent } from "@/lib/admin";
import type { SaveManualPayrollEntrySchemaType } from "@/zod-schemas/manualPayroll";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { formatEmployeeCode } from "@/utils/employeeCode";
import { resolveEmployeeSalaryForPeriod } from "./salaryResolver";
import { getPrimaryResolvedScheduleForPeriod } from "./scheduleResolver";
import { computeManualPayrollLineAmount } from "./manualPayrollRate";
import { getManualPayrollBucketFromAccountCodeOrType } from "./manualPayrollBuckets";

export const MANUAL_PAYROLL_SOURCE_TABLE = "manual_payroll_entry_lines";
const MANUAL_PAYROLL_ENTRY_SOURCE_TABLE = "manual_payroll_entries";

const EDITABLE_RUN_STATUSES = new Set(["Draft", "Stale"]);
const STATUTORY_CODES = new Set([
  "SSS",
  "SSS-ER",
  "SSS-EC",
  "PHILHEALTH",
  "PHILHEALTH-ER",
  "PAGIBIG",
  "PAGIBIG-ER",
  "TAX",
  "PERAA",
  "PERAA-ER",
]);

type DbLike = Pick<typeof db, "delete" | "insert" | "query" | "select" | "update">;
type ManualLineInput = SaveManualPayrollEntrySchemaType["lines"][number];
type ManualPayrollEntryWithLines = typeof manualPayrollEntries.$inferSelect & {
  lines: Array<typeof manualPayrollEntryLines.$inferSelect>;
};
type NormalizedManualLine = NonNullable<ReturnType<typeof normalizeManualLines>[number]>;
type ManualPayrollAccountCodeLookup = {
  byId: Map<number, ManualPayrollAccountCodeOptionView>;
  byCode: Map<string, ManualPayrollAccountCodeOptionView>;
};

export type ManualPayrollBaselineSnapshot = {
  version: 1;
  payComputationMode: PayrollComputationModeView | null;
  fields: ManualPayrollEntryFieldsView;
  lines: ManualPayrollEntryLineView[];
};

type ComputedPayrollLineLike = {
  accountCodeId?: number | null;
  accountType?: string | null;
  lineType: string;
  code: string;
  description: string;
  amount: string | number;
  quantity?: string | number | null;
  rate?: string | number | null;
  taxable?: boolean | null;
  month13thEligible?: boolean | null;
  loanRefNo?: string | null;
  sourceTable?: string | null;
  sourceId?: string | null;
};

type ContributionBasisSnapshot = Partial<
  Record<"SSS" | "PHILHEALTH" | "PAGIBIG" | "PERAA" | "TAX", string | number>
>;

type ComputedPayrollEntryLike = {
  taxablePay: string | number;
  breakdownNotes?: string | null;
  payComputationMode?: PayrollComputationModeView | null;
  contributionBasis?: ContributionBasisSnapshot;
  lines: ComputedPayrollLineLike[];
};

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function money(value: string | number | null | undefined) {
  return toAmount(value).toFixed(2);
}

function roundMoney(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function normalizeManualCodeKey(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

function compareManualPayrollLineCode(
  left: { code: string; sortOrder?: number | null },
  right: { code: string; sortOrder?: number | null }
) {
  return (
    left.code.localeCompare(right.code, undefined, {
      numeric: true,
      sensitivity: "base",
    }) ||
    (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
  );
}

function sortManualPayrollLinesByCode<T extends { code: string; sortOrder?: number | null }>(
  lines: T[]
) {
  return [...lines].sort(compareManualPayrollLineCode);
}

function buildAccountCodeLookup(
  accountCodeOptions: ManualPayrollAccountCodeOptionView[] = []
): ManualPayrollAccountCodeLookup {
  return {
    byId: new Map(accountCodeOptions.map((option) => [option.id, option])),
    byCode: new Map(
      accountCodeOptions.map((option) => [normalizeManualCodeKey(option.code), option])
    ),
  };
}

function getManualLineAccountCode(
  line: {
    accountCodeId?: number | null;
    code: string;
  },
  lookup?: ManualPayrollAccountCodeLookup
) {
  if (!lookup) return null;

  return (
    (line.accountCodeId != null ? lookup.byId.get(line.accountCodeId) : null) ??
    lookup.byCode.get(normalizeManualCodeKey(line.code)) ??
    null
  );
}

function getManualLineAccountTypeForBucket(
  line: {
    accountCodeId?: number | null;
    accountType?: string | null;
  },
  lookup?: ManualPayrollAccountCodeLookup
) {
  if (line.accountType?.trim()) return line.accountType;
  if (line.accountCodeId == null || !lookup) return null;
  return lookup.byId.get(line.accountCodeId)?.accountType ?? null;
}

function buildFullName(employee: {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}) {
  return [employee.lastName, [employee.firstName, employee.middleName].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ")
    .trim();
}

function serializePeriod(
  period: typeof payrollPeriods.$inferSelect
): PayrollRunPeriodView {
  return {
    id: period.id,
    code: period.code,
    startDate: period.startDate,
    endDate: period.endDate,
    adjustedPayDate: period.adjustedPayDate,
    nominalPayDate: period.nominalPayDate,
    cycle: period.cycle,
    status: period.status,
  };
}

function serializeEmployee(row: {
  employeeId: string;
  employeeNo: string;
  employeeType: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  employeeName: string;
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
}): PayrollAccountCodeEmployeeView {
  return {
    employeeId: row.employeeId,
    employeeNo: row.employeeNo,
    employeeType: row.employeeType,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    employeeName: row.employeeName,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    departmentCode: row.departmentCode,
  };
}

async function getEmployeeForManualPayroll(employeeId: string) {
  const [employee] = await db
    .select({
      employeeId: employees.id,
      employeeNo: employees.employeeNo,
      employeeType: employees.employeeType,
      firstName: employees.firstName,
      middleName: employees.middleName,
      lastName: employees.lastName,
      employeeName: employees.lastName,
      departmentId: employeesGeneralInfo.departmentId,
      departmentName: department.name,
      departmentCode: department.code,
    })
    .from(employees)
    .leftJoin(
      employeesGeneralInfo,
      eq(employeesGeneralInfo.employeeId, employees.id)
    )
    .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
    .limit(1);

  if (!employee) return null;

  return serializeEmployee({
    ...employee,
    employeeName: buildFullName(employee),
  });
}

function getManualPayrollRateDivisor(
  salary: Partial<typeof employeesSalary.$inferSelect> | null | undefined
) {
  const divisor = toAmount(salary?.rateDivisor);
  return divisor > 0 ? divisor : 26;
}

function getManualPayrollDailyRate(
  salary: Partial<typeof employeesSalary.$inferSelect> | null | undefined
) {
  const dailyRate = toAmount(salary?.dailyRate);
  if (dailyRate > 0) return dailyRate;

  const monthlyRate = toAmount(salary?.monthlyRate);
  const divisor = getManualPayrollRateDivisor(salary);
  return divisor > 0 ? roundMoney(monthlyRate / divisor) : 0;
}

async function getManualPayrollRateContext(
  payrollPeriodId: string,
  employeeId: string
): Promise<ManualPayrollRateContextView> {
  const [period, resolvedSalary, timekeeping, shiftAssignments, weeklyPatterns] =
    await Promise.all([
      db.query.payrollPeriods.findFirst({
        where: eq(payrollPeriods.id, payrollPeriodId),
      }),
      resolveEmployeeSalaryForPeriod(employeeId, payrollPeriodId),
      db.query.employeesTimekeeping.findFirst({
        where: eq(employeesTimekeeping.employeeId, employeeId),
      }),
      db
        .select()
        .from(employeeShiftAssignments)
        .where(eq(employeeShiftAssignments.employeeId, employeeId)),
      db.query.employeeWeeklyShiftPatterns.findMany({
        where: eq(employeeWeeklyShiftPatterns.employeeId, employeeId),
        with: {
          days: true,
        },
      }),
    ]);

  if (!period) {
    throw new Error("Payroll period not found.");
  }

  const periodShiftAssignments = shiftAssignments.filter(
    (assignment) =>
      assignment.effectiveFrom <= period.endDate &&
      (!assignment.effectiveTo || assignment.effectiveTo >= period.startDate)
  );
  const periodWeeklyPatterns = weeklyPatterns.filter(
    (pattern) =>
      pattern.effectiveFrom <= period.endDate &&
      (!pattern.effectiveTo || pattern.effectiveTo >= period.startDate)
  );
  const primarySchedule = getPrimaryResolvedScheduleForPeriod({
    assignments: periodShiftAssignments,
    weeklyPatterns: periodWeeklyPatterns,
    legacyTimekeeping: timekeeping ?? null,
    startDate: period.startDate,
    endDate: period.endDate,
  });
  const hoursPerDay = toAmount(primarySchedule.hoursPerDay) || 8;
  const salary = resolvedSalary.salary;
  const dailyRate = getManualPayrollDailyRate(salary);
  const monthlyRate = toAmount(salary?.monthlyRate);
  const hourlyRate = hoursPerDay > 0 ? roundMoney(dailyRate / hoursPerDay) : 0;

  return {
    payComputationMode: monthlyRate > 0 ? "Monthly Rate" : "Daily Rate",
    dailyRate: money(dailyRate),
    monthlyRate: money(monthlyRate),
    hoursPerDay: money(hoursPerDay),
    hourlyRate: money(hourlyRate),
  };
}

async function getLatestRun(payrollPeriodId: string) {
  const [latestRun] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.payrollPeriodId, payrollPeriodId))
    .orderBy(desc(payrollRuns.createdAt))
    .limit(1);

  return latestRun ?? null;
}

function getEditBlockReason(status: string | null) {
  if (!status || EDITABLE_RUN_STATUSES.has(status)) return null;
  return `Manual Payroll can only edit Draft or Stale runs. The latest run is ${status}.`;
}

export async function getManualAccountCodeOptions(): Promise<
  ManualPayrollAccountCodeOptionView[]
> {
  const rows = await db
    .select({
      id: accountCode.id,
      code: accountCode.accountCode,
      accountType: accountCode.accountType,
      description: accountCode.description,
      month13thPay: accountCode.month13thPay,
      nonTaxable: accountCode.nonTaxable,
      deminimis: accountCode.deminimis,
      dailyRate: accountCode.dailyRate,
      monthlyRate: accountCode.monthlyRate,
    })
    .from(accountCode)
    .orderBy(asc(accountCode.accountCode), asc(accountCode.accountType));

  return rows;
}

function parseStatutoryBase(notes: string | null | undefined) {
  const match = /Statutory Monthly Base:\s*([0-9,]+(?:\.[0-9]+)?)/i.exec(
    notes ?? ""
  );
  return match ? money(match[1].replaceAll(",", "")) : "0.00";
}

function parsePayComputationMode(
  notes: string | null | undefined
): PayrollComputationModeView | null {
  if (/(^|\|)\s*Payroll Basis:\s*Daily Rate\s*(\||$)/i.test(notes ?? "")) {
    return "Daily Rate";
  }

  if (/(^|\|)\s*Payroll Basis:\s*Monthly Rate\s*(\||$)/i.test(notes ?? "")) {
    return "Monthly Rate";
  }

  return null;
}

function splitDecimalHoursToHoursMinutes(value: string | number | null | undefined) {
  const quantity = Math.max(0, toAmount(value));
  const hours = Math.floor(quantity);
  const minutes = Math.round((quantity - hours) * 60);

  if (minutes >= 60) {
    return {
      hours: hours + 1,
      minutes: 0,
    };
  }

  return { hours, minutes };
}

function splitMinutesToHoursMinutes(value: string | number | null | undefined) {
  const totalMinutes = Math.max(0, Math.round(toAmount(value)));

  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}

function splitDaysToHoursMinutes(
  value: string | number | null | undefined,
  hoursPerDay = 8
) {
  return splitMinutesToHoursMinutes(toAmount(value) * hoursPerDay * 60);
}

function splitComputedLineQuantityToHoursMinutes(line: ComputedPayrollLineLike) {
  const code = line.code.toUpperCase();

  if (line.sourceTable === "attendance_daily_summaries" && code === "LATE-UT") {
    return splitMinutesToHoursMinutes(line.quantity ?? 0);
  }

  if (line.sourceTable === "employees_leave_records") {
    return splitDaysToHoursMinutes(line.quantity ?? 0);
  }

  return splitDecimalHoursToHoursMinutes(line.quantity ?? 0);
}

function getManualSummaryBucket(
  line: {
    accountCodeId?: number | null;
    accountType?: string | null;
    lineType: string;
    code: string;
    taxable?: boolean | null;
    sourceTable?: string | null;
  },
  lookup?: ManualPayrollAccountCodeLookup
): ManualPayrollLineSummaryBucket {
  const accountBucket = getManualPayrollBucketFromAccountCodeOrType({
    code: line.code,
    accountType: getManualLineAccountTypeForBucket(line, lookup),
  });
  if (accountBucket) return accountBucket;

  const code = normalizeManualCodeKey(line.code);

  if (line.lineType === "Deduction") return "otherDeductions";
  if (code === "REG") return "basicPay";
  if (code.includes("LEAVE") || code.includes("OT")) return "otPaidLeaves";
  if (code.includes("13")) return "month13th";
  if (code.includes("DEMINIMIS") || code === "DM") return "deminimis";
  if (line.taxable === false) return "nonTaxable";
  return "otherIncome";
}

function serializeManualLine(
  line: typeof manualPayrollEntryLines.$inferSelect,
  lookup?: ManualPayrollAccountCodeLookup
): ManualPayrollEntryLineView {
  return {
    id: line.id,
    accountCodeId: line.accountCodeId,
    lineType: line.lineType,
    summaryBucket: getManualSummaryBucket(line, lookup),
    code: line.code,
    description: line.description,
    loanRefNo: line.loanRefNo,
    hours: line.hours,
    minutes: line.minutes,
    amount: line.amount,
    taxable: line.taxable,
    month13thEligible: line.month13thEligible,
    nonTaxable: line.nonTaxable,
    deminimis: line.deminimis,
    sourceTable: line.sourceTable,
    sourceId: line.sourceId,
    sortOrder: line.sortOrder,
  };
}

function serializeComputedLine(
  line: ComputedPayrollLineLike,
  sortOrder: number,
  lookup?: ManualPayrollAccountCodeLookup
): ManualPayrollEntryLineView | null {
  if (STATUTORY_CODES.has(line.code.toUpperCase())) return null;
  if (line.lineType === "Employer Contribution") return null;
  const isLeaveInformationLine =
    line.lineType === "Information" &&
    line.sourceTable === "employees_leave_records";
  if (
    line.lineType === "Information" &&
    toAmount(line.amount) <= 0 &&
    !isLeaveInformationLine
  ) {
    return null;
  }
  const quantity = splitComputedLineQuantityToHoursMinutes(line);
  const account = getManualLineAccountCode(line, lookup);
  const accountType = line.accountType ?? account?.accountType ?? null;

  return {
    id: null,
    accountCodeId: line.accountCodeId ?? account?.id ?? null,
    lineType: line.lineType as ManualPayrollEntryLineView["lineType"],
    summaryBucket: getManualSummaryBucket(line, lookup),
    code: line.code,
    description: line.description,
    loanRefNo: accountType === "Loan" ? line.loanRefNo?.trim() || null : null,
    hours: quantity.hours,
    minutes: quantity.minutes,
    amount: money(line.amount),
    taxable: line.taxable ?? false,
    month13thEligible: line.month13thEligible ?? false,
    nonTaxable: line.lineType === "Earning" && !line.taxable,
    deminimis: false,
    sourceTable: line.sourceTable ?? null,
    sourceId: line.sourceId ?? null,
    sortOrder,
  };
}

function emptyFields() {
  return {
    sssEmployee: "0.00",
    sssEmployer: "0.00",
    sssEc: "0.00",
    sssBasis: "0.00",
    philhealthEmployee: "0.00",
    philhealthEmployer: "0.00",
    philhealthBasis: "0.00",
    pagibigEmployee: "0.00",
    pagibigEmployer: "0.00",
    pagibigBasis: "0.00",
    withholdingTax: "0.00",
    withholdingTaxBasis: "0.00",
    peraaEmployee: "0.00",
    peraaEmployer: "0.00",
    peraaBasis: "0.00",
    remarks: null,
  };
}

function lineAmount(
  lines: Array<{ code: string; amount: string | number }>,
  code: string
) {
  return money(
    lines
      .filter((line) => line.code.toUpperCase() === code)
      .reduce((total, line) => total + toAmount(line.amount), 0)
  );
}

function contributionBasisAmount(
  employeeRun: ComputedPayrollEntryLike,
  type: keyof ContributionBasisSnapshot,
  fallback: string
) {
  const value = employeeRun.contributionBasis?.[type];
  return value == null ? fallback : money(value);
}

function contributionBasisValue(
  employeeRun: ComputedPayrollEntryLike,
  type: keyof ContributionBasisSnapshot,
  fallback: string | number
) {
  const value = employeeRun.contributionBasis?.[type];
  return value == null ? toAmount(fallback) : toAmount(value);
}

function semiMonthlyContributionBasisAmount(
  employeeRun: ComputedPayrollEntryLike,
  type: keyof ContributionBasisSnapshot,
  fallback: string | number
) {
  return money(roundMoney(contributionBasisValue(employeeRun, type, fallback) / 2));
}

function getComputedEntryFields(
  employeeRun: ComputedPayrollEntryLike
): ManualPayrollEntryFieldsView {
  const basis = parseStatutoryBase(employeeRun.breakdownNotes);

  return {
    sssEmployee: lineAmount(employeeRun.lines, "SSS"),
    sssEmployer: lineAmount(employeeRun.lines, "SSS-ER"),
    sssEc: lineAmount(employeeRun.lines, "SSS-EC"),
    sssBasis: contributionBasisAmount(employeeRun, "SSS", basis),
    philhealthEmployee: lineAmount(employeeRun.lines, "PHILHEALTH"),
    philhealthEmployer: lineAmount(employeeRun.lines, "PHILHEALTH-ER"),
    philhealthBasis: contributionBasisAmount(employeeRun, "PHILHEALTH", basis),
    pagibigEmployee: lineAmount(employeeRun.lines, "PAGIBIG"),
    pagibigEmployer: lineAmount(employeeRun.lines, "PAGIBIG-ER"),
    pagibigBasis: contributionBasisAmount(employeeRun, "PAGIBIG", basis),
    withholdingTax: lineAmount(employeeRun.lines, "TAX"),
    withholdingTaxBasis: semiMonthlyContributionBasisAmount(
      employeeRun,
      "TAX",
      employeeRun.taxablePay
    ),
    peraaEmployee: lineAmount(employeeRun.lines, "PERAA"),
    peraaEmployer: lineAmount(employeeRun.lines, "PERAA-ER"),
    peraaBasis: contributionBasisAmount(employeeRun, "PERAA", "0.00"),
    remarks: null,
  };
}

function getManualEntryFields(
  entry: Pick<
    typeof manualPayrollEntries.$inferSelect,
    | "sssEmployee"
    | "sssEmployer"
    | "sssEc"
    | "sssBasis"
    | "philhealthEmployee"
    | "philhealthEmployer"
    | "philhealthBasis"
    | "pagibigEmployee"
    | "pagibigEmployer"
    | "pagibigBasis"
    | "withholdingTax"
    | "withholdingTaxBasis"
    | "peraaEmployee"
    | "peraaEmployer"
    | "peraaBasis"
    | "remarks"
  >
): ManualPayrollEntryFieldsView {
  return {
    sssEmployee: entry.sssEmployee,
    sssEmployer: entry.sssEmployer,
    sssEc: entry.sssEc,
    sssBasis: entry.sssBasis,
    philhealthEmployee: entry.philhealthEmployee,
    philhealthEmployer: entry.philhealthEmployer,
    philhealthBasis: entry.philhealthBasis,
    pagibigEmployee: entry.pagibigEmployee,
    pagibigEmployer: entry.pagibigEmployer,
    pagibigBasis: entry.pagibigBasis,
    withholdingTax: entry.withholdingTax,
    withholdingTaxBasis: entry.withholdingTaxBasis,
    peraaEmployee: entry.peraaEmployee,
    peraaEmployer: entry.peraaEmployer,
    peraaBasis: entry.peraaBasis,
    remarks: entry.remarks,
  };
}

function normalizeFieldValue(value: string | number | null | undefined) {
  return money(value);
}

function normalizeManualLineForCompare(
  line: ManualPayrollEntryLineView
): Omit<ManualPayrollEntryLineView, "id" | "sortOrder"> {
  return {
    accountCodeId: line.accountCodeId ?? null,
    lineType: line.lineType,
    summaryBucket: line.summaryBucket,
    code: line.code.trim(),
    description: line.description.trim(),
    loanRefNo: line.loanRefNo?.trim() || null,
    hours: Math.max(0, Math.floor(line.hours ?? 0)),
    minutes: Math.max(0, Math.floor(line.minutes ?? 0)),
    amount: money(line.amount),
    taxable: !!line.taxable,
    month13thEligible: !!line.month13thEligible,
    nonTaxable: !!line.nonTaxable,
    deminimis: !!line.deminimis,
    sourceTable: line.sourceTable?.trim() || null,
    sourceId: line.sourceId?.trim() || null,
  };
}

function areManualLinesEquivalent(
  left: ManualPayrollEntryLineView,
  right: ManualPayrollEntryLineView
) {
  return (
    JSON.stringify(normalizeManualLineForCompare(left)) ===
    JSON.stringify(normalizeManualLineForCompare(right))
  );
}

const ATTENDANCE_REFRESHABLE_MANUAL_CODES = new Set([
  "REG",
  "LATE-UT",
  "ABS",
  "D-ALLOW",
  "COLA",
]);

function createAttendanceRefreshableManualLinePredicate(args?: {
  refreshableExceptionRowIds?: Iterable<string>;
}) {
  const refreshableExceptionRowIds = new Set(args?.refreshableExceptionRowIds ?? []);

  return (
    line: Pick<
      ManualPayrollEntryLineView,
      "accountCodeId" | "code" | "sourceTable" | "sourceId"
    >
  ) => {
    const code = normalizeManualCodeKey(line.code);
    const sourceTable = line.sourceTable?.trim() ?? "";

    if (sourceTable === "attendance_daily_summaries") return true;
    if (
      sourceTable === "employee_payroll_exception_rows" &&
      line.sourceId &&
      refreshableExceptionRowIds.has(line.sourceId)
    ) {
      return true;
    }
    if (line.accountCodeId == null && ATTENDANCE_REFRESHABLE_MANUAL_CODES.has(code)) {
      return true;
    }

    return false;
  };
}

function getLineBaseMergeKey(line: ManualPayrollEntryLineView) {
  return [
    line.sourceTable?.trim() || "",
    line.sourceId?.trim() || "",
    line.lineType,
    line.summaryBucket,
    line.code.trim().toUpperCase(),
    line.description.trim().toUpperCase(),
  ].join("|");
}

function attachLineMergeKeys(lines: ManualPayrollEntryLineView[]) {
  const counts = new Map<string, number>();

  return lines.map((line) => {
    const baseKey = getLineBaseMergeKey(line);
    const occurrence = counts.get(baseKey) ?? 0;
    counts.set(baseKey, occurrence + 1);
    return {
      key: `${baseKey}#${occurrence}`,
      line,
    };
  });
}

function mergeManualFields(args: {
  saved: ManualPayrollEntryFieldsView;
  oldBaseline: ManualPayrollEntryFieldsView | null;
  latestBaseline: ManualPayrollEntryFieldsView | null;
}) {
  if (!args.latestBaseline) return args.saved;

  const merged: ManualPayrollEntryFieldsView = {
    ...args.saved,
    remarks: args.saved.remarks,
  };
  const fields: Array<keyof Omit<ManualPayrollEntryFieldsView, "remarks">> = [
    "sssEmployee",
    "sssEmployer",
    "sssEc",
    "sssBasis",
    "philhealthEmployee",
    "philhealthEmployer",
    "philhealthBasis",
    "pagibigEmployee",
    "pagibigEmployer",
    "pagibigBasis",
    "withholdingTax",
    "withholdingTaxBasis",
    "peraaEmployee",
    "peraaEmployer",
    "peraaBasis",
  ];

  for (const field of fields) {
    if (!args.oldBaseline) continue;

    const savedValue = normalizeFieldValue(args.saved[field]);
    const oldValue = normalizeFieldValue(args.oldBaseline[field]);
    merged[field] =
      savedValue === oldValue ? normalizeFieldValue(args.latestBaseline[field]) : savedValue;
  }

  return merged;
}

function mergeManualLines(args: {
  saved: ManualPayrollEntryLineView[];
  oldBaseline: ManualPayrollEntryLineView[] | null;
  latestBaseline: ManualPayrollEntryLineView[] | null;
  forceRefreshAttendanceLines?: boolean;
  isAttendanceRefreshableLine?: ReturnType<
    typeof createAttendanceRefreshableManualLinePredicate
  >;
}) {
  if (!args.latestBaseline) return args.saved;

  if (args.forceRefreshAttendanceLines) {
    return mergeManualLinesWithFreshAttendanceRows({
      saved: args.saved,
      latestBaseline: args.latestBaseline,
      isAttendanceRefreshableLine: args.isAttendanceRefreshableLine,
    });
  }

  const savedItems = attachLineMergeKeys(args.saved);
  const oldBaselineItems = attachLineMergeKeys(args.oldBaseline ?? []);
  const latestBaselineItems = attachLineMergeKeys(args.latestBaseline);
  const savedByKey = new Map(savedItems.map((item) => [item.key, item.line]));
  const oldBaselineByKey = new Map(
    oldBaselineItems.map((item) => [item.key, item.line])
  );
  const usedSavedKeys = new Set<string>();
  const merged: ManualPayrollEntryLineView[] = [];

  for (const latestItem of latestBaselineItems) {
    const savedLine = savedByKey.get(latestItem.key);
    const oldBaselineLine = oldBaselineByKey.get(latestItem.key);

    if (!savedLine) {
      merged.push(latestItem.line);
      continue;
    }

    usedSavedKeys.add(latestItem.key);

    if (!oldBaselineLine || !areManualLinesEquivalent(savedLine, oldBaselineLine)) {
      merged.push(savedLine);
    } else {
      merged.push(latestItem.line);
    }
  }

  for (const savedItem of savedItems) {
    if (usedSavedKeys.has(savedItem.key)) continue;

    const oldBaselineLine = oldBaselineByKey.get(savedItem.key);
    if (!oldBaselineLine || !areManualLinesEquivalent(savedItem.line, oldBaselineLine)) {
      merged.push(savedItem.line);
    }
  }

  return merged.map((line, index) => ({
    ...line,
    sortOrder: index,
  }));
}

function mergeManualLinesWithFreshAttendanceRows(args: {
  saved: ManualPayrollEntryLineView[];
  latestBaseline: ManualPayrollEntryLineView[];
  isAttendanceRefreshableLine?: ReturnType<
    typeof createAttendanceRefreshableManualLinePredicate
  >;
}) {
  const isAttendanceRefreshableLine =
    args.isAttendanceRefreshableLine ??
    createAttendanceRefreshableManualLinePredicate();
  const refreshedLines = args.latestBaseline.filter(isAttendanceRefreshableLine);
  const firstRefreshableIndex = args.saved.findIndex(isAttendanceRefreshableLine);

  if (firstRefreshableIndex < 0) {
    return [...refreshedLines, ...args.saved].map((line, index) => ({
      ...line,
      id: line.id ?? null,
      sortOrder: index,
    }));
  }

  const before = args.saved
    .slice(0, firstRefreshableIndex)
    .filter((line) => !isAttendanceRefreshableLine(line));
  const after = args.saved
    .slice(firstRefreshableIndex)
    .filter((line) => !isAttendanceRefreshableLine(line));

  return [...before, ...refreshedLines, ...after].map((line, index) => ({
    ...line,
    id: line.id ?? null,
    sortOrder: index,
  }));
}

function normalizeBaselineSnapshot(
  value: unknown
): ManualPayrollBaselineSnapshot | null {
  if (!value || typeof value !== "object") return null;

  const snapshot = value as Partial<ManualPayrollBaselineSnapshot>;
  if (!snapshot.fields || !Array.isArray(snapshot.lines)) return null;

  const payComputationMode =
    snapshot.payComputationMode === "Daily Rate" ||
    snapshot.payComputationMode === "Monthly Rate"
      ? snapshot.payComputationMode
      : null;

  return {
    version: 1,
    payComputationMode,
    fields: {
      ...emptyFields(),
      ...snapshot.fields,
      remarks: snapshot.fields.remarks ?? null,
    },
    lines: snapshot.lines.map((line, index) => ({
      ...line,
      id: null,
      sortOrder: line.sortOrder ?? index,
    })),
  };
}

function getManualEntryBaselineSnapshot(
  entry: typeof manualPayrollEntries.$inferSelect
) {
  return normalizeBaselineSnapshot(entry.baselineSnapshot);
}

export function buildManualPayrollBaselineSnapshotFromComputation(
  employeeRun: ComputedPayrollEntryLike,
  options: {
    accountCodeOptions?: ManualPayrollAccountCodeOptionView[];
  } = {}
): ManualPayrollBaselineSnapshot {
  const fields = getComputedEntryFields(employeeRun);
  const accountCodeLookup = buildAccountCodeLookup(options.accountCodeOptions);
  const lines = employeeRun.lines
    .map((line, index) => serializeComputedLine(line, index, accountCodeLookup))
    .filter((line): line is ManualPayrollEntryLineView => line != null);

  return {
    version: 1,
    payComputationMode:
      employeeRun.payComputationMode ??
      parsePayComputationMode(employeeRun.breakdownNotes) ??
      null,
    fields,
    lines: sortManualPayrollLinesByCode(lines).map((line, index) => ({
      ...line,
      sortOrder: index,
    })),
  };
}

function serializeManualEntry(
  entry: ManualPayrollEntryWithLines,
  args: {
    payrollPeriod: PayrollRunPeriodView;
    employee: PayrollAccountCodeEmployeeView;
    rateContext: ManualPayrollRateContextView;
    accountCodeOptions: ManualPayrollAccountCodeOptionView[];
    latestRunStatus: string | null;
    editBlockReason: string | null;
    latestBaseline: ManualPayrollBaselineSnapshot | null;
  }
): ManualPayrollEntryWorkspaceView {
  const savedFields = getManualEntryFields(entry);
  const accountCodeLookup = buildAccountCodeLookup(args.accountCodeOptions);
  const savedLines = [...entry.lines]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((line) => serializeManualLine(line, accountCodeLookup));
  const oldBaseline = getManualEntryBaselineSnapshot(entry);
  const mergedFields = mergeManualFields({
    saved: savedFields,
    oldBaseline: oldBaseline?.fields ?? null,
    latestBaseline: args.latestBaseline?.fields ?? null,
  });
  const mergedLines = mergeManualLines({
    saved: savedLines,
    oldBaseline: oldBaseline?.lines ?? null,
    latestBaseline: args.latestBaseline?.lines ?? null,
  });
  const sortedLines = sortManualPayrollLinesByCode(mergedLines).map(
    (line, index) => ({
      ...line,
      sortOrder: index,
    })
  );

  return {
    entryId: entry.id,
    source: "manual",
    canEdit: !args.editBlockReason,
    editBlockReason: args.editBlockReason,
    latestRunStatus: args.latestRunStatus,
    payrollPeriod: args.payrollPeriod,
    employee: args.employee,
    rateContext: args.rateContext,
    accountCodeOptions: args.accountCodeOptions,
    ...mergedFields,
    lines: sortedLines,
  };
}

function serializeComputedEntry(
  employeeRun: typeof payrollRunEmployees.$inferSelect & {
    lines: Array<typeof payrollRunLines.$inferSelect>;
  },
  args: {
    payrollPeriod: PayrollRunPeriodView;
    employee: PayrollAccountCodeEmployeeView;
    rateContext: ManualPayrollRateContextView;
    accountCodeOptions: ManualPayrollAccountCodeOptionView[];
    latestRunStatus: string | null;
    editBlockReason: string | null;
  }
): ManualPayrollEntryWorkspaceView {
  const baseline = buildManualPayrollBaselineSnapshotFromComputation(
    {
      taxablePay: employeeRun.taxablePay,
      breakdownNotes: employeeRun.breakdownNotes,
      lines: employeeRun.lines,
    },
    {
      accountCodeOptions: args.accountCodeOptions,
    }
  );
  const accountCodeLookup = buildAccountCodeLookup(args.accountCodeOptions);
  const computedLines = employeeRun.lines
    .map((line, index) => serializeComputedLine(line, index, accountCodeLookup))
    .filter((line): line is ManualPayrollEntryLineView => line != null);
  const sortedComputedLines = sortManualPayrollLinesByCode(computedLines).map(
    (line, index) => ({
      ...line,
      sortOrder: index,
    })
  );

  return {
    ...emptyFields(),
    entryId: null,
    source: "computed",
    canEdit: !args.editBlockReason,
    editBlockReason: args.editBlockReason,
    latestRunStatus: args.latestRunStatus,
    payrollPeriod: args.payrollPeriod,
    employee: args.employee,
    rateContext: args.rateContext,
    accountCodeOptions: args.accountCodeOptions,
    ...baseline.fields,
    lines: sortedComputedLines,
  };
}

function serializeBaselineEntry(
  baseline: ManualPayrollBaselineSnapshot,
  args: {
    payrollPeriod: PayrollRunPeriodView;
    employee: PayrollAccountCodeEmployeeView;
    rateContext: ManualPayrollRateContextView;
    accountCodeOptions: ManualPayrollAccountCodeOptionView[];
    latestRunStatus: string | null;
    editBlockReason: string | null;
  }
): ManualPayrollEntryWorkspaceView {
  return {
    entryId: null,
    source: "computed",
    canEdit: !args.editBlockReason,
    editBlockReason: args.editBlockReason,
    latestRunStatus: args.latestRunStatus,
    payrollPeriod: args.payrollPeriod,
    employee: args.employee,
    rateContext: args.rateContext,
    accountCodeOptions: args.accountCodeOptions,
    ...baseline.fields,
    lines: sortManualPayrollLinesByCode(baseline.lines).map((line, index) => ({
      ...line,
      sortOrder: index,
    })),
  };
}

function serializeBlankEntry(args: {
  payrollPeriod: PayrollRunPeriodView;
  employee: PayrollAccountCodeEmployeeView;
  rateContext: ManualPayrollRateContextView;
  accountCodeOptions: ManualPayrollAccountCodeOptionView[];
  latestRunStatus: string | null;
  editBlockReason: string | null;
}): ManualPayrollEntryWorkspaceView {
  return {
    ...emptyFields(),
    entryId: null,
    source: "blank",
    canEdit: !args.editBlockReason,
    editBlockReason: args.editBlockReason,
    latestRunStatus: args.latestRunStatus,
    payrollPeriod: args.payrollPeriod,
    employee: args.employee,
    rateContext: args.rateContext,
    accountCodeOptions: args.accountCodeOptions,
    lines: [],
  };
}

export async function getManualPayrollEntryWorkspace(args: {
  payrollPeriodId: string;
  employeeId: string;
  includeAccountCodeOptions?: boolean;
  latestBaseline?: ManualPayrollBaselineSnapshot | null;
}): Promise<ManualPayrollEntryWorkspaceView> {
  const [period, employee, accountCodeOptions, latestRun, rateContext] =
    await Promise.all([
    db.query.payrollPeriods.findFirst({
      where: eq(payrollPeriods.id, args.payrollPeriodId),
    }),
    getEmployeeForManualPayroll(args.employeeId),
    args.includeAccountCodeOptions === false
      ? Promise.resolve([])
      : getManualAccountCodeOptions(),
    getLatestRun(args.payrollPeriodId),
    getManualPayrollRateContext(args.payrollPeriodId, args.employeeId),
  ]);

  if (!period) {
    throw new Error("Payroll period not found.");
  }

  if (!employee) {
    throw new Error("Employee not found.");
  }

  const payrollPeriod = serializePeriod(period);
  const latestRunStatus = latestRun?.status ?? null;
  const editBlockReason = getEditBlockReason(latestRunStatus);

  const manualEntry = await db.query.manualPayrollEntries.findFirst({
    where: and(
      eq(manualPayrollEntries.payrollPeriodId, args.payrollPeriodId),
      eq(manualPayrollEntries.employeeId, args.employeeId)
    ),
    with: {
      lines: true,
    },
  });

  const baseArgs = {
    payrollPeriod,
    employee,
    rateContext,
    accountCodeOptions,
    latestRunStatus,
    editBlockReason,
  };

  if (manualEntry) {
    return serializeManualEntry(manualEntry, {
      ...baseArgs,
      latestBaseline: args.latestBaseline ?? null,
    });
  }

  if (args.latestBaseline) {
    return serializeBaselineEntry(args.latestBaseline, baseArgs);
  }

  const computedEmployee = latestRun
    ? await db.query.payrollRunEmployees.findFirst({
        where: and(
          eq(payrollRunEmployees.payrollRunId, latestRun.id),
          eq(payrollRunEmployees.employeeId, args.employeeId)
        ),
        with: {
          lines: true,
        },
      })
    : null;

  if (computedEmployee) {
    return serializeComputedEntry(computedEmployee, baseArgs);
  }

  return serializeBlankEntry(baseArgs);
}

function getNormalizedLineType(
  line: ManualLineInput,
  account: ManualPayrollAccountCodeOptionView | null
) {
  const accountType = account?.accountType;
  if (
    accountType === "Loan" ||
    accountType === "Other Deduction" ||
    accountType === "Unpaid Leaves/Absences"
  ) {
    return "Deduction" as const;
  }
  return line.lineType;
}

function normalizeSummaryBucket(
  lineType: ManualLineInput["lineType"],
  bucket: ManualPayrollLineSummaryBucket,
  account: ManualPayrollAccountCodeOptionView | null,
  code: string | null | undefined
): ManualPayrollLineSummaryBucket {
  const accountBucket = getManualPayrollBucketFromAccountCodeOrType({
    code,
    accountType: account?.accountType,
  });
  if (accountBucket) return accountBucket;
  if (lineType === "Deduction") return "otherDeductions";
  return bucket;
}

function normalizeManualLines(args: {
  rows: ManualLineInput[];
  accountCodeById: Map<number, ManualPayrollAccountCodeOptionView>;
  rateContext: ManualPayrollRateContextView;
}) {
  return args.rows
    .map((row, index) => {
      const selectedAccount =
        row.accountCodeId != null
          ? args.accountCodeById.get(row.accountCodeId) ?? null
          : null;
      const hours = Math.max(0, Math.floor(row.hours ?? 0));
      const minutes = Math.max(0, Math.floor(row.minutes ?? 0));
      const submittedAmount = roundMoney(toAmount(row.amount));
      const computedAmount =
        submittedAmount > 0
          ? null
          : computeManualPayrollLineAmount({
              account: selectedAccount,
              rateContext: args.rateContext,
              hours,
              minutes,
            });
      const amount = submittedAmount > 0 ? submittedAmount : computedAmount ?? 0;
      const hasQuantity = hours > 0 || minutes > 0;
      const isPayrollAccountCodeRow =
        row.sourceTable?.trim() === "employee_payroll_exception_rows";
      const isLeaveRecordRow = row.sourceTable?.trim() === "employees_leave_records";
      const preserveZeroAmountUnpaidLeave =
        selectedAccount?.accountType === "Unpaid Leaves/Absences" &&
        (hasQuantity || isPayrollAccountCodeRow);
      const preserveZeroAmountLeaveAuditRow =
        row.lineType === "Information" && isLeaveRecordRow && hasQuantity;
      if (
        amount <= 0 &&
        !preserveZeroAmountUnpaidLeave &&
        !preserveZeroAmountLeaveAuditRow
      ) {
        return null;
      }

      const lineType = getNormalizedLineType(row, selectedAccount);
      const summaryBucket = normalizeSummaryBucket(
        lineType,
        row.summaryBucket as ManualPayrollLineSummaryBucket,
        selectedAccount,
        selectedAccount?.code ?? row.code
      );
      const nonTaxable =
        selectedAccount?.nonTaxable ?? row.nonTaxable ?? row.taxable === false;
      const deminimis = selectedAccount?.deminimis ?? row.deminimis ?? false;
      const taxable =
        lineType === "Earning" ? !(nonTaxable || deminimis) && !!row.taxable : false;

      return {
        accountCodeId: selectedAccount?.id ?? row.accountCodeId ?? null,
        lineType,
        summaryBucket,
        code: selectedAccount?.code ?? row.code.trim(),
        description:
          row.description.trim() || selectedAccount?.description || selectedAccount?.code || row.code,
        loanRefNo:
          selectedAccount?.accountType === "Loan"
            ? row.loanRefNo?.trim() || null
            : null,
        hours,
        minutes,
        amount: amount.toFixed(2),
        taxable,
        month13thEligible:
          lineType === "Earning"
            ? selectedAccount?.month13thPay ?? row.month13thEligible ?? false
            : false,
        nonTaxable,
        deminimis,
        sourceTable: row.sourceTable?.trim() || null,
        sourceId: row.sourceId?.trim() || null,
        sortOrder: row.sortOrder ?? index,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ManualLineWithSource = {
  sourceTable?: string | null;
  sourceId?: string | null;
  sortOrder?: number;
};

function getLoanInstallmentSourceIds(lines: ManualLineWithSource[]) {
  return [
    ...new Set(
      lines
        .filter((line) => line.sourceTable?.trim() === "loan_installments")
        .map((line) => line.sourceId?.trim() ?? "")
        .filter((sourceId) => UUID_PATTERN.test(sourceId))
    ),
  ];
}

async function filterActiveLoanInstallmentLines<T extends ManualLineWithSource>(
  lines: T[]
): Promise<T[]> {
  const loanInstallmentIds = getLoanInstallmentSourceIds(lines);
  if (loanInstallmentIds.length === 0) {
    return lines.filter(
      (line) => line.sourceTable?.trim() !== "loan_installments"
    );
  }

  const activeInstallments = await db
    .select({
      id: loanInstallments.id,
    })
    .from(loanInstallments)
    .innerJoin(employeesLoans, eq(loanInstallments.loanId, employeesLoans.id))
    .where(
      and(
        inArray(loanInstallments.id, loanInstallmentIds),
        eq(employeesLoans.status, "Active"),
        isNull(employeesLoans.deletedAt),
        inArray(loanInstallments.status, ["Pending", "Due"])
      )
    );
  const activeInstallmentIds = new Set(activeInstallments.map((row) => row.id));

  return lines.filter((line) => {
    if (line.sourceTable?.trim() !== "loan_installments") return true;
    const sourceId = line.sourceId?.trim() ?? "";
    return activeInstallmentIds.has(sourceId);
  });
}

async function sanitizeManualPayrollBaselineSnapshot(
  baseline: ManualPayrollBaselineSnapshot | null | undefined
) {
  if (!baseline) return null;

  return {
    ...baseline,
    lines: await filterActiveLoanInstallmentLines(baseline.lines),
  };
}

function computeEntryTotals(args: {
  lines: ReturnType<typeof normalizeManualLines>;
  payload: SaveManualPayrollEntrySchemaType;
}) {
  const grossPay = roundMoney(
    args.lines
      .filter((line) => line.lineType === "Earning")
      .reduce((total, line) => total + toAmount(line.amount), 0)
  );
  const regularPay = roundMoney(
    args.lines
      .filter((line) => line.lineType === "Earning" && line.summaryBucket === "basicPay")
      .reduce((total, line) => total + toAmount(line.amount), 0)
  );
  const nonTaxablePay = roundMoney(
    args.lines
      .filter(
        (line) =>
          line.lineType === "Earning" &&
          (!line.taxable || line.nonTaxable || line.deminimis)
      )
      .reduce((total, line) => total + toAmount(line.amount), 0)
  );
  const taxableEarnings = roundMoney(grossPay - nonTaxablePay);
  const otherDeductions = roundMoney(
    args.lines
      .filter((line) => line.lineType === "Deduction")
      .reduce((total, line) => total + toAmount(line.amount), 0)
  );
  const employeeContributions = roundMoney(
    args.payload.sssEmployee +
      args.payload.philhealthEmployee +
      args.payload.pagibigEmployee +
      args.payload.withholdingTax +
      args.payload.peraaEmployee
  );
  const employerContributions = roundMoney(
    args.payload.sssEmployer +
      args.payload.sssEc +
      args.payload.philhealthEmployer +
      args.payload.pagibigEmployer +
      args.payload.peraaEmployer
  );
  const totalDeductions = roundMoney(otherDeductions + employeeContributions);
  const taxablePay = roundMoney(
    Math.max(
      0,
      taxableEarnings -
        args.payload.sssEmployee -
        args.payload.philhealthEmployee -
        args.payload.pagibigEmployee -
        args.payload.peraaEmployee
    )
  );

  return {
    regularPay: regularPay.toFixed(2),
    grossPay: grossPay.toFixed(2),
    taxablePay: taxablePay.toFixed(2),
    nonTaxablePay: nonTaxablePay.toFixed(2),
    totalDeductions: totalDeductions.toFixed(2),
    employeeContributions: employeeContributions.toFixed(2),
    employerContributions: employerContributions.toFixed(2),
    netPay: roundMoney(grossPay - totalDeductions).toFixed(2),
  };
}

function buildManualPayrollPayloadFromEntry(args: {
  entry: typeof manualPayrollEntries.$inferSelect;
  lines: ManualPayrollEntryLineView[];
}): SaveManualPayrollEntrySchemaType {
  return {
    payrollPeriodId: args.entry.payrollPeriodId,
    employeeId: args.entry.employeeId,
    sssEmployee: toAmount(args.entry.sssEmployee),
    sssEmployer: toAmount(args.entry.sssEmployer),
    sssEc: toAmount(args.entry.sssEc),
    sssBasis: toAmount(args.entry.sssBasis),
    philhealthEmployee: toAmount(args.entry.philhealthEmployee),
    philhealthEmployer: toAmount(args.entry.philhealthEmployer),
    philhealthBasis: toAmount(args.entry.philhealthBasis),
    pagibigEmployee: toAmount(args.entry.pagibigEmployee),
    pagibigEmployer: toAmount(args.entry.pagibigEmployer),
    pagibigBasis: toAmount(args.entry.pagibigBasis),
    withholdingTax: toAmount(args.entry.withholdingTax),
    withholdingTaxBasis: toAmount(args.entry.withholdingTaxBasis),
    peraaEmployee: toAmount(args.entry.peraaEmployee),
    peraaEmployer: toAmount(args.entry.peraaEmployer),
    peraaBasis: toAmount(args.entry.peraaBasis),
    remarks: args.entry.remarks,
    lines: args.lines.map((line) => ({
      ...line,
      amount: toAmount(line.amount),
    })),
  };
}

export async function refreshManualPayrollAttendanceLinesFromBaseline(args: {
  actorUserId: string;
  payrollPeriodId: string;
  employeeId: string;
  latestBaseline?: ManualPayrollBaselineSnapshot | null;
  refreshableExceptionRowIds?: string[];
}) {
  const latestBaseline = await sanitizeManualPayrollBaselineSnapshot(
    args.latestBaseline
  );

  const emptyResult = {
    refreshed: false,
    entryId: null as string | null,
    replacedLineCount: 0,
    refreshedLineCount: 0,
    preservedLineCount: 0,
  };

  if (!latestBaseline) return emptyResult;

  const [entry, accountCodeOptions, rateContext] = await Promise.all([
    db.query.manualPayrollEntries.findFirst({
      where: and(
        eq(manualPayrollEntries.payrollPeriodId, args.payrollPeriodId),
        eq(manualPayrollEntries.employeeId, args.employeeId)
      ),
      with: {
        lines: true,
      },
    }),
    getManualAccountCodeOptions(),
    getManualPayrollRateContext(args.payrollPeriodId, args.employeeId),
  ]);

  if (!entry) return emptyResult;

  const accountCodeLookup = buildAccountCodeLookup(accountCodeOptions);
  const savedLines = [...entry.lines]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((line) => serializeManualLine(line, accountCodeLookup));
  const isAttendanceRefreshableLine =
    createAttendanceRefreshableManualLinePredicate({
      refreshableExceptionRowIds: args.refreshableExceptionRowIds,
    });
  const mergedLines = mergeManualLinesWithFreshAttendanceRows({
    saved: savedLines,
    latestBaseline: latestBaseline.lines,
    isAttendanceRefreshableLine,
  });
  const accountCodeById = new Map(accountCodeOptions.map((option) => [option.id, option]));
  const payload = buildManualPayrollPayloadFromEntry({
    entry,
    lines: mergedLines,
  });
  const normalizedLines = sortManualPayrollLinesByCode(
    await filterActiveLoanInstallmentLines(
      normalizeManualLines({
        rows: payload.lines,
        accountCodeById,
        rateContext,
      })
    )
  );
  const totals = computeEntryTotals({
    lines: normalizedLines,
    payload,
  });
  const replacedLineCount = savedLines.filter(isAttendanceRefreshableLine).length;
  const refreshedLineCount = latestBaseline.lines.filter(
    isAttendanceRefreshableLine
  ).length;
  const preservedLineCount = savedLines.length - replacedLineCount;

  await db.transaction(async (tx) => {
    await tx
      .update(manualPayrollEntries)
      .set({
        payComputationMode:
          latestBaseline.payComputationMode ??
          (entry.payComputationMode as PayrollComputationModeView | null) ??
          null,
        baselineSnapshot: latestBaseline,
        ...totals,
        updatedByUserId: args.actorUserId,
        updatedAt: new Date(),
      })
      .where(eq(manualPayrollEntries.id, entry.id));

    await tx
      .delete(manualPayrollEntryLines)
      .where(eq(manualPayrollEntryLines.manualPayrollEntryId, entry.id));

    if (normalizedLines.length > 0) {
      await tx.insert(manualPayrollEntryLines).values(
        normalizedLines.map((line: NormalizedManualLine, index: number) => ({
          manualPayrollEntryId: entry.id,
          ...line,
          sortOrder: index,
        }))
      );
    }

    await recordAdminAuditEvent({
      actorUserId: args.actorUserId,
      entityType: "manual_payroll_entry",
      entityId: entry.id,
      action: "manual_payroll.attendance_lines_refreshed",
      details: {
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        replacedLineCount,
        refreshedLineCount,
        preservedLineCount,
      },
      database: tx,
    });
  });

  return {
    refreshed: true,
    entryId: entry.id,
    replacedLineCount,
    refreshedLineCount,
    preservedLineCount,
  };
}

async function assertManualPayrollEditable(payrollPeriodId: string) {
  const latestRun = await getLatestRun(payrollPeriodId);
  const editBlockReason = getEditBlockReason(latestRun?.status ?? null);
  if (editBlockReason) {
    throw new Error(editBlockReason);
  }
  return latestRun;
}

async function markLatestRunStale(args: {
  tx: DbLike;
  latestRun: typeof payrollRuns.$inferSelect | null;
  actorUserId: string;
  notes: string;
}) {
  if (!args.latestRun) return 0;
  if (!EDITABLE_RUN_STATUSES.has(args.latestRun.status)) return 0;

  if (args.latestRun.status !== "Stale") {
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
      .where(eq(payrollRuns.id, args.latestRun.id));
  }

  await recordPayrollRunEvent({
    payrollRunId: args.latestRun.id,
    actorUserId: args.actorUserId,
    eventType: "MarkedStale",
    fromStatus: args.latestRun.status as "Draft" | "Stale",
    toStatus: "Stale",
    notes: args.notes,
    database: args.tx,
  });

  return 1;
}

export async function saveManualPayrollEntry(args: {
  actorUserId: string;
  payload: SaveManualPayrollEntrySchemaType;
  latestBaseline?: ManualPayrollBaselineSnapshot | null;
}) {
  const [period, employee, latestRun, accountCodeOptions, rateContext] = await Promise.all([
    db.query.payrollPeriods.findFirst({
      where: eq(payrollPeriods.id, args.payload.payrollPeriodId),
    }),
    getEmployeeForManualPayroll(args.payload.employeeId),
    assertManualPayrollEditable(args.payload.payrollPeriodId),
    getManualAccountCodeOptions(),
    getManualPayrollRateContext(args.payload.payrollPeriodId, args.payload.employeeId),
  ]);

  if (!period) {
    throw new Error("Payroll period not found.");
  }

  if (!employee) {
    throw new Error("Employee not found.");
  }

  const accountCodeById = new Map(accountCodeOptions.map((option) => [option.id, option]));
  const selectedAccountIds = [
    ...new Set(
      args.payload.lines
        .map((line) => line.accountCodeId)
        .filter((value): value is number => value != null)
    ),
  ];

  for (const accountCodeId of selectedAccountIds) {
    if (!accountCodeById.has(accountCodeId)) {
      throw new Error("One or more selected account codes no longer exist.");
    }
  }

  const normalizedLines = sortManualPayrollLinesByCode(
    await filterActiveLoanInstallmentLines(
      normalizeManualLines({
        rows: args.payload.lines,
        accountCodeById,
        rateContext,
      })
    )
  );
  const latestBaseline = await sanitizeManualPayrollBaselineSnapshot(
    args.latestBaseline
  );
  const totals = computeEntryTotals({
    lines: normalizedLines,
    payload: args.payload,
  });

  await db.transaction(async (tx) => {
    const [existingEntry] = await tx
      .select()
      .from(manualPayrollEntries)
      .where(
        and(
          eq(manualPayrollEntries.payrollPeriodId, args.payload.payrollPeriodId),
          eq(manualPayrollEntries.employeeId, args.payload.employeeId)
        )
      )
      .limit(1);

    let entryId = existingEntry?.id ?? null;
    const entryValues = {
      payrollPeriodId: args.payload.payrollPeriodId,
      employeeId: args.payload.employeeId,
      employeeNoSnapshot: formatEmployeeCode({
        employeeType: employee.employeeType,
        employeeNo: employee.employeeNo,
      }),
      employeeNameSnapshot: employee.employeeName,
      payComputationMode:
        latestBaseline?.payComputationMode ??
        (existingEntry?.payComputationMode as PayrollComputationModeView | null) ??
        null,
      baselineSnapshot:
        latestBaseline ??
        normalizeBaselineSnapshot(existingEntry?.baselineSnapshot) ??
        null,
      ...totals,
      sssEmployee: money(args.payload.sssEmployee),
      sssEmployer: money(args.payload.sssEmployer),
      sssEc: money(args.payload.sssEc),
      sssBasis: money(args.payload.sssBasis),
      philhealthEmployee: money(args.payload.philhealthEmployee),
      philhealthEmployer: money(args.payload.philhealthEmployer),
      philhealthBasis: money(args.payload.philhealthBasis),
      pagibigEmployee: money(args.payload.pagibigEmployee),
      pagibigEmployer: money(args.payload.pagibigEmployer),
      pagibigBasis: money(args.payload.pagibigBasis),
      withholdingTax: money(args.payload.withholdingTax),
      withholdingTaxBasis: money(args.payload.withholdingTaxBasis),
      peraaEmployee: money(args.payload.peraaEmployee),
      peraaEmployer: money(args.payload.peraaEmployer),
      peraaBasis: money(args.payload.peraaBasis),
      remarks: args.payload.remarks?.trim() || null,
      updatedByUserId: args.actorUserId,
      updatedAt: new Date(),
    };

    if (entryId) {
      await tx
        .update(manualPayrollEntries)
        .set(entryValues)
        .where(eq(manualPayrollEntries.id, entryId));
      await tx
        .delete(manualPayrollEntryLines)
        .where(eq(manualPayrollEntryLines.manualPayrollEntryId, entryId));
    } else {
      const [createdEntry] = await tx
        .insert(manualPayrollEntries)
        .values({
          ...entryValues,
          createdByUserId: args.actorUserId,
        })
        .returning({ id: manualPayrollEntries.id });
      entryId = createdEntry.id;
    }

    if (normalizedLines.length > 0) {
      await tx.insert(manualPayrollEntryLines).values(
        normalizedLines.map((line, index) => ({
          manualPayrollEntryId: entryId!,
          ...line,
          sortOrder: index,
        }))
      );
    }

    await markLatestRunStale({
      tx,
      latestRun,
      actorUserId: args.actorUserId,
      notes: "Marked stale because a manual payroll override changed.",
    });

    await recordAdminAuditEvent({
      actorUserId: args.actorUserId,
      entityType: "manual_payroll_entry",
      entityId: entryId,
      action: existingEntry ? "manual_payroll.updated" : "manual_payroll.created",
      details: {
        payrollPeriodId: args.payload.payrollPeriodId,
        employeeId: args.payload.employeeId,
        lineCount: normalizedLines.length,
      },
      database: tx,
    });
  });

  return getManualPayrollEntryWorkspace({
    payrollPeriodId: args.payload.payrollPeriodId,
    employeeId: args.payload.employeeId,
    latestBaseline,
  });
}

export async function deleteManualPayrollEntry(args: {
  actorUserId: string;
  payrollPeriodId: string;
  employeeId: string;
  latestBaseline?: ManualPayrollBaselineSnapshot | null;
}) {
  const [latestRun, existingEntry] = await Promise.all([
    assertManualPayrollEditable(args.payrollPeriodId),
    db.query.manualPayrollEntries.findFirst({
      where: and(
        eq(manualPayrollEntries.payrollPeriodId, args.payrollPeriodId),
        eq(manualPayrollEntries.employeeId, args.employeeId)
      ),
    }),
  ]);

  if (!existingEntry) {
    return getManualPayrollEntryWorkspace({
      payrollPeriodId: args.payrollPeriodId,
      employeeId: args.employeeId,
      latestBaseline: args.latestBaseline ?? null,
    });
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(manualPayrollEntries)
      .where(eq(manualPayrollEntries.id, existingEntry.id));

    await markLatestRunStale({
      tx,
      latestRun,
      actorUserId: args.actorUserId,
      notes: "Marked stale because a manual payroll override was deleted.",
    });

    await recordAdminAuditEvent({
      actorUserId: args.actorUserId,
      entityType: "manual_payroll_entry",
      entityId: existingEntry.id,
      action: "manual_payroll.deleted",
      details: {
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
      },
      database: tx,
    });
  });

  return getManualPayrollEntryWorkspace({
    payrollPeriodId: args.payrollPeriodId,
    employeeId: args.employeeId,
    latestBaseline: args.latestBaseline ?? null,
  });
}

export async function loadManualPayrollEntriesForPeriod(
  payrollPeriodId: string,
  database: DbLike = db
): Promise<ManualPayrollEntryWithLines[]> {
  return database.query.manualPayrollEntries.findMany({
    where: eq(manualPayrollEntries.payrollPeriodId, payrollPeriodId),
    with: {
      lines: true,
    },
  });
}

export function buildManualPayrollContributionLines(
  entry: typeof manualPayrollEntries.$inferSelect
) {
  const lineBase = {
    accountCodeId: null,
    loanRefNo: null,
    quantity: null,
    rate: null,
    taxable: false,
    month13thEligible: false,
    sourceTable: MANUAL_PAYROLL_ENTRY_SOURCE_TABLE,
    sourceId: entry.id,
  };

  return [
    {
      lineType: "Deduction" as const,
      code: "SSS",
      description: "SSS Employee Share",
      amount: toAmount(entry.sssEmployee),
      ...lineBase,
    },
    {
      lineType: "Employer Contribution" as const,
      code: "SSS-ER",
      description: "SSS Employer Share",
      amount: toAmount(entry.sssEmployer),
      ...lineBase,
    },
    {
      lineType: "Employer Contribution" as const,
      code: "SSS-EC",
      description: "SSS EC Share",
      amount: toAmount(entry.sssEc),
      ...lineBase,
    },
    {
      lineType: "Deduction" as const,
      code: "PHILHEALTH",
      description: "PhilHealth Employee Share",
      amount: toAmount(entry.philhealthEmployee),
      ...lineBase,
    },
    {
      lineType: "Employer Contribution" as const,
      code: "PHILHEALTH-ER",
      description: "PhilHealth Employer Share",
      amount: toAmount(entry.philhealthEmployer),
      ...lineBase,
    },
    {
      lineType: "Deduction" as const,
      code: "PAGIBIG",
      description: "Pag-IBIG Employee Share",
      amount: toAmount(entry.pagibigEmployee),
      ...lineBase,
    },
    {
      lineType: "Employer Contribution" as const,
      code: "PAGIBIG-ER",
      description: "Pag-IBIG Employer Share",
      amount: toAmount(entry.pagibigEmployer),
      ...lineBase,
    },
    {
      lineType: "Deduction" as const,
      code: "TAX",
      description: "Withholding Tax",
      amount: toAmount(entry.withholdingTax),
      ...lineBase,
    },
    {
      lineType: "Deduction" as const,
      code: "PERAA",
      description: "PERAA Employee Share",
      amount: toAmount(entry.peraaEmployee),
      ...lineBase,
    },
    {
      lineType: "Employer Contribution" as const,
      code: "PERAA-ER",
      description: "PERAA Employer Share",
      amount: toAmount(entry.peraaEmployer),
      ...lineBase,
    },
  ].filter((line) => line.amount > 0);
}

export function buildManualPayrollRunLines(entry: ManualPayrollEntryWithLines) {
  const detailLines = [...entry.lines]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((line) => ({
      accountCodeId: line.accountCodeId,
      lineType: line.lineType,
      code: line.code,
      description: line.description,
      loanRefNo: line.loanRefNo,
      amount: toAmount(line.amount),
      quantity:
        line.hours > 0 || line.minutes > 0
          ? roundMoney(line.hours + line.minutes / 60)
          : null,
      rate: null,
      taxable: line.taxable,
      month13thEligible: line.month13thEligible,
      sourceTable: line.sourceTable === "loan_installments" ? line.sourceTable : MANUAL_PAYROLL_SOURCE_TABLE,
      sourceId: line.sourceTable === "loan_installments" ? line.sourceId : line.id,
    }));

  return [...detailLines, ...buildManualPayrollContributionLines(entry)];
}

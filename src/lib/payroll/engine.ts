import { db } from "@/db";
import {
  accountCode,
  attendanceDailySummaries,
  customPayrollDefinitions,
  employeeAttendanceDayStatusOverrides,
  employeeAttendancePeriodOverrides,
  employeePayrollExceptionRows,
  employeeShiftAssignments,
  employeeWeeklyShiftPatterns,
  employees,
  employeesGeneralInfo,
  employeeLeaveRecordDays,
  employeesLeaveRecords,
  employeesLoans,
  employeesRecurringEntries,
  employeesSalary,
  employeesTimekeeping,
  employeeAttendanceDayTypeOverrides,
  leaveTypes,
  loanInstallments,
  loanPayments,
  overtimeRules,
  payrollPeriods,
  payrollRunEmployees,
  payrollRunLines,
  payrollRuns,
} from "@/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { eachDayOfInterval, format, isAfter, isBefore } from "date-fns";
import { recordPayrollRunEvent } from "@/lib/admin";
import { DEFAULT_EMPLOYEE_TYPE, formatEmployeeCode } from "@/utils/employeeCode";
import {
  fetchConfirmedHolidayRowsForRange,
  fetchConfirmedHolidayRowsForYear,
  refreshOpenPayrollPeriodsForHolidayYear,
} from "@/lib/holidays";
import { ensurePayrollFoundationData } from "./foundation";
import { buildHolidayDateSet, getCalendarYearSeeds, type HolidayLike } from "./calendar";
import {
  buildLeaveTypeMapByCode,
  getMappedLeavePayrollAccountCode,
  resolveLeavePayStatus,
} from "./leave";
import { buildHolidayTypeByDate, type OvertimeHolidayType } from "./overtime";
import {
  getPrimaryResolvedScheduleForPeriod,
  isResolvedScheduleRestDay,
  resolveEmployeeScheduleForDate,
  type ShiftAssignmentRecord,
  type WeeklyShiftPatternRecord,
} from "./scheduleResolver";
import {
  computeBirWithholding,
  computePagibigContribution,
  computePhilhealthContribution,
  computeSssContribution,
  distributeScheduledAmount,
  getActiveStatutoryRuleBundle,
  isScheduleApplicable,
  roundMoney,
  type ActiveStatutoryRuleBundle,
  type ScheduleFlagsLike,
} from "./statutory";
import {
  buildResolvedSalaryByEmployeeId,
  type ResolvedSalaryForPeriod,
  type ResolvedSalaryRecord,
} from "./salaryResolver";
import {
  applyAttendanceDtrEffectiveStatus,
  computeNetDtrWorkedMinutes,
  getAttendanceDtrDayTypeFromHolidayType,
  isAttendanceDtrNonWorkingDayType,
  normalizeAttendanceDtrPeriodOverride,
  type AttendanceDtrDayType,
  type AttendanceDtrManualStatus,
} from "./dtrOverrides";
import {
  computePayrollExceptionPreview,
  isPayrollExceptionAccountType,
  isPayrollExceptionDtrQuantityOnlyDeductionSource,
} from "./payrollExceptions";
import {
  buildManualPayrollBaselineSnapshotFromComputation,
  buildManualPayrollRunLines,
  loadManualPayrollEntriesForPeriod,
} from "./manualPayroll";
import { getManualPayrollAccountRateMultiplier } from "./manualPayrollRate";
import type { ManualPayrollBaselineSnapshot } from "./manualPayroll";

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

type PayrollLineDraft = {
  accountCodeId?: number | null;
  accountType?: string | null;
  lineType: "Earning" | "Deduction" | "Employer Contribution" | "Information";
  code: string;
  description: string;
  amount: number;
  quantity?: number | null;
  rate?: number | null;
  taxable?: boolean;
  month13thEligible?: boolean;
  loanRefNo?: string | null;
  sourceTable?: string | null;
  sourceId?: string | null;
};

type LoanInstallmentWithLoan = typeof loanInstallments.$inferSelect & {
  loan: typeof employeesLoans.$inferSelect;
};

type ContributionGroupWithFlags = {
  contributionType: "SSS" | "PHILHEALTH" | "PAGIBIG" | "PERAA" | "TAX";
  fixedEmployeeShare: string | null;
  fixedEmployerShare: string | null;
  fixedECShare: string | null;
  fixedAmount: string | null;
  percentage: string | null;
  basisValue: string | null;
  basisOfComputation: string;
  flags: {
    scheduleAlways: boolean;
    scheduleEndOfMonth: boolean;
    scheduleFirstPayroll: boolean;
    scheduleSecondPayroll: boolean;
    scheduleThirdPayroll: boolean;
    scheduleForthPayroll: boolean;
    taxFixedPercentage?: boolean | null;
    taxFixedValue?: string | null;
    taxMonthEndAdjustment?: boolean | null;
  } | null;
};

type ContributionType = ContributionGroupWithFlags["contributionType"];
type ContributionBasisSnapshot = Partial<Record<ContributionType, number>>;

type EmployeeRecord = typeof employees.$inferSelect & {
  generalInfo: typeof employeesGeneralInfo.$inferSelect | null;
  salary: typeof employeesSalary.$inferSelect | null;
  recurringEntries: Array<typeof employeesRecurringEntries.$inferSelect>;
  timekeeping: typeof employeesTimekeeping.$inferSelect | null;
};

type EmployeePayrollComputation = {
  employeeId: string;
  employeeNoSnapshot: string;
  employeeNameSnapshot: string;
  salaryAdjustmentId: number | null;
  salaryAdjustmentMode:
    | "OnePeriodOverride"
    | "ForwardEffective"
    | "MultiPeriodOverride"
    | null;
  regularPay: number;
  grossPay: number;
  taxablePay: number;
  nonTaxablePay: number;
  totalDeductions: number;
  employeeContributions: number;
  employerContributions: number;
  netPay: number;
  payComputationMode: PayrollComputationMode | null;
  breakdownNotes: string | null;
  contributionBasis?: ContributionBasisSnapshot;
  lines: PayrollLineDraft[];
};

type PayrollRunTransitionStatus = "Reviewed" | "Approved" | "Posted" | "Void";
export type PayrollComputationMode = "Daily Rate" | "Monthly Rate";

const DEFAULT_PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPE: AttendanceDtrDayType =
  "Legal/Regular Holiday";
const PAYROLL_BASIS_NOTE_PREFIX = "Payroll Basis: ";
const DAILY_RATE_REG_NOTE =
  "Daily-rate REG uses worked attendance time; approved paid leave is posted separately as P-LEAVE.";
const MONTHLY_RATE_REG_NOTE =
  "Monthly-rate REG uses half of monthly salary; absences and unpaid leave are deducted separately.";
const MONTHLY_RATE_DTR_IGNORED_NOTE = "Monthly Rate DTR ignored";
const STATUTORY_MONTHLY_BASE_NOTE_PREFIX = "Statutory Monthly Base: ";
const SSS_SOURCE_NOTE_PREFIX = "SSS Source: ";
const SSS_SALARY_CREDIT_NOTE_PREFIX = "SSS Salary Credit: ";
const SSS_BRACKET_NOTE_PREFIX = "SSS Bracket: ";
const SSS_SOURCE_STATUTORY = "Statutory Table";
const SSS_SOURCE_CUSTOM_FIXED = "Custom Fixed Share";
const PAYROLL_COMPUTATION_CONCURRENCY = 10;

function resolvePayrollExceptionPreviewDayType(args: {
  accountType: string | null;
  savedDayType: AttendanceDtrDayType | null | undefined;
  fallbackDayType: AttendanceDtrDayType | null | undefined;
  isRestDay: boolean;
}) {
  if (args.savedDayType) return args.savedDayType;
  if (args.accountType !== "Sunday/Holiday") return args.fallbackDayType ?? null;
  if (
    args.fallbackDayType &&
    (args.fallbackDayType !== "Regular Day" || args.isRestDay)
  ) {
    return args.fallbackDayType;
  }

  return DEFAULT_PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPE;
}

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function buildFullName(
  firstName: string,
  lastName: string,
  middleName?: string | null
) {
  return `${lastName}, ${firstName}${middleName ? ` ${middleName}` : ""}`.trim();
}

function formatPayrollNoteNumber(value: number) {
  return Number.isFinite(value) ? String(value) : "0";
}

function getRateDivisor(salary: ResolvedSalaryRecord | undefined) {
  const explicitDivisor = toAmount(salary?.rateDivisor);
  return explicitDivisor > 0 ? explicitDivisor : 26;
}

export function getDailyRate(salary: ResolvedSalaryRecord | undefined) {
  const explicitDailyRate = toAmount(salary?.dailyRate);
  if (explicitDailyRate > 0) return explicitDailyRate;

  const monthlyRate = toAmount(salary?.monthlyRate);
  const divisor = getRateDivisor(salary);
  return divisor > 0 ? roundMoney(monthlyRate / divisor) : 0;
}

function buildPayrollBreakdownNotes(args: {
  payComputationMode: PayrollComputationMode;
  monthlyRateDtrIgnored: boolean;
  derivedAbsentDays: number;
  hasSeparatePaidLeaveLine: boolean;
  unresolvedLeaveCount: number;
  statutoryMonthlyCompensationBase: number | null;
  sssContributionSource: string | null;
  sssSalaryCredit: number | null;
  sssRangeFrom: number | null;
  sssRangeTo: number | null;
}) {
  const notes = [`${PAYROLL_BASIS_NOTE_PREFIX}${args.payComputationMode}`];

  if (args.payComputationMode === "Daily Rate" && args.hasSeparatePaidLeaveLine) {
    notes.push(DAILY_RATE_REG_NOTE);
  }

  if (args.payComputationMode === "Monthly Rate" && args.monthlyRateDtrIgnored) {
    notes.push(MONTHLY_RATE_DTR_IGNORED_NOTE);
  } else if (args.payComputationMode === "Monthly Rate") {
    notes.push(MONTHLY_RATE_REG_NOTE);
  }

  if (args.statutoryMonthlyCompensationBase != null) {
    notes.push(
      `${STATUTORY_MONTHLY_BASE_NOTE_PREFIX}${formatPayrollNoteNumber(
        args.statutoryMonthlyCompensationBase
      )}`
    );
  }

  if (args.sssContributionSource) {
    notes.push(`${SSS_SOURCE_NOTE_PREFIX}${args.sssContributionSource}`);
  }

  if (args.sssSalaryCredit != null) {
    notes.push(
      `${SSS_SALARY_CREDIT_NOTE_PREFIX}${formatPayrollNoteNumber(args.sssSalaryCredit)}`
    );
  }

  if (args.sssRangeFrom != null && args.sssRangeTo != null) {
    notes.push(
      `${SSS_BRACKET_NOTE_PREFIX}${formatPayrollNoteNumber(
        args.sssRangeFrom
      )} to ${formatPayrollNoteNumber(args.sssRangeTo)}`
    );
  }

  if (args.unresolvedLeaveCount > 0) {
    notes.push(
      `Unresolved leave type records treated as unpaid: ${args.unresolvedLeaveCount}`
    );
  }

  if (!args.monthlyRateDtrIgnored && args.derivedAbsentDays > 0) {
    notes.push(`Derived absent days: ${formatPayrollNoteNumber(args.derivedAbsentDays)}`);
  }

  return notes.join(" | ");
}

export function parsePayrollBreakdownNotes(
  notes: string | null | undefined
): {
  payComputationMode: PayrollComputationMode | null;
  isManualPayrollOverride: boolean;
  breakdownNotes: string | null;
  statutoryMonthlyCompensationBase: string | null;
  sssContributionSource: string | null;
  sssSalaryCredit: string | null;
  sssBracketLabel: string | null;
} {
  if (!notes) {
    return {
      payComputationMode: null,
      isManualPayrollOverride: false,
      breakdownNotes: null,
      statutoryMonthlyCompensationBase: null,
      sssContributionSource: null,
      sssSalaryCredit: null,
      sssBracketLabel: null,
    };
  }

  const noteParts = notes
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  let payComputationMode: PayrollComputationMode | null = null;
  let statutoryMonthlyCompensationBase: string | null = null;
  let sssContributionSource: string | null = null;
  let sssSalaryCredit: string | null = null;
  let sssBracketLabel: string | null = null;
  let isManualPayrollOverride = false;
  const remainingNotes: string[] = [];

  for (const part of noteParts) {
    if (part === `${PAYROLL_BASIS_NOTE_PREFIX}Daily Rate`) {
      payComputationMode = "Daily Rate";
      continue;
    }

    if (part === `${PAYROLL_BASIS_NOTE_PREFIX}Monthly Rate`) {
      payComputationMode = "Monthly Rate";
      continue;
    }

    if (part.startsWith(STATUTORY_MONTHLY_BASE_NOTE_PREFIX)) {
      statutoryMonthlyCompensationBase = part
        .slice(STATUTORY_MONTHLY_BASE_NOTE_PREFIX.length)
        .trim();
      continue;
    }

    if (part.startsWith(SSS_SOURCE_NOTE_PREFIX)) {
      sssContributionSource = part.slice(SSS_SOURCE_NOTE_PREFIX.length).trim();
      continue;
    }

    if (part.startsWith(SSS_SALARY_CREDIT_NOTE_PREFIX)) {
      sssSalaryCredit = part.slice(SSS_SALARY_CREDIT_NOTE_PREFIX.length).trim();
      continue;
    }

    if (part.startsWith(SSS_BRACKET_NOTE_PREFIX)) {
      sssBracketLabel = part.slice(SSS_BRACKET_NOTE_PREFIX.length).trim();
      continue;
    }

    if (part === "Manual Payroll Override") {
      isManualPayrollOverride = true;
      continue;
    }

    remainingNotes.push(part);
  }

  return {
    payComputationMode,
    isManualPayrollOverride,
    breakdownNotes: remainingNotes.length > 0 ? remainingNotes.join(" | ") : null,
    statutoryMonthlyCompensationBase,
    sssContributionSource,
    sssSalaryCredit,
    sssBracketLabel,
  };
}

export function getHoursPerDay(args: {
  hoursPerDay?: string | number | null;
  timekeeping?: typeof employeesTimekeeping.$inferSelect | null;
}) {
  const shiftHours = toAmount(args.hoursPerDay);
  if (shiftHours > 0) return shiftHours;

  const legacyHours = toAmount(args.timekeeping?.hoursWorked);
  if (legacyHours > 0) return legacyHours;

  return 8;
}

function countLeaveOverlapDays(
  record: {
    leaveStartDate: string | null;
    leaveEndDate: string | null;
    dateFiled: string;
    dayDetails?: Array<Pick<typeof employeeLeaveRecordDays.$inferSelect, "leaveDate" | "quantity">>;
  },
  startDate: string,
  endDate: string
) {
  if (record.dayDetails && record.dayDetails.length > 0) {
    return record.dayDetails.reduce((total, detail) => {
      if (detail.leaveDate < startDate || detail.leaveDate > endDate) {
        return total;
      }

      return total + toAmount(detail.quantity);
    }, 0);
  }

  const start = new Date(`${record.leaveStartDate ?? record.dateFiled}T00:00:00`);
  const end = new Date(
    `${record.leaveEndDate ?? record.leaveStartDate ?? record.dateFiled}T00:00:00`
  );
  const periodStart = new Date(`${startDate}T00:00:00`);
  const periodEnd = new Date(`${endDate}T00:00:00`);

  if (isAfter(start, periodEnd) || isBefore(end, periodStart)) {
    return 0;
  }

  const overlapStart = start > periodStart ? start : periodStart;
  const overlapEnd = end < periodEnd ? end : periodEnd;

  return eachDayOfInterval({ start: overlapStart, end: overlapEnd }).length;
}

function getLeaveTypeDisplayName(leave: {
  record: { leaveType: string | null };
  leaveType: typeof leaveTypes.$inferSelect | null;
}) {
  return (
    leave.leaveType?.name?.trim() ||
    leave.leaveType?.code?.trim() ||
    leave.record.leaveType?.trim() ||
    null
  );
}

function getLeaveTypeDescriptionSuffix(args: {
  leaves: Array<{
    record: {
      leaveStartDate: string | null;
      leaveEndDate: string | null;
      dateFiled: string;
      leaveType: string | null;
      dayDetails?: Array<Pick<typeof employeeLeaveRecordDays.$inferSelect, "leaveDate" | "quantity">>;
    };
    leaveType: typeof leaveTypes.$inferSelect | null;
    isPaid: boolean;
  }>;
  isPaid: boolean;
  periodStartDate: string;
  periodEndDate: string;
}) {
  const leaveTypeNames = [
    ...new Set(
      args.leaves
        .filter(
          (leave) =>
            leave.isPaid === args.isPaid &&
            countLeaveOverlapDays(
              leave.record,
              args.periodStartDate,
              args.periodEndDate
            ) > 0
        )
        .map(getLeaveTypeDisplayName)
        .filter((name): name is string => Boolean(name))
    ),
  ];

  return leaveTypeNames.length > 0 ? leaveTypeNames.join(", ") : null;
}

function appendLeaveTypeDescription(description: string, leaveTypeSuffix: string | null) {
  return leaveTypeSuffix ? `${description} - ${leaveTypeSuffix}` : description;
}

type ResolvedApprovedLeaveForPayroll = {
  record: typeof employeesLeaveRecords.$inferSelect & {
    leaveTypeLookup: typeof leaveTypes.$inferSelect | null;
    dayDetails?: Array<typeof employeeLeaveRecordDays.$inferSelect>;
  };
  leaveType: typeof leaveTypes.$inferSelect | null;
  isPaid: boolean;
  unresolved: boolean;
};

type LeavePayrollLineGroup = {
  accountCodeId: number | null;
  accountType: string | null;
  code: string;
  descriptionSuffix: string | null;
  days: number;
  taxable: boolean;
  month13thEligible: boolean;
};

function resolveLeavePayrollAccount(args: {
  leave: ResolvedApprovedLeaveForPayroll;
  accountCodes: Map<string, typeof accountCode.$inferSelect>;
}) {
  const mappedCode = getMappedLeavePayrollAccountCode({
    leaveType: args.leave.record.leaveType,
    leaveTypeLookup: args.leave.leaveType,
  });

  if (mappedCode) {
    const mappedAccount = args.accountCodes.get(mappedCode) ?? null;

    return {
      accountCodeId: mappedAccount?.id ?? null,
      accountType: mappedAccount?.accountType ?? null,
      code: mappedAccount?.accountCode ?? mappedCode,
      taxable: !(mappedAccount?.nonTaxable ?? false),
      month13thEligible: mappedAccount?.month13thPay ?? true,
    };
  }

  const fallbackAccount = getAccountCodeById(
    args.accountCodes,
    args.leave.leaveType?.accountCodeId
  );

  if (!fallbackAccount) return null;

  return {
    accountCodeId: fallbackAccount.id,
    accountType: fallbackAccount.accountType,
    code: fallbackAccount.accountCode,
    taxable: !fallbackAccount.nonTaxable,
    month13thEligible: fallbackAccount.month13thPay,
  };
}

function buildLeavePayrollLineGroups(args: {
  leaves: ResolvedApprovedLeaveForPayroll[];
  isPaid: boolean;
  approvedLeaveOverlapDays: Map<number, number>;
  accountCodes: Map<string, typeof accountCode.$inferSelect>;
  fallbackCode: string;
  fallbackDays: number;
  fallbackDescriptionSuffix: string | null;
  fallbackTaxable: boolean;
  fallbackMonth13thEligible: boolean;
}): LeavePayrollLineGroup[] {
  const groups = new Map<
    string,
    Omit<LeavePayrollLineGroup, "descriptionSuffix"> & { leaveNames: Set<string> }
  >();

  for (const leave of args.leaves) {
    if (leave.isPaid !== args.isPaid) continue;

    const days = args.approvedLeaveOverlapDays.get(leave.record.id) ?? 0;
    if (days <= 0) continue;

    const resolvedAccount = resolveLeavePayrollAccount({
      leave,
      accountCodes: args.accountCodes,
    });
    const code = resolvedAccount?.code ?? args.fallbackCode;
    const key = [
      resolvedAccount?.accountCodeId ?? "",
      resolvedAccount?.accountType ?? "",
      code,
      resolvedAccount?.taxable ?? args.fallbackTaxable,
      resolvedAccount?.month13thEligible ?? args.fallbackMonth13thEligible,
    ].join("|");
    const group =
      groups.get(key) ??
      {
        accountCodeId: resolvedAccount?.accountCodeId ?? null,
        accountType: resolvedAccount?.accountType ?? null,
        code,
        days: 0,
        taxable: resolvedAccount?.taxable ?? args.fallbackTaxable,
        month13thEligible:
          resolvedAccount?.month13thEligible ?? args.fallbackMonth13thEligible,
        leaveNames: new Set<string>(),
      };

    group.days = roundMoney(group.days + days);
    const leaveName = getLeaveTypeDisplayName(leave);
    if (leaveName) group.leaveNames.add(leaveName);
    groups.set(key, group);
  }

  if (groups.size === 0 && args.fallbackDays > 0) {
    return [
      {
        accountCodeId: null,
        accountType: null,
        code: args.fallbackCode,
        descriptionSuffix: args.fallbackDescriptionSuffix,
        days: args.fallbackDays,
        taxable: args.fallbackTaxable,
        month13thEligible: args.fallbackMonth13thEligible,
      },
    ];
  }

  return [...groups.values()]
    .map((group) => ({
      accountCodeId: group.accountCodeId,
      accountType: group.accountType,
      code: group.code,
      descriptionSuffix:
        group.leaveNames.size > 0 ? [...group.leaveNames].join(", ") : null,
      days: group.days,
      taxable: group.taxable,
      month13thEligible: group.month13thEligible,
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

function getExpectedWorkingDaysWithResolvedSchedules({
  startDate,
  endDate,
  assignments,
  weeklyPatterns,
  legacyTimekeeping,
  holidays,
  dayTypeByDate,
}: {
  startDate: string;
  endDate: string;
  assignments: ShiftAssignmentRecord[];
  weeklyPatterns: WeeklyShiftPatternRecord[];
  legacyTimekeeping: typeof employeesTimekeeping.$inferSelect | null;
  holidays: Set<string>;
  dayTypeByDate?: Map<string, AttendanceDtrDayType>;
}) {
  return eachDayOfInterval({
    start: new Date(`${startDate}T00:00:00`),
    end: new Date(`${endDate}T00:00:00`),
  }).filter((currentDate) =>
    isExpectedWorkingDateWithResolvedSchedules({
      attendanceDate: format(currentDate, "yyyy-MM-dd"),
      assignments,
      weeklyPatterns,
      legacyTimekeeping,
      holidays,
      dayTypeByDate,
    })
  ).length;
}

function isExpectedWorkingDateWithResolvedSchedules({
  attendanceDate,
  assignments,
  weeklyPatterns,
  legacyTimekeeping,
  holidays,
  dayTypeByDate,
}: {
  attendanceDate: string;
  assignments: ShiftAssignmentRecord[];
  weeklyPatterns: WeeklyShiftPatternRecord[];
  legacyTimekeeping: typeof employeesTimekeeping.$inferSelect | null;
  holidays: Set<string>;
  dayTypeByDate?: Map<string, AttendanceDtrDayType>;
}) {
  const effectiveDayType = dayTypeByDate?.get(attendanceDate);

  if (
    effectiveDayType
      ? isAttendanceDtrNonWorkingDayType(effectiveDayType)
      : holidays.has(attendanceDate)
  ) {
    return false;
  }

  const resolvedSchedule = resolveEmployeeScheduleForDate({
    attendanceDate,
    assignments,
    weeklyPatterns,
    legacyTimekeeping,
  });

  return !isResolvedScheduleRestDay(resolvedSchedule) && resolvedSchedule.hoursPerDay > 0;
}

function isRecurringEntryActive(
  entry: typeof employeesRecurringEntries.$inferSelect,
  startDate: string,
  endDate: string
) {
  if (entry.status !== "Active") return false;
  if (entry.startDate && entry.startDate > endDate) return false;
  if (entry.endDate && entry.endDate < startDate) return false;
  return true;
}

function getCustomPayrollScheduleFlags(group: ContributionGroupWithFlags) {
  const flags = group.flags;
  return {
    always: flags?.scheduleAlways ?? true,
    endOfMonth: flags?.scheduleEndOfMonth ?? false,
    firstPayroll: flags?.scheduleFirstPayroll ?? false,
    secondPayroll: flags?.scheduleSecondPayroll ?? false,
    thirdPayroll: flags?.scheduleThirdPayroll ?? false,
    forthPayroll: flags?.scheduleForthPayroll ?? false,
  } satisfies ScheduleFlagsLike;
}

function distributeCustomFixedPayrollAmount(
  totalAmount: number,
  cycle: "A" | "B",
  flags?: ScheduleFlagsLike
) {
  if (!flags || flags.always) {
    return roundMoney(totalAmount);
  }

  return isScheduleApplicable(cycle, flags) ? roundMoney(totalAmount) : 0;
}

function getBasisAmount({
  basisOfComputation,
  basisValue,
  grossPay,
  regularPay,
  monthlyRate,
}: {
  basisOfComputation: string;
  basisValue: number;
  grossPay: number;
  regularPay: number;
  monthlyRate: number;
}) {
  if (basisOfComputation === "Gross Pay") return grossPay;
  if (basisOfComputation === "Actual Basic Pay") return regularPay;
  if (basisOfComputation === "Monthly Rate") return monthlyRate;
  if (basisOfComputation === "Fixed Monthly Salary") return basisValue;
  if (basisOfComputation === "Fixed Contribution") return basisValue;
  return grossPay;
}

function getCustomContributionBasis(args: {
  group: ContributionGroupWithFlags | undefined;
  grossPay: number;
  regularPay: number;
  monthlyCompensationBase: number;
}) {
  if (!args.group) {
    return undefined;
  }

  return getBasisAmount({
    basisOfComputation: args.group.basisOfComputation,
    basisValue: toAmount(args.group.basisValue),
    grossPay: args.grossPay,
    regularPay: args.regularPay,
    monthlyRate: args.monthlyCompensationBase,
  });
}

function summarizeAttendanceDays(
  summaries: Array<typeof attendanceDailySummaries.$inferSelect>,
  fallbackScheduledMinutesPerDay: number
) {
  let presentDays = 0;
  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  let lateMinutes = 0;
  let undertimeMinutes = 0;
  let regularMinutes = 0;
  let overtimeMinutes = 0;

  for (const summary of summaries) {
    const scheduledMinutes =
      summary.scheduledMinutes > 0
        ? summary.scheduledMinutes
        : fallbackScheduledMinutesPerDay > 0
          ? fallbackScheduledMinutesPerDay
          : 480;

    if (!summary.isRestDay && (summary.workedMinutes > 0 || summary.regularMinutes > 0)) {
      presentDays += Math.max(1, roundMoney(summary.regularMinutes / scheduledMinutes));
    }

    if (!summary.isRestDay && summary.regularMinutes > 0) {
      regularMinutes += summary.regularMinutes;
    }

    if (summary.paidLeaveMinutes > 0) {
      paidLeaveDays += roundMoney(summary.paidLeaveMinutes / scheduledMinutes);
    }

    if (summary.unpaidLeaveMinutes > 0) {
      unpaidLeaveDays += roundMoney(summary.unpaidLeaveMinutes / scheduledMinutes);
    }

    lateMinutes += summary.lateMinutes;
    undertimeMinutes += summary.undertimeMinutes;
    overtimeMinutes += summary.overtimeMinutes;
  }

  const roundedPresentDays = roundMoney(presentDays);

  return {
    presentDays: roundedPresentDays,
    paidLeaveDays: roundMoney(paidLeaveDays),
    unpaidLeaveDays: roundMoney(unpaidLeaveDays),
    lateMinutes,
    undertimeMinutes,
    workedMinutes: computeNetDtrWorkedMinutes({
      presentDays: roundedPresentDays,
      lateMinutes,
      undertimeMinutes,
    }),
    regularMinutes,
    overtimeMinutes,
  };
}

function summarizeLateUndertimeDeduction(args: {
  summaries: Array<typeof attendanceDailySummaries.$inferSelect>;
  dailyRate: number;
  fallbackHoursPerDay: number;
  lateMinutesOverride?: number | null;
  undertimeMinutesOverride?: number | null;
}) {
  let totalLateMinutes = 0;
  let totalUndertimeMinutes = 0;
  let totalMinutes = 0;
  let totalAmount = 0;
  const rateValues = new Set<string>();

  for (const summary of args.summaries) {
    totalLateMinutes += summary.lateMinutes;
    totalUndertimeMinutes += summary.undertimeMinutes;
  }

  const hasMinuteOverride =
    args.lateMinutesOverride != null || args.undertimeMinutesOverride != null;
  const effectiveLateMinutes = args.lateMinutesOverride ?? totalLateMinutes;
  const effectiveUndertimeMinutes =
    args.undertimeMinutesOverride ?? totalUndertimeMinutes;

  if (hasMinuteOverride) {
    totalMinutes = effectiveLateMinutes + effectiveUndertimeMinutes;
    const hourlyRate =
      args.fallbackHoursPerDay > 0 ? args.dailyRate / args.fallbackHoursPerDay : 0;

    return {
      totalLateMinutes: effectiveLateMinutes,
      totalUndertimeMinutes: effectiveUndertimeMinutes,
      totalMinutes,
      totalAmount: roundMoney((totalMinutes / 60) * hourlyRate),
      rate: hourlyRate > 0 ? hourlyRate : null,
    };
  }

  for (const summary of args.summaries) {
    const minutes = summary.lateMinutes + summary.undertimeMinutes;
    if (minutes <= 0) continue;

    const hoursPerDay =
      summary.scheduledMinutes > 0
        ? summary.scheduledMinutes / 60
        : args.fallbackHoursPerDay > 0
          ? args.fallbackHoursPerDay
          : 8;
    const hourlyRate = hoursPerDay > 0 ? args.dailyRate / hoursPerDay : 0;

    totalMinutes += minutes;
    totalAmount += (minutes / 60) * hourlyRate;
    rateValues.add(String(hourlyRate));
  }

  return {
    totalLateMinutes,
    totalUndertimeMinutes,
    totalMinutes,
    totalAmount: roundMoney(totalAmount),
    rate: rateValues.size === 1 ? Number([...rateValues][0]) : null,
  };
}

function getDefaultOvertimeAccountCode(
  accountCodes: Map<string, typeof accountCode.$inferSelect>
) {
  return [...accountCodes.values()]
    .filter((item) => item.accountType === "Overtime")
    .sort((left, right) => left.accountCode.localeCompare(right.accountCode))[0] ?? null;
}

function buildAttendanceRegularOvertimeLine(args: {
  accountCodes: Map<string, typeof accountCode.$inferSelect>;
  overtimeMinutes: number;
  payComputationMode: PayrollComputationMode;
  hourlyRate: number;
  sourceTable: PayrollLineDraft["sourceTable"];
}) {
  const quantityMinutes = Math.max(0, args.overtimeMinutes);
  if (quantityMinutes <= 0) return null;

  const overtimeAccount = getDefaultOvertimeAccountCode(args.accountCodes);
  if (!overtimeAccount) {
    throw new Error(
      "Create an Overtime Account Code before computing Regular Overtime from DTR."
    );
  }

  const rateContext = {
    payComputationMode: args.payComputationMode,
    hourlyRate: args.hourlyRate,
  };
  const multiplier = getManualPayrollAccountRateMultiplier({
    account: overtimeAccount,
    rateContext,
  });
  const multiplierField =
    args.payComputationMode === "Monthly Rate" ? "Monthly Rate" : "Daily Rate";

  if (multiplier <= 0) {
    throw new Error(
      `Set a ${multiplierField} multiplier greater than zero for Overtime Account Code ${overtimeAccount.accountCode}.`
    );
  }

  if (args.hourlyRate <= 0) {
    throw new Error(
      "Cannot compute Regular Overtime because the employee hourly salary rate is zero."
    );
  }

  const quantityHours = roundMoney(quantityMinutes / 60);
  const overtimeRate = roundMoney(args.hourlyRate * multiplier);
  const amount = roundMoney(quantityHours * overtimeRate);
  if (amount <= 0) return null;

  return {
    lineType: "Earning",
    code: overtimeAccount.accountCode,
    description: "Regular Overtime",
    amount,
    quantity: quantityHours,
    rate: overtimeRate,
    taxable: !overtimeAccount.nonTaxable,
    month13thEligible: overtimeAccount.month13thPay,
    sourceTable: args.sourceTable,
  } satisfies PayrollLineDraft;
}

function buildPayrollExceptionLines(args: {
  attendanceByDate: Map<string, typeof attendanceDailySummaries.$inferSelect>;
  dayTypeByDate: Map<string, AttendanceDtrDayType>;
  exceptionRows: Array<typeof employeePayrollExceptionRows.$inferSelect>;
  overtimeRuleRows: Array<typeof overtimeRules.$inferSelect>;
  dailyRate: number;
  payComputationMode: PayrollComputationMode;
  hourlyRate: number;
  fallbackHoursPerDay: number;
  fallbackMinutesPerDay: number;
  accountCodes: Map<string, typeof accountCode.$inferSelect>;
}) {
  const lines: PayrollLineDraft[] = [];
  const accountCodesById = new Map(
    [...args.accountCodes.values()].map((item) => [item.id, item] as const)
  );

  for (const row of args.exceptionRows) {
    const summary = args.attendanceByDate.get(row.attendanceDate);
    const accountType = isPayrollExceptionAccountType(row.accountTypeSnapshot)
      ? row.accountTypeSnapshot
      : row.exceptionType === "OVERTIME"
        ? "Overtime"
        : null;
    const mappedAccount =
      (row.accountCodeId != null ? accountCodesById.get(row.accountCodeId) : null) ??
      args.accountCodes.get(row.accountCodeSnapshot) ??
      null;
    const isRestDay = summary?.isRestDay ?? false;
    const effectiveDayType = resolvePayrollExceptionPreviewDayType({
      accountType,
      savedDayType: row.dayType as AttendanceDtrDayType | null,
      fallbackDayType: args.dayTypeByDate.get(row.attendanceDate) ?? null,
      isRestDay,
    });
    const preview = computePayrollExceptionPreview({
      attendanceDate: row.attendanceDate,
      accountCode: row.accountCodeSnapshot,
      accountType,
      accountDescription: row.accountDescriptionSnapshot,
      overtimeCategory: row.overtimeCategory,
      quantityMinutes: row.quantityMinutes,
      amountOverride: row.amountOverride,
      scheduledMinutes: summary?.scheduledMinutes ?? args.fallbackMinutesPerDay,
      dailyRate: args.dailyRate,
      payComputationMode: args.payComputationMode,
      hourlyRate: args.hourlyRate,
      accountDailyRate: mappedAccount?.dailyRate ?? null,
      accountMonthlyRate: mappedAccount?.monthlyRate ?? null,
      fallbackHoursPerDay: args.fallbackHoursPerDay,
      fallbackMinutesPerDay: args.fallbackMinutesPerDay,
      overtimeRules: args.overtimeRuleRows,
      nonTaxable: row.accountNonTaxableSnapshot,
      month13thPay: row.accountMonth13thPaySnapshot,
      dayType: effectiveDayType,
      isRestDay,
      dtrOverrideSource: row.dtrOverrideSource,
    });

    if (preview.error) {
      throw new Error(`${preview.error} (${row.accountCodeSnapshot})`);
    }

    const hasQuantity = preview.quantity != null && preview.quantity > 0;
    const preserveZeroAmountUnpaidLeave =
      accountType === "Unpaid Leaves/Absences" && hasQuantity;
    const preserveZeroAmountDtrQuantityOnly =
      isPayrollExceptionDtrQuantityOnlyDeductionSource(row.dtrOverrideSource) &&
      hasQuantity;
    if (
      preview.amount <= 0 &&
      !preserveZeroAmountUnpaidLeave &&
      !preserveZeroAmountDtrQuantityOnly
    ) {
      continue;
    }

    lines.push({
      accountCodeId: row.accountCodeId,
      accountType,
      lineType: preview.lineType,
      code: preview.code,
      description: preview.description,
      amount: preview.amount,
      quantity: preview.quantity,
      rate: preview.rate,
      taxable: preview.taxable,
      month13thEligible: preview.month13thEligible,
      sourceTable: "employee_payroll_exception_rows",
      sourceId: row.id,
    });
  }

  return lines;
}

function getAccountCodeById(
  accountCodes: Map<string, typeof accountCode.$inferSelect>,
  accountCodeId: number | null | undefined
) {
  if (accountCodeId == null) return null;

  for (const item of accountCodes.values()) {
    if (item.id === accountCodeId) return item;
  }

  return null;
}

function buildLoanDeductionLine(args: {
  installment: LoanInstallmentWithLoan;
  accountCodes: Map<string, typeof accountCode.$inferSelect>;
}): PayrollLineDraft | null {
  const { installment } = args;
  const amount = roundMoney(toAmount(installment.scheduledAmount));
  if (amount <= 0) return null;

  const loanAccount = getAccountCodeById(
    args.accountCodes,
    installment.loan.accountCodeId
  );
  const code = loanAccount?.accountCode.trim() || "LOAN";
  const description = loanAccount?.description?.trim() || code;
  const isLoanAccount = loanAccount?.accountType === "Loan";

  return {
    accountCodeId: loanAccount?.id ?? null,
    accountType: loanAccount?.accountType ?? null,
    lineType: "Deduction",
    code,
    description,
    amount,
    taxable: false,
    month13thEligible: false,
    loanRefNo: isLoanAccount ? installment.loan.loanReferenceNumber : null,
    sourceTable: "loan_installments",
    sourceId: installment.id,
  };
}

async function loadCustomPayrollMap(customPayrollIds: number[]) {
  if (customPayrollIds.length === 0) {
    return new Map<number, { id: number; code: string; groups: ContributionGroupWithFlags[] }>();
  }

  const definitions = await db.query.customPayrollDefinitions.findMany({
    where: inArray(customPayrollDefinitions.id, customPayrollIds),
    with: {
      contributionGroups: {
        with: {
          flags: true,
        },
      },
    },
  });

  return new Map(
    definitions.map((definition) => [
      definition.id,
      {
        id: definition.id,
        code: definition.code,
        groups: definition.contributionGroups as ContributionGroupWithFlags[],
      },
    ])
  );
}

async function getPriorCycleTaxContext(
  period: typeof payrollPeriods.$inferSelect,
  employeeId: string
) {
  if (period.cycle !== "B") {
    return { previousTaxable: 0, previousTaxWithheld: 0 };
  }

  const priorPeriodCode = `${period.year}-${String(period.month).padStart(2, "0")}-A`;

  const previousRunEmployee = await db
    .select({
      taxablePay: payrollRunEmployees.taxablePay,
      id: payrollRunEmployees.id,
    })
    .from(payrollRunEmployees)
    .innerJoin(payrollRuns, eq(payrollRunEmployees.payrollRunId, payrollRuns.id))
    .innerJoin(payrollPeriods, eq(payrollRuns.payrollPeriodId, payrollPeriods.id))
    .where(
      and(
        eq(payrollRunEmployees.employeeId, employeeId),
        eq(payrollPeriods.code, priorPeriodCode),
        ne(payrollRuns.status, "Void")
      )
    )
    .orderBy(desc(payrollRuns.createdAt))
    .limit(1);

  const priorEmployee = previousRunEmployee[0];
  if (!priorEmployee) {
    return { previousTaxable: 0, previousTaxWithheld: 0 };
  }

  const [previousTax] = await db
    .select({
      amount: payrollRunLines.amount,
    })
    .from(payrollRunLines)
    .where(
      and(
        eq(payrollRunLines.payrollRunEmployeeId, priorEmployee.id),
        eq(payrollRunLines.code, "TAX")
      )
    )
    .limit(1);

  return {
    previousTaxable: toAmount(priorEmployee.taxablePay),
    previousTaxWithheld: toAmount(previousTax?.amount),
  };
}

type PriorCycleTaxContext = { previousTaxable: number; previousTaxWithheld: number };

async function batchLoadPriorCycleTaxContext(
  period: typeof payrollPeriods.$inferSelect,
  employeeIds: string[]
): Promise<Map<string, PriorCycleTaxContext>> {
  const result = new Map<string, PriorCycleTaxContext>();
  if (period.cycle !== "B" || employeeIds.length === 0) return result;

  const priorPeriodCode = `${period.year}-${String(period.month).padStart(2, "0")}-A`;

  // Single query for all employees' prior-cycle run records
  const priorRunRows = await db
    .select({
      employeeId: payrollRunEmployees.employeeId,
      taxablePay: payrollRunEmployees.taxablePay,
      runEmployeeId: payrollRunEmployees.id,
      runCreatedAt: payrollRuns.createdAt,
    })
    .from(payrollRunEmployees)
    .innerJoin(payrollRuns, eq(payrollRunEmployees.payrollRunId, payrollRuns.id))
    .innerJoin(payrollPeriods, eq(payrollRuns.payrollPeriodId, payrollPeriods.id))
    .where(
      and(
        inArray(payrollRunEmployees.employeeId, employeeIds),
        eq(payrollPeriods.code, priorPeriodCode),
        ne(payrollRuns.status, "Void")
      )
    )
    .orderBy(desc(payrollRuns.createdAt));

  // Keep only the latest run per employee (rows are already ordered by createdAt desc)
  const latestByEmployee = new Map<string, typeof priorRunRows[number]>();
  for (const row of priorRunRows) {
    if (!latestByEmployee.has(row.employeeId)) {
      latestByEmployee.set(row.employeeId, row);
    }
  }

  const runEmployeeIds = [...latestByEmployee.values()].map((r) => r.runEmployeeId);
  if (runEmployeeIds.length === 0) return result;

  // Single query for TAX lines across all prior-cycle run employees
  const taxLines = await db
    .select({
      payrollRunEmployeeId: payrollRunLines.payrollRunEmployeeId,
      amount: payrollRunLines.amount,
    })
    .from(payrollRunLines)
    .where(
      and(
        inArray(payrollRunLines.payrollRunEmployeeId, runEmployeeIds),
        eq(payrollRunLines.code, "TAX")
      )
    );

  const taxByRunEmployeeId = new Map(taxLines.map((t) => [t.payrollRunEmployeeId, t]));

  for (const [employeeId, row] of latestByEmployee) {
    const tax = taxByRunEmployeeId.get(row.runEmployeeId);
    result.set(employeeId, {
      previousTaxable: toAmount(row.taxablePay),
      previousTaxWithheld: toAmount(tax?.amount),
    });
  }

  return result;
}

async function computeEmployeePayroll({
  employee,
  resolvedSalary,
  period,
  holidays,
  shiftAssignments,
  weeklyPatterns,
  attendance,
  attendancePeriodOverride,
  attendanceStatusOverridesByDate,
  attendanceDayTypeOverridesByDate,
  calendarDayTypeByDate,
  payrollExceptionRows,
  overtimeRuleRows,
  approvedLeaves,
  leaveTypesByCode,
  recurringEntries,
  dueInstallments,
  accountCodes,
  customPayrollMap,
  statutoryBundle,
  priorCycleTaxContext,
}: {
  employee: EmployeeRecord;
  resolvedSalary: ResolvedSalaryForPeriod;
  period: typeof payrollPeriods.$inferSelect;
  holidays: Set<string>;
  shiftAssignments: ShiftAssignmentRecord[];
  weeklyPatterns: WeeklyShiftPatternRecord[];
  attendance: Array<typeof attendanceDailySummaries.$inferSelect>;
  attendancePeriodOverride?: typeof employeeAttendancePeriodOverrides.$inferSelect | null;
  attendanceStatusOverridesByDate: Map<string, AttendanceDtrManualStatus>;
  attendanceDayTypeOverridesByDate: Map<string, AttendanceDtrDayType>;
  calendarDayTypeByDate: Map<string, AttendanceDtrDayType>;
  payrollExceptionRows: Array<typeof employeePayrollExceptionRows.$inferSelect>;
  overtimeRuleRows: Array<typeof overtimeRules.$inferSelect>;
  approvedLeaves: Array<
    typeof employeesLeaveRecords.$inferSelect & {
      leaveTypeLookup: typeof leaveTypes.$inferSelect | null;
      dayDetails?: Array<typeof employeeLeaveRecordDays.$inferSelect>;
    }
  >;
  leaveTypesByCode: Map<string, typeof leaveTypes.$inferSelect>;
  recurringEntries: Array<typeof employeesRecurringEntries.$inferSelect>;
  dueInstallments: LoanInstallmentWithLoan[];
  accountCodes: Map<string, typeof accountCode.$inferSelect>;
  customPayrollMap: Map<number, { id: number; code: string; groups: ContributionGroupWithFlags[] }>;
  statutoryBundle: ActiveStatutoryRuleBundle;
  priorCycleTaxContext?: Map<string, PriorCycleTaxContext>;
}): Promise<EmployeePayrollComputation> {
  const salary = resolvedSalary.salary ?? (employee.salary ?? undefined);
  const primaryResolvedSchedule = getPrimaryResolvedScheduleForPeriod({
    assignments: shiftAssignments,
    weeklyPatterns,
    legacyTimekeeping: employee.timekeeping ?? null,
    startDate: period.startDate,
    endDate: period.endDate,
  });
  const hoursPerDay = getHoursPerDay({
    hoursPerDay: primaryResolvedSchedule.hoursPerDay,
    timekeeping: employee.timekeeping,
  });
  const scheduledMinutesPerDay = Math.round(hoursPerDay * 60);
  const dailyRate = getDailyRate(salary);
  const monthlyRate = toAmount(salary?.monthlyRate);
  const monthlyAllowance = toAmount(salary?.monthlyAllowance);
  const dailyAllowance = toAmount(salary?.dailyAllowance);
  const cola = toAmount(salary?.cola);
  const attendanceByDate = new Map(
    attendance.map((summary) => [summary.attendanceDate, summary])
  );
  const periodDates = eachDayOfInterval({
    start: new Date(`${period.startDate}T00:00:00`),
    end: new Date(`${period.endDate}T00:00:00`),
  }).map((currentDate) => format(currentDate, "yyyy-MM-dd"));
  const effectiveDayTypeByDate = new Map<string, AttendanceDtrDayType>();

  for (const attendanceDate of periodDates) {
    const effectiveDayType =
      attendanceDayTypeOverridesByDate.get(attendanceDate) ??
      calendarDayTypeByDate.get(attendanceDate) ??
      "Regular Day";

    effectiveDayTypeByDate.set(attendanceDate, effectiveDayType);
  }

  for (const attendanceDate of attendanceStatusOverridesByDate.keys()) {
    if (attendanceByDate.has(attendanceDate)) continue;

    attendanceByDate.set(attendanceDate, {
      id: `manual-${employee.id}-${attendanceDate}`,
      employeeId: employee.id,
      shiftAssignmentId: null,
      sourceBatchId: null,
      attendanceDate,
      firstInAt: null,
      lastOutAt: null,
      scheduledInTime: null,
      scheduledOutTime: null,
      scheduledMinutes: scheduledMinutesPerDay,
      workedMinutes: 0,
      regularMinutes: 0,
      lateMinutes: 0,
      undertimeMinutes: 0,
      overtimeMinutes: 0,
      nightMinutes: 0,
      paidLeaveMinutes: 0,
      unpaidLeaveMinutes: 0,
      absentMinutes: scheduledMinutesPerDay,
      isRestDay: false,
      anomalyFlags: "NO_LOGS",
      remarks: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  const effectiveAttendance = [...attendanceByDate.values()].map((summary) =>
    applyAttendanceDtrEffectiveStatus(
      summary,
      attendanceStatusOverridesByDate.get(summary.attendanceDate) ?? null
    )
  );
  const effectiveAttendanceByDate = new Map(
    effectiveAttendance.map((summary) => [summary.attendanceDate, summary] as const)
  );

  const periodOverride = normalizeAttendanceDtrPeriodOverride(attendancePeriodOverride);
  const attendanceSummary = summarizeAttendanceDays(
    effectiveAttendance,
    scheduledMinutesPerDay
  );
  const lateUndertimeSummary = summarizeLateUndertimeDeduction({
    summaries: effectiveAttendance,
    dailyRate,
    fallbackHoursPerDay: hoursPerDay,
    lateMinutesOverride: periodOverride.lateMinutes,
    undertimeMinutesOverride: periodOverride.undertimeMinutes,
  });
  const resolvedApprovedLeaves = approvedLeaves.map((record) => ({
    record,
    ...resolveLeavePayStatus(record, leaveTypesByCode),
  }));
  // Cache overlap days per leave record — same period bounds for all, avoid repeated eachDayOfInterval calls
  const approvedLeaveOverlapDays = new Map(
    resolvedApprovedLeaves.map(l => [l.record.id, countLeaveOverlapDays(l.record, period.startDate, period.endDate)])
  );
  const unresolvedLeaveCount = resolvedApprovedLeaves.filter(
    (leave) => leave.unresolved
  ).length;
  const paidLeaveDaysFromRecords = resolvedApprovedLeaves
    .filter((leave) => leave.isPaid)
    .reduce(
      (total, leave) => total + (approvedLeaveOverlapDays.get(leave.record.id) ?? 0),
      0
    );
  const unpaidLeaveDaysFromRecords = resolvedApprovedLeaves
    .filter((leave) => !leave.isPaid)
    .reduce(
      (total, leave) => total + (approvedLeaveOverlapDays.get(leave.record.id) ?? 0),
      0
    );
  const paidLeaveTypeDescription = getLeaveTypeDescriptionSuffix({
    leaves: resolvedApprovedLeaves,
    isPaid: true,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
  });
  const unpaidLeaveTypeDescription = getLeaveTypeDescriptionSuffix({
    leaves: resolvedApprovedLeaves,
    isPaid: false,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
  });

  const computedExpectedWorkingDays = getExpectedWorkingDaysWithResolvedSchedules({
    startDate: period.startDate,
    endDate: period.endDate,
    assignments: shiftAssignments,
    weeklyPatterns,
    legacyTimekeeping: employee.timekeeping ?? null,
    holidays,
    dayTypeByDate: effectiveDayTypeByDate,
  });
  const manualRestDayWorkingDateCount = [
    ...attendanceStatusOverridesByDate.entries(),
  ].filter(
    ([attendanceDate, status]) =>
      (status === "Rest Day" || status === "Rest Day Work") &&
      isExpectedWorkingDateWithResolvedSchedules({
        attendanceDate,
        assignments: shiftAssignments,
        weeklyPatterns,
        legacyTimekeeping: employee.timekeeping ?? null,
        holidays,
        dayTypeByDate: effectiveDayTypeByDate,
      })
  ).length;
  const expectedWorkingDays = Math.max(
    0,
    computedExpectedWorkingDays - manualRestDayWorkingDateCount
  );
  const presentDays = periodOverride.presentDays ?? attendanceSummary.presentDays;
  const regularOvertimeMinutes =
    periodOverride.overtimeMinutes ?? attendanceSummary.overtimeMinutes;
  const effectiveLateMinutes =
    periodOverride.lateMinutes ?? attendanceSummary.lateMinutes;
  const effectiveUndertimeMinutes =
    periodOverride.undertimeMinutes ?? attendanceSummary.undertimeMinutes;
  const effectiveWorkedMinutes = computeNetDtrWorkedMinutes({
    presentDays: attendanceSummary.presentDays,
    lateMinutes: effectiveLateMinutes,
    undertimeMinutes: effectiveUndertimeMinutes,
    workedMinutesOverride: periodOverride.workedMinutes,
  });
  const regularPayMinutes = Math.max(0, effectiveWorkedMinutes);
  const regularPayHours = roundMoney(regularPayMinutes / 60);
  const hourlyRate = hoursPerDay > 0 ? dailyRate / hoursPerDay : 0;
  const useRecordBackedLeaveDays = resolvedApprovedLeaves.length > 0;
  const paidLeaveDays = roundMoney(
    useRecordBackedLeaveDays ? paidLeaveDaysFromRecords : attendanceSummary.paidLeaveDays
  );
  const unpaidLeaveDays = roundMoney(
    useRecordBackedLeaveDays
      ? unpaidLeaveDaysFromRecords
      : attendanceSummary.unpaidLeaveDays
  );
  const derivedAbsentDays = Math.max(
    0,
    roundMoney(expectedWorkingDays - presentDays - paidLeaveDays - unpaidLeaveDays)
  );

  const lines: PayrollLineDraft[] = [];
  if (resolvedSalary.adjustmentId != null) {
    lines.push({
      lineType: "Information",
      code: "SAL-ADJ",
      description:
        resolvedSalary.adjustmentMode === "OnePeriodOverride"
          ? "Salary Adjustment Applied (One-Period Override)"
          : resolvedSalary.adjustmentMode === "MultiPeriodOverride"
            ? "Salary Adjustment Applied (Multi-Period Override)"
            : "Salary Adjustment Applied (Forward Effective)",
      amount: 0,
      sourceTable: "employee_salary_changes",
      sourceId: String(resolvedSalary.adjustmentId),
    });
  }
  const isMonthlyEmployee = monthlyRate > 0;
  const ignoreDtrForMonthlyRate =
    isMonthlyEmployee && salary?.ignoreDtrForMonthlyRate === true;
  const ignoreContributionDeduction =
    salary?.ignoreContributionDeduction === true;
  const regularPayLineAmount = isMonthlyEmployee
    ? roundMoney(monthlyRate / 2)
    : roundMoney(regularPayHours * hourlyRate);
  const paidLeavePay = isMonthlyEmployee
    ? 0
    : roundMoney(dailyRate * paidLeaveDays);
  const regularPay = isMonthlyEmployee
    ? regularPayLineAmount
    : roundMoney(regularPayLineAmount + paidLeavePay);
  const payComputationMode: PayrollComputationMode = isMonthlyEmployee
    ? "Monthly Rate"
    : "Daily Rate";
  const paidLeaveLineGroups = buildLeavePayrollLineGroups({
    leaves: resolvedApprovedLeaves,
    isPaid: true,
    approvedLeaveOverlapDays,
    accountCodes,
    fallbackCode: "P-LEAVE",
    fallbackDays: paidLeaveDays,
    fallbackDescriptionSuffix: paidLeaveTypeDescription,
    fallbackTaxable: true,
    fallbackMonth13thEligible: true,
  });
  const unpaidLeaveLineGroups = buildLeavePayrollLineGroups({
    leaves: resolvedApprovedLeaves,
    isPaid: false,
    approvedLeaveOverlapDays,
    accountCodes,
    fallbackCode: "U-LEAVE",
    fallbackDays: unpaidLeaveDays,
    fallbackDescriptionSuffix: unpaidLeaveTypeDescription,
    fallbackTaxable: false,
    fallbackMonth13thEligible: false,
  });
  const payrollExceptionRowsForPay = payrollExceptionRows;
  const hasGeneratedWorkedRow = payrollExceptionRowsForPay.some(
    (row) => row.dtrOverrideSource === "DTR_WORKED"
  );
  const hasGeneratedRegularOvertimeRow = payrollExceptionRowsForPay.some(
    (row) => row.dtrOverrideSource === "DTR_REGULAR_OVERTIME"
  );
  const hasGeneratedTardinessRow = payrollExceptionRowsForPay.some(
    (row) => row.dtrOverrideSource === "DTR_TARDINESS"
  );
  const hasGeneratedUndertimeRow = payrollExceptionRowsForPay.some(
    (row) => row.dtrOverrideSource === "DTR_UNDERTIME"
  );

  if (regularPayLineAmount > 0 && !hasGeneratedWorkedRow) {
    lines.push({
      lineType: "Earning",
      code: "REG",
      description: isMonthlyEmployee
        ? "Regular Pay"
        : "Regular Pay (Worked Hours)",
      amount: regularPayLineAmount,
      quantity: isMonthlyEmployee ? 1 : regularPayHours,
      rate: isMonthlyEmployee ? monthlyRate : hourlyRate,
      taxable: true,
      month13thEligible: true,
      sourceTable: isMonthlyEmployee ? null : "attendance_daily_summaries",
    });
  }

  if (
    !ignoreDtrForMonthlyRate &&
    regularOvertimeMinutes > 0 &&
    !hasGeneratedRegularOvertimeRow
  ) {
    const regularOvertimeLine = buildAttendanceRegularOvertimeLine({
      accountCodes,
      overtimeMinutes: regularOvertimeMinutes,
      payComputationMode,
      hourlyRate,
      sourceTable:
        periodOverride.overtimeMinutes != null
          ? "employee_attendance_period_overrides"
          : "attendance_daily_summaries",
    });

    if (regularOvertimeLine) {
      lines.push(regularOvertimeLine);
    }
  }

  for (const leaveGroup of paidLeaveLineGroups) {
    const paidLeaveGroupPay = roundMoney(dailyRate * leaveGroup.days);

    if (isMonthlyEmployee || paidLeaveGroupPay <= 0) continue;

    lines.push({
      accountCodeId: leaveGroup.accountCodeId,
      accountType: leaveGroup.accountType,
      lineType: "Earning",
      code: leaveGroup.code,
      description: appendLeaveTypeDescription(
        "Paid Leave Compensation",
        leaveGroup.descriptionSuffix
      ),
      amount: paidLeaveGroupPay,
      quantity: leaveGroup.days,
      rate: dailyRate,
      taxable: leaveGroup.taxable,
      month13thEligible: leaveGroup.month13thEligible,
      sourceTable: "employees_leave_records",
    });
  }

  if (isMonthlyEmployee && !ignoreDtrForMonthlyRate) {
    for (const leaveGroup of paidLeaveLineGroups) {
      if (leaveGroup.days <= 0) continue;

      lines.push({
        accountCodeId: leaveGroup.accountCodeId,
        accountType: leaveGroup.accountType,
        lineType: "Information",
        code: leaveGroup.code,
        description: appendLeaveTypeDescription(
          "Paid Leave (Audit Only)",
          leaveGroup.descriptionSuffix
        ),
        amount: 0,
        quantity: leaveGroup.days,
        rate: dailyRate,
        taxable: false,
        month13thEligible: false,
        sourceTable: "employees_leave_records",
      });
    }
  }

  if (!isMonthlyEmployee) {
    for (const leaveGroup of unpaidLeaveLineGroups) {
      if (leaveGroup.days <= 0) continue;

      lines.push({
        accountCodeId: leaveGroup.accountCodeId,
        accountType: leaveGroup.accountType,
        lineType: "Information",
        code: leaveGroup.code,
        description: appendLeaveTypeDescription(
          "Unpaid Leave (Audit Only)",
          leaveGroup.descriptionSuffix
        ),
        amount: 0,
        quantity: leaveGroup.days,
        rate: dailyRate,
        taxable: false,
        month13thEligible: false,
        sourceTable: "employees_leave_records",
      });
    }
  }

  if (isMonthlyEmployee && !ignoreDtrForMonthlyRate) {
    for (const leaveGroup of unpaidLeaveLineGroups) {
      const unpaidLeaveDeduction = roundMoney(leaveGroup.days * dailyRate);

      if (unpaidLeaveDeduction > 0) {
        lines.push({
          accountCodeId: leaveGroup.accountCodeId,
          accountType: leaveGroup.accountType,
          lineType: "Deduction",
          code: leaveGroup.code,
          description: appendLeaveTypeDescription(
            "Unpaid Leave",
            leaveGroup.descriptionSuffix
          ),
          amount: unpaidLeaveDeduction,
          quantity: leaveGroup.days,
          rate: dailyRate,
          taxable: false,
          month13thEligible: false,
          sourceTable: "employees_leave_records",
        });
      }
    }
  }

  if (!ignoreDtrForMonthlyRate) {
    lines.push(
      ...buildPayrollExceptionLines({
        attendanceByDate: effectiveAttendanceByDate,
        dayTypeByDate: effectiveDayTypeByDate,
        exceptionRows: payrollExceptionRowsForPay,
        overtimeRuleRows,
        dailyRate,
        payComputationMode,
        hourlyRate,
        fallbackHoursPerDay: hoursPerDay,
        fallbackMinutesPerDay: scheduledMinutesPerDay,
        accountCodes,
      })
    );
  }

  if (monthlyAllowance > 0) {
    lines.push({
      lineType: "Earning",
      code: "M-ALLOW",
      description: "Monthly Allowance",
      amount: roundMoney(monthlyAllowance / 2),
      quantity: 1,
      rate: monthlyAllowance,
      taxable: true,
      month13thEligible: false,
    });
  }

  if (
    !ignoreDtrForMonthlyRate &&
    dailyAllowance > 0 &&
    presentDays + paidLeaveDays > 0
  ) {
    lines.push({
      lineType: "Earning",
      code: "D-ALLOW",
      description: "Daily Allowance",
      amount: roundMoney(dailyAllowance * (presentDays + paidLeaveDays)),
      quantity: presentDays + paidLeaveDays,
      rate: dailyAllowance,
      taxable: false,
      month13thEligible: false,
    });
  }

  if (!ignoreDtrForMonthlyRate && cola > 0 && presentDays + paidLeaveDays > 0) {
    lines.push({
      lineType: "Earning",
      code: "COLA",
      description: "COLA",
      amount: roundMoney(cola * (presentDays + paidLeaveDays)),
      quantity: presentDays + paidLeaveDays,
      rate: cola,
      taxable: false,
      month13thEligible: false,
    });
  }

  const lateUndertimePotentialIncome = lateUndertimeSummary.totalAmount;
  if (
    !ignoreDtrForMonthlyRate &&
    lateUndertimePotentialIncome > 0 &&
    !hasGeneratedTardinessRow &&
    !hasGeneratedUndertimeRow
  ) {
    lines.push({
      lineType: "Information",
      code: "LATE-UT",
      description: "Late / Undertime Potential Income",
      amount: lateUndertimePotentialIncome,
      quantity: lateUndertimeSummary.totalMinutes,
      rate: lateUndertimeSummary.rate,
      sourceTable: "attendance_daily_summaries",
    });
  }

  if (isMonthlyEmployee && !ignoreDtrForMonthlyRate && derivedAbsentDays > 0) {
    const absenceDeduction = roundMoney(derivedAbsentDays * dailyRate);

    if (absenceDeduction > 0) {
      lines.push({
        lineType: "Deduction",
        code: "ABS",
        description: "Absence",
        amount: absenceDeduction,
        quantity: derivedAbsentDays,
        rate: dailyRate,
      });
    }
  }

  for (const entry of recurringEntries) {
    if (!isRecurringEntryActive(entry, period.startDate, period.endDate)) continue;

    const mappedAccount = entry.accountCode ? accountCodes.get(entry.accountCode) : undefined;
    const amount = roundMoney(toAmount(entry.amount));
    if (amount <= 0) continue;

    const accountType = mappedAccount?.accountType ?? "Other Deduction";
    const isEarning = [
      "Regular Hours",
      "Overtime",
      "Night Premium",
      "Sunday/Holiday",
      "Paid Leaves",
      "Other Income",
    ].includes(accountType);

    lines.push({
      lineType: isEarning ? "Earning" : "Deduction",
      code: entry.accountCode ?? "RECUR",
      description: entry.description ?? mappedAccount?.description ?? "Recurring Entry",
      amount,
      taxable: mappedAccount ? !mappedAccount.nonTaxable : !isEarning,
      month13thEligible: mappedAccount?.month13thPay ?? false,
      sourceTable: "employees_recurring_entries",
      sourceId: String(entry.id),
    });
  }

  for (const installment of dueInstallments) {
    const loanLine = buildLoanDeductionLine({ installment, accountCodes });
    if (loanLine) lines.push(loanLine);
  }

  const customPayroll =
    salary?.customPayrollId != null
      ? customPayrollMap.get(salary.customPayrollId)
      : undefined;
  const grossPay = roundMoney(
    lines
      .filter((line) => line.lineType === "Earning")
      .reduce((total, line) => total + line.amount, 0)
  );
  const nonTaxablePay = roundMoney(
    lines
      .filter((line) => line.lineType === "Earning" && !line.taxable)
      .reduce((total, line) => total + line.amount, 0)
  );
  const taxableEarningsBeforeGov = roundMoney(grossPay - nonTaxablePay);
  // Statutory deductions stay on a monthly compensation basis, even when the
  // employee is paid semi-monthly or is on a daily-rate payroll setup.
  const monthlyCompensationBase = monthlyRate || roundMoney(dailyRate * getRateDivisor(salary));
  const contributionGroups = new Map(
    (customPayroll?.groups ?? []).map((group) => [group.contributionType, group])
  );
  const contributionBasis: ContributionBasisSnapshot = {};
  for (const contributionType of [
    "SSS",
    "PHILHEALTH",
    "PAGIBIG",
    "TAX",
    "PERAA",
  ] as const satisfies readonly ContributionType[]) {
    if (ignoreContributionDeduction && contributionType !== "PERAA") {
      contributionBasis[contributionType] = 0;
      continue;
    }

    const basis = getCustomContributionBasis({
      group: contributionGroups.get(contributionType),
      grossPay,
      regularPay,
      monthlyCompensationBase,
    });

    if (basis != null) {
      contributionBasis[contributionType] = roundMoney(basis);
    }
  }
  let sssEmployee = 0;
  let sssEmployer = 0;
  let sssEc = 0;
  let sssContributionSource: string | null = null;
  let sssSalaryCredit: number | null = null;
  let sssRangeFrom: number | null = null;
  let sssRangeTo: number | null = null;
  let philhealthEmployee = 0;
  let philhealthEmployer = 0;
  let pagibigEmployee = 0;
  let pagibigEmployer = 0;

  const statutoryConfigs = [
    { type: "SSS" as const, versionId: statutoryBundle.sssVersionId },
    { type: "PHILHEALTH" as const, versionId: statutoryBundle.philhealthVersionId },
    { type: "PAGIBIG" as const, versionId: statutoryBundle.pagibigVersionId },
  ];

  // Pre-fetch all three statutory DB lookups in parallel to avoid sequential awaits in the loop
  const sssGroup = contributionGroups.get("SSS");
  const phGroup = contributionGroups.get("PHILHEALTH");
  const pgGroup = contributionGroups.get("PAGIBIG");
  const hasCustomFixed = (g: typeof sssGroup) =>
    g ? [g.fixedEmployeeShare, g.fixedEmployerShare, g.fixedECShare].some((v) => toAmount(v) > 0) : false;
  const [sssStatutoryResult, philhealthStatutoryResult, pagibigStatutoryResult] = await Promise.all([
    !ignoreContributionDeduction && !hasCustomFixed(sssGroup) && statutoryBundle.sssVersionId
      ? computeSssContribution(monthlyCompensationBase, statutoryBundle.sssVersionId)
      : Promise.resolve(null),
    !ignoreContributionDeduction && !hasCustomFixed(phGroup) && statutoryBundle.philhealthVersionId
      ? computePhilhealthContribution(monthlyCompensationBase, statutoryBundle.philhealthVersionId)
      : Promise.resolve(null),
    !ignoreContributionDeduction && !hasCustomFixed(pgGroup) && statutoryBundle.pagibigVersionId
      ? computePagibigContribution(monthlyCompensationBase, statutoryBundle.pagibigVersionId)
      : Promise.resolve(null),
  ]);

  for (const config of statutoryConfigs) {
    if (ignoreContributionDeduction) continue;

    const group = contributionGroups.get(config.type);
    const flags = group ? getCustomPayrollScheduleFlags(group) : undefined;
    const hasCustomFixedShares = group
      ? [
          group.fixedEmployeeShare,
          group.fixedEmployerShare,
          group.fixedECShare,
        ].some((value) => toAmount(value) > 0)
      : false;
    let employeeShare = 0;
    let employerShare = 0;
    let ecShare = 0;

    if (group && hasCustomFixedShares) {
      employeeShare = toAmount(group.fixedEmployeeShare);
      employerShare = toAmount(group.fixedEmployerShare);
      ecShare = toAmount(group.fixedECShare);
      if (config.type === "SSS") {
        sssContributionSource = SSS_SOURCE_CUSTOM_FIXED;
      }
    } else if (config.versionId) {
      if (config.type === "SSS" && sssStatutoryResult) {
        employeeShare = sssStatutoryResult.employeeShare;
        employerShare = sssStatutoryResult.employerShare;
        ecShare = sssStatutoryResult.ecShare;
        sssContributionSource = SSS_SOURCE_STATUTORY;
        sssSalaryCredit = sssStatutoryResult.salaryCredit;
        sssRangeFrom = sssStatutoryResult.rangeFrom;
        sssRangeTo = sssStatutoryResult.rangeTo;
      }

      if (config.type === "PHILHEALTH" && philhealthStatutoryResult) {
        employeeShare = philhealthStatutoryResult.employeeShare;
        employerShare = philhealthStatutoryResult.employerShare;
      }

      if (config.type === "PAGIBIG" && pagibigStatutoryResult) {
        employeeShare = pagibigStatutoryResult.employeeShare;
        employerShare = pagibigStatutoryResult.employerShare;
      }
    }

    const distributeContributionAmount = hasCustomFixedShares
      ? distributeCustomFixedPayrollAmount
      : distributeScheduledAmount;
    const employeePeriodShare = distributeContributionAmount(employeeShare, period.cycle, flags);
    const employerPeriodShare = distributeContributionAmount(employerShare, period.cycle, flags);
    const ecPeriodShare =
      config.type === "SSS" && !hasCustomFixedShares
        ? roundMoney(ecShare)
        : distributeContributionAmount(ecShare, period.cycle, flags);

    if (employeePeriodShare > 0) {
      lines.push({
        lineType: "Deduction",
        code: config.type,
        description: `${config.type} Employee Share`,
        amount: employeePeriodShare,
        sourceTable: group ? "employee_contribution_groups" : "statutory_rule_versions",
        sourceId: group ? group.contributionType : String(config.versionId),
      });
    }

    if (employerPeriodShare > 0) {
      lines.push({
        lineType: "Employer Contribution",
        code: `${config.type}-ER`,
        description: `${config.type} Employer Share`,
        amount: employerPeriodShare,
        sourceTable: group ? "employee_contribution_groups" : "statutory_rule_versions",
        sourceId: group ? group.contributionType : String(config.versionId),
      });
    }

    if (ecPeriodShare > 0) {
      lines.push({
        lineType: "Employer Contribution",
        code: "SSS-EC",
        description: "SSS EC Share",
        amount: ecPeriodShare,
        sourceTable: group ? "employee_contribution_groups" : "statutory_rule_versions",
        sourceId: group ? group.contributionType : String(config.versionId),
      });
    }

    if (config.type === "SSS") {
      sssEmployee = employeePeriodShare;
      sssEmployer = employerPeriodShare;
      sssEc = ecPeriodShare;
    }
    if (config.type === "PHILHEALTH") {
      philhealthEmployee = employeePeriodShare;
      philhealthEmployer = employerPeriodShare;
    }
    if (config.type === "PAGIBIG") {
      pagibigEmployee = employeePeriodShare;
      pagibigEmployer = employerPeriodShare;
    }
  }

  const taxableCompensation = Math.max(
    0,
    roundMoney(
      taxableEarningsBeforeGov - sssEmployee - philhealthEmployee - pagibigEmployee
    )
  );
  const taxGroup = contributionGroups.get("TAX");
  const taxFlags = taxGroup ? getCustomPayrollScheduleFlags(taxGroup) : undefined;
  let taxAmount = 0;

  if (!ignoreContributionDeduction && (!taxGroup || isScheduleApplicable(period.cycle, taxFlags))) {
    if (taxGroup?.flags?.taxFixedPercentage) {
      const taxRate =
        toAmount(taxGroup.flags.taxFixedValue) > 0
          ? toAmount(taxGroup.flags.taxFixedValue) / 100
          : toAmount(taxGroup.percentage);
      taxAmount = roundMoney(taxableCompensation * taxRate);
    } else if (taxGroup && toAmount(taxGroup.fixedEmployeeShare) > 0) {
      taxAmount = distributeCustomFixedPayrollAmount(
        toAmount(taxGroup.fixedEmployeeShare),
        period.cycle,
        taxFlags
      );
    } else if (taxGroup && toAmount(taxGroup.percentage) > 0) {
      const basis = getBasisAmount({
        basisOfComputation: taxGroup.basisOfComputation,
        basisValue: toAmount(taxGroup.basisValue),
        grossPay,
        regularPay,
        monthlyRate: monthlyCompensationBase,
      });
      taxAmount = roundMoney(basis * toAmount(taxGroup.percentage));
    } else if (statutoryBundle.taxVersionId) {
      if (taxGroup?.flags?.taxMonthEndAdjustment && period.cycle === "B") {
        const previous =
          priorCycleTaxContext?.get(employee.id) ??
          (await getPriorCycleTaxContext(period, employee.id));
        const monthlyTaxableCompensation = previous.previousTaxable + taxableCompensation;
        const monthlyTax = roundMoney(
          (await computeBirWithholding(
            monthlyTaxableCompensation / 2,
            statutoryBundle.taxVersionId
          )) * 2
        );
        taxAmount = roundMoney(
          Math.max(0, monthlyTax - previous.previousTaxWithheld)
        );
      } else if (!(taxGroup?.flags?.taxMonthEndAdjustment && period.cycle === "A")) {
        taxAmount = await computeBirWithholding(
          taxableCompensation,
          statutoryBundle.taxVersionId
        );
      }
    }
  }

  if (taxAmount > 0) {
    lines.push({
      lineType: "Deduction",
      code: "TAX",
      description: "Withholding Tax",
      amount: taxAmount,
      sourceTable: taxGroup ? "employee_contribution_groups" : "statutory_rule_versions",
      sourceId: taxGroup ? taxGroup.contributionType : String(statutoryBundle.taxVersionId),
    });
  }

  const totalDeductions = roundMoney(
    lines
      .filter((line) => line.lineType === "Deduction")
      .reduce((total, line) => total + line.amount, 0)
  );
  const employeeContributions = roundMoney(
    sssEmployee + philhealthEmployee + pagibigEmployee + taxAmount
  );
  const employerContributions = roundMoney(
    sssEmployer + sssEc + philhealthEmployer + pagibigEmployer
  );
  const netPay = roundMoney(grossPay - totalDeductions);

  return {
    employeeId: employee.id,
    employeeNoSnapshot: formatEmployeeCode({
      employeeType: employee.employeeType,
      employeeNo: employee.employeeNo,
    }),
    employeeNameSnapshot: buildFullName(
      employee.firstName,
      employee.lastName,
      employee.middleName
    ),
    salaryAdjustmentId: resolvedSalary.adjustmentId,
    salaryAdjustmentMode: resolvedSalary.adjustmentMode,
    regularPay,
    grossPay,
    taxablePay: taxableCompensation,
    nonTaxablePay,
    totalDeductions,
    employeeContributions,
    employerContributions,
    netPay,
    payComputationMode,
    breakdownNotes: buildPayrollBreakdownNotes({
      payComputationMode,
      monthlyRateDtrIgnored: ignoreDtrForMonthlyRate,
      derivedAbsentDays,
      hasSeparatePaidLeaveLine: !isMonthlyEmployee && paidLeavePay > 0,
      unresolvedLeaveCount,
      statutoryMonthlyCompensationBase:
        monthlyCompensationBase > 0 ? monthlyCompensationBase : null,
      sssContributionSource,
      sssSalaryCredit,
      sssRangeFrom,
      sssRangeTo,
    }),
    contributionBasis,
    lines,
  };
}

function buildManualPayrollComputation(
  entry: Awaited<ReturnType<typeof loadManualPayrollEntriesForPeriod>>[number],
  dueInstallments: LoanInstallmentWithLoan[],
  accountCodes: Map<string, typeof accountCode.$inferSelect>
): EmployeePayrollComputation {
  const payComputationMode =
    entry.payComputationMode === "Daily Rate" ||
    entry.payComputationMode === "Monthly Rate"
      ? entry.payComputationMode
      : null;
  const lines = buildManualPayrollRunLines(entry).map((line) => ({
    accountCodeId: line.accountCodeId,
    lineType: line.lineType,
    code: line.code,
    description: line.description,
    amount: line.amount,
    quantity: line.quantity,
    rate: line.rate,
    taxable: line.taxable,
    month13thEligible: line.month13thEligible,
    loanRefNo: line.loanRefNo,
    sourceTable: line.sourceTable,
    sourceId: line.sourceId,
  }));
  const existingLoanInstallmentIds = new Set(
    lines
      .filter((line) => line.sourceTable === "loan_installments" && line.sourceId)
      .map((line) => line.sourceId!)
  );
  const autoLoanLines = dueInstallments
    .filter((installment) => !existingLoanInstallmentIds.has(installment.id))
    .map((installment) => buildLoanDeductionLine({ installment, accountCodes }))
    .filter((line): line is PayrollLineDraft => line != null);
  const autoLoanDeductionTotal = roundMoney(
    autoLoanLines.reduce((total, line) => total + line.amount, 0)
  );
  const breakdownNotes = [
    payComputationMode ? `${PAYROLL_BASIS_NOTE_PREFIX}${payComputationMode}` : null,
    "Manual Payroll Override",
    autoLoanDeductionTotal > 0 ? "Scheduled loan deductions auto-applied" : null,
    entry.remarks?.trim() ? `Remarks: ${entry.remarks.trim()}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    employeeId: entry.employeeId,
    employeeNoSnapshot: entry.employeeNoSnapshot,
    employeeNameSnapshot: entry.employeeNameSnapshot,
    salaryAdjustmentId: null,
    salaryAdjustmentMode: null,
    regularPay: toAmount(entry.regularPay),
    grossPay: toAmount(entry.grossPay),
    taxablePay: toAmount(entry.taxablePay),
    nonTaxablePay: toAmount(entry.nonTaxablePay),
    totalDeductions: roundMoney(
      toAmount(entry.totalDeductions) + autoLoanDeductionTotal
    ),
    employeeContributions: toAmount(entry.employeeContributions),
    employerContributions: toAmount(entry.employerContributions),
    netPay: roundMoney(toAmount(entry.netPay) - autoLoanDeductionTotal),
    payComputationMode,
    breakdownNotes,
    lines: [...lines, ...autoLoanLines],
  };
}

export async function computeManualPayrollLatestBaseline(
  payrollPeriodId: string,
  employeeId: string
): Promise<ManualPayrollBaselineSnapshot | null> {
  await ensurePayrollFoundationData();

  const period = await getPayrollPeriod(payrollPeriodId);
  if (!period) {
    throw new Error("Payroll period not found.");
  }

  if (period.payrollTerms !== "Semi-Monthly") {
    throw new Error("Only semi-monthly payroll periods are supported in v1.");
  }

  const employee = await db.query.employees.findFirst({
    where: and(
      eq(employees.id, employeeId),
      eq(employees.employeeType, DEFAULT_EMPLOYEE_TYPE),
      isNull(employees.deletedAt)
    ),
    with: {
      generalInfo: true,
      salary: true,
      recurringEntries: true,
      timekeeping: true,
    },
  });

  if (!employee) return null;

  const payrollTerms = employee.generalInfo?.payrollTerms;
  const separated = employee.generalInfo?.separationDate;
  if (payrollTerms !== "Semi-Monthly" || (separated && separated < period.startDate)) {
    return null;
  }

  const holidays = await fetchConfirmedHolidayRowsForRange(
    period.startDate,
    period.endDate
  );
  const holidaySet = buildHolidayDateSet(
    holidays.filter((holiday) => holiday.holidayType !== "Special Working") as HolidayLike[]
  );
  const [
    resolvedSalaryByEmployeeId,
    attendance,
    leaves,
    allAccountCodes,
    installments,
    shiftAssignmentRows,
    weeklyPatternRows,
    overtimeRuleRows,
    payrollExceptionRows,
    attendancePeriodOverrideRows,
    attendanceDayStatusOverrideRows,
    attendanceDayTypeOverrideRows,
  ] = await Promise.all([
    buildResolvedSalaryByEmployeeId({
      employees: [
        {
          id: employee.id,
          salary: employee.salary,
        },
      ],
      period,
    }),
    db
      .select()
      .from(attendanceDailySummaries)
      .where(
        and(
          eq(attendanceDailySummaries.employeeId, employee.id),
          gte(attendanceDailySummaries.attendanceDate, period.startDate),
          lte(attendanceDailySummaries.attendanceDate, period.endDate)
        )
      ),
    db.query.employeesLeaveRecords.findMany({
      where: and(
        eq(employeesLeaveRecords.employeeId, employee.id),
        eq(employeesLeaveRecords.leaveStatus, "Approved")
      ),
      with: {
        leaveTypeLookup: true,
        dayDetails: true,
      },
    }),
    db.select({
      id: accountCode.id,
      accountCode: accountCode.accountCode,
      accountType: accountCode.accountType,
      description: accountCode.description,
      dailyRate: accountCode.dailyRate,
      monthlyRate: accountCode.monthlyRate,
      nonTaxable: accountCode.nonTaxable,
      deminimis: accountCode.deminimis,
      healthInsurance: accountCode.healthInsurance,
      month13thPay: accountCode.month13thPay,
      createdAt: accountCode.createdAt,
      updatedAt: accountCode.updatedAt,
    }).from(accountCode),
    db
      .select({
        installment: loanInstallments,
        loan: employeesLoans,
      })
      .from(loanInstallments)
      .innerJoin(employeesLoans, eq(loanInstallments.loanId, employeesLoans.id))
      .where(
        and(
          eq(employeesLoans.employeeId, employee.id),
          eq(employeesLoans.status, "Active"),
          isNull(employeesLoans.deletedAt),
          eq(loanInstallments.payrollCode, period.code),
          inArray(loanInstallments.status, ["Pending", "Due"])
        )
      ),
    db
      .select()
      .from(employeeShiftAssignments)
      .where(
        and(
          eq(employeeShiftAssignments.employeeId, employee.id),
          lte(employeeShiftAssignments.effectiveFrom, period.endDate),
          sql`(${employeeShiftAssignments.effectiveTo} is null or ${employeeShiftAssignments.effectiveTo} >= ${period.startDate})`
        )
      ),
    db.query.employeeWeeklyShiftPatterns.findMany({
      where: and(
        eq(employeeWeeklyShiftPatterns.employeeId, employee.id),
        lte(employeeWeeklyShiftPatterns.effectiveFrom, period.endDate),
        or(isNull(employeeWeeklyShiftPatterns.effectiveTo), gte(employeeWeeklyShiftPatterns.effectiveTo, period.startDate))
      ),
      with: {
        days: true,
      },
    }),
    db.select().from(overtimeRules),
    db
      .select()
      .from(employeePayrollExceptionRows)
      .where(
        and(
          eq(employeePayrollExceptionRows.payrollPeriodId, period.id),
          eq(employeePayrollExceptionRows.employeeId, employee.id),
          gte(employeePayrollExceptionRows.attendanceDate, period.startDate),
          lte(employeePayrollExceptionRows.attendanceDate, period.endDate)
        )
      )
      .orderBy(asc(employeePayrollExceptionRows.attendanceDate)),
    db
      .select()
      .from(employeeAttendancePeriodOverrides)
      .where(
        and(
          eq(employeeAttendancePeriodOverrides.payrollPeriodId, period.id),
          eq(employeeAttendancePeriodOverrides.employeeId, employee.id)
        )
      ),
    db
      .select()
      .from(employeeAttendanceDayStatusOverrides)
      .where(
        and(
          eq(employeeAttendanceDayStatusOverrides.payrollPeriodId, period.id),
          eq(employeeAttendanceDayStatusOverrides.employeeId, employee.id),
          gte(employeeAttendanceDayStatusOverrides.attendanceDate, period.startDate),
          lte(employeeAttendanceDayStatusOverrides.attendanceDate, period.endDate)
        )
      ),
    db
      .select()
      .from(employeeAttendanceDayTypeOverrides)
      .where(
        and(
          eq(employeeAttendanceDayTypeOverrides.payrollPeriodId, period.id),
          eq(employeeAttendanceDayTypeOverrides.employeeId, employee.id),
          gte(employeeAttendanceDayTypeOverrides.attendanceDate, period.startDate),
          lte(employeeAttendanceDayTypeOverrides.attendanceDate, period.endDate)
        )
      ),
  ]);

  const customPayrollIds = [...resolvedSalaryByEmployeeId.values()]
    .map((resolvedSalary) => resolvedSalary.salary.customPayrollId)
    .filter((value): value is number => value != null);
  const customPayrollMap = await loadCustomPayrollMap(customPayrollIds);
  const leaveTypesByCode = await buildLeaveTypeMapByCode(
    leaves.filter((leave) => leave.leaveTypeLookup == null).map((leave) => leave.leaveType)
  );
  const holidayTypeByDate = buildHolidayTypeByDate(
    holidays as Array<HolidayLike & { holidayType: OvertimeHolidayType }>
  );
  const calendarDayTypeByDate = new Map(
    [...holidayTypeByDate.entries()].map(([attendanceDate, holidayType]) => [
      attendanceDate,
      getAttendanceDtrDayTypeFromHolidayType(holidayType),
    ])
  );
  const attendanceStatusOverridesByDate = new Map(
    attendanceDayStatusOverrideRows.map((override) => [
      override.attendanceDate,
      override.status as AttendanceDtrManualStatus,
    ])
  );
  const attendanceDayTypeOverridesByDate = new Map(
    attendanceDayTypeOverrideRows.map((override) => [
      override.attendanceDate,
      override.dayType as AttendanceDtrDayType,
    ])
  );
  // Pre-compute leave overlap days once per leave record (same period bounds for all)
  const leaveOverlapCache = new Map<number, number>(
    leaves.map(leave => [leave.id, countLeaveOverlapDays(leave, period.startDate, period.endDate)])
  );
  const approvedLeaves = leaves.filter(leave => (leaveOverlapCache.get(leave.id) ?? 0) > 0);
  const dueInstallments = installments.map((row) => ({
    ...row.installment,
    loan: row.loan,
  }));
  const accountCodeMap = new Map(allAccountCodes.map((item) => [item.accountCode, item]));
  const statutoryBundle = await getActiveStatutoryRuleBundle(period.adjustedPayDate);
  const computation = await computeEmployeePayroll({
    employee,
    resolvedSalary:
      resolvedSalaryByEmployeeId.get(employee.id) ??
      ({
        salary: ((employee.salary ?? {}) as ResolvedSalaryRecord),
        adjustmentId: null,
        adjustmentMode: null,
        resolvedFrom: "Base",
      } satisfies ResolvedSalaryForPeriod),
    period,
    holidays: holidaySet,
    shiftAssignments: shiftAssignmentRows,
    weeklyPatterns: weeklyPatternRows,
    attendance,
    attendancePeriodOverride: attendancePeriodOverrideRows[0] ?? null,
    attendanceStatusOverridesByDate,
    attendanceDayTypeOverridesByDate,
    calendarDayTypeByDate,
    payrollExceptionRows,
    overtimeRuleRows,
    approvedLeaves,
    leaveTypesByCode,
    recurringEntries: employee.recurringEntries,
    dueInstallments,
    accountCodes: accountCodeMap,
    customPayrollMap,
    statutoryBundle,
  });

  return buildManualPayrollBaselineSnapshotFromComputation(computation, {
    accountCodeOptions: allAccountCodes.map((item) => ({
      id: item.id,
      code: item.accountCode,
      accountType: item.accountType,
      description: item.description,
      month13thPay: item.month13thPay,
      nonTaxable: item.nonTaxable,
      deminimis: item.deminimis,
      dailyRate: item.dailyRate,
      monthlyRate: item.monthlyRate,
    })),
  });
}

function isSameStatusTransition(
  currentStatus: string,
  nextStatus: PayrollRunTransitionStatus
) {
  return currentStatus === nextStatus;
}

function ensurePayrollTransitionAllowed(
  currentStatus: string,
  nextStatus: PayrollRunTransitionStatus
) {
  if (nextStatus === "Reviewed" && ["Draft", "Stale"].includes(currentStatus)) {
    return;
  }

  if (nextStatus === "Approved" && currentStatus === "Reviewed") {
    return;
  }

  if (nextStatus === "Posted" && currentStatus === "Approved") {
    return;
  }

  if (nextStatus === "Void" && ["Draft", "Stale", "Reviewed", "Approved"].includes(currentStatus)) {
    return;
  }

  if (nextStatus === "Void" && currentStatus === "Posted") {
    throw new Error(
      "Posted payroll runs cannot be voided directly. Use a reversal workflow before corrections."
    );
  }

  throw new Error(`Cannot move payroll run from ${currentStatus} to ${nextStatus}.`);
}

export async function ensureSemiMonthlyPayrollPeriods(year: number) {
  await ensurePayrollFoundationData();

  const holidays = await fetchConfirmedHolidayRowsForYear(year);
  const seeds = getCalendarYearSeeds(year, holidays as HolidayLike[]);
  const existing = await db
    .select({ code: payrollPeriods.code })
    .from(payrollPeriods)
    .where(eq(payrollPeriods.year, year));
  const existingCodes = new Set(existing.map((period) => period.code));

  const missingSeeds = seeds.filter((seed) => !existingCodes.has(seed.code));

  if (missingSeeds.length > 0) {
    await db.insert(payrollPeriods).values(missingSeeds);
  }

  await refreshOpenPayrollPeriodsForHolidayYear(year);

  return db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.year, year))
    .orderBy(asc(payrollPeriods.startDate));
}

export async function getPayrollPeriod(periodId: string) {
  return db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, periodId),
  });
}

export async function createOrRecomputePayrollRun(
  payrollPeriodId: string,
  actorUserId: string
) {
  await ensurePayrollFoundationData();

  const period = await getPayrollPeriod(payrollPeriodId);
  if (!period) {
    throw new Error("Payroll period not found.");
  }

  if (period.payrollTerms !== "Semi-Monthly") {
    throw new Error("Only semi-monthly payroll periods are supported in v1.");
  }

  const holidays = await fetchConfirmedHolidayRowsForRange(
    period.startDate,
    period.endDate
  );
  const holidaySet = buildHolidayDateSet(
    holidays.filter((holiday) => holiday.holidayType !== "Special Working") as HolidayLike[]
  );

  const employeesForPayroll = await db.query.employees.findMany({
    where: and(
      eq(employees.employeeType, DEFAULT_EMPLOYEE_TYPE),
      isNull(employees.deletedAt),
    ),
    with: {
      generalInfo: true,
      salary: true,
      recurringEntries: true,
      timekeeping: true,
    },
  });

  const eligibleEmployees = employeesForPayroll.filter((employee) => {
    const payrollTerms = employee.generalInfo?.payrollTerms;
    const separated = employee.generalInfo?.separationDate;
    return (
      payrollTerms === "Semi-Monthly" &&
      (!separated || separated >= period.startDate)
    );
  });

  const manualPayrollEntryRows = await loadManualPayrollEntriesForPeriod(period.id);
  const manualPayrollEmployeeIds = new Set(
    manualPayrollEntryRows.map((entry) => entry.employeeId)
  );
  const employeesToCompute = eligibleEmployees.filter(
    (employee) => !manualPayrollEmployeeIds.has(employee.id)
  );
  const employeeIds = employeesToCompute.map((employee) => employee.id);
  const loanEmployeeIds = [...new Set([...employeeIds, ...manualPayrollEmployeeIds])];
  const [
    resolvedSalaryByEmployeeId,
    attendance,
    leaves,
    allAccountCodes,
    installments,
    shiftAssignmentRows,
    weeklyPatternRows,
    overtimeRuleRows,
    payrollExceptionRows,
    attendancePeriodOverrideRows,
    attendanceDayStatusOverrideRows,
    attendanceDayTypeOverrideRows,
  ] =
    await Promise.all([
      buildResolvedSalaryByEmployeeId({
        employees: employeesToCompute.map((employee) => ({
          id: employee.id,
          salary: employee.salary,
        })),
        period,
      }),
      employeeIds.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(attendanceDailySummaries)
            .where(
              and(
                inArray(attendanceDailySummaries.employeeId, employeeIds),
                gte(attendanceDailySummaries.attendanceDate, period.startDate),
                lte(attendanceDailySummaries.attendanceDate, period.endDate)
              )
            ),
      employeeIds.length === 0
        ? Promise.resolve([])
        : db.query.employeesLeaveRecords.findMany({
            where: and(
              inArray(employeesLeaveRecords.employeeId, employeeIds),
              eq(employeesLeaveRecords.leaveStatus, "Approved")
            ),
            with: {
              leaveTypeLookup: true,
              dayDetails: true,
            },
          }),
      db.select({
      id: accountCode.id,
      accountCode: accountCode.accountCode,
      accountType: accountCode.accountType,
      description: accountCode.description,
      dailyRate: accountCode.dailyRate,
      monthlyRate: accountCode.monthlyRate,
      nonTaxable: accountCode.nonTaxable,
      deminimis: accountCode.deminimis,
      healthInsurance: accountCode.healthInsurance,
      month13thPay: accountCode.month13thPay,
      createdAt: accountCode.createdAt,
      updatedAt: accountCode.updatedAt,
    }).from(accountCode),
      loanEmployeeIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              installment: loanInstallments,
              loan: employeesLoans,
            })
            .from(loanInstallments)
            .innerJoin(employeesLoans, eq(loanInstallments.loanId, employeesLoans.id))
            .where(
              and(
                inArray(employeesLoans.employeeId, loanEmployeeIds),
                eq(employeesLoans.status, "Active"),
                isNull(employeesLoans.deletedAt),
                eq(loanInstallments.payrollCode, period.code),
                inArray(loanInstallments.status, ["Pending", "Due"])
              )
            ),
      employeeIds.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(employeeShiftAssignments)
            .where(
              and(
                inArray(employeeShiftAssignments.employeeId, employeeIds),
                lte(employeeShiftAssignments.effectiveFrom, period.endDate),
                sql`(${employeeShiftAssignments.effectiveTo} is null or ${employeeShiftAssignments.effectiveTo} >= ${period.startDate})`
              )
            ),
      employeeIds.length === 0
        ? Promise.resolve([])
        : db.query.employeeWeeklyShiftPatterns.findMany({
            where: and(
              inArray(employeeWeeklyShiftPatterns.employeeId, employeeIds),
              lte(employeeWeeklyShiftPatterns.effectiveFrom, period.endDate),
              or(isNull(employeeWeeklyShiftPatterns.effectiveTo), gte(employeeWeeklyShiftPatterns.effectiveTo, period.startDate))
            ),
            with: {
              days: true,
            },
          }),
      db.select().from(overtimeRules),
      employeeIds.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(employeePayrollExceptionRows)
            .where(
              and(
                eq(employeePayrollExceptionRows.payrollPeriodId, period.id),
                inArray(employeePayrollExceptionRows.employeeId, employeeIds),
                gte(employeePayrollExceptionRows.attendanceDate, period.startDate),
                lte(employeePayrollExceptionRows.attendanceDate, period.endDate)
              )
            )
            .orderBy(asc(employeePayrollExceptionRows.attendanceDate)),
      employeeIds.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(employeeAttendancePeriodOverrides)
            .where(
              and(
                eq(employeeAttendancePeriodOverrides.payrollPeriodId, period.id),
                inArray(employeeAttendancePeriodOverrides.employeeId, employeeIds)
              )
            ),
      employeeIds.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(employeeAttendanceDayStatusOverrides)
            .where(
              and(
                eq(employeeAttendanceDayStatusOverrides.payrollPeriodId, period.id),
                inArray(employeeAttendanceDayStatusOverrides.employeeId, employeeIds),
                gte(employeeAttendanceDayStatusOverrides.attendanceDate, period.startDate),
                lte(employeeAttendanceDayStatusOverrides.attendanceDate, period.endDate)
              )
            ),
      employeeIds.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(employeeAttendanceDayTypeOverrides)
            .where(
              and(
                eq(employeeAttendanceDayTypeOverrides.payrollPeriodId, period.id),
                inArray(employeeAttendanceDayTypeOverrides.employeeId, employeeIds),
                gte(employeeAttendanceDayTypeOverrides.attendanceDate, period.startDate),
                lte(employeeAttendanceDayTypeOverrides.attendanceDate, period.endDate)
              )
            ),
    ]);

  const customPayrollIds = [...resolvedSalaryByEmployeeId.values()]
    .map((resolvedSalary) => resolvedSalary.salary.customPayrollId)
    .filter((value): value is number => value != null);
  const customPayrollMap = await loadCustomPayrollMap(customPayrollIds);
  const leaveTypesByCode = await buildLeaveTypeMapByCode(
    leaves.filter((leave) => leave.leaveTypeLookup == null).map((leave) => leave.leaveType)
  );
  const holidayTypeByDate = buildHolidayTypeByDate(
    holidays as Array<HolidayLike & { holidayType: OvertimeHolidayType }>
  );
  const calendarDayTypeByDate = new Map(
    [...holidayTypeByDate.entries()].map(([attendanceDate, holidayType]) => [
      attendanceDate,
      getAttendanceDtrDayTypeFromHolidayType(holidayType),
    ])
  );

  const attendanceDayStatusOverridesByEmployee = new Map<
    string,
    Map<string, AttendanceDtrManualStatus>
  >();
  for (const override of attendanceDayStatusOverrideRows) {
    const current =
      attendanceDayStatusOverridesByEmployee.get(override.employeeId) ?? new Map();
    current.set(override.attendanceDate, override.status as AttendanceDtrManualStatus);
    attendanceDayStatusOverridesByEmployee.set(override.employeeId, current);
  }
  const attendanceDayTypeOverridesByEmployee = new Map<
    string,
    Map<string, AttendanceDtrDayType>
  >();
  for (const override of attendanceDayTypeOverrideRows) {
    const current =
      attendanceDayTypeOverridesByEmployee.get(override.employeeId) ?? new Map();
    current.set(override.attendanceDate, override.dayType as AttendanceDtrDayType);
    attendanceDayTypeOverridesByEmployee.set(override.employeeId, current);
  }
  const attendanceByEmployee = new Map<string, Array<typeof attendanceDailySummaries.$inferSelect>>();
  for (const summary of attendance) {
    const current = attendanceByEmployee.get(summary.employeeId) ?? [];
    current.push(summary);
    attendanceByEmployee.set(summary.employeeId, current);
  }

  const attendancePeriodOverrideByEmployee = new Map(
    attendancePeriodOverrideRows.map((override) => [override.employeeId, override])
  );

  const payrollExceptionRowsByEmployee = new Map<
    string,
    Array<typeof employeePayrollExceptionRows.$inferSelect>
  >();
  for (const row of payrollExceptionRows) {
    const current = payrollExceptionRowsByEmployee.get(row.employeeId) ?? [];
    current.push(row);
    payrollExceptionRowsByEmployee.set(row.employeeId, current);
  }

  // Pre-compute leave overlap for all employees' leaves once (avoids N eachDayOfInterval calls in the loop below)
  const leaveOverlapBulkCache = new Map<number, number>(
    leaves.map(leave => [leave.id, countLeaveOverlapDays(leave, period.startDate, period.endDate)])
  );
  const leavesByEmployee = new Map<
    string,
    Array<
      typeof employeesLeaveRecords.$inferSelect & {
        leaveTypeLookup: typeof leaveTypes.$inferSelect | null;
        dayDetails?: Array<typeof employeeLeaveRecordDays.$inferSelect>;
      }
    >
  >();
  for (const leave of leaves) {
    const overlapDays = leaveOverlapBulkCache.get(leave.id) ?? 0;
    if (overlapDays <= 0) continue;

    const current = leavesByEmployee.get(leave.employeeId) ?? [];
    current.push(leave);
    leavesByEmployee.set(leave.employeeId, current);
  }

  const installmentsByEmployee = new Map<string, LoanInstallmentWithLoan[]>();
  for (const row of installments) {
    const current = installmentsByEmployee.get(row.loan.employeeId) ?? [];
    current.push({ ...row.installment, loan: row.loan });
    installmentsByEmployee.set(row.loan.employeeId, current);
  }

  const shiftAssignmentsByEmployee = new Map<string, ShiftAssignmentRecord[]>();
  for (const assignment of shiftAssignmentRows) {
    const current = shiftAssignmentsByEmployee.get(assignment.employeeId) ?? [];
    current.push(assignment);
    shiftAssignmentsByEmployee.set(assignment.employeeId, current);
  }

  const weeklyPatternsByEmployee = new Map<string, WeeklyShiftPatternRecord[]>();
  for (const pattern of weeklyPatternRows) {
    const current = weeklyPatternsByEmployee.get(pattern.employeeId) ?? [];
    current.push(pattern);
    weeklyPatternsByEmployee.set(pattern.employeeId, current);
  }

  const accountCodeMap = new Map(allAccountCodes.map((item) => [item.accountCode, item]));
  const [statutoryBundle, priorCycleTaxContextMap] = await Promise.all([
    getActiveStatutoryRuleBundle(period.adjustedPayDate),
    // Batch-load Cycle A tax data for all employees in a single pass (eliminates N×2 queries on Cycle B runs)
    batchLoadPriorCycleTaxContext(period, employeesToCompute.map((e) => e.id)),
  ]);

  const computations: EmployeePayrollComputation[] = [];
  for (const employeeChunk of chunk(employeesToCompute, PAYROLL_COMPUTATION_CONCURRENCY)) {
    const chunkComputations = await Promise.all(
      employeeChunk.map((employee) =>
        computeEmployeePayroll({
          employee,
          resolvedSalary:
            resolvedSalaryByEmployeeId.get(employee.id) ??
            ({
              salary: ((employee.salary ?? {}) as ResolvedSalaryRecord),
              adjustmentId: null,
              adjustmentMode: null,
              resolvedFrom: "Base",
            } satisfies ResolvedSalaryForPeriod),
          period,
          holidays: holidaySet,
          shiftAssignments: shiftAssignmentsByEmployee.get(employee.id) ?? [],
          weeklyPatterns: weeklyPatternsByEmployee.get(employee.id) ?? [],
          attendance: attendanceByEmployee.get(employee.id) ?? [],
          attendancePeriodOverride:
            attendancePeriodOverrideByEmployee.get(employee.id) ?? null,
          attendanceStatusOverridesByDate:
            attendanceDayStatusOverridesByEmployee.get(employee.id) ?? new Map(),
          attendanceDayTypeOverridesByDate:
            attendanceDayTypeOverridesByEmployee.get(employee.id) ?? new Map(),
          calendarDayTypeByDate,
          payrollExceptionRows:
            payrollExceptionRowsByEmployee.get(employee.id) ?? [],
          overtimeRuleRows,
          approvedLeaves: leavesByEmployee.get(employee.id) ?? [],
          leaveTypesByCode,
          recurringEntries: employee.recurringEntries,
          dueInstallments: installmentsByEmployee.get(employee.id) ?? [],
          accountCodes: accountCodeMap,
          customPayrollMap,
          statutoryBundle,
          priorCycleTaxContext: priorCycleTaxContextMap,
        })
      )
    );
    computations.push(...chunkComputations);
  }
  computations.push(
    ...manualPayrollEntryRows.map((entry) =>
      buildManualPayrollComputation(
        entry,
        installmentsByEmployee.get(entry.employeeId) ?? [],
        accountCodeMap
      )
    )
  );

  return db.transaction(async (tx) => {
    const [latestRunForPeriod] = await tx
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.payrollPeriodId, payrollPeriodId))
      .orderBy(desc(payrollRuns.createdAt))
      .limit(1);

    let runId: string;

    if (
      !latestRunForPeriod ||
      latestRunForPeriod.status === "Posted" ||
      latestRunForPeriod.status === "Void"
    ) {
      const [createdRun] = await tx
        .insert(payrollRuns)
        .values({
          payrollPeriodId,
          runNumber: (latestRunForPeriod?.runNumber ?? 0) + 1,
          status: "Draft",
          computedAt: new Date(),
          computedByUserId: actorUserId,
        })
        .returning();
      runId = createdRun.id;
    } else {
      if (
        latestRunForPeriod.status !== "Draft" &&
        latestRunForPeriod.status !== "Stale"
      ) {
        throw new Error(
          `Payroll period ${period.code} already has a ${latestRunForPeriod.status.toLowerCase()} run. Recompute is only allowed from Draft or Stale.`
        );
      }

      runId = latestRunForPeriod.id;
      const existingRunEmployees = await tx
        .select({ id: payrollRunEmployees.id })
        .from(payrollRunEmployees)
        .where(eq(payrollRunEmployees.payrollRunId, runId));

      const existingRunEmployeeIds = existingRunEmployees.map((item) => item.id);
      if (existingRunEmployeeIds.length > 0) {
        await tx
          .delete(payrollRunLines)
          .where(inArray(payrollRunLines.payrollRunEmployeeId, existingRunEmployeeIds));
      }
      await tx
        .delete(payrollRunEmployees)
        .where(eq(payrollRunEmployees.payrollRunId, runId));
      await tx
        .update(payrollRuns)
        .set({
          status: "Draft",
          computedAt: new Date(),
          computedByUserId: actorUserId,
          reviewedAt: null,
          reviewedByUserId: null,
          approvedAt: null,
          approvedByUserId: null,
          postedAt: null,
          postedByUserId: null,
          voidedByUserId: null,
          voidReason: null,
        })
        .where(eq(payrollRuns.id, runId));
    }

    const insertedRunEmployees =
      computations.length === 0
        ? []
        : await tx
            .insert(payrollRunEmployees)
            .values(
              computations.map((computation) => ({
                payrollRunId: runId,
                employeeId: computation.employeeId,
                employeeNoSnapshot: computation.employeeNoSnapshot,
                employeeNameSnapshot: computation.employeeNameSnapshot,
                salaryAdjustmentId: computation.salaryAdjustmentId,
                salaryAdjustmentMode: computation.salaryAdjustmentMode,
                regularPay: computation.regularPay.toFixed(2),
                grossPay: computation.grossPay.toFixed(2),
                taxablePay: computation.taxablePay.toFixed(2),
                nonTaxablePay: computation.nonTaxablePay.toFixed(2),
                totalDeductions: computation.totalDeductions.toFixed(2),
                employeeContributions: computation.employeeContributions.toFixed(2),
                employerContributions: computation.employerContributions.toFixed(2),
                netPay: computation.netPay.toFixed(2),
                breakdownNotes: computation.breakdownNotes,
              }))
            )
            .returning({
              id: payrollRunEmployees.id,
              employeeId: payrollRunEmployees.employeeId,
            });

    const runEmployeeIdByEmployeeId = new Map(
      insertedRunEmployees.map((employee) => [employee.employeeId, employee.id])
    );
    const lineRows = computations.flatMap((computation) => {
      const payrollRunEmployeeId = runEmployeeIdByEmployeeId.get(
        computation.employeeId
      );

      if (!payrollRunEmployeeId) return [];

      return computation.lines.map((line) => ({
        payrollRunEmployeeId,
        lineType: line.lineType,
        code: line.code,
        description: line.description,
        amount: line.amount.toFixed(2),
        quantity: line.quantity != null ? line.quantity.toFixed(2) : null,
        rate: line.rate != null ? line.rate.toFixed(4) : null,
        taxable: line.taxable ?? false,
        month13thEligible: line.month13thEligible ?? false,
        sourceTable: line.sourceTable ?? null,
        sourceId: line.sourceId ?? null,
      }));
    });

    for (const rows of chunk(lineRows, 500)) {
      if (rows.length === 0) continue;
      await tx.insert(payrollRunLines).values(rows);
    }

    await recordPayrollRunEvent({
      payrollRunId: runId,
      actorUserId,
      eventType: "Computed",
      fromStatus: latestRunForPeriod?.status ?? null,
      toStatus: "Draft",
      database: tx,
    });

    return tx.query.payrollRuns.findFirst({
      where: eq(payrollRuns.id, runId),
      with: {
        payrollPeriod: true,
        employees: {
          with: {
            lines: true,
          },
        },
      },
    });
  });
}

export async function transitionPayrollRunStatus(
  payrollRunId: string,
  nextStatus: PayrollRunTransitionStatus,
  actorUserId: string,
  notes?: string | null
) {
  const run = await db.query.payrollRuns.findFirst({
    where: eq(payrollRuns.id, payrollRunId),
    with: {
      payrollPeriod: true,
      employees: {
        with: {
          lines: true,
        },
      },
    },
  });

  if (!run) {
    throw new Error("Payroll run not found.");
  }

  if (isSameStatusTransition(run.status, nextStatus)) {
    return run;
  }

  ensurePayrollTransitionAllowed(run.status, nextStatus);

  if (nextStatus === "Posted") {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select id from payroll_runs where id = ${payrollRunId} for update`);

      const lockedRun = await tx.query.payrollRuns.findFirst({
        where: eq(payrollRuns.id, payrollRunId),
        with: {
          payrollPeriod: true,
          employees: {
            with: {
              lines: true,
            },
          },
        },
      });

      if (!lockedRun) {
        throw new Error("Payroll run not found.");
      }

      if (lockedRun.status === "Posted") {
        return lockedRun;
      }

      ensurePayrollTransitionAllowed(lockedRun.status, nextStatus);

      const loanLines = lockedRun.employees.flatMap((employeeRun) =>
        employeeRun.lines
          .filter(
            (line) =>
              line.sourceTable === "loan_installments" &&
              line.sourceId
          )
          .map((line) => ({
            employeeRunId: employeeRun.id,
            installmentId: line.sourceId!,
            amount: line.amount,
          }))
      );
      const installmentIds = [
        ...new Set(loanLines.map((line) => line.installmentId)),
      ];

      if (installmentIds.length > 0) {
        const [installmentRows, existingPayrollPayments] = await Promise.all([
          tx.query.loanInstallments.findMany({
            where: inArray(loanInstallments.id, installmentIds),
          }),
          tx.query.loanPayments.findMany({
            where: and(
              inArray(loanPayments.installmentId, installmentIds),
              eq(loanPayments.source, "Payroll")
            ),
          }),
        ]);
        const installmentById = new Map(
          installmentRows.map((installment) => [installment.id, installment])
        );
        const existingPayrollPaymentIds = new Set(
          existingPayrollPayments
            .map((payment) => payment.installmentId)
            .filter((id): id is string => Boolean(id))
        );
        const loanIds = [
          ...new Set(installmentRows.map((installment) => installment.loanId)),
        ];
        const loanRows =
          loanIds.length === 0
            ? []
            : await tx.query.employeesLoans.findMany({
                where: inArray(employeesLoans.id, loanIds),
              });
        const inactiveLoan = loanRows.find(
          (loan) => loan.status !== "Active" || loan.deletedAt
        );
        if (inactiveLoan) {
          throw new Error(
            `Payroll run contains a scheduled loan deduction for inactive loan ${inactiveLoan.loanReferenceNumber}. Recompute payroll before posting.`
          );
        }
        const loanById = new Map(loanRows.map((loan) => [loan.id, loan]));
        const today = format(new Date(), "yyyy-MM-dd");
        const now = new Date();

        // Collect all writes first, then batch-execute to avoid serial round-trips per loan
        const installmentIdsToMark: string[] = [];
        const paymentRowsToInsert: Parameters<typeof tx.insert>[0] extends never
          ? never[]
          : Array<{
              loanId: string;
              installmentId: string;
              payrollRunEmployeeId: string;
              paymentDate: string;
              amountPaid: string;
              source: "Payroll";
              remarks: string;
            }> = [];
        const loanUpdatesByLoanId = new Map<
          string,
          { loanBalance: string; status: "Active" | "Paid" | "Inactive"; loanPaymentDate: string | null; updatedAt: Date }
        >();

        for (const loanLine of loanLines) {
          if (existingPayrollPaymentIds.has(loanLine.installmentId)) continue;

          const installment = installmentById.get(loanLine.installmentId);
          if (!installment) continue;

          const loan = loanById.get(installment.loanId);
          if (!loan) continue;

          const nextBalance = roundMoney(
            Math.max(0, toAmount(loan.loanBalance) - toAmount(loanLine.amount))
          );

          installmentIdsToMark.push(installment.id);

          paymentRowsToInsert.push({
            loanId: loan.id,
            installmentId: installment.id,
            payrollRunEmployeeId: loanLine.employeeRunId,
            paymentDate: today,
            amountPaid: toAmount(loanLine.amount).toFixed(2),
            source: "Payroll",
            remarks: `Auto-posted from payroll run ${lockedRun.id}`,
          });

          const updatedLoan = {
            loanBalance: nextBalance.toFixed(2),
            status: (nextBalance <= 0 ? "Paid" : loan.status) as "Active" | "Paid" | "Inactive",
            loanPaymentDate: nextBalance <= 0 ? today : loan.loanPaymentDate,
            updatedAt: now,
          };
          loanUpdatesByLoanId.set(loan.id, updatedLoan);

          // Track running balance so multi-installment loans accumulate correctly
          loanById.set(loan.id, { ...loan, ...updatedLoan });
          existingPayrollPaymentIds.add(loanLine.installmentId);
        }

        // Batch execute: single UPDATE for all installments, single INSERT for all payments,
        // concurrent UPDATEs per unique loan (usually just a few)
        if (installmentIdsToMark.length > 0) {
          await Promise.all([
            tx
              .update(loanInstallments)
              .set({ status: "Paid", updatedAt: now })
              .where(inArray(loanInstallments.id, installmentIdsToMark)),
            tx.insert(loanPayments).values(paymentRowsToInsert),
            ...Array.from(loanUpdatesByLoanId.entries()).map(([loanId, updates]) =>
              tx.update(employeesLoans).set(updates).where(eq(employeesLoans.id, loanId))
            ),
          ]);
        }
      }

      await tx
        .update(payrollRuns)
        .set({
          status: nextStatus,
          postedAt: new Date(),
          postedByUserId: actorUserId,
          updatedAt: new Date(),
        })
        .where(eq(payrollRuns.id, payrollRunId));

      await recordPayrollRunEvent({
        payrollRunId,
        actorUserId,
        eventType: "Posted",
        fromStatus: lockedRun.status,
        toStatus: nextStatus,
        notes,
        database: tx,
      });

      return tx.query.payrollRuns.findFirst({
        where: eq(payrollRuns.id, payrollRunId),
        with: {
          payrollPeriod: true,
          employees: {
            with: {
              lines: true,
            },
          },
        },
      });
    });
  }

  const eventType =
    nextStatus === "Reviewed"
      ? "Reviewed"
      : nextStatus === "Approved"
        ? "Approved"
        : "Voided";

  return db.transaction(async (tx) => {
    await tx
      .update(payrollRuns)
      .set({
        status: nextStatus,
        reviewedAt: nextStatus === "Reviewed" ? new Date() : run.reviewedAt,
        reviewedByUserId: nextStatus === "Reviewed" ? actorUserId : run.reviewedByUserId,
        approvedAt: nextStatus === "Approved" ? new Date() : run.approvedAt,
        approvedByUserId: nextStatus === "Approved" ? actorUserId : run.approvedByUserId,
        voidedByUserId: nextStatus === "Void" ? actorUserId : run.voidedByUserId,
        voidReason: nextStatus === "Void" ? notes ?? null : run.voidReason,
        updatedAt: new Date(),
      })
      .where(eq(payrollRuns.id, payrollRunId));

    await recordPayrollRunEvent({
      payrollRunId,
      actorUserId,
      eventType,
      fromStatus: run.status,
      toStatus: nextStatus,
      notes,
      database: tx,
    });

    return tx.query.payrollRuns.findFirst({
      where: eq(payrollRuns.id, payrollRunId),
      with: {
        payrollPeriod: true,
        employees: {
          with: {
            lines: true,
          },
        },
      },
    });
  });
}

export async function getPayrollRun(runId: string) {
  return db.query.payrollRuns.findFirst({
    where: eq(payrollRuns.id, runId),
    with: {
      payrollPeriod: true,
      employees: {
        with: {
          lines: true,
        },
      },
    },
  });
}

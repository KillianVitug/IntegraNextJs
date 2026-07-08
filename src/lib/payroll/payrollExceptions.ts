import { getOvertimeCategoryLabel, type OvertimeCategory } from "./overtime";
import type { AttendanceDtrDayType } from "./dtrOverrides";
import {
  getManualPayrollAccountRateMultiplier,
  isManualPayrollHourBasedAccountType,
} from "./manualPayrollRate";

export const payrollExceptionTypeValues = [
  "OVERTIME",
  "WORKED_DAY_PREMIUM",
  "NON_WORKED_HOLIDAY",
] as const;

export type PayrollExceptionType = (typeof payrollExceptionTypeValues)[number];

export const PAYROLL_EXCEPTION_TYPE_LABELS: Record<PayrollExceptionType, string> = {
  OVERTIME: "Overtime",
  WORKED_DAY_PREMIUM: "Worked Day Premium",
  NON_WORKED_HOLIDAY: "Non-Worked Holiday",
};

export const payrollExceptionWorkedStatusValues = [
  "WORKED",
  "NON_WORKED",
] as const;

export type PayrollExceptionWorkedStatus =
  (typeof payrollExceptionWorkedStatusValues)[number];

export const PAYROLL_EXCEPTION_WORKED_STATUS_LABELS: Record<
  PayrollExceptionWorkedStatus,
  string
> = {
  WORKED: "Worked",
  NON_WORKED: "Non-Worked",
};

export const payrollExceptionAccountTypeValues = [
  "Regular Hours",
  "Overtime",
  "Night Premium",
  "Sunday/Holiday",
  "Paid Leaves",
  "Unpaid Leaves/Absences",
  "Other Income",
  "Loan",
  "Other Deduction",
] as const;

export type PayrollExceptionAccountType =
  (typeof payrollExceptionAccountTypeValues)[number];

export const payrollExceptionDtrOverrideSourceValues = [
  "DTR_WORKED",
  "DTR_TARDINESS",
  "DTR_UNDERTIME",
  "DTR_REGULAR_OVERTIME",
  "DTR_HOLD_WORKED",
  "DTR_HOLD_TARDINESS",
  "DTR_HOLD_UNDERTIME",
  "DTR_HOLD_REGULAR_OVERTIME",
] as const;

export type PayrollExceptionDtrOverrideSource =
  (typeof payrollExceptionDtrOverrideSourceValues)[number];

export const payrollExceptionEarningAccountTypes = [
  "Regular Hours",
  "Overtime",
  "Night Premium",
  "Sunday/Holiday",
  "Paid Leaves",
  "Other Income",
] as const satisfies readonly PayrollExceptionAccountType[];

export function isPayrollExceptionAccountType(
  value: string | null | undefined
): value is PayrollExceptionAccountType {
  return payrollExceptionAccountTypeValues.includes(
    value as PayrollExceptionAccountType
  );
}

export function isPayrollExceptionEarningAccountType(
  value: string | null | undefined
) {
  return payrollExceptionEarningAccountTypes.includes(
    value as (typeof payrollExceptionEarningAccountTypes)[number]
  );
}

export function isPayrollExceptionDtrOverrideSource(
  value: string | null | undefined
): value is PayrollExceptionDtrOverrideSource {
  return payrollExceptionDtrOverrideSourceValues.includes(
    value as PayrollExceptionDtrOverrideSource
  );
}

export function isPayrollExceptionDtrQuantityOnlyDeductionSource(
  value: string | null | undefined
) {
  return (
    value === "DTR_TARDINESS" ||
    value === "DTR_UNDERTIME" ||
    value === "DTR_HOLD_TARDINESS" ||
    value === "DTR_HOLD_UNDERTIME"
  );
}

export function isPayrollExceptionHeldDtrSource(
  value: string | null | undefined
) {
  return (
    value === "DTR_HOLD_WORKED" ||
    value === "DTR_HOLD_TARDINESS" ||
    value === "DTR_HOLD_UNDERTIME" ||
    value === "DTR_HOLD_REGULAR_OVERTIME"
  );
}

type OvertimeRuleLike = {
  category: OvertimeCategory;
  minutesFrom: number;
  minutesTo: number | null;
  rateMultiplier: number | string;
};

export type PayrollExceptionPreviewInput = {
  attendanceDate: string;
  accountCode: string;
  accountType: string | null;
  accountDescription: string | null;
  overtimeCategory: OvertimeCategory | null;
  quantityMinutes: number | null;
  amountOverride: number | string | null;
  scheduledMinutes: number;
  dailyRate: number;
  payComputationMode?: "Daily Rate" | "Monthly Rate" | null;
  hourlyRate?: number | string | null;
  accountDailyRate?: string | number | null;
  accountMonthlyRate?: string | number | null;
  fallbackHoursPerDay: number;
  fallbackMinutesPerDay: number;
  overtimeRules: OvertimeRuleLike[];
  nonTaxable: boolean;
  month13thPay: boolean;
  dayType?: AttendanceDtrDayType | null;
  isRestDay?: boolean;
  dtrOverrideSource?: PayrollExceptionDtrOverrideSource | null;
};

export type PayrollExceptionPreview = {
  lineType: "Earning" | "Deduction";
  code: string;
  description: string;
  amount: number;
  quantity: number | null;
  rate: number | null;
  taxable: boolean;
  month13thEligible: boolean;
  error: string | null;
};

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundMoney(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function getScheduledMinutes(args: {
  scheduledMinutes: number;
  fallbackMinutesPerDay: number;
}) {
  return args.scheduledMinutes > 0
    ? args.scheduledMinutes
    : args.fallbackMinutesPerDay > 0
      ? args.fallbackMinutesPerDay
      : 480;
}

function getHoursPerDay(args: {
  scheduledMinutes: number;
  fallbackHoursPerDay: number;
}) {
  return args.scheduledMinutes > 0
    ? args.scheduledMinutes / 60
    : args.fallbackHoursPerDay > 0
      ? args.fallbackHoursPerDay
      : 8;
}

function getAccountDescription(args: {
  accountDescription: string | null;
  accountType: string | null;
  overtimeCategory?: OvertimeCategory | null;
}) {
  const base = args.accountDescription?.trim() || args.accountType || "Payroll Exception";
  return args.overtimeCategory
    ? `${base} - ${getOvertimeCategoryLabel(args.overtimeCategory)}`
    : base;
}

export function getPayrollExceptionLineType(accountType: string | null | undefined) {
  return isPayrollExceptionEarningAccountType(accountType) ? "Earning" : "Deduction";
}

function isAccountCodeLeaveAccountType(
  accountType: PayrollExceptionAccountType | null
) {
  return accountType === "Paid Leaves" || accountType === "Unpaid Leaves/Absences";
}

export function computePayrollExceptionPreview(
  args: PayrollExceptionPreviewInput
): PayrollExceptionPreview {
  const accountType = isPayrollExceptionAccountType(args.accountType)
    ? args.accountType
    : null;
  const isDtrQuantityOnlyDeduction =
    isPayrollExceptionDtrQuantityOnlyDeductionSource(args.dtrOverrideSource);
  const lineType = isDtrQuantityOnlyDeduction
    ? "Deduction"
    : getPayrollExceptionLineType(accountType);
  const taxable = lineType === "Earning" ? !args.nonTaxable : false;
  const amountOverride =
    args.amountOverride == null || args.amountOverride === ""
      ? null
      : Math.max(0, toAmount(args.amountOverride));

  const payableMinutes = Math.max(0, args.quantityMinutes ?? 0);
  const scheduledMinutes = getScheduledMinutes({
    scheduledMinutes: args.scheduledMinutes,
    fallbackMinutesPerDay: args.fallbackMinutesPerDay,
  });
  const hoursPerDay = getHoursPerDay({
    scheduledMinutes,
    fallbackHoursPerDay: args.fallbackHoursPerDay,
  });
  const hourlyRate =
    args.hourlyRate != null && args.hourlyRate !== ""
      ? toAmount(args.hourlyRate)
      : hoursPerDay > 0
        ? roundMoney(args.dailyRate / hoursPerDay)
        : 0;
  const quantityHours = roundMoney(payableMinutes / 60);
  const description = getAccountDescription({
    accountDescription: args.accountDescription,
    accountType,
    overtimeCategory:
      accountType === "Overtime" ? args.overtimeCategory : null,
  });

  if (isDtrQuantityOnlyDeduction) {
    return {
      lineType,
      code: args.accountCode,
      description,
      amount: 0,
      quantity: quantityHours,
      rate: 0,
      taxable,
      month13thEligible: false,
      error: null,
    };
  }

  if (amountOverride != null) {
    return {
      lineType,
      code: args.accountCode,
      description,
      amount: amountOverride,
      quantity: quantityHours,
      rate: null,
      taxable,
      month13thEligible: lineType === "Earning" ? args.month13thPay : false,
      error: null,
    };
  }

  if (accountType === "Overtime" && !args.overtimeCategory) {
    return {
      lineType,
      code: args.accountCode,
      description,
      amount: 0,
      quantity: quantityHours,
      rate: null,
      taxable,
      month13thEligible: args.month13thPay,
      error: "Select an OT category.",
    };
  }

  if (isManualPayrollHourBasedAccountType(accountType)) {
    if (payableMinutes <= 0) {
      return {
        lineType,
        code: args.accountCode,
        description,
        amount: 0,
        quantity: quantityHours,
        rate: null,
        taxable,
        month13thEligible: lineType === "Earning" ? args.month13thPay : false,
        error: "Enter hours/minutes or an amount override.",
      };
    }

    const account = {
      accountType,
      dailyRate: args.accountDailyRate,
      monthlyRate: args.accountMonthlyRate,
    };
    const rateContext = {
      payComputationMode: args.payComputationMode ?? "Daily Rate",
      hourlyRate,
    };
    const multiplier = getManualPayrollAccountRateMultiplier({
      account,
      rateContext,
    });

    if (multiplier <= 0) {
      if (isAccountCodeLeaveAccountType(accountType) && multiplier <= 0) {
        return {
          lineType,
          code: args.accountCode,
          description,
          amount: 0,
          quantity: quantityHours,
          rate: 0,
          taxable,
          month13thEligible: lineType === "Earning" ? args.month13thPay : false,
          error: null,
        };
      }

      return {
        lineType,
        code: args.accountCode,
        description,
        amount: 0,
        quantity: quantityHours,
        rate: null,
        taxable,
        month13thEligible: lineType === "Earning" ? args.month13thPay : false,
        error:
          isAccountCodeLeaveAccountType(accountType) && hourlyRate <= 0
            ? "Set an employee salary rate or enter an amount override."
            : "Set an account-code rate multiplier or enter an amount override.",
      };
    }
    if (hourlyRate <= 0) {
      return {
        lineType,
        code: args.accountCode,
        description,
        amount: 0,
        quantity: quantityHours,
        rate: null,
        taxable,
        month13thEligible: lineType === "Earning" ? args.month13thPay : false,
        error:
          isAccountCodeLeaveAccountType(accountType)
            ? "Set an employee salary rate or enter an amount override."
            : "Set an account-code rate multiplier or enter an amount override.",
      };
    }

    const effectiveMultiplier = multiplier;
    const amount = roundMoney(quantityHours * hourlyRate * effectiveMultiplier);

    return {
      lineType,
      code: args.accountCode,
      description,
      amount,
      quantity: quantityHours,
      rate: roundMoney(hourlyRate * effectiveMultiplier),
      taxable,
      month13thEligible: lineType === "Earning" ? args.month13thPay : false,
      error: null,
    };
  }

  return {
    lineType,
    code: args.accountCode,
    description,
    amount: 0,
    quantity: quantityHours > 0 ? quantityHours : null,
    rate: null,
    taxable,
    month13thEligible: lineType === "Earning" ? args.month13thPay : false,
    error: null,
  };
}

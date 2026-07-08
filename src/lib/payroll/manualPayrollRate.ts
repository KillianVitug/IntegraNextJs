export type ManualPayrollRateContextLike = {
  payComputationMode: "Daily Rate" | "Monthly Rate" | null;
  hourlyRate: string | number | null;
};

export type ManualPayrollRateAccountLike = {
  accountType: string | null;
  dailyRate?: string | number | null;
  monthlyRate?: string | number | null;
};

const MANUAL_PAYROLL_HOUR_BASED_ACCOUNT_TYPES = new Set([
  "Regular Hours",
  "Overtime",
  "Night Premium",
  "Sunday/Holiday",
  "Paid Leaves",
  "Unpaid Leaves/Absences",
]);

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundMoney(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

export function isManualPayrollHourBasedAccountType(
  accountType: string | null | undefined
) {
  return MANUAL_PAYROLL_HOUR_BASED_ACCOUNT_TYPES.has(accountType ?? "");
}

export function getManualPayrollAccountRateMultiplier(args: {
  account: ManualPayrollRateAccountLike | null | undefined;
  rateContext: ManualPayrollRateContextLike | null | undefined;
}) {
  if (!args.account || !args.rateContext) return 0;
  if (!isManualPayrollHourBasedAccountType(args.account.accountType)) return 0;

  const rate =
    args.rateContext.payComputationMode === "Monthly Rate"
      ? args.account.monthlyRate
      : args.account.dailyRate;

  return toAmount(rate);
}

export function computeManualPayrollLineAmount(args: {
  account: ManualPayrollRateAccountLike | null | undefined;
  rateContext: ManualPayrollRateContextLike | null | undefined;
  hours: string | number | null | undefined;
  minutes: string | number | null | undefined;
}) {
  const quantityHours =
    Math.max(0, Math.floor(toAmount(args.hours))) +
    Math.max(0, Math.floor(toAmount(args.minutes))) / 60;
  if (quantityHours <= 0) return null;

  const hourlyRate = toAmount(args.rateContext?.hourlyRate);
  if (hourlyRate <= 0) return null;

  const multiplier = getManualPayrollAccountRateMultiplier({
    account: args.account,
    rateContext: args.rateContext,
  });
  if (multiplier <= 0) return null;

  return roundMoney(quantityHours * hourlyRate * multiplier);
}

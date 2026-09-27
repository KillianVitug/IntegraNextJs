export const DEFAULT_PHILHEALTH_ANNUALIZATION_RATE_DIVISOR = 26;
export const PHILHEALTH_ANNUALIZATION_FACTORS_BY_RATE_DIVISOR = {
  22: 261,
  26: 313,
} as const satisfies Record<number, number>;

type PhilhealthAnnualizationSalary = {
  customPayrollId?: string | number | null;
  rateDivisor?: string | number | null;
};

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundMoney(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function getEffectiveRateDivisor(
  salary: Pick<PhilhealthAnnualizationSalary, "rateDivisor"> | undefined
) {
  const explicitDivisor = toAmount(salary?.rateDivisor);
  return explicitDivisor > 0
    ? explicitDivisor
    : DEFAULT_PHILHEALTH_ANNUALIZATION_RATE_DIVISOR;
}

function getPhilhealthAnnualizationFactor(rateDivisor: number) {
  return PHILHEALTH_ANNUALIZATION_FACTORS_BY_RATE_DIVISOR[
    rateDivisor as keyof typeof PHILHEALTH_ANNUALIZATION_FACTORS_BY_RATE_DIVISOR
  ];
}

export function resolvePhilhealthMonthlyCompensationBase(args: {
  salary: PhilhealthAnnualizationSalary | undefined;
  dailyRate: number;
  monthlyRate: number;
  monthlyCompensationBase: number;
}) {
  const effectiveRateDivisor = getEffectiveRateDivisor(args.salary);
  const annualizationFactor =
    getPhilhealthAnnualizationFactor(effectiveRateDivisor);
  const usesAnnualizedDailyRateBasis =
    args.monthlyRate <= 0 &&
    args.dailyRate > 0 &&
    annualizationFactor != null;

  return {
    monthlyCompensationBase: usesAnnualizedDailyRateBasis
      ? roundMoney((args.dailyRate * annualizationFactor) / 12)
      : args.monthlyCompensationBase,
    usesAnnualizedDailyRateBasis,
  };
}

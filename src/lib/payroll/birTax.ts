export const birTaxCategoryValues = [
  "RegularTaxable",
  "SupplementalTaxable",
  "ThirteenthMonthOtherBenefits",
  "DeMinimis",
  "NonTaxable",
] as const;

export const birDeMinimisTypeValues = [
  "MonetizedLeavePrivate",
  "MedicalCashAllowance",
  "RiceSubsidy",
  "UniformClothing",
  "MedicalBenefits",
  "LaundryAllowance",
  "EmployeeAchievementAward",
  "ChristmasMajorAnniversaryGift",
  "OvertimeMealAllowance",
] as const;

export type BirTaxCategory = (typeof birTaxCategoryValues)[number];
export type BirDeMinimisType = (typeof birDeMinimisTypeValues)[number];

export type BirTaxLineInput = {
  lineType: string;
  accountType?: string | null;
  code?: string | null;
  amount: string | number;
  taxable?: boolean | null;
  nonTaxable?: boolean | null;
  deminimis?: boolean | null;
  birTaxCategory?: BirTaxCategory | null;
  birDeMinimisType?: BirDeMinimisType | null;
};

export type BirYearToDateTaxContext = {
  priorTaxableCompensation: number;
  priorTaxWithheld: number;
  thirteenthMonthOtherBenefits: number;
  deMinimisByType: Partial<Record<BirDeMinimisType, number>>;
};

export type BirEmployeeDeductionInput = {
  sssEmployee?: number;
  philhealthEmployee?: number;
  pagibigEmployee?: number;
  peraaEmployee?: number;
};

export type BirTaxProfileInput = {
  isMinimumWageEarner?: boolean;
};

export const EMPTY_BIR_YEAR_TO_DATE_CONTEXT: BirYearToDateTaxContext = {
  priorTaxableCompensation: 0,
  priorTaxWithheld: 0,
  thirteenthMonthOtherBenefits: 0,
  deMinimisByType: {},
};

export const BIR_THIRTEENTH_MONTH_OTHER_BENEFITS_EXEMPTION = 90_000;

const BIR_ANNUAL_BRACKETS_2023_ONWARD = [
  { from: 0, to: 250_000, baseTax: 0, rate: 0 },
  { from: 250_000, to: 400_000, baseTax: 0, rate: 0.15 },
  { from: 400_000, to: 800_000, baseTax: 22_500, rate: 0.2 },
  { from: 800_000, to: 2_000_000, baseTax: 102_500, rate: 0.25 },
  { from: 2_000_000, to: 8_000_000, baseTax: 402_500, rate: 0.3 },
  { from: 8_000_000, to: Number.POSITIVE_INFINITY, baseTax: 2_202_500, rate: 0.35 },
] as const;

// Annual caps where the cap can be evaluated from payroll line amounts alone.
export const BIR_DE_MINIMIS_ANNUAL_CAPS: Partial<Record<BirDeMinimisType, number>> = {
  MedicalCashAllowance: 3_000,
  RiceSubsidy: 24_000,
  UniformClothing: 6_000,
  MedicalBenefits: 10_000,
  LaundryAllowance: 3_600,
  EmployeeAchievementAward: 10_000,
  ChristmasMajorAnniversaryGift: 5_000,
};

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundMoney(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

export function isBirTaxCategory(value: unknown): value is BirTaxCategory {
  return (
    typeof value === "string" &&
    birTaxCategoryValues.includes(value as BirTaxCategory)
  );
}

export function isBirDeMinimisType(value: unknown): value is BirDeMinimisType {
  return (
    typeof value === "string" &&
    birDeMinimisTypeValues.includes(value as BirDeMinimisType)
  );
}

export function inferBirTaxCategory(line: BirTaxLineInput): BirTaxCategory {
  if (line.birTaxCategory) return line.birTaxCategory;
  if (line.lineType !== "Earning") return "NonTaxable";
  if (line.nonTaxable || line.taxable === false) return "NonTaxable";
  if (line.deminimis) return "DeMinimis";

  const code = (line.code ?? "").toUpperCase();
  if (code.includes("13")) return "ThirteenthMonthOtherBenefits";

  if (
    line.accountType === "Overtime" ||
    line.accountType === "Night Premium" ||
    line.accountType === "Sunday/Holiday" ||
    line.accountType === "Other Income"
  ) {
    return "SupplementalTaxable";
  }

  return "RegularTaxable";
}

export function collectBirGrossBuckets(lines: BirTaxLineInput[]) {
  let regularTaxable = 0;
  let supplementalTaxable = 0;
  let thirteenthMonthOtherBenefits = 0;
  let nonTaxable = 0;
  let uncappedDeMinimis = 0;
  const deMinimisByType: Partial<Record<BirDeMinimisType, number>> = {};

  for (const line of lines) {
    if (line.lineType !== "Earning") continue;
    const amount = roundMoney(toAmount(line.amount));
    if (amount <= 0) continue;

    const category = inferBirTaxCategory(line);
    if (category === "RegularTaxable") regularTaxable += amount;
    if (category === "SupplementalTaxable") supplementalTaxable += amount;
    if (category === "ThirteenthMonthOtherBenefits") {
      thirteenthMonthOtherBenefits += amount;
    }
    if (category === "NonTaxable") nonTaxable += amount;
    if (category === "DeMinimis") {
      if (line.birDeMinimisType) {
        deMinimisByType[line.birDeMinimisType] =
          (deMinimisByType[line.birDeMinimisType] ?? 0) + amount;
      } else {
        uncappedDeMinimis += amount;
      }
    }
  }

  return {
    regularTaxable: roundMoney(regularTaxable),
    supplementalTaxable: roundMoney(supplementalTaxable),
    thirteenthMonthOtherBenefits: roundMoney(thirteenthMonthOtherBenefits),
    nonTaxable: roundMoney(nonTaxable),
    uncappedDeMinimis: roundMoney(uncappedDeMinimis),
    deMinimisByType,
  };
}

function computeCurrentDeMinimisExcess(args: {
  currentByType: Partial<Record<BirDeMinimisType, number>>;
  priorByType: Partial<Record<BirDeMinimisType, number>>;
}) {
  let excess = 0;

  for (const type of birDeMinimisTypeValues) {
    const annualCap = BIR_DE_MINIMIS_ANNUAL_CAPS[type];
    if (annualCap == null) continue;

    const prior = args.priorByType[type] ?? 0;
    const current = args.currentByType[type] ?? 0;
    const priorExcess = Math.max(0, prior - annualCap);
    const throughCurrentExcess = Math.max(0, prior + current - annualCap);
    excess += throughCurrentExcess - priorExcess;
  }

  return roundMoney(excess);
}

export function computeBirTaxableCompensation(args: {
  lines: BirTaxLineInput[];
  employeeDeductions?: BirEmployeeDeductionInput;
  yearToDate?: Partial<BirYearToDateTaxContext> | null;
  taxProfile?: BirTaxProfileInput | null;
}) {
  const current = collectBirGrossBuckets(args.lines);
  const yearToDate = {
    ...EMPTY_BIR_YEAR_TO_DATE_CONTEXT,
    ...args.yearToDate,
    deMinimisByType: args.yearToDate?.deMinimisByType ?? {},
  };
  const currentDeMinimisExcess = computeCurrentDeMinimisExcess({
    currentByType: current.deMinimisByType,
    priorByType: yearToDate.deMinimisByType,
  });
  const currentBenefitsAgainstCap = roundMoney(
    current.thirteenthMonthOtherBenefits + currentDeMinimisExcess
  );
  const priorBenefitsAgainstCap = roundMoney(
    yearToDate.thirteenthMonthOtherBenefits +
      computeCurrentDeMinimisExcess({
        currentByType: yearToDate.deMinimisByType,
        priorByType: {},
      })
  );
  const priorBenefitTaxableExcess = Math.max(
    0,
    priorBenefitsAgainstCap - BIR_THIRTEENTH_MONTH_OTHER_BENEFITS_EXEMPTION
  );
  const throughCurrentBenefitTaxableExcess = Math.max(
    0,
    priorBenefitsAgainstCap +
      currentBenefitsAgainstCap -
      BIR_THIRTEENTH_MONTH_OTHER_BENEFITS_EXEMPTION
  );
  const currentBenefitTaxableExcess = roundMoney(
    throughCurrentBenefitTaxableExcess - priorBenefitTaxableExcess
  );
  const employeeMandatoryDeductions = roundMoney(
    toAmount(args.employeeDeductions?.sssEmployee) +
      toAmount(args.employeeDeductions?.philhealthEmployee) +
      toAmount(args.employeeDeductions?.pagibigEmployee) +
      toAmount(args.employeeDeductions?.peraaEmployee)
  );
  const taxableBeforeDeductions = roundMoney(
    current.regularTaxable +
      current.supplementalTaxable +
      currentBenefitTaxableExcess
  );
  const taxableCompensation = roundMoney(
    Math.max(0, taxableBeforeDeductions - employeeMandatoryDeductions)
  );
  const mweDeferredNote = args.taxProfile?.isMinimumWageEarner
    ? "Minimum Wage Earner exemption not applied: wage-region/rate data is not configured."
    : null;

  return {
    taxableCompensation,
    taxableBeforeDeductions,
    employeeMandatoryDeductions,
    regularTaxable: current.regularTaxable,
    supplementalTaxable: roundMoney(
      current.supplementalTaxable + currentBenefitTaxableExcess
    ),
    thirteenthMonthOtherBenefits: current.thirteenthMonthOtherBenefits,
    deMinimis: roundMoney(
      Object.values(current.deMinimisByType).reduce(
        (total, amount) => total + (amount ?? 0),
        current.uncappedDeMinimis
      )
    ),
    deMinimisExcessToBenefits: currentDeMinimisExcess,
    benefitTaxableExcess: currentBenefitTaxableExcess,
    nonTaxable: roundMoney(
      current.nonTaxable +
        current.uncappedDeMinimis +
        Object.values(current.deMinimisByType).reduce(
          (total, amount) => total + (amount ?? 0),
          0
        ) -
        currentDeMinimisExcess +
        currentBenefitsAgainstCap -
        currentBenefitTaxableExcess
    ),
    mweDeferredNote,
  };
}

export function computeAnnualBirTax2023Onward(annualTaxableCompensation: number) {
  const bracket =
    BIR_ANNUAL_BRACKETS_2023_ONWARD.find(
      (row) =>
        annualTaxableCompensation >= row.from &&
        annualTaxableCompensation <= row.to
    ) ?? BIR_ANNUAL_BRACKETS_2023_ONWARD[BIR_ANNUAL_BRACKETS_2023_ONWARD.length - 1];

  return roundMoney(
    annualTaxableCompensation <= bracket.from
      ? bracket.baseTax
      : bracket.baseTax + (annualTaxableCompensation - bracket.from) * bracket.rate
  );
}

export function isFinalDecemberSemiMonthlyPayroll(period: {
  month: number;
  cycle: string;
}) {
  return period.month === 12 && period.cycle === "B";
}

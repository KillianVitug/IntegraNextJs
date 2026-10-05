import { statutoryRuleTypeEnum } from "@/db/schema";

export type StatutoryRuleType = (typeof statutoryRuleTypeEnum.enumValues)[number];

export type LatestSssContributionBracket = {
  rangeFrom: number;
  rangeTo: number;
  salaryCredit: number;
  employeeShare: number;
  employerShare: number;
  ecShare: number;
};

export type LatestPhilhealthContributionRate = {
  monthlyBasicSalaryFloor: number;
  monthlyBasicSalaryCeiling: number;
  premiumRate: number;
  employeeShareRate: number;
  employerShareRate: number;
};

export type LatestPagibigContributionRate = {
  rangeFrom: number;
  rangeTo: number;
  employeeRate: number;
  employerRate: number;
  maxCompensationBase: number;
};

export type LatestBirWithholdingTaxBracket = {
  payrollTerms: "Semi-Monthly";
  compensationFrom: number;
  compensationTo: number | null;
  baseTax: number;
  overPercentage: number;
};

type LatestStatutoryRateSourceBase = {
  ruleType: StatutoryRuleType;
  sourceLabel: string;
  sourceUrl: string;
};

export type LatestStatutoryRateSource =
  | (LatestStatutoryRateSourceBase & {
      ruleType: "SSS";
      rows: LatestSssContributionBracket[];
    })
  | (LatestStatutoryRateSourceBase & {
      ruleType: "PHILHEALTH";
      rows: LatestPhilhealthContributionRate[];
    })
  | (LatestStatutoryRateSourceBase & {
      ruleType: "PAGIBIG";
      rows: LatestPagibigContributionRate[];
    })
  | (LatestStatutoryRateSourceBase & {
      ruleType: "TAX";
      rows: LatestBirWithholdingTaxBracket[];
    });

function generateSss2025Rows(): LatestSssContributionBracket[] {
  const rows: LatestSssContributionBracket[] = [];

  for (let salaryCredit = 5000; salaryCredit <= 35000; salaryCredit += 500) {
    const isFirst = salaryCredit === 5000;
    const isLast = salaryCredit === 35000;

    rows.push({
      rangeFrom: isFirst ? 0 : salaryCredit - 250,
      rangeTo: isLast ? 999999.99 : salaryCredit + 249.99,
      salaryCredit,
      employeeShare: salaryCredit * 0.05,
      employerShare: salaryCredit * 0.1,
      ecShare: salaryCredit < 15000 ? 10 : 30,
    });
  }

  return rows;
}

const latestStatutoryRateSources = {
  SSS: {
    ruleType: "SSS",
    sourceLabel: "SSS Circular No. 2024-006, effective January 1, 2025",
    sourceUrl:
      "https://www.sss.gov.ph/wp-content/uploads/2024/12/2025-SSS-Contribution-Table-rev.pdf",
    rows: generateSss2025Rows(),
  },
  PHILHEALTH: {
    ruleType: "PHILHEALTH",
    sourceLabel: "PhilHealth Advisory No. 2025-0002, CY 2025 premium schedule",
    sourceUrl: "https://www.philhealth.gov.ph/advisories/2025/PA2025-0002.pdf",
    rows: [
      {
        monthlyBasicSalaryFloor: 10000,
        monthlyBasicSalaryCeiling: 100000,
        premiumRate: 0.05,
        employeeShareRate: 0.5,
        employerShareRate: 0.5,
      },
    ],
  },
  PAGIBIG: {
    ruleType: "PAGIBIG",
    sourceLabel: "Pag-IBIG Fund Circular No. 460, effective February 2024",
    sourceUrl:
      "https://mpm.ph/wp-content/uploads/2024/01/HDMF-Circular-No.-460-Pag-ibig-HDMF-Table-2024.pdf",
    rows: [
      {
        rangeFrom: 0,
        rangeTo: 1500,
        employeeRate: 0.01,
        employerRate: 0.02,
        maxCompensationBase: 10000,
      },
      {
        rangeFrom: 1500.01,
        rangeTo: 999999.99,
        employeeRate: 0.02,
        employerRate: 0.02,
        maxCompensationBase: 10000,
      },
    ],
  },
  TAX: {
    ruleType: "TAX",
    sourceLabel: "BIR RR No. 11-2018 Annex E, effective January 1, 2023 onward",
    sourceUrl: "https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf",
    rows: [
      {
        payrollTerms: "Semi-Monthly",
        compensationFrom: 0,
        compensationTo: 10417,
        baseTax: 0,
        overPercentage: 0,
      },
      {
        payrollTerms: "Semi-Monthly",
        compensationFrom: 10417.01,
        compensationTo: 16666,
        baseTax: 0,
        overPercentage: 0.15,
      },
      {
        payrollTerms: "Semi-Monthly",
        compensationFrom: 16667,
        compensationTo: 33332,
        baseTax: 937.5,
        overPercentage: 0.2,
      },
      {
        payrollTerms: "Semi-Monthly",
        compensationFrom: 33333,
        compensationTo: 83332,
        baseTax: 4270.7,
        overPercentage: 0.25,
      },
      {
        payrollTerms: "Semi-Monthly",
        compensationFrom: 83333,
        compensationTo: 333332,
        baseTax: 16770.7,
        overPercentage: 0.3,
      },
      {
        payrollTerms: "Semi-Monthly",
        compensationFrom: 333333,
        compensationTo: null,
        baseTax: 91770.7,
        overPercentage: 0.35,
      },
    ],
  },
} satisfies Record<StatutoryRuleType, LatestStatutoryRateSource>;

export function getLatestStatutoryRateSource(
  ruleType: StatutoryRuleType
): LatestStatutoryRateSource {
  return latestStatutoryRateSources[ruleType];
}

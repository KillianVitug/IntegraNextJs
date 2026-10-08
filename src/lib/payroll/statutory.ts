 import { db, type DbClient } from "@/db";
import {
  birWithholdingTaxBrackets,
  pagibigContributionRates,
  philhealthContributionRates,
  sssContributionBrackets,
  statutoryRuleTypeEnum,
  statutoryRuleVersions,
} from "@/db/schema";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";

export type ScheduleFlagsLike = {
  always?: boolean;
  endOfMonth?: boolean;
  firstPayroll?: boolean;
  secondPayroll?: boolean;
  thirdPayroll?: boolean;
  forthPayroll?: boolean;
};

export type StatutoryContributionResult = {
  employeeShare: number;
  employerShare: number;
  ecShare: number;
};

export type SssContributionResult = StatutoryContributionResult & {
  salaryCredit: number | null;
  rangeFrom: number | null;
  rangeTo: number | null;
};

export type ActiveStatutoryRuleBundle = {
  sssVersionId: number | null;
  philhealthVersionId: number | null;
  pagibigVersionId: number | null;
  taxVersionId: number | null;
};

/** Read once per calculation. Never shared across requests or rule revisions. */
export type StatutoryCalculationRules = {
  versions: ActiveStatutoryRuleBundle;
  sss: (typeof sssContributionBrackets.$inferSelect)[];
  philhealth: (typeof philhealthContributionRates.$inferSelect)[];
  pagibig: (typeof pagibigContributionRates.$inferSelect)[];
  tax: (typeof birWithholdingTaxBrackets.$inferSelect)[];
};
export async function loadStatutoryCalculationRules(versions: ActiveStatutoryRuleBundle, database: DbClient = db): Promise<StatutoryCalculationRules> {
  const [sss,philhealth,pagibig,tax]=await Promise.all([
    versions.sssVersionId ? database.select().from(sssContributionBrackets).where(eq(sssContributionBrackets.versionId,versions.sssVersionId)).orderBy(sssContributionBrackets.rangeFrom) : [],
    versions.philhealthVersionId ? database.select().from(philhealthContributionRates).where(eq(philhealthContributionRates.versionId,versions.philhealthVersionId)).limit(1) : [],
    versions.pagibigVersionId ? database.select().from(pagibigContributionRates).where(eq(pagibigContributionRates.versionId,versions.pagibigVersionId)).orderBy(pagibigContributionRates.rangeFrom) : [],
    versions.taxVersionId ? database.select().from(birWithholdingTaxBrackets).where(and(eq(birWithholdingTaxBrackets.versionId,versions.taxVersionId),eq(birWithholdingTaxBrackets.payrollTerms,"Semi-Monthly"))).orderBy(birWithholdingTaxBrackets.compensationFrom) : [],
  ]);
  return {versions:{...versions},sss,philhealth,pagibig,tax};
}
function checkedRules(rules:StatutoryCalculationRules,version:keyof ActiveStatutoryRuleBundle,id:number) {
  if(rules.versions[version]!==id)throw new Error("Calculation rule version mismatch. Reload the payroll calculation.");
  return rules;
}

function toAmount(value: string | number | null | undefined) {
  if (value == null) return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

export function roundMoney(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function isScheduleApplicable(
  cycle: "A" | "B",
  flags?: ScheduleFlagsLike
) {
  if (!flags) return true;
  if (flags.always) return true;
  if (cycle === "A" && flags.firstPayroll) return true;
  if (cycle === "B" && (flags.secondPayroll || flags.endOfMonth)) return true;
  return false;
}

export function isSssEcApplicableForCycle(cycle: "A" | "B") {
  return cycle === "A";
}

export function distributeScheduledAmount(
  totalAmount: number,
  cycle: "A" | "B",
  flags?: ScheduleFlagsLike
) {
  if (!flags || flags.always) {
    return roundMoney(totalAmount / 2);
  }

  return isScheduleApplicable(cycle, flags) ? roundMoney(totalAmount) : 0;
}

export async function getActiveStatutoryVersion(
  ruleType: (typeof statutoryRuleTypeEnum.enumValues)[number],
  asOfDate: string,
  payrollTerms: "Semi-Monthly" = "Semi-Monthly",
  database: DbClient = db
) {
  const [rule] = await database
    .select()
    .from(statutoryRuleVersions)
    .where(
      and(
        eq(statutoryRuleVersions.ruleType, ruleType),
        eq(statutoryRuleVersions.payrollTerms, payrollTerms),
        eq(statutoryRuleVersions.status, "Published"),
        lte(statutoryRuleVersions.effectiveFrom, asOfDate),
        or(
          isNull(statutoryRuleVersions.effectiveTo),
          gte(statutoryRuleVersions.effectiveTo, asOfDate)
        )
      )
    )
    .orderBy(desc(statutoryRuleVersions.effectiveFrom))
    .limit(1);

  return rule ?? null;
}

export async function getActiveStatutoryRuleBundle(
  asOfDate: string,
  payrollTerms: "Semi-Monthly" = "Semi-Monthly",
  database: DbClient = db
): Promise<ActiveStatutoryRuleBundle> {
  const [sss, philhealth, pagibig, tax] = await Promise.all([
    getActiveStatutoryVersion("SSS", asOfDate, payrollTerms, database),
    getActiveStatutoryVersion("PHILHEALTH", asOfDate, payrollTerms, database),
    getActiveStatutoryVersion("PAGIBIG", asOfDate, payrollTerms, database),
    getActiveStatutoryVersion("TAX", asOfDate, payrollTerms, database),
  ]);

  return {
    sssVersionId: sss?.id ?? null,
    philhealthVersionId: philhealth?.id ?? null,
    pagibigVersionId: pagibig?.id ?? null,
    taxVersionId: tax?.id ?? null,
  };
}

export async function computeSssContribution(
  monthlyCompensation: number,
  versionId: number,
  rules?: StatutoryCalculationRules
): Promise<SssContributionResult> {
  const brackets = rules ? checkedRules(rules,"sssVersionId",versionId).sss : await db
    .select()
    .from(sssContributionBrackets)
    .where(eq(sssContributionBrackets.versionId, versionId))
    .orderBy(sssContributionBrackets.rangeFrom);

  if (brackets.length === 0) {
    return {
      employeeShare: 0,
      employerShare: 0,
      ecShare: 0,
      salaryCredit: null,
      rangeFrom: null,
      rangeTo: null,
    };
  }

  const bracket =
    brackets.find((row) => {
      const rangeFrom = toAmount(row.rangeFrom);
      const rangeTo = toAmount(row.rangeTo);
      return monthlyCompensation >= rangeFrom && monthlyCompensation <= rangeTo;
    }) ?? brackets[brackets.length - 1];

  return {
    employeeShare: roundMoney(toAmount(bracket?.employeeShare)),
    employerShare: roundMoney(toAmount(bracket?.employerShare)),
    ecShare: roundMoney(toAmount(bracket?.ecShare)),
    salaryCredit: roundMoney(toAmount(bracket?.salaryCredit)),
    rangeFrom: roundMoney(toAmount(bracket?.rangeFrom)),
    rangeTo: roundMoney(toAmount(bracket?.rangeTo)),
  };
}

export async function computePhilhealthContribution(
  monthlyCompensation: number,
  versionId: number,
  rules?: StatutoryCalculationRules
) {
  const [rate] = rules ? checkedRules(rules,"philhealthVersionId",versionId).philhealth : await db
    .select()
    .from(philhealthContributionRates)
    .where(eq(philhealthContributionRates.versionId, versionId))
    .limit(1);

  if (!rate) {
    return { employeeShare: 0, employerShare: 0, ecShare: 0 };
  }

  const floor = toAmount(rate.monthlyBasicSalaryFloor);
  const ceiling = toAmount(rate.monthlyBasicSalaryCeiling);
  const basis = Math.min(Math.max(monthlyCompensation, floor), ceiling);
  const totalPremium = basis * toAmount(rate.premiumRate);

  return {
    employeeShare: roundMoney(totalPremium * toAmount(rate.employeeShareRate)),
    employerShare: roundMoney(totalPremium * toAmount(rate.employerShareRate)),
    ecShare: 0,
  } satisfies StatutoryContributionResult;
}

export async function computePagibigContribution(
  monthlyCompensation: number,
  versionId: number,
  rules?: StatutoryCalculationRules
) {
  const rates = rules ? checkedRules(rules,"pagibigVersionId",versionId).pagibig : await db
    .select()
    .from(pagibigContributionRates)
    .where(eq(pagibigContributionRates.versionId, versionId))
    .orderBy(pagibigContributionRates.rangeFrom);

  const rate =
    rates.find((row) => {
      const rangeFrom = toAmount(row.rangeFrom);
      const rangeTo = toAmount(row.rangeTo);
      return monthlyCompensation >= rangeFrom && monthlyCompensation <= rangeTo;
    }) ?? rates[rates.length - 1];

  if (!rate) {
    return { employeeShare: 0, employerShare: 0, ecShare: 0 };
  }

  const maxCompensationBase = toAmount(rate.maxCompensationBase) || monthlyCompensation;
  const basis = Math.min(monthlyCompensation, maxCompensationBase);

  return {
    employeeShare: roundMoney(basis * toAmount(rate.employeeRate)),
    employerShare: roundMoney(basis * toAmount(rate.employerRate)),
    ecShare: 0,
  } satisfies StatutoryContributionResult;
}

export async function computeBirWithholding(
  taxableCompensation: number,
  versionId: number,
  payrollTerms: "Semi-Monthly" = "Semi-Monthly",
  rules?: StatutoryCalculationRules
) {
  const brackets = rules ? checkedRules(rules,"taxVersionId",versionId).tax : await db
    .select()
    .from(birWithholdingTaxBrackets)
    .where(
      and(
        eq(birWithholdingTaxBrackets.versionId, versionId),
        eq(birWithholdingTaxBrackets.payrollTerms, payrollTerms)
      )
    )
    .orderBy(birWithholdingTaxBrackets.compensationFrom);

  const bracket =
    brackets.find((row) => {
      const compensationFrom = toAmount(row.compensationFrom);
      const compensationTo =
        row.compensationTo == null ? Number.POSITIVE_INFINITY : toAmount(row.compensationTo);

      return (
        taxableCompensation >= compensationFrom &&
        taxableCompensation <= compensationTo
      );
    }) ?? brackets[brackets.length - 1];

  if (!bracket) return 0;

  const compensationFrom = toAmount(bracket.compensationFrom);
  const baseTax = toAmount(bracket.baseTax);
  const overPercentage = toAmount(bracket.overPercentage);

  return roundMoney(
    taxableCompensation <= compensationFrom
      ? baseTax
      : baseTax + (taxableCompensation - compensationFrom) * overPercentage
  );
}

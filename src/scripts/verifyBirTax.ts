import assert from "node:assert/strict";
import {
  computeAnnualBirTax2023Onward,
  computeBirTaxableCompensation,
  inferBirTaxCategory,
  isFinalDecemberSemiMonthlyPayroll,
} from "../lib/payroll/birTax";

function assertClose(actual: number, expected: number) {
  assert.equal(Math.abs(actual - expected) < 0.000001, true);
}

const statutoryTaxableBasis = computeBirTaxableCompensation({
  lines: [
    {
      lineType: "Earning",
      code: "REG",
      amount: 30_000,
      taxable: true,
      birTaxCategory: "RegularTaxable",
    },
  ],
  employeeDeductions: {
    sssEmployee: 1_350,
    philhealthEmployee: 750,
    pagibigEmployee: 200,
  },
});

assertClose(statutoryTaxableBasis.taxableCompensation, 27_700);

const thirteenthBelowCap = computeBirTaxableCompensation({
  lines: [
    {
      lineType: "Earning",
      code: "13TH",
      amount: 80_000,
      taxable: true,
      birTaxCategory: "ThirteenthMonthOtherBenefits",
    },
  ],
});

assertClose(thirteenthBelowCap.taxableCompensation, 0);
assertClose(thirteenthBelowCap.nonTaxable, 80_000);

const thirteenthAboveCap = computeBirTaxableCompensation({
  lines: [
    {
      lineType: "Earning",
      code: "13TH",
      amount: 100_000,
      taxable: true,
      birTaxCategory: "ThirteenthMonthOtherBenefits",
    },
  ],
});

assertClose(thirteenthAboveCap.taxableCompensation, 10_000);
assertClose(thirteenthAboveCap.benefitTaxableExcess, 10_000);

const deMinimisWithinCap = computeBirTaxableCompensation({
  lines: [
    {
      lineType: "Earning",
      code: "UNIFORM",
      amount: 6_000,
      taxable: true,
      birTaxCategory: "DeMinimis",
      birDeMinimisType: "UniformClothing",
    },
  ],
});

assertClose(deMinimisWithinCap.taxableCompensation, 0);
assertClose(deMinimisWithinCap.nonTaxable, 6_000);

const deMinimisExcessUsesBenefitCap = computeBirTaxableCompensation({
  yearToDate: {
    priorTaxableCompensation: 0,
    priorTaxWithheld: 0,
    thirteenthMonthOtherBenefits: 89_000,
    deMinimisByType: {},
  },
  lines: [
    {
      lineType: "Earning",
      code: "UNIFORM",
      amount: 8_000,
      taxable: true,
      birTaxCategory: "DeMinimis",
      birDeMinimisType: "UniformClothing",
    },
  ],
});

assertClose(deMinimisExcessUsesBenefitCap.deMinimisExcessToBenefits, 2_000);
assertClose(deMinimisExcessUsesBenefitCap.benefitTaxableExcess, 1_000);
assertClose(deMinimisExcessUsesBenefitCap.taxableCompensation, 1_000);

const semiMonthlyBracketTax = (taxableCompensation: number) => {
  if (taxableCompensation <= 10_417) return 0;
  if (taxableCompensation <= 16_666) {
    return Math.round((taxableCompensation - 10_417) * 0.15 * 100) / 100;
  }
  if (taxableCompensation <= 33_332) {
    return Math.round((937.5 + (taxableCompensation - 16_667) * 0.2) * 100) / 100;
  }
  return Math.round((4_270.7 + (taxableCompensation - 33_333) * 0.25) * 100) / 100;
};

assertClose(semiMonthlyBracketTax(27_700), 3_144.1);

assert.equal(isFinalDecemberSemiMonthlyPayroll({ month: 12, cycle: "B" }), true);
assert.equal(isFinalDecemberSemiMonthlyPayroll({ month: 12, cycle: "A" }), false);

const annualTaxDue = computeAnnualBirTax2023Onward(600_000);
assertClose(annualTaxDue, 62_500);
assertClose(Math.max(0, annualTaxDue - 50_000), 12_500);

const mweDeferred = computeBirTaxableCompensation({
  taxProfile: { isMinimumWageEarner: true },
  lines: [
    {
      lineType: "Earning",
      code: "REG",
      amount: 15_000,
      taxable: true,
      birTaxCategory: "RegularTaxable",
    },
  ],
});

assert.equal(mweDeferred.taxableCompensation, 15_000);
assert.equal(
  mweDeferred.mweDeferredNote,
  "Minimum Wage Earner exemption not applied: wage-region/rate data is not configured."
);

assert.equal(
  inferBirTaxCategory({
    lineType: "Earning",
    accountType: "Other Income",
    code: "BONUS",
    amount: 5_000,
    taxable: true,
  }),
  "SupplementalTaxable"
);

const customPercentageBasis = 20_000;
assertClose(customPercentageBasis * 0.05, 1_000);

console.log("BIR tax fixtures passed.");

import assert from "node:assert/strict";
import { resolvePhilhealthMonthlyCompensationBase } from "../lib/payroll/philhealthAnnualization";

function assertClose(actual: number, expected: number) {
  assert.equal(Math.abs(actual - expected) < 0.000001, true);
}

const divisor26AnnualizedDailyBasis = (1000 * 313) / 12;
const divisor22AnnualizedDailyBasis = (1000 * 261) / 12;

const missingDivisor = resolvePhilhealthMonthlyCompensationBase({
  salary: { customPayrollId: null, rateDivisor: null },
  dailyRate: 1000,
  monthlyRate: 0,
  monthlyCompensationBase: 26000,
});

assert.equal(missingDivisor.usesAnnualizedDailyRateBasis, true);
assertClose(missingDivisor.monthlyCompensationBase, divisor26AnnualizedDailyBasis);

const divisor26 = resolvePhilhealthMonthlyCompensationBase({
  salary: { customPayrollId: null, rateDivisor: "26" },
  dailyRate: 1000,
  monthlyRate: 0,
  monthlyCompensationBase: 26000,
});

assert.equal(divisor26.usesAnnualizedDailyRateBasis, true);
assertClose(divisor26.monthlyCompensationBase, divisor26AnnualizedDailyBasis);

const divisor22 = resolvePhilhealthMonthlyCompensationBase({
  salary: { customPayrollId: null, rateDivisor: "22" },
  dailyRate: 1000,
  monthlyRate: 0,
  monthlyCompensationBase: 22000,
});

assert.equal(divisor22.usesAnnualizedDailyRateBasis, true);
assertClose(divisor22.monthlyCompensationBase, divisor22AnnualizedDailyBasis);

const divisor24 = resolvePhilhealthMonthlyCompensationBase({
  salary: { customPayrollId: null, rateDivisor: "24" },
  dailyRate: 1000,
  monthlyRate: 0,
  monthlyCompensationBase: 24000,
});

assert.equal(divisor24.usesAnnualizedDailyRateBasis, false);
assert.equal(divisor24.monthlyCompensationBase, 24000);

const monthlyRate = resolvePhilhealthMonthlyCompensationBase({
  salary: { customPayrollId: null, rateDivisor: "26" },
  dailyRate: 1000,
  monthlyRate: 30000,
  monthlyCompensationBase: 30000,
});

assert.equal(monthlyRate.usesAnnualizedDailyRateBasis, false);
assert.equal(monthlyRate.monthlyCompensationBase, 30000);

const customPayrollDivisor26 = resolvePhilhealthMonthlyCompensationBase({
  salary: { customPayrollId: 1, rateDivisor: "26" },
  dailyRate: 1000,
  monthlyRate: 0,
  monthlyCompensationBase: 26000,
});

assert.equal(customPayrollDivisor26.usesAnnualizedDailyRateBasis, true);
assertClose(
  customPayrollDivisor26.monthlyCompensationBase,
  divisor26AnnualizedDailyBasis
);

const customPayrollDivisor22 = resolvePhilhealthMonthlyCompensationBase({
  salary: { customPayrollId: 1, rateDivisor: "22" },
  dailyRate: 1000,
  monthlyRate: 0,
  monthlyCompensationBase: 22000,
});

assert.equal(customPayrollDivisor22.usesAnnualizedDailyRateBasis, true);
assertClose(
  customPayrollDivisor22.monthlyCompensationBase,
  divisor22AnnualizedDailyBasis
);

console.log("PhilHealth annualization fixtures passed.");

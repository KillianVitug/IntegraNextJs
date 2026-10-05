import assert from "node:assert/strict";
import { getLatestStatutoryRateSource } from "@/lib/payroll/statutoryRateImport";

const sss = getLatestStatutoryRateSource("SSS");
assert.equal(sss.rows.length, 61);
assert.deepEqual(sss.rows[0], {
  rangeFrom: 0,
  rangeTo: 5249.99,
  salaryCredit: 5000,
  employeeShare: 250,
  employerShare: 500,
  ecShare: 10,
});
assert.deepEqual(sss.rows[20], {
  rangeFrom: 14750,
  rangeTo: 15249.99,
  salaryCredit: 15000,
  employeeShare: 750,
  employerShare: 1500,
  ecShare: 30,
});
assert.deepEqual(sss.rows[60], {
  rangeFrom: 34750,
  rangeTo: 999999.99,
  salaryCredit: 35000,
  employeeShare: 1750,
  employerShare: 3500,
  ecShare: 30,
});

const philhealth = getLatestStatutoryRateSource("PHILHEALTH");
assert.equal(philhealth.rows.length, 1);
assert.deepEqual(philhealth.rows[0], {
  monthlyBasicSalaryFloor: 10000,
  monthlyBasicSalaryCeiling: 100000,
  premiumRate: 0.05,
  employeeShareRate: 0.5,
  employerShareRate: 0.5,
});

const pagibig = getLatestStatutoryRateSource("PAGIBIG");
assert.equal(pagibig.rows.length, 2);
assert.deepEqual(pagibig.rows, [
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
]);

const tax = getLatestStatutoryRateSource("TAX");
assert.equal(tax.rows.length, 6);
assert.deepEqual(tax.rows, [
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
]);

console.log("Statutory rate import fixtures passed.");

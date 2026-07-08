import assert from "node:assert/strict";
import { normalizeSalaryForDb } from "../lib/payroll/salaryNormalization";
import { insertEmployeeSalarySchema } from "../zod-schemas/employeeSalary";

const baseSalary = {
  dailyRate: "1,234.5678",
  monthlyRate: "0",
  monthlyAllowance: "1,000",
  dailyAllowance: "25.5",
  cola: "0",
  rateDivisor: "26",
  billingRate: "120.4",
  ignoreDtrForMonthlyRate: false,
  ignoreContributionDeduction: true,
  customPayrollId: "2",
  customPayrollDescription: "Custom payroll",
};

const slvlZero = normalizeSalaryForDb({
  ...baseSalary,
  id: 123,
  employeeId: "00000000-0000-0000-0000-000000000000",
  slvlGroupId: "0",
});

assert.equal(slvlZero.slvlGroupId, 0);
assert.equal(slvlZero.customPayrollId, 2);
assert.equal(slvlZero.dailyRate, "1234.5678");
assert.equal(slvlZero.monthlyAllowance, "1000.00");
assert.equal(slvlZero.dailyAllowance, "25.50");
assert.equal(slvlZero.cola, "0.00");
assert.equal(slvlZero.rateDivisor, "26.00");
assert.equal(slvlZero.billingRate, "120.40");
assert.equal(slvlZero.ignoreContributionDeduction, true);
assert.equal("id" in slvlZero, false);
assert.equal("employeeId" in slvlZero, false);

const slvlOne = normalizeSalaryForDb({
  ...baseSalary,
  slvlGroupId: "1",
});

assert.equal(slvlOne.slvlGroupId, 1);

const emptyLookupIds = normalizeSalaryForDb({
  ...baseSalary,
  slvlGroupId: "",
  customPayrollId: "0",
});

assert.equal(emptyLookupIds.slvlGroupId, null);
assert.equal(emptyLookupIds.customPayrollId, null);

const validIntegerLookup = insertEmployeeSalarySchema.safeParse({
  ...baseSalary,
  slvlGroupId: "0",
});

assert.equal(validIntegerLookup.success, true);

const invalidDecimalLookup = insertEmployeeSalarySchema.safeParse({
  ...baseSalary,
  slvlGroupId: "0.00",
});

assert.equal(invalidDecimalLookup.success, false);

assert.throws(
  () =>
    normalizeSalaryForDb({
      ...baseSalary,
      slvlGroupId: "0.00",
    }),
  /SLVL Group must be an integer id/,
);

console.log("Salary normalization fixtures passed.");

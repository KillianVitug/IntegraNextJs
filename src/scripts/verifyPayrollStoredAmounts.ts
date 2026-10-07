import assert from "node:assert/strict";
import { reconcileStoredPayrollAmounts } from "../lib/payroll/storedAmounts";

const base = { regularPay: 1200, grossPay: 1200, taxablePay: 516.875,
  nonTaxablePay: 0, totalDeductions: 683.125, employeeContributions: 683.125,
  employerContributions: 1000, netPay: 516.875, lines: [
    { lineType: "Earning", code: "REG", amount: 1200, rate: 75.1234 },
    { lineType: "Deduction", code: "SSS", amount: 387.5 },
    { lineType: "Deduction", code: "PHILHEALTH", amount: 195.625 },
    { lineType: "Deduction", code: "PAGIBIG", amount: 100 },
    { lineType: "Employer Contribution", code: "PHILHEALTH-ER", amount: 195.625 },
    { lineType: "Information", code: "LATE-UT", amount: 999.999 },
  ] };
const rounded = reconcileStoredPayrollAmounts(base);
assert.equal(rounded.totalDeductions, 683.13);
assert.equal(rounded.netPay, 516.87, "Net must subtract the actually stored deductions");
assert.equal(rounded.employeeContributions, 683.13);
assert.equal(rounded.employerContributions, 195.63);
assert.equal(rounded.lines[0].rate, 75.1234, "Do not reduce salary rate precision");
assert.equal(base.lines[2].amount, 195.625, "Do not mutate calculation inputs");
assert.deepEqual(reconcileStoredPayrollAmounts(rounded), rounded, "Finalization must be idempotent");
const negative = reconcileStoredPayrollAmounts({...base, lines: [
  {lineType:"Earning",code:"REG",amount:337.5},
  {lineType:"Deduction",code:"SSS",amount:757.575},
]});
assert.equal(negative.netPay, -420.08, "Rounding must not invent a deduction deferral policy");
const zero = reconcileStoredPayrollAmounts({...base, regularPay:0,taxablePay:0,lines:[]});
assert.equal(zero.grossPay,0);assert.equal(zero.netPay,0);assert.equal(zero.totalDeductions,0);
const split = reconcileStoredPayrollAmounts({...base,lines:[
  {lineType:"Earning",code:"REG",amount:10.005},
  {lineType:"Earning",code:"ALLOW",amount:10.005},
  {lineType:"Deduction",code:"LOAN",amount:1.235},
]});
assert.equal(split.grossPay,20.02);assert.equal(split.totalDeductions,1.24);
assert.equal(split.employeeContributions,0);assert.equal(split.netPay,18.78);
const manual = reconcileStoredPayrollAmounts({...base,lines:[
  {lineType:"Earning",code:"MANUAL",amount:1000},
  {lineType:"Deduction",code:"PERAA",amount:25.125},
  {lineType:"Employer Contribution",code:"PERAA-ER",amount:50.125},
]});
assert.equal(manual.employeeContributions,25.13);
assert.equal(manual.employerContributions,50.13);
assert.equal(manual.netPay,974.87);
assert.throws(()=>reconcileStoredPayrollAmounts({...base,lines:[{lineType:"Earning",code:"REG",amount:NaN}]}),/finite/);
console.log("PASS stored payroll lines, cents totals, fractional contribution regression, zero earnings, negative net preservation, precision and idempotence");

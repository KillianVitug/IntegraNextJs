import assert from "node:assert/strict";
import {
  buildManualPayrollContributionLines,
  buildManualPayrollRunLines,
} from "@/lib/payroll/manualPayroll";
import { isSssEcApplicableForCycle } from "@/lib/payroll/statutory";

const manualEntry = {
  id: "manual-entry-id",
  sssEmployee: "500.00",
  sssEmployer: "1000.00",
  sssEc: "30.00",
  philhealthEmployee: "200.00",
  philhealthEmployer: "200.00",
  pagibigEmployee: "100.00",
  pagibigEmployer: "100.00",
  withholdingTax: "50.00",
  peraaEmployee: "25.00",
  peraaEmployer: "25.00",
} as Parameters<typeof buildManualPayrollContributionLines>[0];

const manualEntryWithLines = {
  ...manualEntry,
  lines: [],
} as Parameters<typeof buildManualPayrollRunLines>[0];

assert.equal(isSssEcApplicableForCycle("A"), true);
assert.equal(isSssEcApplicableForCycle("B"), false);

const cycleAContributionLines = buildManualPayrollContributionLines(manualEntry, "A");
const cycleBContributionLines = buildManualPayrollContributionLines(manualEntry, "B");

assert.equal(
  cycleAContributionLines.find((line) => line.code === "SSS-EC")?.amount,
  30
);
assert.equal(
  cycleBContributionLines.some((line) => line.code === "SSS-EC"),
  false
);

const cycleBRunLines = buildManualPayrollRunLines(manualEntryWithLines, "B");
assert.equal(cycleBRunLines.some((line) => line.code === "SSS-EC"), false);

const cycleBEmployerContributionTotal = cycleBContributionLines
  .filter((line) => line.lineType === "Employer Contribution")
  .reduce((total, line) => total + line.amount, 0);

assert.equal(cycleBEmployerContributionTotal, 1325);

console.log("SSS EC first-payroll verification passed.");

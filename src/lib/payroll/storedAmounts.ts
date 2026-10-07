type StoredLine = { lineType: string; code: string; amount: number };
type ComputedAmounts = {
  regularPay: number;
  grossPay: number;
  taxablePay: number;
  nonTaxablePay: number;
  totalDeductions: number;
  employeeContributions: number;
  employerContributions: number;
  netPay: number;
  lines: StoredLine[];
};

const employeeShareCodes = new Set(["SSS", "PHILHEALTH", "PAGIBIG", "PERAA", "TAX"]);

function storedCents(amount: number) {
  if (!Number.isFinite(amount)) throw new Error("Payroll amount must be finite");
  // Match the existing numeric(12,2) serialization once, at the storage boundary.
  return Math.round(Number(amount.toFixed(2)) * 100);
}

/** Keep persisted totals equal to the persisted line items without rounding rates. */
export function reconcileStoredPayrollAmounts<T extends ComputedAmounts>(input: T): T {
  const lines = input.lines.map(line => ({ ...line, amount: storedCents(line.amount) / 100 }));
  const sum = (predicate: (line: StoredLine) => boolean) =>
    lines.filter(predicate).reduce((total, line) => total + storedCents(line.amount), 0);
  const gross = sum(line => line.lineType === "Earning");
  const deductions = sum(line => line.lineType === "Deduction");
  return {
    ...input,
    lines,
    regularPay: storedCents(input.regularPay) / 100,
    taxablePay: storedCents(input.taxablePay) / 100,
    nonTaxablePay: storedCents(input.nonTaxablePay) / 100,
    grossPay: gross / 100,
    totalDeductions: deductions / 100,
    employeeContributions: sum(line => line.lineType === "Deduction" && employeeShareCodes.has(line.code)) / 100,
    employerContributions: sum(line => line.lineType === "Employer Contribution") / 100,
    netPay: (gross - deductions) / 100,
  };
}

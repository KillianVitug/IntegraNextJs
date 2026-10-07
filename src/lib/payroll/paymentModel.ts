export type PaymentMode = "Bank" | "Cash";
export type PaymentEmployee = {
  employeeId: string; employeeNoSnapshot: string; employeeNameSnapshot: string;
  grossPay: string; totalDeductions: string; netPay: string;
  paymentMode: PaymentMode | null; bankAccountNo: string | null;
};

export function payrollCents(value: string | number) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Invalid payroll amount.");
  return Math.round(amount * 100);
}

export function paymentSummary(rows: PaymentEmployee[]) {
  const total = (key: "grossPay" | "totalDeductions" | "netPay") => rows.reduce((sum, row) => sum + payrollCents(row[key]), 0) / 100;
  return {
    gross: total("grossPay"), deductions: total("totalDeductions"), net: total("netPay"),
    payable: rows.reduce((sum, row) => sum + Math.max(0, payrollCents(row.netPay)), 0) / 100,
    shortfall: rows.reduce((sum, row) => sum + Math.max(0, -payrollCents(row.netPay)), 0) / 100,
    positiveCount: rows.filter(row => payrollCents(row.netPay) > 0).length,
    zeroCount: rows.filter(row => payrollCents(row.netPay) === 0).length,
    shortfalls: rows.filter(row => payrollCents(row.netPay) < 0).map(row => ({ employeeId: row.employeeId, employeeNo: row.employeeNoSnapshot, name: row.employeeNameSnapshot, amount: -payrollCents(row.netPay) / 100 })),
  };
}

export function selectPaymentRows(rows: PaymentEmployee[], mode: PaymentMode, unassignedMode?: PaymentMode) {
  const positive = rows.filter(row => payrollCents(row.netPay) > 0);
  if (positive.some(row => !row.paymentMode) && !unassignedMode) throw new Error("Choose Bank or Cash for employees without a payment method.");
  const selected = positive.filter(row => (row.paymentMode ?? unassignedMode) === mode);
  if (mode === "Bank") {
    const missing = selected.filter(row => !row.bankAccountNo?.trim());
    if (missing.length) throw new Error(`Bank account required: ${missing.map(row => row.employeeNoSnapshot).join(", ")}.`);
  }
  return selected;
}

// Text cells must not become spreadsheet formulas. Account numbers are text,
// preserving leading zeros; this is a review CSV, not a bank-specific upload format.
export function payrollCsv(rows: (string | number)[][]) {
  const cell = (value: string | number) => {
    const text = typeof value === "number" ? value.toFixed(2) : /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function bankListCsv(rows: PaymentEmployee[], mode: PaymentMode) {
  return payrollCsv([
    ["Employee number", "Employee name", "Payment method", "Bank account (text)", "Amount PHP"],
    ...rows.map(row => [row.employeeNoSnapshot, row.employeeNameSnapshot, mode, mode === "Bank" ? `'${row.bankAccountNo?.trim() ?? ""}` : "", payrollCents(row.netPay) / 100]),
  ]);
}

export function assertPayrollOperator(args: { nextStatus: string; actorUserId: string; actorRole?: string | null; reviewedByUserId: string | null; approvedByUserId: string | null }) {
  const sameActor = args.nextStatus === "Approved" && args.reviewedByUserId === args.actorUserId || args.nextStatus === "Posted" && args.approvedByUserId === args.actorUserId;
  if (sameActor && args.actorRole !== "ADMIN") throw new Error("An administrator is required to complete multiple payroll approval steps.");
  return sameActor ? "Administrator completed multiple payroll steps under the owner-approved single-admin policy." : null;
}

import { payrollCents } from "./paymentModel";

export const SHORTFALL_POLICY = "future-positive-net-v1";
export const SHORTFALL_CODE = "SHORTFALL_RECOVERY";
export const SHORTFALL_SOURCE = "payroll_run_employees";
export type ShortfallBalance = {
  sourceId: string; employeeId: string; periodCode: string; startDate: string;
  originalCents: number; recoveredCents: number; remainingCents: number;
};
export type Recovery = { sourceId: string; employeeId: string; periodCode: string; amountCents: number };
type Line = { code: string; lineType: string; amount: string | number; sourceTable?: string | null; sourceId?: string | null };

export function isShortfallRecovery(line: Line) {
  return line.lineType === "Deduction" && line.code === SHORTFALL_CODE && line.sourceTable === SHORTFALL_SOURCE;
}

/** Current payroll deductions come first. Recovery never creates negative pay. */
export function allocateShortfallRecovery(balances: ShortfallBalance[], employeeId: string, availableNet: string | number): Recovery[] {
  let available = Math.max(0, payrollCents(availableNet));
  const result: Recovery[] = [];
  for (const balance of balances.filter(row => row.employeeId === employeeId).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.sourceId.localeCompare(b.sourceId))) {
    if (![balance.originalCents, balance.recoveredCents, balance.remainingCents].every(Number.isSafeInteger) || balance.recoveredCents < 0 || balance.remainingCents < 0 || balance.originalCents !== balance.recoveredCents + balance.remainingCents) throw new Error("Invalid shortfall balance.");
    const amountCents = Math.min(available, balance.remainingCents);
    if (amountCents > 0) result.push({sourceId: balance.sourceId, employeeId, periodCode: balance.periodCode, amountCents});
    available -= amountCents;
  }
  return result;
}

export function recoveryLine(recovery: Recovery) {
  return {lineType: "Deduction" as const, code: SHORTFALL_CODE, description: `Prior payroll shortfall — ${recovery.periodCode}`, amount: recovery.amountCents / 100, sourceTable: SHORTFALL_SOURCE, sourceId: recovery.sourceId, taxable: false, month13thEligible: false};
}

export function employeeShortfallAmounts(employee: { grossPay: string | number; totalDeductions: string | number; netPay: string | number; lines: Line[] }) {
  const gross = payrollCents(employee.grossPay), deductions = payrollCents(employee.totalDeductions);
  return {
    collected: Math.max(0, Math.min(gross, deductions)) / 100,
    carriedForward: Math.max(0, -payrollCents(employee.netPay)) / 100,
    recovered: employee.lines.filter(isShortfallRecovery).reduce((sum, line) => sum + payrollCents(line.amount), 0) / 100,
  };
}

export function priorShortfallBalance(snapshot: Record<string, unknown> | null | undefined, employeeId: string) {
  if (!Array.isArray(snapshot?.shortfallBalances)) return 0;
  return snapshot.shortfallBalances.reduce((sum: number, row: Partial<ShortfallBalance>) => sum + (row?.employeeId === employeeId && Number.isSafeInteger(row.remainingCents) && row.remainingCents! > 0 ? row.remainingCents! : 0), 0) / 100;
}

export function shortfallPolicyText(snapshot: Record<string, unknown> | null | undefined, status: string, runType = "Regular") {
  if (runType !== "Regular") return "Adjustment or reversal: no new automatic shortfall balance is created.";
  if (snapshot?.shortfallPolicy === SHORTFALL_POLICY) return status === "Posted"
    ? "Carried forward for automatic deduction from future positive pay, after current deductions. No bank transfer for this shortfall."
    : "On posting, carry forward for automatic deduction from future positive pay, after current deductions. No balance is created by a draft.";
  return ["Draft", "Reviewed"].includes(status)
    ? "Approval will authorize automatic deduction of these shortfalls from future positive pay. The balance starts only when payroll is posted."
    : "Historical shortfall: automatic future deduction was not authorized on this run.";
}

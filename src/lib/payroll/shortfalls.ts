import { createHash } from "node:crypto";
import { db, type DbClient } from "@/db";
import { payrollPeriods, payrollRunEmployees, payrollRunLines, payrollRuns } from "@/db/schema";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { payrollCents } from "./paymentModel";
import { allocateShortfallRecovery, isShortfallRecovery, SHORTFALL_CODE, SHORTFALL_POLICY, SHORTFALL_SOURCE, type ShortfallBalance } from "./shortfallModel";
import { PayrollValidationError } from "./validation";

/** Posted snapshots and linked recovery lines are the immutable balance ledger.
 * No inferred debt from legacy runs, reads that write, or second contribution charge.
 * Include all posted recoveries, even later-dated runs, to protect out-of-order posting.
 */
export async function loadShortfallBalances(employeeIds: string[], beforeDate: string, database: DbClient = db) {
  if (!employeeIds.length) return {balances: [] as ShortfallBalance[], digest: balanceDigest([])};
  const sources = await database.select({sourceId: payrollRunEmployees.id, employeeId: payrollRunEmployees.employeeId, periodCode: payrollPeriods.code, startDate: payrollPeriods.startDate, netPay: payrollRunEmployees.netPay})
    .from(payrollRunEmployees).innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunEmployees.payrollRunId)).innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.payrollPeriodId))
    .where(and(inArray(payrollRunEmployees.employeeId, employeeIds), eq(payrollRuns.status, "Posted"), eq(payrollRuns.runType, "Regular"), lt(payrollRunEmployees.netPay, "0"), lt(payrollPeriods.endDate, beforeDate), sql`${payrollRuns.inputSnapshot}->>'shortfallPolicy'=${SHORTFALL_POLICY}`,
      sql`not exists (select 1 from payroll_runs reversal where reversal.status='Posted' and reversal.run_type='Reversal' and reversal.input_snapshot->>'reversedPayrollRunId'=${payrollRuns.id}::text)`));
  const recoveries = sources.length ? await database.select({sourceId: payrollRunLines.sourceId, employeeId: payrollRunEmployees.employeeId, amount: payrollRunLines.amount})
    .from(payrollRunLines).innerJoin(payrollRunEmployees, eq(payrollRunEmployees.id, payrollRunLines.payrollRunEmployeeId)).innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunEmployees.payrollRunId))
    .where(and(eq(payrollRuns.status, "Posted"), eq(payrollRunLines.lineType, "Deduction"), eq(payrollRunLines.code, SHORTFALL_CODE), eq(payrollRunLines.sourceTable, SHORTFALL_SOURCE), inArray(payrollRunLines.sourceId, sources.map(row => row.sourceId)))) : [];
  const totals = new Map<string, number>();
  for (const row of recoveries) {
    if (!sources.some(source => source.sourceId === row.sourceId && source.employeeId === row.employeeId)) throw new PayrollValidationError("A shortfall recovery belongs to a different employee. Review the linked payroll before continuing.");
    totals.set(row.sourceId!, (totals.get(row.sourceId!) ?? 0) + payrollCents(row.amount));
  }
  const balances = sources.map(row => {
    const originalCents = -payrollCents(row.netPay), recoveredCents = totals.get(row.sourceId) ?? 0;
    if (recoveredCents < 0 || recoveredCents > originalCents) throw new PayrollValidationError("A payroll shortfall balance does not reconcile. Review its recovery history before continuing.");
    return {...row, originalCents, recoveredCents, remainingCents: originalCents - recoveredCents};
  }).filter(row => row.remainingCents > 0).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return {balances, digest: balanceDigest(balances)};
}

function balanceDigest(balances: ShortfallBalance[]) {
  return createHash("sha256").update(JSON.stringify(balances.map(row => [row.sourceId, row.employeeId, row.startDate, row.periodCode, row.originalCents, row.recoveredCents, row.remainingCents]))).digest("hex");
}

type Run = {
  runType: string; status: string; inputSnapshot: Record<string, unknown> | null;
  payrollPeriod: {startDate: string} | null;
  employees: {employeeId: string; netPay: string; lines: (typeof payrollRunLines.$inferSelect)[]}[];
};

/** Called under the payroll input lock at Review, Approve and Post. */
export async function assertShortfallRecoveryCurrent(run: Run, database: DbClient) {
  if (run.runType !== "Regular") return run.inputSnapshot;
  const ledger = await loadShortfallBalances(run.employees.map(row => row.employeeId), run.payrollPeriod!.startDate, database);
  const recoveryInstruction = run.status === "Draft" || run.status === "Stale" ? "Recompute the draft" : "Void this unposted run and recompute";
  if (run.inputSnapshot?.shortfallDigest && run.inputSnapshot.shortfallDigest !== ledger.digest) throw new PayrollValidationError(`Shortfall balances changed after this payroll was calculated. ${recoveryInstruction} before continuing; no balance was collected.`);
  for (const employee of run.employees) {
    const lines = employee.lines.filter(isShortfallRecovery);
    const current = new Map<string, number>();
    for (const line of lines) {
      if (!line.sourceId || payrollCents(line.amount) <= 0 || current.has(line.sourceId)) throw new PayrollValidationError("Invalid or duplicate shortfall recovery. Recompute this payroll.");
      current.set(line.sourceId, payrollCents(line.amount));
    }
    const beforeRecovery = (payrollCents(employee.netPay) + [...current.values()].reduce((sum, cents) => sum + cents, 0)) / 100;
    const expected = allocateShortfallRecovery(ledger.balances, employee.employeeId, beforeRecovery);
    if (current.size !== expected.length || expected.some(row => current.get(row.sourceId) !== row.amountCents)) throw new PayrollValidationError(`Outstanding shortfalls changed or were not included. ${recoveryInstruction} to apply the correct future deductions.`);
  }
  // An existing untouched draft can adopt this policy without recalculating pay.
  // Never silently change the terms of an already-approved historical run.
  if (run.status === "Approved" && run.inputSnapshot?.shortfallPolicy !== SHORTFALL_POLICY) return run.inputSnapshot;
  return {...run.inputSnapshot, shortfallPolicy: SHORTFALL_POLICY, shortfallDigest: ledger.digest, shortfallBalances: ledger.balances};
}

export async function assertShortfallReversal(run: Run, database: DbClient) {
  if (run.runType !== "Reversal") return;
  const originalId = run.inputSnapshot?.reversedPayrollRunId;
  if (typeof originalId !== "string") return;
  const original = await database.query.payrollRuns.findFirst({where: eq(payrollRuns.id, originalId), with: {employees: {with: {lines: true}}}});
  if (!original || original.status !== "Posted") throw new PayrollValidationError("The original payroll must remain posted for a linked reversal.");
  const sourceIds = original.inputSnapshot?.shortfallPolicy === SHORTFALL_POLICY ? original.employees.filter(row => payrollCents(row.netPay) < 0).map(row => row.id) : [];
  if (sourceIds.length) {
    const [recovered] = await database.select({amount: sql<string>`coalesce(sum(${payrollRunLines.amount}),0)`}).from(payrollRunLines)
      .innerJoin(payrollRunEmployees, eq(payrollRunEmployees.id, payrollRunLines.payrollRunEmployeeId)).innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunEmployees.payrollRunId))
      .where(and(eq(payrollRuns.status, "Posted"), eq(payrollRunLines.code, SHORTFALL_CODE), eq(payrollRunLines.sourceTable, SHORTFALL_SOURCE), inArray(payrollRunLines.sourceId, sourceIds)));
    if (payrollCents(recovered?.amount ?? 0) !== 0) throw new PayrollValidationError("This payroll's shortfalls have already been recovered. Reverse the linked recovery payroll first before reversing its source, so collected money is not lost from history.");
  }
}

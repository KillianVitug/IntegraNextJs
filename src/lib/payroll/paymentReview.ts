import { employeeShortfallAmounts, priorShortfallBalance, shortfallPolicyText, SHORTFALL_CODE } from "./shortfallModel";
import { db, type DbClient } from "@/db";
import { employeesGeneralInfo, employeesOtherReferences, payrollRunEmployees, payrollRunLines, payrollRuns } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { paymentSummary, type PaymentEmployee } from "./paymentModel";

export async function loadPaymentEmployees(runId: string, database: DbClient = db): Promise<PaymentEmployee[]> {
  return database.select({
    employeeId: payrollRunEmployees.employeeId,
    employeeNoSnapshot: payrollRunEmployees.employeeNoSnapshot,
    employeeNameSnapshot: payrollRunEmployees.employeeNameSnapshot,
    grossPay: payrollRunEmployees.grossPay,
    totalDeductions: payrollRunEmployees.totalDeductions,
    netPay: payrollRunEmployees.netPay,
    paymentMode: employeesGeneralInfo.payrollMode,
    bankAccountNo: employeesOtherReferences.bankAccountNo,
  }).from(payrollRunEmployees)
    .leftJoin(employeesGeneralInfo, eq(employeesGeneralInfo.employeeId, payrollRunEmployees.employeeId))
    .leftJoin(employeesOtherReferences, eq(employeesOtherReferences.employeeId, payrollRunEmployees.employeeId))
    .where(eq(payrollRunEmployees.payrollRunId, runId)).orderBy(payrollRunEmployees.employeeNoSnapshot);
}

export async function loadPaymentReview(runId: string) {
  const run = await db.query.payrollRuns.findFirst({where: eq(payrollRuns.id, runId)});
  if (!run) throw new Error("Payroll run not found.");
  const [rows, lines] = await Promise.all([
    loadPaymentEmployees(runId),
    db.select({employeeId: payrollRunEmployees.employeeId, code: payrollRunLines.code, lineType: payrollRunLines.lineType, amount: payrollRunLines.amount, sourceId: payrollRunLines.sourceId, sourceTable: payrollRunLines.sourceTable}).from(payrollRunLines).innerJoin(payrollRunEmployees, eq(payrollRunEmployees.id, payrollRunLines.payrollRunEmployeeId)).where(and(eq(payrollRunEmployees.payrollRunId, runId), eq(payrollRunLines.code, SHORTFALL_CODE))),
  ]);
  const recoveries = rows.map(row => {
    const amounts = employeeShortfallAmounts({...row, lines: lines.filter(line => line.employeeId === row.employeeId)});
    const opening = priorShortfallBalance(run.inputSnapshot, row.employeeId);
    return {employeeId: row.employeeId, name: row.employeeNameSnapshot, ...amounts, opening, remaining: Math.max(0, Math.round((opening - amounts.recovered) * 100) / 100)};
  }).filter(row => row.opening > 0 || row.recovered !== 0 || row.carriedForward > 0);
  return { runId, status: run.status, policyText: shortfallPolicyText(run.inputSnapshot, run.status, run.runType), recoveries, ...paymentSummary(rows), rows: rows.map(({bankAccountNo, ...row}) => ({...row, bankAccountLast4: bankAccountNo?.trim().slice(-4) ?? null})) };
}

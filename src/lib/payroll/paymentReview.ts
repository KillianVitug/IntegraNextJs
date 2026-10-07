import { db, type DbClient } from "@/db";
import { employeesGeneralInfo, employeesOtherReferences, payrollRunEmployees, payrollRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
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
  const rows = await loadPaymentEmployees(runId);
  return { runId, status: run.status, ...paymentSummary(rows), rows: rows.map(({bankAccountNo, ...row}) => ({...row, bankAccountLast4: bankAccountNo?.trim().slice(-4) ?? null})) };
}

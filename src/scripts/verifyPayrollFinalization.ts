import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type DbClient } from "@/db";
import { authAccounts, employees, employeesGeneralInfo, employeesOtherReferences, payrollArtifacts, payrollPeriods, payrollRunEmployees, payrollRunEvents, payrollRunLines, payrollRuns, payslipPublications } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { transitionPayrollRunStatus } from "@/lib/payroll/engine";
import { generateBankBatch, publishPayslips } from "@/lib/payroll/control";
import { attendancePayrollSnapshot } from "@/lib/payroll/attendanceSourceGuard";

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1", "Restored local database only");
  const tables = ["payroll_periods", "payroll_runs", "payroll_run_employees", "payroll_run_lines", "payroll_run_events", "payroll_artifacts", "payroll_disbursement_batches", "payroll_bank_files", "payslip_publications", "employees_general_info", "employees_other_references", "loan_installments", "loan_payments"];
  const fingerprint = async () => (await db.execute(sql.raw(tables.map(table => `select '${table}' as name,count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as hash from ${table} t`).join(" union all ")))).rows;
  const before = await fingerprint();
  const rollback = new Error("Fixture rollback");
  try {
    await db.transaction(async tx => {
      const database = {...db, transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)} as typeof db;
      const [actor] = await tx.select().from(authAccounts).limit(1);
      const people = await tx.select().from(employees).limit(3);
      assert.equal(people.length, 3);
      const periodId = randomUUID(), runId = randomUUID();
      await tx.insert(payrollPeriods).values({id: periodId, code: `S5-${periodId.slice(0,8)}`, year: 2099, month: 9, cycle: "B", payrollTerms: "Semi-Monthly", startDate: "2099-09-16", endDate: "2099-09-30", nominalPayDate: "2099-10-05", adjustedPayDate: "2099-10-05", status: "Open"});
      await tx.insert(payrollRuns).values({id: runId, payrollPeriodId: periodId, runNumber: 1, status: "Draft", inputSnapshot: {payrollGroup: "Daily"}});
      const amounts = [{gross: "1000.00", deduction: "100.00", net: "900.00"}, {gross: "100.00", deduction: "250.00", net: "-150.00"}, {gross: "0.00", deduction: "0.00", net: "0.00"}];
      const inserted = await tx.insert(payrollRunEmployees).values(people.map((person, index) => ({payrollRunId: runId, employeeId: person.id, employeeNoSnapshot: person.employeeNo, employeeNameSnapshot: `Fictional Stage 5 ${index}`, grossPay: amounts[index].gross, totalDeductions: amounts[index].deduction, netPay: amounts[index].net}))).returning();
      await tx.insert(payrollRunLines).values(inserted.flatMap((employee, index) => [{payrollRunEmployeeId: employee.id, lineType: "Earning" as const, code: "FIXTURE", description: "Fictional earnings", amount: amounts[index].gross}, {payrollRunEmployeeId: employee.id, lineType: "Deduction" as const, code: "FIXTURE-DED", description: "Fictional deduction", amount: amounts[index].deduction}]));
      await tx.insert(payrollRunEvents).values({payrollRunId: runId, actorUserId: actor.id, eventType: "Computed", notes: JSON.stringify({attendanceSourceInputRunId: await attendancePayrollSnapshot(tx as DbClient, periodId)})});
      const ids = people.map(person => person.id);
      await tx.update(employeesGeneralInfo).set({payrollMode: null}).where(inArray(employeesGeneralInfo.employeeId, ids));
      await tx.update(employeesOtherReferences).set({bankAccountNo: "0012345678"}).where(inArray(employeesOtherReferences.employeeId, ids));
      await assert.rejects(() => generateBankBatch({payrollRunId: runId, actorUserId: actor.id, unassignedMode: "Bank"}, database), /Approve this run/);
      const move = (status: "Reviewed" | "Approved" | "Posted", role = "ADMIN", ack = false) => transitionPayrollRunStatus(runId, status, actor.id, null, database, {actorRole: role, acknowledgeShortfalls: ack});
      await move("Reviewed");
      await assert.rejects(() => move("Approved", "MANAGER", true), /administrator/);
      await assert.rejects(() => move("Approved"), /shortfalls/);
      await move("Approved", "ADMIN", true);
      const approval = await tx.query.payrollRunEvents.findFirst({where: sql`${payrollRunEvents.payrollRunId}=${runId} and ${payrollRunEvents.eventType}='Approved'`});
      assert.match(approval?.notes ?? "", /single-admin/); assert.match(approval?.notes ?? "", /zero transfer/);
      await move("Posted"); await move("Posted");
      const posting = await tx.select().from(payrollRunEvents).where(sql`${payrollRunEvents.payrollRunId}=${runId} and ${payrollRunEvents.eventType}='Posted'`);
      assert.equal(posting.length, 1, "Repeated posting is idempotent");
      await assert.rejects(() => generateBankBatch({payrollRunId: runId, actorUserId: actor.id}, database), /Choose Bank or Cash/);
      const batch = await generateBankBatch({payrollRunId: runId, actorUserId: actor.id, unassignedMode: "Bank"}, database);
      assert.equal(batch.employeeCount, 1); assert.equal(batch.totalNetPay, "900.00");
      assert.equal((await generateBankBatch({payrollRunId: runId, actorUserId: actor.id, unassignedMode: "Bank"}, database)).id, batch.id);
      const [artifact] = await tx.select().from(payrollArtifacts).where(eq(payrollArtifacts.id, batch.artifactId!));
      assert.match(String(artifact.metadata?.paymentListCsv), /'0012345678/); assert.doesNotMatch(String(artifact.metadata?.paymentListCsv), /-150/);
      assert.equal((await publishPayslips({payrollRunId: runId, actorUserId: actor.id}, database)).publishedCount, 3);
      await publishPayslips({payrollRunId: runId, actorUserId: actor.id}, database);
      assert.equal((await tx.select().from(payrollArtifacts).where(sql`${payrollArtifacts.payrollRunId}=${runId} and ${payrollArtifacts.kind}='Payslip'`)).length, 3);
      assert.equal((await tx.select().from(payslipPublications).where(inArray(payslipPublications.payrollRunEmployeeId, inserted.map(employee => employee.id)))).length, 3);
      const final = await tx.query.payrollRuns.findFirst({where: eq(payrollRuns.id, runId)});
      assert.equal(final?.status, "Posted"); assert.equal(final?.approvedByUserId, actor.id); assert.equal(final?.postedByUserId, actor.id);
      throw rollback;
    });
  } catch (error) {if (error !== rollback) throw error;}
  assert.deepEqual(await fingerprint(), before, "Fixture rollback preserves all affected table contents");
  console.log("PASS restored-only finalization: admin authority, shortfall acknowledgment, posting retry, correct bank recipients/cents, output retries, bulk payslip publication and complete rollback");
}
main().then(() => process.exit(0)).catch(error => {console.error(error); process.exit(1);});

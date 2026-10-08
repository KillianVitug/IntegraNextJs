import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { matchingDatabase } from "./attendanceTest/matchingDatabase";
import { employees, payrollPeriods, payrollRuns } from "@/db/schema";
import { workBatches, workHistory, workPlans } from "@/db/attendanceWorkbenchSchema";
import { attendanceSourcePeriods, attendanceSourceRuns } from "@/db/attendanceSourceSchema";
import { attendanceBatchCompletion } from "@/lib/payroll/attendanceCompletion";
import { assertAttendanceSourceReady, attendancePayrollSnapshot } from "@/lib/payroll/attendanceSourceGuard";

async function main() {
  process.env.ATTENDANCE_WORKBENCH_ENABLED = "true";
  process.env.ATTENDANCE_SOURCE_ENABLED = "true";
  const { pg, database, client } = await matchingDatabase();
  try {
    const periodId = randomUUID(), batchId = randomUUID(), actor = randomUUID();
    const employeesIds = [randomUUID(), randomUUID()], planIds = [randomUUID(), randomUUID()];
    await database.insert(employees).values(employeesIds.map((id, i) => ({ id, employeeNo: String(700 + i), firstName: "Completion", lastName: "Fixture" })));
    await database.insert(payrollPeriods).values({ id: periodId, code: "COMPLETION-FIXTURE", payrollTerms: "Semi-Monthly", cycle: "B", year: 2026, month: 9, startDate: "2026-09-16", endDate: "2026-09-30", nominalPayDate: "2026-09-30", adjustedPayDate: "2026-09-30" });
    await database.insert(workBatches).values({ id: batchId, periodId, actor, state: "Draft", revision: 2 });
    await database.insert(workPlans).values(planIds.map((id, i) => ({ id, batchId, periodId, employeeId: employeesIds[i], state: i ? "Needs evidence" : "Resolved", draft: { employeeId: employeesIds[i], days: ["2026-09-30"], changes: [], reason: "", ownerId: actor, needed: "", rejected: false, version: "fixture" }, evidenceVersion: "fixture", ownerId: actor, sourceResult: i ? null : { state: "LocalOnly" } })));
    await assert.rejects(() => attendanceBatchCompletion(periodId, batchId, [], client), /No approved decision/);
    await assert.rejects(() => attendanceBatchCompletion(periodId, batchId, [planIds[1]], client), /No approved decision/);
    await assert.rejects(() => attendanceBatchCompletion(periodId, batchId, planIds, client), /No approved decision/);
    await assert.rejects(() => attendanceBatchCompletion(periodId, randomUUID(), [planIds[0]], client), /No approved decision/);
    const complete = await attendanceBatchCompletion(periodId, batchId, [planIds[0]], client);
    assert.equal(complete.decision, "approved"); assert.equal(complete.attendance, "updated"); assert.equal(complete.payroll, "unchanged");
    const legacyRequest = { operation: "apply-plan", id: randomUUID(), changes: [] };
    await database.update(workPlans).set({ state: "Approved", sourceRequest: legacyRequest, sourceResult: null }).where(eq(workPlans.id, planIds[0]));
    await assert.rejects(() => attendanceBatchCompletion(periodId, batchId, [planIds[0]], client), /historical source request needs local attendance review/, "Legacy approval awaiting delivery is not a saved local attendance decision");
    await database.update(workPlans).set({ state: "Resolved", sourceResult: { readOnlyCutover: { localApproved: false } } }).where(eq(workPlans.id, planIds[0]));
    await assert.rejects(() => attendanceBatchCompletion(periodId, batchId, [planIds[0]], client), /historical source request needs local attendance review/);
    await database.update(workPlans).set({ sourceResult: { readOnlyCutover: { localApproved: true } } }).where(eq(workPlans.id, planIds[0]));
    assert.equal((await attendanceBatchCompletion(periodId, batchId, [planIds[0]], client)).decision, "approved", "A confirmed retained local decision supports completion after source retirement");
    assert.deepEqual((await database.select().from(workPlans).where(eq(workPlans.id, planIds[0])))[0].sourceRequest, legacyRequest, "Completion retains the historical request as audit evidence");
    await database.update(workPlans).set({ sourceRequest: null, sourceResult: { state: "LocalOnly" } }).where(eq(workPlans.id, planIds[0]));
    const runId = randomUUID();
    await database.insert(attendanceSourceRuns).values({ id: runId, payrollPeriodId: periodId, actorUserId: actor, state: "Complete", fromDate: "2026-09-15", throughDate: "2026-10-01" });
    await database.insert(attendanceSourcePeriods).values({ payrollPeriodId: periodId, inputRunId: runId, summariesRunId: null });
    const pending = await attendanceBatchCompletion(periodId, batchId, [planIds[0]], client);
    assert.equal(pending.decision, "approved"); assert.equal(pending.attendance, "pending"); assert.equal(pending.payroll, "unchanged");
    assert.deepEqual(pending.pendingPeriodIds, [periodId]);
    const attendanceVersion = await attendancePayrollSnapshot(client, periodId);
    const receiptDetails = { periodId, version: attendanceVersion, planIds: [planIds[0]] };
    await database.insert(workHistory).values([
      { actor, action: "Unrelated attendance receipt", details: receiptDetails },
      { actor, action: "Attendance decision DTR refreshed", details: { ...receiptDetails, periodId: randomUUID() } },
      { actor, action: "Attendance decision DTR refreshed", details: { ...receiptDetails, version: "earlier-attendance-revision" } },
      { actor, action: "Attendance decision DTR refreshed", details: { ...receiptDetails, planIds: [planIds[1]] } },
    ]);
    assert.equal((await attendanceBatchCompletion(periodId, batchId, [planIds[0]], client)).attendance, "pending", "Another action, period, input revision or selection cannot complete this attendance update");
    const receiptId = randomUUID();
    await database.insert(workHistory).values({ id: receiptId, actor, action: "Attendance decision DTR refreshed", details: receiptDetails });
    const selectedComplete = await attendanceBatchCompletion(periodId, batchId, [planIds[0]], client);
    assert.equal(selectedComplete.attendance, "updated", "The matching input revision and selected plan receipt completes DTR recovery");
    assert.equal(selectedComplete.payroll, "unchanged");
    assert.deepEqual(selectedComplete.pendingPeriodIds, []);
    assert.match(selectedComplete.message, /Payroll preparation remains separate/);
    await assert.rejects(() => assertAttendanceSourceReady(periodId, client), /need DTR refresh/, "Selected DTR completion must not unlock full payroll readiness");
    assert.equal((await database.select().from(attendanceSourcePeriods))[0].summariesRunId, null, "Reading a selected receipt cannot advance the full payroll refresh marker");
    // The same batch can contain another approved plan; a receipt for just one
    // selection does not complete a recovery request covering both plans.
    await database.update(workPlans).set({ state: "Resolved" }).where(eq(workPlans.id, planIds[1]));
    assert.equal((await attendanceBatchCompletion(periodId, batchId, planIds, client)).attendance, "pending", "Every requested plan must be covered by the receipt");
    await database.update(workHistory).set({ details: { ...receiptDetails, planIds } }).where(eq(workHistory.id, receiptId));
    assert.equal((await attendanceBatchCompletion(periodId, batchId, planIds, client)).attendance, "updated");
    assert.equal((await attendanceBatchCompletion(periodId, batchId, [planIds[0]], client)).attendance, "updated", "A receipt covering the entire selection also supports recovery of its approved subset");
    await database.update(workHistory).set({ details: { ...receiptDetails, version: "earlier-attendance-revision", planIds } }).where(eq(workHistory.id, receiptId));
    assert.equal((await attendanceBatchCompletion(periodId, batchId, planIds, client)).attendance, "pending", "Matching plans cannot reuse a stale input revision receipt");
    await database.update(workPlans).set({ state: "Needs evidence" }).where(eq(workPlans.id, planIds[1]));
    const neighbor = randomUUID(), neighborRun = randomUUID();
    await database.insert(payrollPeriods).values({ id: neighbor, code: "COMPLETION-NEIGHBOR", payrollTerms: "Semi-Monthly", cycle: "A", year: 2026, month: 10, startDate: "2026-10-01", endDate: "2026-10-15", nominalPayDate: "2026-10-15", adjustedPayDate: "2026-10-15" });
    await database.update(workPlans).set({ impactedPeriodIds: [periodId, neighbor] }).where(eq(workPlans.id, planIds[0]));
    await database.insert(attendanceSourceRuns).values({ id: neighborRun, payrollPeriodId: neighbor, actorUserId: actor, state: "Complete", fromDate: "2026-09-30", throughDate: "2026-10-16" });
    await database.insert(attendanceSourcePeriods).values({ payrollPeriodId: neighbor, inputRunId: neighborRun, summariesRunId: null });
    const both = await attendanceBatchCompletion(periodId, batchId, [planIds[0]], client);
    assert.deepEqual(new Set(both.pendingPeriodIds), new Set([periodId, neighbor]), "Every affected open period needs fresh attendance");
    await database.insert(payrollRuns).values({ payrollPeriodId: neighbor, runNumber: 1, status: "Posted", inputSnapshot: { payrollGroup: "Monthly" } });
    assert.deepEqual((await attendanceBatchCompletion(periodId, batchId, [planIds[0]], client)).adjustmentPeriodIds, [], "Monthly payout alone does not freeze Daily attendance");
    await database.insert(payrollRuns).values({ payrollPeriodId: neighbor, runNumber: 2, status: "Posted", inputSnapshot: { payrollGroup: "Daily" } });
    const mixed = await attendanceBatchCompletion(periodId, batchId, [planIds[0]], client);
    assert.deepEqual(mixed.pendingPeriodIds, [periodId]); assert.deepEqual(mixed.adjustmentPeriodIds, [neighbor]);
    await database.update(attendanceSourcePeriods).set({ summariesRunId: runId }).where(eq(attendanceSourcePeriods.payrollPeriodId, periodId));
    const posted = await attendanceBatchCompletion(periodId, batchId, [planIds[0]], client);
    assert.equal(posted.attendance, "adjustment-required"); assert.deepEqual(posted.pendingPeriodIds, []); assert.match(posted.message, /Posted payroll/);
    assert.equal((await database.select().from(workBatches))[0].state, "Draft", "Completion reads never complete an unfinished batch");
    assert.deepEqual((await database.select().from(workPlans)).map(p => p.state).sort(), ["Needs evidence", "Resolved"], "Status checks do not replay approvals");
    console.log("PASS exact selected-plan completion, mixed/unfinished batch rejection, revision/plan-scoped DTR receipt recovery without payroll readiness, all-period DTR freshness, Monthly/Daily posted distinction and mutation-free status checks");
  } finally { await pg.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

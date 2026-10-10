import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import { buildShiftBreakRows } from "@/lib/shifts";
import { archiveShiftCatalog, saveShiftCatalog } from "@/lib/scheduling/shift-catalog";
import { archiveWeeklySchedule, confirmScopedScheduleDays, mutatePeriodSchedule, readScheduleWorkspace, saveWeeklySchedules } from "@/lib/scheduling/service";
import type { SchedulePeriodCommand } from "@/lib/scheduling/workspace-types";
import { freshScheduleDatabase } from "./attendanceTest/freshScheduleDatabase";

async function main() {
  const { pg, database, client, transactional } = await freshScheduleDatabase();
  const actor = { userId: randomUUID(), role: "ADMIN" as const };
  let checks = 0;
  try {
    const [branch] = await database.insert(s.department).values({ code: "FICTION", name: "Fictional branch" }).returning();
    const [person, sibling] = await database.insert(s.employees).values(["A", "B"].map(code => ({ employeeNo: code, firstName: "Fictional", lastName: code }))).returning();
    await database.insert(s.employeesGeneralInfo).values([person, sibling].map(row => ({ employeeId: row.id, departmentId: branch.id, dateHired: "2020-10-15" })));
    await database.insert(s.accountCode).values([
      { accountCode: "LWOP", accountType: "Unpaid Leaves/Absences", description: "Leave Without Pay" },
      { accountCode: "REGULAR", accountType: "Regular Hours", description: "Regular hours" },
      { accountCode: "OT", accountType: "Overtime", description: "Regular overtime" },
      { accountCode: "LATE", accountType: "Unpaid Leaves/Absences", description: "Tardiness" },
    ]);
    const periods = await database.insert(s.payrollPeriods).values(["A", "B"].map(cycle => ({ code: `FIX-${cycle}`, year: 2020, month: 10, cycle: cycle as "A" | "B", payrollTerms: "Semi-Monthly" as const, startDate: cycle === "A" ? "2020-10-15" : "2020-10-16", endDate: cycle === "A" ? "2020-10-15" : "2020-10-17", nominalPayDate: "2020-10-20", adjustedPayDate: "2020-10-20", status: "Open" as const }))).returning();
    const baseInput = { requestId: randomUUID(), code: "SPLIT-FIX", description: "Fictional original", regularStartTime: "08:00", regularEndTime: "21:00", calculationPolicy: "eight_hour_day", punchPolicy: "split_gaps", breaks: buildShiftBreakRows([{ slotKey: "mid_break", fromTime: "11:00", toTime: "15:30", deduct: true, deductHours: 4, deductMinutes: 30, requiresPunches: true }]) };
    const original = await saveShiftCatalog(client, actor, baseInput);
    const night = await saveShiftCatalog(client, actor, { ...baseInput, requestId: randomUUID(), code: "NIGHT-FIX", regularStartTime: "22:00", regularEndTime: "06:00", punchPolicy: "outer", breaks: buildShiftBreakRows([]) });
    const query = { departmentId: branch.id, periodId: periods[0].id, effectiveDate: "2020-10-15" };
    let workspace = await readScheduleWorkspace(actor, query, client);
    const weeklyCommand = () => ({ requestId: randomUUID(), departmentId: branch.id, sourceDigest: workspace.weeklyDigest, effectiveFrom: "2020-10-15", effectiveTo: "2020-10-17", employeeIds: [person.id], days: [{ weekday: "Thursday" as const, value: String(original.shiftTableId) }] });
    const weekly = weeklyCommand();
    const weeklyReceipt = await saveWeeklySchedules(actor, weekly, transactional);
    assert.deepEqual(await saveWeeklySchedules(actor, weekly, transactional), weeklyReceipt);
    const savedDays = await database.select().from(s.employeeWeeklyShiftPatternDays);
    assert.equal(savedDays.find(row => row.weekday === "Thursday")?.definitionSnapshot?.breaks[0].requiresPunches, true);
    assert.equal(savedDays.find(row => row.weekday === "Thursday")?.calculationPolicy, "eight_hour_day");
    checks++;
    const revision = await saveShiftCatalog(client, actor, { ...baseInput, requestId: randomUUID(), id: original.shiftTableId, expectedVersion: 1, breaks: buildShiftBreakRows([{ slotKey: "mid_break", fromTime: "12:00", toTime: "16:30", deduct: true, deductHours: 4, deductMinutes: 30, requiresPunches: true }]) });
    workspace = await readScheduleWorkspace(actor, query, client);
    assert.equal(workspace.shifts.some(row => row.id === original.shiftTableId), false);
    assert.equal(workspace.cells.find(row => row.employeeId === person.id)?.snapshot.breaks[0].fromTime, "11:00:00");
    await saveWeeklySchedules(actor, weeklyCommand(), transactional); // unchanged saved archived ID is retained.
    workspace = await readScheduleWorkspace(actor, query, client);
    await assert.rejects(saveWeeklySchedules(actor, { ...weeklyCommand(), employeeIds: [sibling.id] }, transactional), /current shift/);
    const periodCommand = (employeeId = person.id, day = "2020-10-15", value = "captured"): SchedulePeriodCommand => ({ requestId: randomUUID(), departmentId: branch.id, periodId: periods[0].id, sourceDigest: workspace.sourceDigest, expectedDraftId: workspace.draft?.id ?? null, expectedDraftRevision: workspace.draft?.revision ?? null, changes: [{ employeeId, day, value }] });
    await database.update(s.payrollPeriods).set({ status: "Closed" }).where(eq(s.payrollPeriods.id, periods[0].id));
    workspace = await readScheduleWorkspace(actor, query, client);
    await assert.rejects(confirmScopedScheduleDays(actor, periodCommand(), transactional), /closed/);
    await assert.rejects(mutatePeriodSchedule(actor, { ...periodCommand(), changes: [] }, "confirmed", transactional), /closed/);
    await database.update(s.payrollPeriods).set({ status: "Open" }).where(eq(s.payrollPeriods.id, periods[0].id));
    const [protectedRun] = await database.insert(s.payrollRuns).values({ payrollPeriodId: periods[0].id, runNumber: 1, status: "Approved" }).returning();
    await database.insert(s.payrollRunEmployees).values({ payrollRunId: protectedRun.id, employeeId: person.id, employeeNoSnapshot: person.employeeNo, employeeNameSnapshot: "Fictional" });
    workspace = await readScheduleWorkspace(actor, query, client);
    await assert.rejects(confirmScopedScheduleDays(actor, periodCommand(), transactional), /Approved or Posted/);
    await assert.rejects(mutatePeriodSchedule(actor, { ...periodCommand(), changes: [] }, "confirmed", transactional), /Approved or Posted/);
    assert.equal((await database.select().from(s.scheduleDecisionRevisions)).length, 0);
    await database.update(s.payrollRuns).set({ status: "Draft" }).where(eq(s.payrollRuns.id, protectedRun.id)); checks++;
    // Both whole-period/scoped unchanged overnight capture must check the next period.
    await database.insert(s.employeeShiftAssignments).values({ employeeId: person.id, shiftTableId: night.shiftTableId, shiftName: "Fictional night", effectiveFrom: "2020-10-15", effectiveTo: "2020-10-15", checkInTime: "22:00", checkOutTime: "06:00", hoursPerDay: "8.00", breakMinutes: 0 });
    await database.update(s.payrollPeriods).set({ status: "Closed" }).where(eq(s.payrollPeriods.id, periods[1].id));
    workspace = await readScheduleWorkspace(actor, query, client);
    await assert.rejects(confirmScopedScheduleDays(actor, periodCommand(), transactional), /closed.*overnight/);
    await assert.rejects(mutatePeriodSchedule(actor, { ...periodCommand(), changes: [] }, "confirmed", transactional), /closed.*overnight/);
    // Weekly newly selected overnight on sibling also affects a closed next period without a run.
    await assert.rejects(saveWeeklySchedules(actor, { ...weeklyCommand(), employeeIds: [sibling.id], effectiveTo: "2020-10-15", days: [{ weekday: "Thursday", value: String(night.shiftTableId) }] }, transactional), /closed.*overnight/);
    await database.update(s.payrollPeriods).set({ status: "Open" }).where(eq(s.payrollPeriods.id, periods[1].id));
    const [nextRun] = await database.insert(s.payrollRuns).values({ payrollPeriodId: periods[1].id, runNumber: 1, status: "Posted" }).returning();
    await database.insert(s.payrollRunEmployees).values({ payrollRunId: nextRun.id, employeeId: person.id, employeeNoSnapshot: person.employeeNo, employeeNameSnapshot: "Fictional" });
    workspace = await readScheduleWorkspace(actor, query, client);
    await assert.rejects(confirmScopedScheduleDays(actor, periodCommand(), transactional), /Approved or Posted/);
    await assert.rejects(mutatePeriodSchedule(actor, { ...periodCommand(), changes: [] }, "confirmed", transactional), /Approved or Posted/);
    await database.update(s.payrollRuns).set({ status: "Draft" }).where(eq(s.payrollRuns.id, nextRun.id)); checks++;
    workspace = await readScheduleWorkspace(actor, query, client);
    const confirm = periodCommand();
    const receipt = await confirmScopedScheduleDays(actor, confirm, transactional);
    assert.deepEqual(receipt.affectedTargets, [{ employeeId: person.id, day: "2020-10-15" }, { employeeId: person.id, day: "2020-10-16" }]);
    assert.deepEqual(await confirmScopedScheduleDays(actor, confirm, transactional), receipt);
    assert.equal((await database.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, nextRun.id)))[0].status, "Stale");
    const assignments = await database.select().from(s.employeeShiftAssignments);
    const captured = assignments.find(row => row.scheduleDecisionId)!;
    assert.equal(captured.confirmedSchedule?.calculationPolicy, "legacy", "Legacy dated overrides keep their own saved legacy policy");
    assert.equal(assignments.filter(row => row.employeeId === sibling.id).length, 0); checks++;
    // A later full-period confirmation captures only the remaining sibling, carrying
    // the newly selected pay/punch policy and full break flags into the dated row.
    const [batch] = await database.insert(s.attendanceImportBatches).values({ sourceFileName: "fictional.csv", sourceFormat: "CSV", payrollPeriodId: periods[0].id, status: "Processed" }).returning();
    await database.insert(s.attendanceRawLogs).values(["08:00", "12:00", "16:30", "21:00"].map((time, index) => ({ batchId: batch.id, employeeId: sibling.id, employeeNo: sibling.employeeNo, logDate: "2020-10-15", logTime: time, loggedAt: new Date(`2020-10-15T${time}:00Z`), direction: index % 2 ? "OUT" as const : "IN" as const })));
    const sourceLogs = await database.select().from(s.attendanceRawLogs);
    workspace = await readScheduleWorkspace(actor, query, client);
    const fullCommand = periodCommand(sibling.id, "2020-10-15", String(revision.shiftTableId));
    const fullReceipt = await mutatePeriodSchedule(actor, fullCommand, "confirmed", transactional);
    assert.equal(fullReceipt.changedCount, 1);
    assert.deepEqual(await mutatePeriodSchedule(actor, fullCommand, "confirmed", transactional), fullReceipt);
    const siblingCapture = (await database.select().from(s.employeeShiftAssignments).where(eq(s.employeeShiftAssignments.employeeId, sibling.id)))[0];
    assert.equal(siblingCapture.calculationPolicy, "eight_hour_day");
    assert.equal(siblingCapture.punchPolicy, "split_gaps");
    assert.equal(siblingCapture.confirmedSchedule?.breaks[0].requiresPunches, true);
    assert.equal(siblingCapture.confirmedSchedule?.breaks[0].fromTime, "12:00:00");
    const splitSummary = (await database.select().from(s.attendanceDailySummaries).where(eq(s.attendanceDailySummaries.employeeId, sibling.id)))[0];
    assert.equal(splitSummary.calculationPolicy, "eight_hour_day");
    assert.equal(splitSummary.regularMinutes, 480);
    assert.equal(splitSummary.overtimeMinutes, 30);
    assert.deepEqual(await database.select().from(s.attendanceRawLogs), sourceLogs, "Refresh preserves original punch evidence");
    assert.deepEqual((await database.select().from(s.employeeShiftAssignments).where(eq(s.employeeShiftAssignments.id, captured.id)))[0], captured);
    // A Posted sibling run must not block a scoped change for the other employee.
    const [siblingRun] = await database.insert(s.payrollRuns).values({ payrollPeriodId: periods[0].id, runNumber: 2, status: "Posted" }).returning();
    await database.insert(s.payrollRunEmployees).values({ payrollRunId: siblingRun.id, employeeId: sibling.id, employeeNoSnapshot: sibling.employeeNo, employeeNameSnapshot: "Fictional sibling" });
    workspace = await readScheduleWorkspace(actor, query, client);
    const independent = await confirmScopedScheduleDays(actor, periodCommand(person.id, "2020-10-15", "rest"), transactional);
    assert.equal(independent.changedCount, 1);
    workspace = await readScheduleWorkspace(actor, query, client);
    const beforeFailure = await database.select().from(s.scheduleDecisionRevisions);
    await assert.rejects(confirmScopedScheduleDays(actor, periodCommand(sibling.id, "2020-10-15", "rest"), transactional), /Approved or Posted/);
    assert.deepEqual(await database.select().from(s.scheduleDecisionRevisions), beforeFailure);
    checks++;
    await archiveShiftCatalog(client, actor, { requestId: randomUUID(), id: revision.shiftTableId, expectedVersion: 2 });
    workspace = await readScheduleWorkspace(actor, query, client);
    const pattern = workspace.employees.find(row => row.id === person.id)!.weeklyHistory[0];
    await archiveWeeklySchedule(actor, { requestId: randomUUID(), departmentId: branch.id, sourceDigest: workspace.weeklyDigest, employeeId: person.id, patternId: pattern.id, endDate: "2020-10-15" }, transactional);
    assert.equal((await database.select().from(s.employeeWeeklyShiftPatternDays).where(eq(s.employeeWeeklyShiftPatternDays.patternId, pattern.id))).length, 7);
    assert.equal((await database.select().from(s.employeeShiftAssignments).where(eq(s.employeeShiftAssignments.id, siblingCapture.id)))[0].confirmedSchedule?.breaks[0].fromTime, "12:00:00");
    checks++;
    const [future] = await database.insert(s.payrollPeriods).values({ code: "FIX-FUTURE", year: 2198, month: 10, cycle: "A", payrollTerms: "Semi-Monthly", startDate: "2198-10-15", endDate: "2198-10-15", nominalPayDate: "2198-10-20", adjustedPayDate: "2198-10-20", status: "Open" }).returning();
    const beforeFutureSummaries = await database.select().from(s.attendanceDailySummaries);
    const beforeFutureGenerated = await database.select().from(s.employeePayrollExceptionRows);
    workspace = await readScheduleWorkspace(actor, { ...query, periodId: future.id }, client);
    const futureCommand = { ...periodCommand(person.id, "2198-10-15", String(night.shiftTableId)), periodId: future.id };
    const futureReceipt = await confirmScopedScheduleDays(actor, futureCommand, transactional);
    assert.equal(futureReceipt.changedCount, 1);
    assert.equal(futureReceipt.summariesRebuilt, 0);
    assert.deepEqual(await database.select().from(s.attendanceDailySummaries), beforeFutureSummaries, "Future schedules must not invent attendance/absence summaries");
    assert.deepEqual(await database.select().from(s.employeePayrollExceptionRows), beforeFutureGenerated, "Future schedules must not generate attendance pay/deduction lines");
    await assert.rejects(readScheduleWorkspace({ userId: randomUUID(), role: "MANAGER" }, query, client), /not assigned/);
    checks++;
    await database.update(s.payrollPeriods).set({ endDate: "2020-10-18" }).where(eq(s.payrollPeriods.id, periods[1].id));
    const [untouchedGap] = await database.insert(s.attendanceDailySummaries).values({ employeeId: person.id, attendanceDate: "2020-10-17", workedMinutes: 37, regularMinutes: 37, remarks: "Fictional untouched middle day" }).returning();
    workspace = await readScheduleWorkspace(actor, { ...query, periodId: periods[1].id }, client);
    const separatedTargets = { ...periodCommand(), periodId: periods[1].id, changes: ["2020-10-16", "2020-10-18"].map(day => ({ employeeId: person.id, day, value: "rest" })) };
    const separatedReceipt = await confirmScopedScheduleDays(actor, separatedTargets, transactional);
    assert.deepEqual(separatedReceipt.affectedTargets, [{ employeeId: person.id, day: "2020-10-16" }, { employeeId: person.id, day: "2020-10-18" }]);
    assert.deepEqual((await database.select().from(s.attendanceDailySummaries).where(eq(s.attendanceDailySummaries.id, untouchedGap.id)))[0], untouchedGap, "Noncontiguous target batching must not rebuild untouched middle summaries");
    checks++;
    // A daytime explicit definition can own an actual closing OUT after midnight.
    // The next period is protected even though the configured end is before midnight.
    const [lateCloser] = await database.insert(s.employees).values({ employeeNo: "C", firstName: "Fictional", lastName: "Late closer" }).returning();
    await database.insert(s.employeesGeneralInfo).values({ employeeId: lateCloser.id, departmentId: branch.id, dateHired: "2020-10-15" });
    const daytime = await saveShiftCatalog(client, actor, { ...baseInput, requestId: randomUUID(), code: "DAY-LATE-FINISH", regularEndTime: "17:00", punchPolicy: "outer", breaks: buildShiftBreakRows([]) });
    await database.insert(s.attendanceRawLogs).values([
      { batchId: batch.id, employeeId: lateCloser.id, employeeNo: "C", logDate: "2020-10-15", logTime: "08:00", loggedAt: new Date("2020-10-15T08:00:00Z"), direction: "IN" },
      { batchId: batch.id, employeeId: lateCloser.id, employeeNo: "C", logDate: "2020-10-16", logTime: "00:30", loggedAt: new Date("2020-10-16T00:30:00Z"), direction: "OUT" },
    ]);
    const beforeBoundaryLogs = await database.select().from(s.attendanceRawLogs);
    await database.update(s.payrollPeriods).set({ status: "Closed" }).where(eq(s.payrollPeriods.id, periods[1].id));
    workspace = await readScheduleWorkspace(actor, query, client);
    await assert.rejects(saveWeeklySchedules(actor, { ...weeklyCommand(), employeeIds: [lateCloser.id], effectiveTo: "2020-10-15", days: [{ weekday: "Thursday", value: String(daytime.shiftTableId) }] }, transactional), /closed.*overnight/);
    await database.insert(s.employeeShiftAssignments).values({ employeeId: lateCloser.id, shiftTableId: daytime.shiftTableId, shiftName: "Fictional daytime", effectiveFrom: "2020-10-15", effectiveTo: "2020-10-15", checkInTime: "08:00", checkOutTime: "17:00", hoursPerDay: "9.00", breakMinutes: 0, calculationPolicy: "eight_hour_day", punchPolicy: "outer" });
    workspace = await readScheduleWorkspace(actor, query, client);
    await assert.rejects(confirmScopedScheduleDays(actor, periodCommand(lateCloser.id), transactional), /closed.*overnight/);
    await assert.rejects(mutatePeriodSchedule(actor, { ...periodCommand(lateCloser.id), changes: [] }, "confirmed", transactional), /closed.*overnight/);
    await database.update(s.payrollPeriods).set({ status: "Open" }).where(eq(s.payrollPeriods.id, periods[1].id));
    await database.insert(s.payrollRunEmployees).values({ payrollRunId: nextRun.id, employeeId: lateCloser.id, employeeNoSnapshot: "C", employeeNameSnapshot: "Fictional late closer" });
    await database.update(s.payrollRuns).set({ status: "Posted" }).where(eq(s.payrollRuns.id, nextRun.id));
    workspace = await readScheduleWorkspace(actor, query, client);
    await assert.rejects(confirmScopedScheduleDays(actor, periodCommand(lateCloser.id), transactional), /Approved or Posted/);
    await assert.rejects(mutatePeriodSchedule(actor, { ...periodCommand(lateCloser.id), changes: [] }, "confirmed", transactional), /Approved or Posted/);
    await database.update(s.payrollRuns).set({ status: "Draft" }).where(eq(s.payrollRuns.id, nextRun.id));
    const actualBoundary = await confirmScopedScheduleDays(actor, periodCommand(lateCloser.id, "2020-10-15", "saved"), transactional);
    assert.deepEqual(actualBoundary.affectedTargets, [{ employeeId: lateCloser.id, day: "2020-10-15" }, { employeeId: lateCloser.id, day: "2020-10-16" }]);
    assert.equal((await database.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, nextRun.id)))[0].status, "Stale");
    const actualSummary = (await database.select().from(s.attendanceDailySummaries).where(eq(s.attendanceDailySummaries.employeeId, lateCloser.id))).find(row => row.attendanceDate === "2020-10-15")!;
    assert.equal(actualSummary.regularMinutes, 480);
    assert.equal(actualSummary.lastOutAt?.toISOString(), "2020-10-16T00:30:00.000Z");
    await database.update(s.payrollPeriods).set({ status: "Closed" }).where(eq(s.payrollPeriods.id, periods[0].id));
    workspace = await readScheduleWorkspace(actor, { ...query, periodId: periods[1].id }, client);
    await assert.rejects(confirmScopedScheduleDays(actor, { ...periodCommand(lateCloser.id, "2020-10-16", "rest"), periodId: periods[1].id }, transactional), /closed.*overnight/);
    assert.deepEqual(await database.select().from(s.attendanceRawLogs), beforeBoundaryLogs);
    checks++;
    const actual = await database.execute(sql`select count(*)::integer as count from admin_audit_events`);
    assert.ok(Number(actual.rows[0].count) > 0);
    console.log(JSON.stringify({ passed: true, groups: checks, fixture: "fresh fictional PGlite; full scheduling service and derivative refresh" }));
  } finally { await pg.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

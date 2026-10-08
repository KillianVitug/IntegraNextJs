import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { authAccounts, department, employees, employeesGeneralInfo, employeesTimekeeping, employeesLeaveRecords, leaveTypes, shiftTables, shiftTableBreaks, payrollPeriods, payrollRuns, payrollRunEmployees, attendanceImportBatches, attendanceRawLogs, attendanceDtrCorrections, attendanceDailySummaries, employeeAttendanceDayMetricOverrides, employeeShiftAssignments, scheduleDecisionRevisions, manualPayrollEntries, manualPayrollEntryLines } from "@/db/schema";
import { workExclusions, workTreatments, workPlans, workHistory } from "@/db/attendanceWorkbenchSchema";
import { approveWorkBatch, draftVersion, prepareWorkApproval, saveWorkDraft, workEmployees } from "@/lib/payroll/attendanceWorkbench";
import type { WorkChange, WorkDraft } from "@/lib/payroll/attendanceWorkbenchModel";
import { confirmScopedScheduleDays, mutatePeriodSchedule, readScheduleDayRepair, readScheduleWorkspace, type ScheduleActor } from "@/lib/scheduling/service";
import type { SchedulePeriodCommand } from "@/lib/scheduling/workspace-types";
import { loadEffectiveAttendanceCorrections, loadEffectiveAttendanceRawLogs } from "@/lib/payroll/effectiveAttendanceInputs";
import { rebuildEmployeeAttendanceSummaries } from "@/app/actions/shiftAssignmentHelpers";
import { ATTENDANCE_DECISION_DTR_REFRESHED, refreshAttendanceDecisionDtr } from "@/lib/payroll/attendanceCompletionRefresh";
import { assertAttendanceSourceReady } from "@/lib/payroll/attendanceSourceGuard";

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1", "Write tests require the isolated restored database");
  const tables = ["employees", "employees_general_info", "employees_timekeeping", "employees_leave_records", "leave_types", "department", "payroll_periods", "payroll_runs", "payroll_run_employees", "payroll_run_events", "employee_shift_assignments", "shift_tables", "shift_table_breaks", "schedule_workspace_drafts", "schedule_decision_revisions", "schedule_request_receipts", "attendance_import_batches", "attendance_raw_logs", "attendance_daily_summaries", "attendance_dtr_corrections", "employee_attendance_day_metric_overrides", "attendance_work_batches", "attendance_work_plans", "attendance_work_history", "attendance_work_treatments", "attendance_work_raw_logs", "attendance_work_exclusions", "attendance_source_periods", "admin_audit_events"];
  tables.push("manual_payroll_entries", "manual_payroll_entry_lines", "employee_payroll_exception_rows", "attendance_dtr_hold_approvals");
  const fingerprint = async () => (await db.execute(sql.raw(tables.map(table => `select '${table}' as name,count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as hash from ${table} t`).join(" union all ")))).rows;
  const before = await fingerprint(), rollback = new Error("fixture rollback");
  try { await db.transaction(async tx => {
    const database = new Proxy(db, { get(_target, key) { if (key === "transaction") return (fn: Parameters<typeof db.transaction>[0]) => tx.transaction(fn); const value = Reflect.get(tx, key); return typeof value === "function" ? value.bind(tx) : value; } });
    const [account] = await tx.select().from(authAccounts).limit(1), suffix = randomUUID().slice(0, 8);
    const actor: ScheduleActor = { userId: account.id, role: "ADMIN" };
    const [branch] = await tx.insert(department).values({ code: `AS-${suffix}`, name: `Attendance schedule QA ${suffix}` }).returning();
    const people = await tx.insert(employees).values([1, 2, 3].map(n => ({ employeeNo: `AS-${suffix}-${n}`, firstName: "QA", lastName: `Resolution ${n}` }))).returning();
    await tx.insert(employeesGeneralInfo).values(people.map(person => ({ employeeId: person.id, departmentId: branch.id, dateHired: "2002-09-01" })));
    await tx.insert(employeesTimekeeping).values(people.map(person => ({ employeeId: person.id, payrollTerms: "Semi-Monthly", hoursWorked: "8.00" })));
    const periodId = randomUUID(), nextPeriodId = randomUUID();
    await tx.insert(payrollPeriods).values([
      { id: periodId, code: `AR-${suffix}-B`, year: 2002, month: 9, cycle: "B", payrollTerms: "Semi-Monthly", startDate: "2002-09-28", endDate: "2002-09-30", nominalPayDate: "2002-10-05", adjustedPayDate: "2002-10-05", status: "Open" },
      { id: nextPeriodId, code: `AR-${suffix}-A`, year: 2002, month: 10, cycle: "A", payrollTerms: "Semi-Monthly", startDate: "2002-10-01", endDate: "2002-10-15", nominalPayDate: "2002-10-20", adjustedPayDate: "2002-10-20", status: "Open" },
    ]);
    const [shift, night] = await tx.insert(shiftTables).values([
      { code: `AD-${suffix}`, description: "Day fixture", regularStartTime: "08:00", regularEndTime: "17:00" },
      { code: `AN-${suffix}`, description: "Night fixture", regularStartTime: "22:00", regularEndTime: "06:00" },
    ]).returning();
    await tx.insert(shiftTableBreaks).values({ shiftTableId: shift.id, slotKey: "mid_break", label: "Lunch", fromTime: "12:00", toTime: "13:00", deduct: true, deductHours: 1, deductMinutes: 0, sortOrder: 1 });
    const [batch] = await tx.insert(attendanceImportBatches).values({ payrollPeriodId: periodId, sourceFileName: "fixture.csv", sourceFormat: "CSV", status: "Processed" }).returning();
    const raw = async (employee: typeof people[number], day: string, time: string, direction: "IN" | "OUT", batchId = batch.id, hash?: string) => (await tx.insert(attendanceRawLogs).values({ employeeId: employee.id, employeeNo: employee.employeeNo, batchId, logDate: day, logTime: time, loggedAt: sql`${`${day} ${time}`}::timestamp`, direction, rawText: "fixture", normalizedHash: hash }).returning())[0];
    const wrong = await raw(people[0], "2002-09-29", "19:31:00", "IN");
    await raw(people[0], "2002-09-29", "17:10:13", "OUT");
    const [neighbor] = await tx.insert(attendanceDailySummaries).values({ employeeId: people[0].id, attendanceDate: "2002-09-28", workedMinutes: 123 }).returning();
    const approve = async (changes: WorkChange[]) => {
      const person = (await workEmployees(periodId, tx, undefined, undefined, people[0].id))[0];
      const draft: WorkDraft = { employeeId: person.id, days: ["2002-09-29"], changes, reason: "approved", ownerId: actor.userId, needed: "", rejected: false, version: draftVersion(person, ["2002-09-29"]) };
      const batch = await saveWorkDraft(tx, actor.userId, periodId, [draft]);
      const preview = await prepareWorkApproval(periodId, batch.id, batch.revision, tx);
      await approveWorkBatch(actor.userId, periodId, batch.id, batch.revision, preview.digest, database);
      return { ...batch, planIds: preview.prepared.map(plan => plan.id) };
    };
    const manualId = randomUUID();
    await approve([
      { id: randomUUID(), day: "2002-09-29", kind: "Exclude", rawLogId: wrong.id, reason: "approved", evidence: "approved", verified: true },
      { id: manualId, day: "2002-09-29", kind: "Manual", at: "2002-09-29T07:34", type: "IN", reason: "approved", evidence: "approved", verified: true },
    ]);
    assert.ok((await tx.select().from(workExclusions).where(eq(workExclusions.rawLogId, wrong.id)))[0].active);
    let approved = (await workEmployees(periodId, tx, undefined, undefined, people[0].id))[0];
    const manual = approved.contextRecords!.find(record => record.source === "Manual" && record.type === "IN")!;
    assert.ok(manual.rawLogId, "Actual approval materializes the manual capture");
    const approvedBatch = await approve([{ id: randomUUID(), day: "2002-09-29", kind: "Time", eventId: manual.id, rawLogId: manual.rawLogId, at: "2002-09-29T07:35", reason: "approved", evidence: "approved", verified: true }]);
    approved = (await workEmployees(periodId, tx, undefined, undefined, people[0].id))[0];
    assert.ok(approved.days.find(day => day.day === "2002-09-29")!.resolved);
    // An old neighboring-period projection must not revive an approved original.
    const [neighborBatch] = await tx.insert(attendanceImportBatches).values({ payrollPeriodId: nextPeriodId, sourceFileName: "neighbor-api", sourceFormat: "API", status: "Processed" }).returning();
    await raw(people[0], "2002-09-29", "19:31:00", "IN", neighborBatch.id, "neighbor-original");
    const scope = { employeeIds: [people[0].id], startDate: "2002-09-29", endDate: "2002-09-29" };
    const effective = await loadEffectiveAttendanceRawLogs(tx, scope);
    assert.deepEqual(effective.map(row => row.logTime), ["07:35:00", "17:10:13"], "Only the latest approved sequence is effective");
    const query = { departmentId: branch.id, periodId };
    let workspace = await readScheduleWorkspace(actor, query, tx);
    const command = (changes: SchedulePeriodCommand["changes"]): SchedulePeriodCommand => ({ requestId: randomUUID(), departmentId: branch.id, periodId, sourceDigest: workspace.sourceDigest, expectedDraftId: workspace.draft?.id ?? null, expectedDraftRevision: workspace.draft?.revision ?? null, changes });
    await mutatePeriodSchedule(actor, command([{ employeeId: people[1].id, day: "2002-09-28", value: "rest" }]), "draft_saved", database);
    workspace = await readScheduleWorkspace(actor, query, tx);
    const sibling = workspace.draft!.cells.find(cell => cell.employeeId === people[1].id && cell.day === "2002-09-28")!;
    const repairView = await readScheduleDayRepair(actor, { employeeId: people[0].id, day: "2002-09-29", periodId }, tx);
    assert.equal(repairView.departmentId, branch.id); assert.equal(repairView.expectedDraftId, workspace.draft!.id);
    const repair = command([{ employeeId: people[0].id, day: "2002-09-29", value: String(shift.id) }]);
    const receipt = await confirmScopedScheduleDays(actor, repair, database);
    assert.deepEqual(await confirmScopedScheduleDays(actor, repair, database), receipt, "Targeted confirmation retries return the same receipt");
    assert.equal(receipt.changedCount, 1); assert.equal(receipt.summariesRebuilt, 1);
    assert.equal((await tx.select().from(scheduleDecisionRevisions).where(eq(scheduleDecisionRevisions.periodId, periodId))).length, 1, "No unrelated employee/date is confirmed");
    workspace = await readScheduleWorkspace(actor, query, tx);
    assert.deepEqual(workspace.draft!.cells.find(cell => cell.employeeId === people[1].id && cell.day === "2002-09-28"), sibling, "Sibling branch draft values survive exactly");
    assert.equal(workspace.draft!.sourceDigest, workspace.sourceDigest); assert.equal(workspace.draft!.revision, 2);
    const [summary] = await tx.select().from(attendanceDailySummaries).where(and(eq(attendanceDailySummaries.employeeId, people[0].id), eq(attendanceDailySummaries.attendanceDate, "2002-09-29")));
    assert.equal(summary.firstInAt?.toISOString().slice(11, 19), "07:35:00"); assert.equal(summary.lastOutAt?.toISOString().slice(11, 19), "17:10:13"); assert.ok(summary.workedMinutes > 0);
    assert.deepEqual((await tx.select().from(attendanceDailySummaries).where(eq(attendanceDailySummaries.id, neighbor.id)))[0], neighbor, "Adjacent DTR provenance stays unchanged");
    const [moneyEntry] = await tx.insert(manualPayrollEntries).values({ payrollPeriodId: periodId, employeeId: people[0].id, employeeNoSnapshot: people[0].employeeNo, employeeNameSnapshot: "QA protected money", grossPay: "1000.00", netPay: "900.00", totalDeductions: "100.00" }).returning();
    await tx.insert(manualPayrollEntryLines).values({ manualPayrollEntryId: moneyEntry.id, lineType: "Earning", summaryBucket: "regularPay", code: "QA-MONEY", description: "Preserved payroll input", amount: "1000.00", sourceTable: "attendance_daily_summaries" });
    const protectedTables = ["manual_payroll_entries", "manual_payroll_entry_lines", "employee_payroll_exception_rows", "attendance_dtr_hold_approvals", "payroll_runs", "payroll_run_employees", "payroll_run_events", "attendance_source_periods"];
    const financialSnapshot = async () => (await tx.execute(sql.raw(protectedTables.map(table => `select '${table}' as name,count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as hash from ${table} t`).join(" union all ")))).rows;
    const protectedBefore = await financialSnapshot();
    const refreshInput = { actor: actor.userId, periodId, batchId: approvedBatch.id, planIds: approvedBatch.planIds };
    const safeRefresh = await refreshAttendanceDecisionDtr(refreshInput, database);
    assert.equal(safeRefresh.refreshed, true); assert.deepEqual(safeRefresh.affectedTargets, [{ employeeId: people[0].id, day: "2002-09-29" }]);
    assert.equal((await refreshAttendanceDecisionDtr(refreshInput, database)).refreshed, false, "Repeated completion uses its durable current-version receipt");
    assert.equal((await tx.select().from(workHistory).where(eq(workHistory.action, ATTENDANCE_DECISION_DTR_REFRESHED))).length, 1);
    assert.deepEqual(await financialSnapshot(), protectedBefore, "Local completion does not refresh money, generated earnings, holds, payroll status or global readiness");
    await assert.rejects(() => assertAttendanceSourceReady(periodId, tx), /refresh/i, "Selected-plan completion never falsely acknowledges whole-period DTR readiness");
    assert.deepEqual((await tx.select().from(attendanceDailySummaries).where(eq(attendanceDailySummaries.id, neighbor.id)))[0], neighbor);
    await tx.update(payrollPeriods).set({ status: "Closed" }).where(eq(payrollPeriods.id, periodId));
    assert.equal((await refreshAttendanceDecisionDtr(refreshInput, database)).adjustmentRequired, true, "Closed-period check precedes receipt reuse and summary writes");
    await tx.update(payrollPeriods).set({ status: "Open" }).where(eq(payrollPeriods.id, periodId));
    assert.equal((await tx.select().from(workPlans).where(eq(workPlans.id, approvedBatch.planIds[0])))[0].state, "Resolved");
    // Preserve approved legacy manual DTR corrections and explicit metric overrides.
    const missingOut = await raw(people[1], "2002-09-29", "08:00:00", "IN");
    const punch = (direction: "IN" | "OUT", time: string, synthetic: boolean) => ({ rawLogId: synthetic ? null : missingOut.id, employeeNo: people[1].employeeNo, employeeId: people[1].id, loggedAt: `2002-09-29T${time}Z`, logDate: "2002-09-29", logTime: time, direction, sourceLine: null, rawText: null, deviceId: null, siteCode: null, synthetic });
    const [legacyCorrection] = await tx.insert(attendanceDtrCorrections).values({ payrollPeriodId: periodId, employeeId: people[1].id, attendanceDate: "2002-09-29", correctionType: "Missing Out", status: "Approved", reason: "approved", payload: { rawPunches: [punch("IN", "08:00:00", false)], ignoredRawLogIds: [], syntheticPunches: [punch("OUT", "17:00:00", true)], effectivePunches: [punch("IN", "08:00:00", false), punch("OUT", "17:00:00", true)], proposedMetrics: null } }).returning();
    const [metric] = await tx.insert(employeeAttendanceDayMetricOverrides).values({ payrollPeriodId: periodId, employeeId: people[1].id, attendanceDate: "2002-09-29", lateMinutes: 42, remarks: "approved" }).returning();
    workspace = await readScheduleWorkspace(actor, query, tx);
    await confirmScopedScheduleDays(actor, command([{ employeeId: people[1].id, day: "2002-09-29", value: String(shift.id) }]), database);
    const [legacySummary] = await tx.select().from(attendanceDailySummaries).where(and(eq(attendanceDailySummaries.employeeId, people[1].id), eq(attendanceDailySummaries.attendanceDate, "2002-09-29")));
    assert.equal(legacySummary.lastOutAt?.toISOString().slice(11, 19), "17:00:00"); assert.equal(legacySummary.workedMinutes, 480);
    assert.deepEqual((await tx.select().from(employeeAttendanceDayMetricOverrides).where(eq(employeeAttendanceDayMetricOverrides.id, metric.id)))[0], metric);
    assert.deepEqual((await loadEffectiveAttendanceCorrections(tx, { employeeIds: [people[1].id], startDate: "2002-09-29", endDate: "2002-09-29" }))[0], legacyCorrection);
    // Superseded automatic/manual suggestions cannot override a newer reviewed sequence.
    await tx.insert(attendanceDtrCorrections).values({ ...legacyCorrection, id: randomUUID(), employeeId: people[0].id });
    assert.equal((await loadEffectiveAttendanceCorrections(tx, scope)).length, 0);
    await rebuildEmployeeAttendanceSummaries({ tx, employeeId: people[0].id, startDate: "2002-09-29", endDate: "2002-09-29" });
    assert.equal((await tx.select().from(attendanceDailySummaries).where(and(eq(attendanceDailySummaries.employeeId, people[0].id), eq(attendanceDailySummaries.attendanceDate, "2002-09-29"))))[0].lastOutAt?.toISOString().slice(11, 19), "17:10:13");
    const [leaveType] = await tx.insert(leaveTypes).values({ code: `AL-${suffix}`, name: `QA paid leave ${suffix}`, isPaid: true }).returning();
    await tx.insert(employeesLeaveRecords).values({ employeeId: people[2].id, leaveTypeId: leaveType.id, leaveType: leaveType.code, dateFiled: "2002-09-20", leaveStartDate: "2002-09-29", leaveEndDate: "2002-09-29", noOfDays: "1.00", leaveStatus: "Approved" });
    workspace = await readScheduleWorkspace(actor, query, tx);
    await confirmScopedScheduleDays(actor, command([{ employeeId: people[2].id, day: "2002-09-29", value: String(shift.id) }]), database);
    assert.equal((await tx.select().from(attendanceDailySummaries).where(and(eq(attendanceDailySummaries.employeeId, people[2].id), eq(attendanceDailySummaries.attendanceDate, "2002-09-29"))))[0].paidLeaveMinutes, 480);
    // A stale sibling review must remain recoverable; a day repair cannot approve
    // or silently rebase changes whose source snapshot the administrator has not reviewed.
    await tx.update(shiftTables).set({ description: "Changed template description" }).where(eq(shiftTables.id, shift.id));
    workspace = await readScheduleWorkspace(actor, query, tx);
    const staleDraft = workspace.draft!; assert.notEqual(staleDraft.sourceDigest, workspace.sourceDigest);
    await confirmScopedScheduleDays(actor, command([{ employeeId: people[2].id, day: "2002-09-30", value: String(shift.id) }]), database);
    assert.deepEqual((await readScheduleWorkspace(actor, query, tx)).draft, staleDraft, "Stale sibling draft is retained without rebasing or deleting its edits");
    await raw(people[0], "2002-09-30", "22:00:00", "IN", batch.id, "night-in");
    await raw(people[0], "2002-10-01", "06:00:00", "OUT", batch.id, "night-out");
    await raw(people[0], "2002-10-01", "06:00:00", "OUT", neighborBatch.id, "night-out");
    workspace = await readScheduleWorkspace(actor, query, tx);
    const nightReceipt = await confirmScopedScheduleDays(actor, command([{ employeeId: people[0].id, day: "2002-09-30", value: String(night.id) }]), database);
    assert.deepEqual(nightReceipt.affectedTargets, [{ employeeId: people[0].id, day: "2002-09-30" }, { employeeId: people[0].id, day: "2002-10-01" }]);
    assert.ok(nightReceipt.affectedPeriodIds?.includes(nextPeriodId));
    const [nightSummary] = await tx.select().from(attendanceDailySummaries).where(and(eq(attendanceDailySummaries.employeeId, people[0].id), eq(attendanceDailySummaries.attendanceDate, "2002-09-30")));
    assert.equal(nightSummary.lastOutAt?.toISOString().slice(0, 19), "2002-10-01T06:00:00"); assert.equal(nightSummary.workedMinutes, 480);
    // Freshness and identity races fail atomically, retaining existing schedules and drafts.
    await assert.rejects(() => confirmScopedScheduleDays(actor, { ...repair, requestId: randomUUID() }, database), /changed|Reload/);
    workspace = await readScheduleWorkspace(actor, query, tx);
    await assert.rejects(() => confirmScopedScheduleDays({ userId: randomUUID(), role: "MANAGER" }, command([{ employeeId: people[0].id, day: "2002-09-30", value: "rest" }]), database), /not assigned/);
    const runId = randomUUID(); await tx.insert(payrollRuns).values({ id: runId, payrollPeriodId: nextPeriodId, runNumber: 1, status: "Posted", inputSnapshot: { payrollGroup: "Daily" } });
    await tx.insert(payrollRunEmployees).values({ payrollRunId: runId, employeeId: people[0].id, employeeNoSnapshot: people[0].employeeNo, employeeNameSnapshot: "QA only" });
    const assignmentBefore = await tx.select().from(employeeShiftAssignments).where(eq(employeeShiftAssignments.employeeId, people[0].id));
    await assert.rejects(() => confirmScopedScheduleDays(actor, command([{ employeeId: people[0].id, day: "2002-09-30", value: "rest" }]), database), /posted/);
    assert.deepEqual(await tx.select().from(employeeShiftAssignments).where(eq(employeeShiftAssignments.employeeId, people[0].id)), assignmentBefore, "Posted overnight neighbor prevents all schedule mutations");
    assert.ok((await tx.select().from(workTreatments).where(and(eq(workTreatments.employeeId, people[0].id), eq(workTreatments.active, true)))).length > 0);
    throw rollback;
  }); } catch (error) { if (error !== rollback) throw error; }
  assert.deepEqual(await fingerprint(), before, "Every fixture write rolls back");
  console.log("PASS attendance→schedule repair: real approved manual/exclusion and supersession, canonical effective inputs, scoped confirmation/retry, sibling drafts, legacy DTR overrides, paid leave, overnight/cross-period context, stale/manager/posted protection and rollback");
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

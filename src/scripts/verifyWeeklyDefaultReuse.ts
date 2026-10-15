import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { readScheduleReceipt, readScheduleWorkspace, readWeeklySchedulePreview, saveWeeklySchedules, type ScheduleActor } from "@/lib/scheduling/service";
import { scheduleWeekdays, type ScheduleSnapshot, type ScheduleWeeklyPreviewInput } from "@/lib/scheduling/workspace-types";
import { emptySchedule } from "@/lib/scheduling/model";
import { getActiveWeeklyShiftPatternForDate } from "@/lib/payroll/scheduleResolver";
import { freshScheduleDatabase } from "./attendanceTest/freshScheduleDatabase";

/** Actual read/save services on a new fictional in-memory database; no private data or network writes. */
async function main() {
  const { pg, database, client, transactional } = await freshScheduleDatabase();
  const checks: string[] = [];
  try {
    const [branch, other] = await database.insert(s.department).values([{ code: "REUSE", name: "Fictional reuse" }, { code: "ELSE", name: "Other fictional branch" }]).returning();
    const people = await database.insert(s.employees).values(["Alice", "Bob", "Carol", "NoWeek", "Manager", "Admin", "Outside"].map(name => ({ employeeNo: `REUSE-${name}`, firstName: name, lastName: "Fiction" }))).returning();
    const [alice, bob, carol, noWeek, managerPerson, adminPerson, outside] = people;
    await database.insert(s.employeesGeneralInfo).values(people.map((person, index) => ({ employeeId: person.id, departmentId: index < 4 ? branch.id : other.id, dateHired: "2020-01-01", confidentialityLevel: "Rank and File" as const })));
    const [managerAccount, adminAccount] = await database.insert(s.authAccounts).values([managerPerson, adminPerson].map(person => ({ employeeId: person.id, email: `${person.firstName}@example.invalid`, status: "Active" as const }))).returning();
    const [managerGroup, adminGroup] = await database.insert(s.authPermissionGroups).values([{ key: "MANAGER", name: "Manager" }, { key: "SYSTEM_ADMIN", name: "System Admin" }]).returning();
    await database.insert(s.authAccountPermissionGroups).values([{ accountId: managerAccount.id, groupId: managerGroup.id }, { accountId: adminAccount.id, groupId: adminGroup.id }]);
    await database.insert(s.authManagerDepartments).values({ accountId: managerAccount.id, departmentId: branch.id });
    const admin: ScheduleActor = { userId: adminAccount.id, role: "ADMIN" }, manager: ScheduleActor = { userId: managerAccount.id, role: "MANAGER" };
    const [period] = await database.insert(s.payrollPeriods).values({ code: "REUSE-2098-A", year: 2098, month: 10, cycle: "A", payrollTerms: "Semi-Monthly", startDate: "2098-10-01", endDate: "2098-10-15", nominalPayDate: "2098-10-20", adjustedPayDate: "2098-10-20", status: "Open" }).returning();
    const [shift] = await database.insert(s.shiftTables).values({ code: "REUSE-DAY", description: "Current catalog definition", regularStartTime: "09:00", regularEndTime: "17:00", calculationPolicy: "eight_hour_day", punchPolicy: "outer" }).returning();
    const frozen: ScheduleSnapshot = { ...emptySchedule("unconfigured"), kind: "shift", shiftTableId: shift.id, shiftName: "Frozen source definition", shiftCode: "REUSE-DAY", checkInTime: "08:00:00", checkOutTime: "17:00:00", breakMinutes: 60, hoursPerDay: 8, calculationPolicy: "eight_hour_day", punchPolicy: "outer", breaks: [{ slotKey: "mid_break", label: "Saved lunch", fromTime: "12:00:00", toTime: "13:00:00", deduct: true, deductHours: 1, deductMinutes: 0, sortOrder: 1 }] };
    const late = { ...structuredClone(frozen), shiftName: "Bob's own week", checkInTime: "10:00:00", checkOutTime: "19:00:00", breaks: [{ ...frozen.breaks[0], fromTime: "14:00:00", toTime: "15:00:00" }] };
    const pattern = async (employeeId: string, from: string, snapshot: ScheduleSnapshot, to: string | null = null) => {
      const [saved] = await database.insert(s.employeeWeeklyShiftPatterns).values({ employeeId, effectiveFrom: from, effectiveTo: to }).returning();
      const days = await database.insert(s.employeeWeeklyShiftPatternDays).values(scheduleWeekdays.map((weekday, index) => { const day = index === 6 ? emptySchedule("rest") : index === 5 ? emptySchedule("unconfigured") : snapshot; return { patternId: saved.id, weekday, scheduleState: day.kind, definitionSnapshot: structuredClone(day), calculationPolicy: day.calculationPolicy ?? "legacy", punchPolicy: day.punchPolicy ?? "legacy", shiftTableId: day.shiftTableId, shiftName: day.shiftName, checkInTime: day.checkInTime, checkOutTime: day.checkOutTime, breakMinutes: day.breakMinutes, paidBreakMinutes: day.paidBreakMinutes, hoursPerDay: day.hoursPerDay.toFixed(2) }; })).returning();
      return { ...saved, days };
    };
    const aliceSource = await pattern(alice.id, "2098-10-15", frozen), bobSource = await pattern(bob.id, "2098-10-12", late), carolSource = await pattern(carol.id, "2098-10-15", frozen);
    const future = await pattern(alice.id, "2098-11-01", late);
    await database.update(s.shiftTables).set({ archivedAt: new Date() }).where(eq(s.shiftTables.id, shift.id));
    const [dated] = await database.insert(s.employeeShiftAssignments).values({ employeeId: alice.id, effectiveFrom: "2098-10-02", effectiveTo: "2098-10-02", shiftName: "Dated exception", checkInTime: "11:00", checkOutTime: "19:00", hoursPerDay: "8.00", calculationPolicy: "eight_hour_day", punchPolicy: "outer" }).returning();
    const [confirmed] = await database.insert(s.employeeShiftAssignments).values({ employeeId: alice.id, effectiveFrom: "2098-10-03", effectiveTo: "2098-10-03", shiftName: "Unconfigured", checkInTime: "00:00", checkOutTime: "00:00", hoursPerDay: "0.00", scheduleDecisionId: randomUUID(), confirmedSchedule: emptySchedule("unconfigured") }).returning();
    const input = async (employeeIds = [alice.id, bob.id], extras: Partial<ScheduleWeeklyPreviewInput> = {}): Promise<ScheduleWeeklyPreviewInput> => ({ departmentId: branch.id, sourceDigest: (await readScheduleWorkspace(admin, { departmentId: branch.id, effectiveDate: "2098-10-15" }, client)).weeklyDigest, employeeIds, effectiveFrom: "2098-10-01", effectiveTo: null, reuseFromDate: "2098-10-15", days: [], ...extras });
    const counts = async () => ({ patterns: (await database.select().from(s.employeeWeeklyShiftPatterns)).length, days: (await database.select().from(s.employeeWeeklyShiftPatternDays)).length, receipts: (await database.select().from(s.scheduleRequestReceipts)).length, audits: (await database.select().from(s.adminAuditEvents)).length });
    const before = await counts(), original = await input(), preview = await readWeeklySchedulePreview(admin, original, client);
    assert.equal(preview.canSave, true); assert.deepEqual(await counts(), before, "Preview must not mutate business or receipt/audit records");
    assert.deepEqual(preview.employees.map(row => row.effectiveTo), ["2098-10-14", "2098-10-11"]);
    assert.deepEqual(preview.employees[0].days[0].snapshot, frozen); assert.deepEqual(preview.employees[1].days[0].snapshot, late);
    assert.deepEqual(preview.employees[0].retainedAssignments.map(row => row.kind), ["dated", "confirmed"]);
    assert.equal(preview.employees[0].days[5].snapshot.kind, "unconfigured"); assert.equal(preview.employees[0].days[6].snapshot.kind, "rest");
    checks.push("read-only automatic preview, mixed real boundaries, exact per-employee frozen week and rest/unconfigured, retained dated/confirmed days");

    const command = { ...original, requestId: randomUUID(), previewDigest: preview.previewDigest };
    const receipt = await saveWeeklySchedules(admin, command, transactional);
    assert.deepEqual(await saveWeeklySchedules(admin, command, transactional), receipt);
    await assert.rejects(saveWeeklySchedules(admin, { ...command, effectiveFrom: "2098-10-02" }, transactional), /request ID/);
    assert.equal((await counts()).patterns, before.patterns + 2);
    const savedPatterns = await database.query.employeeWeeklyShiftPatterns.findMany({ with: { days: true }, where: eq(s.employeeWeeklyShiftPatterns.employeeId, alice.id) });
    const earlier = getActiveWeeklyShiftPatternForDate(savedPatterns, "2098-10-01")!;
    assert.deepEqual(earlier.days.find(day => day.weekday === "Monday")!.definitionSnapshot, frozen);
    assert.equal(getActiveWeeklyShiftPatternForDate(savedPatterns, "2098-10-15")!.id, aliceSource.id);
    assert.equal(getActiveWeeklyShiftPatternForDate(savedPatterns, "2098-11-01")!.id, future.id);
    assert.deepEqual((await database.select().from(s.employeeShiftAssignments).where(eq(s.employeeShiftAssignments.id, dated.id)))[0], dated);
    assert.deepEqual((await database.select().from(s.employeeShiftAssignments).where(eq(s.employeeShiftAssignments.id, confirmed.id)))[0], confirmed);
    assert.deepEqual((await database.select().from(s.employeeWeeklyShiftPatterns).where(eq(s.employeeWeeklyShiftPatterns.id, bobSource.id)))[0], { id: bobSource.id, employeeId: bobSource.employeeId, effectiveFrom: bobSource.effectiveFrom, effectiveTo: bobSource.effectiveTo, createdAt: bobSource.createdAt, updatedAt: bobSource.updatedAt });
    checks.push("date-only save/reload, exact snapshots, source/future versions and exceptions preserved, idempotent retry and changed-request rejection");

    await assert.rejects(saveWeeklySchedules(admin, { ...await input([carol.id]), requestId: randomUUID() }, transactional), /impact changed/);
    await assert.rejects(readWeeklySchedulePreview(admin, { ...await input([carol.id]), sourceDigest: original.sourceDigest }, client), /changed/);
    assert.equal((await readWeeklySchedulePreview(admin, await input([noWeek.id]), client)).canSave, false);
    assert.match((await readWeeklySchedulePreview(admin, await input([noWeek.id]), client)).blockers.join(" "), /No saved weekly pattern/);
    const mixedInvalid = await input([carol.id, noWeek.id]), mixedPreview = await readWeeklySchedulePreview(admin, mixedInvalid, client), beforeInvalid = await counts();
    await assert.rejects(saveWeeklySchedules(admin, { ...mixedInvalid, requestId: randomUUID(), previewDigest: mixedPreview.previewDigest }, transactional), /No saved weekly pattern/);
    assert.deepEqual(await counts(), beforeInvalid, "One blocked employee cannot leave a partial saved group");
    assert.match((await readWeeklySchedulePreview(admin, await input([bob.id], { effectiveFrom: "2098-10-13" }), client)).blockers.join(" "), /already starts 2098-10-12/);
    assert.match((await readWeeklySchedulePreview(admin, await input([carol.id], { effectiveTo: "2098-10-15" }), client)).blockers.join(" "), /end must be before/);
    assert.match((await readWeeklySchedulePreview(admin, await input([carol.id], { effectiveFrom: "2096-01-01" }), client)).blockers.join(" "), /at most one year/);
    await assert.rejects(readWeeklySchedulePreview(manager, await input([outside.id]), client), /not assigned/);
    await assert.rejects(readWeeklySchedulePreview(admin, await input([carol.id, carol.id]), client), /only once/);
    await assert.rejects(readWeeklySchedulePreview(admin, await input([carol.id], { effectiveFrom: "2098-02-30" }), client));
    checks.push("missing/stale preview and source, missing saved week, already-effective/mixed incompatible source, end/range/date/scope/duplicate validation");

    await pattern(carol.id, "2098-10-06", late, "2098-10-14");
    assert.match((await readWeeklySchedulePreview(admin, await input([carol.id]), client)).blockers.join(" "), /version starts 2098-10-06/);
    const bounded = await input([carol.id], { effectiveTo: "2098-10-05", days: [{ weekday: "Monday", value: "rest" }] });
    const boundedPreview = await readWeeklySchedulePreview(admin, bounded, client);
    assert.equal(boundedPreview.canSave, true); assert.equal(boundedPreview.employees[0].days[0].snapshot.kind, "rest"); assert.deepEqual(boundedPreview.employees[0].days[1].snapshot, frozen);
    const boundedCommand = { ...bounded, requestId: randomUUID(), previewDigest: boundedPreview.previewDigest };
    await database.insert(s.employeeShiftAssignments).values({ employeeId: carol.id, effectiveFrom: "2098-10-04", effectiveTo: "2098-10-04", shiftName: "New assignment", checkInTime: "11:00", checkOutTime: "19:00", hoursPerDay: "8.00", calculationPolicy: "eight_hour_day", punchPolicy: "outer" });
    await assert.rejects(saveWeeklySchedules(admin, boundedCommand, transactional), /impact changed/);
    checks.push("intermediate version protected, explicit shorter range and manual overlay, assignment changes invalidate preview");

    const [resumed] = await database.insert(s.employees).values({ employeeNo: "REUSE-RESUMED", firstName: "Resumed", lastName: "Fiction" }).returning();
    await database.insert(s.employeesGeneralInfo).values({ employeeId: resumed.id, departmentId: branch.id, dateHired: "2020-01-01" });
    await pattern(resumed.id, "2098-10-06", late);
    await pattern(resumed.id, "2098-10-01", frozen, "2098-10-08");
    await pattern(resumed.id, "2098-10-15", frozen);
    const resumedInput = await input([resumed.id]), resumedPreview = await readWeeklySchedulePreview(admin, resumedInput, client);
    assert.equal(resumedPreview.canSave, false); assert.match(resumedPreview.blockers.join(" "), /starts 2098-10-06 and applies from 2098-10-09/);
    await assert.rejects(saveWeeklySchedules(admin, { ...resumedInput, requestId: randomUUID(), previewDigest: resumedPreview.previewDigest }, transactional), /2098-10-09/);
    assert.equal((await readWeeklySchedulePreview(admin, await input([resumed.id], { effectiveTo: "2098-10-08" }), client)).canSave, true);
    checks.push("later weekly version revealed after an overlapping version ends is preserved at its actual resumed boundary");

    const [run] = await database.insert(s.payrollRuns).values({ payrollPeriodId: period.id, runNumber: 1, status: "Draft", inputSnapshot: { payrollGroup: "Daily" } }).returning();
    await database.insert(s.payrollRunEmployees).values({ payrollRunId: run.id, employeeId: carol.id, employeeNoSnapshot: carol.employeeNo, employeeNameSnapshot: "Fictional Carol" });
    const runInput = await input([carol.id], { effectiveTo: "2098-10-05" }), runPreview = await readWeeklySchedulePreview(admin, runInput, client);
    await database.update(s.payrollRuns).set({ status: "Reviewed" }).where(eq(s.payrollRuns.id, run.id));
    await assert.rejects(saveWeeklySchedules(admin, { ...runInput, requestId: randomUUID(), previewDigest: runPreview.previewDigest }, transactional), /impact changed/);
    assert.match((await readWeeklySchedulePreview(manager, runInput, client)).blockers.join(" "), /already been reviewed/);
    await database.update(s.payrollRuns).set({ status: "Posted" }).where(eq(s.payrollRuns.id, run.id));
    assert.match((await readWeeklySchedulePreview(admin, runInput, client)).blockers.join(" "), /Approved or Posted/);
    await assert.rejects(saveWeeklySchedules(admin, { ...runInput, requestId: randomUUID(), previewDigest: runPreview.previewDigest }, transactional), /Approved or Posted/);
    await database.update(s.payrollRuns).set({ status: "Draft" }).where(eq(s.payrollRuns.id, run.id));
    await database.update(s.payrollPeriods).set({ status: "Closed" }).where(eq(s.payrollPeriods.id, period.id));
    assert.match((await readWeeklySchedulePreview(admin, runInput, client)).blockers.join(" "), /closed payroll period/);
    await database.update(s.payrollPeriods).set({ status: "Open" }).where(eq(s.payrollPeriods.id, period.id));
    const fresh = await readWeeklySchedulePreview(admin, runInput, client);
    await saveWeeklySchedules(admin, { ...runInput, requestId: randomUUID(), previewDigest: fresh.previewDigest }, transactional);
    assert.equal((await database.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, run.id)))[0].status, "Stale");
    assert.equal((await database.select().from(s.employeeWeeklyShiftPatterns).where(eq(s.employeeWeeklyShiftPatterns.id, carolSource.id)))[0].effectiveFrom, "2098-10-15");
    checks.push("payroll-status stale preview, manager Reviewed boundary, Posted/closed blockers, editable Draft invalidation");

    await database.update(s.shiftTables).set({ archivedAt: null }).where(eq(s.shiftTables.id, shift.id));
    const historicalEdit = await input([bob.id], { reuseFromDate: undefined, effectiveFrom: "2098-10-13", effectiveTo: "2098-10-14", days: [{ weekday: "Monday", value: "rest" }] });
    const historicalPreview = await readWeeklySchedulePreview(admin, historicalEdit, client);
    assert.equal(historicalPreview.canSave, true); assert.deepEqual(historicalPreview.employees[0].days[1].snapshot, late);
    await saveWeeklySchedules(admin, { ...historicalEdit, requestId: randomUUID(), previewDigest: historicalPreview.previewDigest }, transactional);
    const normal = await input([noWeek.id], { reuseFromDate: undefined, effectiveFrom: "2098-10-16", effectiveTo: "2098-10-20", days: [{ weekday: "Monday", value: String(shift.id) }] });
    const normalPreview = await readWeeklySchedulePreview(admin, normal, client);
    assert.equal(normalPreview.canSave, true); assert.equal(normalPreview.employees[0].days[0].snapshot.checkInTime?.slice(0, 5), "09:00");
    await saveWeeklySchedules(admin, { ...normal, requestId: randomUUID(), previewDigest: normalPreview.previewDigest }, transactional);
    await saveWeeklySchedules(admin, { ...await input([noWeek.id], { reuseFromDate: undefined, effectiveFrom: "2098-10-21", days: [{ weekday: "Tuesday", value: String(shift.id) }] }), requestId: randomUUID() }, transactional);
    checks.push("normal target-date weekday edit before/after shown date with preview and backward-compatible callers without preview");

    await database.insert(s.accountCode).values([
      { accountCode: "LWOP", accountType: "Unpaid Leaves/Absences", description: "Leave Without Pay" },
      { accountCode: "REGULAR", accountType: "Regular Hours", description: "Regular hours" },
      { accountCode: "OT", accountType: "Overtime", description: "Regular overtime" },
      { accountCode: "LATE", accountType: "Unpaid Leaves/Absences", description: "Tardiness" },
    ]);
    const [pastPeriod] = await database.insert(s.payrollPeriods).values({ code: "REUSE-PAST", year: 2026, month: 9, cycle: "A", payrollTerms: "Semi-Monthly", startDate: "2026-09-01", endDate: "2026-09-03", nominalPayDate: "2026-09-20", adjustedPayDate: "2026-09-20", status: "Open" }).returning();
    const [pastRun] = await database.insert(s.payrollRuns).values({ payrollPeriodId: pastPeriod.id, runNumber: 1, status: "Draft", inputSnapshot: { payrollGroup: "Daily" } }).returning();
    await database.insert(s.payrollRunEmployees).values({ payrollRunId: pastRun.id, employeeId: noWeek.id, employeeNoSnapshot: noWeek.employeeNo, employeeNameSnapshot: "Fictional historic day" });
    await pattern(noWeek.id, "2026-09-15", frozen, "2026-09-30");
    const [batch] = await database.insert(s.attendanceImportBatches).values({ sourceFileName: "fictional-reuse.csv", sourceFormat: "CSV", payrollPeriodId: pastPeriod.id, status: "Processed" }).returning();
    await database.insert(s.attendanceRawLogs).values(["08:30", "17:00"].map((time, index) => ({ batchId: batch.id, employeeId: noWeek.id, employeeNo: noWeek.employeeNo, logDate: "2026-09-01", logTime: time, loggedAt: new Date(`2026-09-01T${time}:00+08:00`), direction: index ? "OUT" as const : "IN" as const })));
    const originalLogs = await database.select().from(s.attendanceRawLogs);
    const pastInput = await input([noWeek.id], { effectiveFrom: "2026-09-01", effectiveTo: "2026-09-03", reuseFromDate: "2026-09-15" }), pastPreview = await readWeeklySchedulePreview(admin, pastInput, client);
    assert.equal(pastPreview.canSave, true); assert.ok(pastPreview.affectedEmployeeDays > 0);
    await saveWeeklySchedules(admin, { ...pastInput, requestId: randomUUID(), previewDigest: pastPreview.previewDigest }, transactional);
    const refreshed = (await database.select().from(s.attendanceDailySummaries).where(eq(s.attendanceDailySummaries.employeeId, noWeek.id))).find(row => row.attendanceDate === "2026-09-01")!;
    assert.equal(refreshed.lateMinutes, 30); assert.equal(refreshed.regularMinutes, 450);
    assert.equal((await database.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, pastRun.id)))[0].status, "Stale");
    assert.deepEqual(await database.select().from(s.attendanceRawLogs), originalLogs);
    assert.ok((await database.select().from(s.employeePayrollExceptionRows).where(eq(s.employeePayrollExceptionRows.payrollPeriodId, pastPeriod.id))).length > 0);
    checks.push("past-day backdate refreshes actual attendance/generated DTR, stales Draft and preserves original captured punches");

    await database.insert(s.payrollPeriods).values({ code: "REUSE-CLOSED-NEXT", year: 2026, month: 9, cycle: "B", payrollTerms: "Semi-Monthly", startDate: "2026-09-04", endDate: "2026-09-05", nominalPayDate: "2026-09-20", adjustedPayDate: "2026-09-20", status: "Closed" });
    await pattern(carol.id, "2026-09-15", { ...frozen, checkInTime: "22:00:00", checkOutTime: "06:00:00", breakMinutes: 0, breaks: [] }, "2026-09-30");
    const nightInput = await input([carol.id], { effectiveFrom: "2026-09-03", effectiveTo: "2026-09-03", reuseFromDate: "2026-09-15" });
    assert.match((await readWeeklySchedulePreview(admin, nightInput, client)).blockers.join(" "), /closed.*overnight/);
    checks.push("overnight copied schedule cannot cross a protected neighboring payroll period");

    await database.delete(s.shiftTables).where(eq(s.shiftTables.id, shift.id));
    const deletedInput = await input([bob.id], { effectiveFrom: "2098-09-25", effectiveTo: "2098-09-30" }), deletedPreview = await readWeeklySchedulePreview(manager, deletedInput, client);
    assert.equal(deletedPreview.canSave, true); assert.deepEqual(deletedPreview.employees[0].days[0].snapshot, late);
    const deletedCommand = { ...deletedInput, requestId: randomUUID(), previewDigest: deletedPreview.previewDigest };
    const deletedReceipt = await saveWeeklySchedules(manager, deletedCommand, transactional);
    const deletedPatterns = await database.query.employeeWeeklyShiftPatterns.findMany({ with: { days: true }, where: eq(s.employeeWeeklyShiftPatterns.employeeId, bob.id) });
    const deletedCopy = getActiveWeeklyShiftPatternForDate(deletedPatterns, "2098-09-25")!.days.find(day => day.weekday === "Monday")!;
    assert.equal(deletedCopy.shiftTableId, null); assert.deepEqual(deletedCopy.definitionSnapshot, late);
    assert.deepEqual(await readScheduleReceipt(manager, deletedCommand.requestId, client), deletedReceipt);
    await database.update(s.employeesGeneralInfo).set({ departmentId: other.id }).where(eq(s.employeesGeneralInfo.employeeId, bob.id));
    await assert.rejects(readScheduleReceipt(manager, deletedCommand.requestId, client), /scope/);
    await assert.rejects(saveWeeklySchedules(manager, deletedCommand, transactional), /scope/);
    checks.push("archived/deleted catalog source preserved exactly, nullable catalog projection, manager receipt and replay scope after employee transfer");
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  } finally { await pg.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

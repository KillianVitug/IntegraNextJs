import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { readManagerAttendanceOverview } from "@/lib/manager/oversight";
import { projectManagerAttendanceDay } from "@/lib/manager/oversight-model";
import { loadProvisionalPayroll } from "@/lib/payroll/provisional";
import { getProvisionalDayReview } from "@/lib/payroll/provisionalReview";
import { saveShiftCatalog } from "@/lib/scheduling/shift-catalog";
import { confirmScopedScheduleDays, readScheduleWorkspace } from "@/lib/scheduling/service";
import { buildShiftBreakRows } from "@/lib/shifts";
import { persistAdminDecision } from "@/lib/payroll/attendanceAdminDecisionStore";
import { resolutionPeople } from "@/lib/payroll/attendanceResolution";
import { resolveLeavePayStatus } from "@/lib/payroll/leave";
import type { WorkDraft, WorkRecord } from "@/lib/payroll/attendanceWorkbenchModel";
import type { SourcePunch } from "@/lib/payroll/attendanceSourceClient";
import { freshScheduleDatabase } from "./attendanceTest/freshScheduleDatabase";

function readOnlyLoader() {
  const filename = path.resolve("src/lib/manager/oversight.ts"), requireNative = createRequire(filename), fixture = { exports: {} };
  const fail = () => { throw new Error("Manager read attempted global database access/default leave seeding"); };
  const overrides: Record<string, unknown> = { "@/db": { db: new Proxy({}, { get: fail }) }, "@/lib/payroll/leave": { resolveLeavePayStatus, buildLeaveTypeMapByCode: fail } };
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new vm.Script(compiled, { filename }).runInNewContext({ module: fixture, exports: fixture.exports, require: (request: string) => Object.hasOwn(overrides, request) ? overrides[request] : requireNative(request), Date, Map, Set, Promise, Error, console, process });
  return fixture.exports as typeof import("@/lib/manager/oversight");
}

async function main() {
  const { pg, database, client, transactional } = await freshScheduleDatabase();
  const checks: string[] = [];
  const sentinel = "CONFIDENTIAL_928374_PAYROLL_NOTE";
  const now = new Date("2020-10-22T12:00:00+08:00");
  const actor = { userId: randomUUID(), role: "ADMIN" as const };
  const manager = { accountId: randomUUID(), role: "MANAGER" };
  const otherManager = { accountId: randomUUID(), role: "MANAGER" };
  const days = ["2020-10-16", "2020-10-17", "2020-10-18", "2020-10-19", "2020-10-20"];
  try {
    const [branch, otherBranch] = await database.insert(s.department).values([{ code: "M-QA-A", name: "Fictional branch A" }, { code: "M-QA-B", name: "Fictional branch B" }]).returning();
    const [employee, otherEmployee] = await database.insert(s.employees).values([{ employeeNo: "M-QA-A", firstName: "Fictional", lastName: "Alpha" }, { employeeNo: "M-QA-B", firstName: "Outside", lastName: "Scope" }]).returning();
    await database.insert(s.employeesGeneralInfo).values([{ employeeId: employee.id, departmentId: branch.id, dateHired: days[0], payrollTerms: "Semi-Monthly" }, { employeeId: otherEmployee.id, departmentId: otherBranch.id, dateHired: days[0], payrollTerms: "Semi-Monthly" }]);
    await database.insert(s.employeesSalary).values([{ employeeId: employee.id, dailyRate: "928374.92", monthlyRate: "0", ignoreContributionDeduction: true }, { employeeId: otherEmployee.id, dailyRate: "123456.78", monthlyRate: "0", ignoreContributionDeduction: true }]);
    await database.insert(s.authManagerDepartments).values([{ accountId: manager.accountId, departmentId: branch.id }, { accountId: otherManager.accountId, departmentId: otherBranch.id }]);
    await database.insert(s.accountCode).values([{ accountCode: "REG", accountType: "Regular Hours", description: sentinel, dailyRate: "1", monthlyRate: "1" }, { accountCode: "OT", accountType: "Overtime", description: sentinel, dailyRate: "1.25", monthlyRate: "1.25" }, { accountCode: "LATE", accountType: "Unpaid Leaves/Absences", description: "Tardiness" }, { accountCode: "LWOP", accountType: "Unpaid Leaves/Absences", description: "Leave Without Pay" }]);
    const [period] = await database.insert(s.payrollPeriods).values({ code: "2020-10-B", year: 2020, month: 10, cycle: "B", payrollTerms: "Semi-Monthly", startDate: days[0], endDate: days[4], nominalPayDate: "2020-10-31", adjustedPayDate: "2020-10-31", status: "Open" }).returning();
    // More future periods than the old 120-row descending limit must not hide the current period.
    await database.insert(s.payrollPeriods).values(Array.from({ length: 130 }, (_, index) => {
      const year = 2030 + Math.floor(index / 12), month = index % 12 + 1, date = `${year}-${String(month).padStart(2, "0")}-01`;
      return { code: `FUTURE-${index}`, year, month, cycle: "A" as const, payrollTerms: "Semi-Monthly" as const, startDate: date, endDate: date, nominalPayDate: date, adjustedPayDate: date, status: "Open" as const };
    }));
    const regular = await saveShiftCatalog(client, actor, { requestId: randomUUID(), code: "M-REG", description: "Fictional regular", regularStartTime: "08:00", regularEndTime: "17:00", calculationPolicy: "eight_hour_day", punchPolicy: "outer", breaks: buildShiftBreakRows([{ slotKey: "mid_break", fromTime: "12:00", toTime: "13:00", deduct: true, deductHours: 1, deductMinutes: 0, requiresPunches: false }]) });
    const split = await saveShiftCatalog(client, actor, { requestId: randomUUID(), code: "M-SPLIT", description: "Fictional split", regularStartTime: "08:00", regularEndTime: "21:00", calculationPolicy: "eight_hour_day", punchPolicy: "split_gaps", breaks: buildShiftBreakRows([{ slotKey: "mid_break", fromTime: "11:00", toTime: "15:30", deduct: true, deductHours: 4, deductMinutes: 30, requiresPunches: true }]) });
    const workspace = await readScheduleWorkspace(actor, { departmentId: branch.id, periodId: period.id, effectiveDate: days[0] }, client);
    await confirmScopedScheduleDays(actor, { requestId: randomUUID(), departmentId: branch.id, periodId: period.id, sourceDigest: workspace.sourceDigest, expectedDraftId: null, expectedDraftRevision: null, changes: days.map(day => ({ employeeId: employee.id, day, value: String(day === days[4] ? split.shiftTableId : regular.shiftTableId) })) }, transactional);
    const [batch] = await database.insert(s.attendanceImportBatches).values({ payrollPeriodId: period.id, sourceFileName: "fictional-manager.csv", sourceFormat: "CSV", status: "Processed", notes: sentinel }).returning();
    await database.insert(s.attendanceRawLogs).values([
      { day: days[1], time: "08:00", direction: "IN" as const }, { day: days[1], time: "17:00", direction: "OUT" as const },
      { day: days[4], time: "08:00", direction: "IN" as const }, { day: days[4], time: "21:00", direction: "OUT" as const },
    ].map(row => ({ batchId: batch.id, employeeId: employee.id, employeeNo: employee.employeeNo, logDate: row.day, logTime: row.time, loggedAt: new Date(`${row.day}T${row.time}:00Z`), direction: row.direction, rawText: sentinel })));
    const sourceId = "M-SOURCE", outsideSource = "OUTSIDE-SOURCE";
    await database.insert(s.attendanceSourceMappings).values([{ sourceEmployeeId: sourceId, employeeId: employee.id, actorUserId: "fixture", reason: sentinel }, { sourceEmployeeId: outsideSource, employeeId: otherEmployee.id, actorUserId: "fixture", reason: sentinel }]);
    const punch = (time: string, type: "IN" | "OUT"): SourcePunch => ({ eventId: randomUUID(), employeeId: sourceId, employeeName: sentinel, originalEmployeeId: sourceId, originalEmployeeName: sentinel, branchId: "QA", type, capturedAt: `${days[0]}T${time}:00+08:00`, receivedAt: `${days[0]}T${time}:00+08:00`, updatedAt: `${days[0]}T${time}:00+08:00`, status: "VALID", clockFlag: false, reviewResolved: false, reviewFlags: [] });
    const source = [punch("08:00", "IN"), punch("09:00", "IN"), punch("17:00", "OUT")];
    async function addSource(record: SourcePunch, employeeId = employee.id) {
      await database.insert(s.attendanceSourceEvents).values({ eventId: record.eventId, sourceEmployeeId: record.employeeId, capturedAt: new Date(record.capturedAt), payload: record, firstPayload: record });
      await database.insert(s.attendanceSourceProjections).values({ payrollPeriodId: period.id, eventId: record.eventId, employeeId, rawLogId: null, payloadHash: "fictional" });
    }
    for (const record of source) await addSource(record);
    await addSource({ ...punch("07:00", "IN"), employeeId: outsideSource }, otherEmployee.id);
    const records: WorkRecord[] = source.map(record => ({ id: record.eventId, source: "API", employeeId: employee.id, type: record.type, at: record.capturedAt, status: record.status, clockFlag: false, sourcePunch: record }));
    const draft: WorkDraft = { employeeId: employee.id, days: [days[0]], changes: [], reason: sentinel, ownerId: "fixture", needed: "", rejected: false, version: "fixture" };
    const [workBatch] = await database.insert(s.workBatches).values({ periodId: period.id, actor: "fixture" }).returning();
    const [plan] = await database.insert(s.workPlans).values({ batchId: workBatch.id, periodId: period.id, employeeId: employee.id, draft, state: "Resolved", evidenceVersion: "fixture", ownerId: "fixture" }).returning();
    await persistAdminDecision(client, { periodId: period.id, planId: plan.id, actor: "fixture", employeeNo: employee.employeeNo, draft, sourceRecords: records, records: records.map((record, index) => index === 1 ? { ...record, status: "VOID" } : record), warnings: [sentinel] });
    async function fingerprint() {
      const tables = (await pg.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
      const hash = createHash("sha256");
      for (const { tablename } of tables) hash.update(tablename).update(JSON.stringify((await pg.query(`select to_jsonb(t) as row from "${tablename.replaceAll('"', '""')}" t order by to_jsonb(t)::text`)).rows));
      return hash.digest("hex");
    }
    async function compare(label: string) {
      const before = await fingerprint();
      const result = await readManagerAttendanceOverview(manager, { periodId: period.id, departmentId: branch.id, asOfDate: days[4] }, transactional, now);
      const admin = await loadProvisionalPayroll({ periodId: period.id, employeeId: employee.id, group: "Daily", asOfDate: days[4] }, transactional);
      assert.equal(await fingerprint(), before, "Every table is unchanged by manager and administrator reads");
      assert.equal(result.employees.length, 1);
      const serialized = JSON.stringify(result);
      for (const value of [sentinel, "928374", "123456", otherEmployee.id, "Outside Scope"]) assert(!serialized.includes(value), `Confidential/out-of-scope sentinel absent: ${value}`);
      assert(!/"(?:gross|net|salary|rate|amount|deductions|shortfall|postedCredits|recordedLines|forecastLines|remarks|reason|notes|rawText|payload)"/.test(serialized));
      for (const day of result.employees[0].days) {
        const expected = admin.rows[0].days.find(item => item.date === day.date)!;
        assert(expected);
        assert.equal(day.workedMinutes, expected.workedMinutes, `${label}: work`);
        assert.equal(day.regularMinutes, expected.regularMinutes, `${label}: regular`);
        assert.equal(day.lateMinutes, expected.review!.lateMinutes, `${label}: late`);
        assert.equal(day.undertimeMinutes, expected.review!.undertimeMinutes, `${label}: undertime`);
        assert.equal(day.overtimeMinutes, expected.review!.overtimeMinutes, `${label}: overtime`);
        const review = getProvisionalDayReview(expected, { today: result.today, asOfDate: result.asOfDate });
        assert.equal(day.needsAction, review.needsAction || review.inScope && day.leaveCoverage === "partial-day", `${label}: action plus conservative partial-leave review`);
        assert.deepEqual(day.findings.filter(item => item.code !== "partial-leave").map(item => item.code), review.findings.map(item => item.code), `${label}: canonical finding codes`);
        assert.deepEqual(day.punches.map(({ type, at, included }) => ({ type, at, included })), expected.attendance!.punches.map(({ type, at, included }) => ({ type, at: new Date(at).toISOString(), included })), `${label}: evidence`);
      }
      checks.push(label);
      return result;
    }
    const initial = await compare("Scoped current findings match actual Admin loader for normal, corrected, missing and required split punches; every table preserved");
    assert(initial.employees[0].days[0].punches.some(row => row.state === "resolved"));
    assert.equal(initial.employees[0].days[0].needsAction, false);
    assert(initial.employees[0].days[2].findings.some(row => row.code === "scheduled-no-attendance"));
    assert(initial.employees[0].days[4].findings.some(row => row.code === "punches"));
    assert.deepEqual(initial.employees[0].days[4].breaks, [{ fromTime: "11:00:00", toTime: "15:30:00", requiresPunches: true }]);
    const extra = punch("18:00", "IN"); await addSource(extra);
    const changed = await compare("New evidence remains actionable while approved original/corrected evidence is retained");
    assert(changed.employees[0].days[0].findings.some(row => row.code === "new-evidence"));
    await database.delete(s.attendanceSourceProjections).where(eq(s.attendanceSourceProjections.eventId, extra.eventId)); await database.delete(s.attendanceSourceEvents).where(eq(s.attendanceSourceEvents.eventId, extra.eventId));
    await database.insert(s.employeeAttendanceDayStatusOverrides).values({ payrollPeriodId: period.id, employeeId: employee.id, attendanceDate: days[0], status: "Hold", remarks: sentinel });
    await database.insert(s.employeeAttendanceDayMetricOverrides).values({ payrollPeriodId: period.id, employeeId: employee.id, attendanceDate: days[1], lateMinutes: 7, undertimeMinutes: 11, overtimeMinutes: 6, remarks: sentinel });
    await compare("Independent Hold and manual metric overrides match Admin without exposing remarks");
    const [leaveType] = await database.insert(s.leaveTypes).values({ code: "M-LEAVE", name: "Fictional leave", isPaid: true, requiresBalance: false }).returning();
    const [leave] = await database.insert(s.employeesLeaveRecords).values({ employeeId: employee.id, leaveTypeId: leaveType.id, dateFiled: days[0], leaveStartDate: days[3], leaveEndDate: days[3], leaveType: leaveType.code, noOfDays: "0.50", reason: sentinel, leaveStatus: "Approved" }).returning();
    await database.insert(s.employeeLeaveRecordDays).values({ leaveRecordId: leave.id, leaveDate: days[3], dayPart: "AM", quantity: "0.50" });
    const withLeave = await compare("Partial approved leave preserves Admin time totals and adds explicit remaining-attendance review without determining absence/pay");
    assert.equal(withLeave.employees[0].days[3].approvedLeave, true);
    assert.equal(withLeave.employees[0].days[3].leaveCoverage, "partial-day");
    assert.equal(withLeave.employees[0].days[3].needsAction, true);
    assert(withLeave.issues.some(issue => issue.date === days[3] && issue.code === "partial-leave"));
    const [legacyLeave] = await database.insert(s.employeesLeaveRecords).values({ employeeId: employee.id, leaveTypeId: null, dateFiled: days[2], leaveStartDate: null, leaveEndDate: null, leaveType: leaveType.code, noOfDays: "1.00", reason: sentinel, leaveStatus: "Approved" }).returning();
    const beforeLegacy = await fingerprint();
    const legacyResult = await readOnlyLoader().readManagerAttendanceOverview(manager, { periodId: period.id }, transactional, now);
    const legacyDay = legacyResult.employees[0].days.find(day => day.date === days[2])!;
    assert.equal(legacyDay.approvedLeave, true); assert.equal(legacyDay.leaveCoverage, "unverified");
    assert(!legacyDay.findings.some(finding => finding.code === "scheduled-no-attendance"));
    assert.equal(await fingerprint(), beforeLegacy, "Legacy type fallback and dateFiled overlap read cannot seed or modify any table");
    await database.delete(s.employeesLeaveRecords).where(eq(s.employeesLeaveRecords.id, legacyLeave.id));
    checks.push("Legacy null-start/null-type approved leave uses dateFiled and transaction-only lookup; global DB/seeding trap and every-table fingerprint pass");
    await database.insert(s.employeesTimekeeping).values({ employeeId: otherEmployee.id, checkInTime: "22:00", checkOutTime: "06:00", hoursWorked: "8.00" });
    await database.insert(s.attendanceRawLogs).values({ batchId: batch.id, employeeId: otherEmployee.id, employeeNo: otherEmployee.employeeNo, logDate: days[4], logTime: "22:00", loggedAt: new Date(`${days[4]}T22:00:00+08:00`), direction: "IN", rawText: sentinel });
    const overnightDuring = await readManagerAttendanceOverview(otherManager, { periodId: period.id, employeeId: otherEmployee.id }, transactional, new Date("2020-10-21T01:00:00+08:00"));
    const overnightAfter = await readManagerAttendanceOverview(otherManager, { periodId: period.id, employeeId: otherEmployee.id }, transactional, new Date("2020-10-21T07:00:00+08:00"));
    assert.equal(overnightDuring.employees[0].days.find(day => day.date === days[4])!.phase, "in-progress");
    assert.equal(overnightDuring.employees[0].days.find(day => day.date === days[4])!.needsAction, false);
    assert(!overnightDuring.issues.some(issue => issue.date === days[4]));
    assert.equal(overnightAfter.employees[0].days.find(day => day.date === days[4])!.phase, "recorded");
    assert.equal(overnightAfter.employees[0].days.find(day => day.date === days[4])!.needsAction, true);
    checks.push("Prior-day 22:00–06:00 shift is in progress at 01:00 with no missing-OUT action, and actionable at 07:00 if OUT is still absent");
    const scopedResolution = await resolutionPeople(client, period, undefined, [employee.id]);
    assert(scopedResolution.every(row => row.employeeId === employee.id));
    assert.deepEqual(scopedResolution, (await resolutionPeople(client, period)).filter(row => row.employeeId === employee.id), "Scoped legacy-resolution evidence is identical to Admin's same employees");
    checks.push("Legacy source-resolution reader scopes identities before evidence retrieval without changing current Admin results");
    const defaultPeriod = await readManagerAttendanceOverview(manager, {}, transactional, new Date("2020-10-18T12:00:00+08:00"));
    assert.equal(defaultPeriod.period?.id, period.id); assert.equal(defaultPeriod.asOfDate, "2020-10-17");
    assert.equal(defaultPeriod.employees[0].days[2].phase, "in-progress"); assert.equal(defaultPeriod.employees[0].days[3].phase, "future");
    assert(defaultPeriod.employees[0].days.filter(row => ["future", "in-progress"].includes(row.phase)).every(row => !row.needsAction));
    const historical = await readManagerAttendanceOverview(manager, { periodId: period.id }, transactional, new Date("2026-10-14T12:00:00+08:00"));
    assert.equal(historical.asOfDate, period.endDate);
    const earlier = await readManagerAttendanceOverview(manager, { periodId: period.id, asOfDate: days[0] }, transactional, now);
    assert.equal(earlier.employees[0].days[1].phase, "after-cutoff"); assert.equal(earlier.employees[0].days[1].needsAction, false);
    checks.push("130 future catalog periods cannot displace current selection; historic cutoff, completed-day filtering and future/in-progress states remain explicit");
    await assert.rejects(() => readManagerAttendanceOverview(manager, { departmentId: otherBranch.id, periodId: period.id }, transactional, now), /not assigned/);
    await assert.rejects(() => readManagerAttendanceOverview(manager, { departmentId: branch.id, employeeId: otherEmployee.id, periodId: period.id }, transactional, now), /unavailable/);
    await assert.rejects(() => readManagerAttendanceOverview(manager, { employeeId: otherEmployee.id, periodId: period.id }, transactional, now), /unavailable/);
    assert.equal((await readManagerAttendanceOverview(manager, { employeeId: employee.id, periodId: period.id }, transactional, now)).departmentId, branch.id);
    const other = await readManagerAttendanceOverview(otherManager, { periodId: period.id }, transactional, now);
    assert.equal(other.employees[0].employeeId, otherEmployee.id); assert(!JSON.stringify(other).includes(employee.id));
    await assert.rejects(() => readManagerAttendanceOverview({ ...manager, role: "EMPLOYEE" }, {}, transactional, now), /Manager access/);
    await assert.rejects(() => readManagerAttendanceOverview({ ...manager, role: "ADMIN" }, {}, transactional, now), /Manager access/);
    await assert.rejects(() => readManagerAttendanceOverview(manager, { asOfDate: "2020-10-22" }, transactional, now), /completed/);
    await assert.rejects(() => readManagerAttendanceOverview(manager, { asOfDate: "2020-02-31" }, transactional, now), /valid/);
    await database.delete(s.authManagerDepartments).where(eq(s.authManagerDepartments.accountId, manager.accountId));
    assert.equal((await readManagerAttendanceOverview(manager, {}, transactional, now)).employees.length, 0);
    await assert.rejects(() => readManagerAttendanceOverview(manager, { departmentId: branch.id }, transactional, now), /not assigned/);
    checks.push("Two-manager isolation, tampered branch/employee, inferred authorized employee branch, role denial and immediate revoked-scope denial");
    const adminDay = (await loadProvisionalPayroll({ periodId: period.id, employeeId: employee.id, group: "Daily", asOfDate: days[4] }, transactional)).rows[0].days[0];
    adminDay.warnings = [sentinel]; adminDay.attendance!.issues.push(sentinel); adminDay.attendance!.punches[0].reason = sentinel; adminDay.scheduleSource = sentinel;
    assert(!JSON.stringify(projectManagerAttendanceDay(adminDay, { today: "2020-10-22", asOfDate: days[4] })).includes(sentinel), "Unknown/free-text sources cannot leak through typed projection");
    checks.push("Public projection rejects nested/raw-text sentinels; no financial keys or values in actual manager service payloads");
    console.log(JSON.stringify({ passed: true, checks, fixture: "Fresh fictional PGlite; source/configuration never connects to production. HTTP session/browser acceptance is separate." }, null, 2));
  } finally { await pg.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

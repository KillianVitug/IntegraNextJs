import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { readShiftCatalog } from "@/lib/scheduling/shift-catalog";
import { shiftTableScheduleSnapshot } from "@/lib/scheduling/presentation";
import { applyUnifiedRuleTransition, previewUnifiedRuleTransition } from "@/lib/scheduling/unified-rule-transition";
import { getActiveWeeklyShiftPatternForDate } from "@/lib/payroll/scheduleResolver";
import { scheduleWeekdays } from "@/lib/scheduling/workspace-types";
import { freshScheduleDatabase } from "./attendanceTest/freshScheduleDatabase";
import { captureUnifiedRuleRetention, unifiedRuleInvariants } from "./runUnifiedRuleTransition";

async function main() {
  const { pg, database, client } = await freshScheduleDatabase();
  const actor = { role: "ADMIN" as const, userId: "system:unified-rule-fixture" };
  try {
    const [branch] = await database.insert(s.department).values({ code: "UNIFIED-FIX", name: "Fictional conversion branch" }).returning();
    const [person] = await database.insert(s.employees).values({ employeeNo: "UNIFIED-FIX", firstName: "Fictional", lastName: "Conversion" }).returning();
    await database.insert(s.employeesGeneralInfo).values({ employeeId: person.id, departmentId: branch.id, dateHired: "2026-09-01", payrollTerms: "Semi-Monthly" });
    await database.insert(s.employeesSalary).values({ employeeId: person.id, dailyRate: "800", monthlyRate: "0", ignoreContributionDeduction: true });
    await database.insert(s.accountCode).values([{ accountCode: "REG", accountType: "Regular Hours", description: "Regular hours", dailyRate: "1" }, { accountCode: "OT", accountType: "Overtime", description: "Regular overtime", dailyRate: "1.25" }, { accountCode: "LATE", accountType: "Unpaid Leaves/Absences", description: "Tardiness" }, { accountCode: "LWOP", accountType: "Unpaid Leaves/Absences", description: "Leave Without Pay" }]);
    await database.insert(s.overtimeRules).values({ category: "REGULAR_DAY", minutesFrom: 30, rateMultiplier: "1.25" });
    const [prior, period] = await database.insert(s.payrollPeriods).values([
      { code: "FIX-SEP", year: 2026, month: 9, cycle: "B" as const, payrollTerms: "Semi-Monthly" as const, startDate: "2026-09-16", endDate: "2026-09-30", nominalPayDate: "2026-09-30", adjustedPayDate: "2026-09-30", status: "Closed" as const },
      { code: "FIX-OCT", year: 2026, month: 10, cycle: "A" as const, payrollTerms: "Semi-Monthly" as const, startDate: "2026-10-01", endDate: "2026-10-15", nominalPayDate: "2026-10-15", adjustedPayDate: "2026-10-15", status: "Open" as const },
    ]).returning();
    const [split, ordinary] = await database.insert(s.shiftTables).values([
      { code: "REVIEWED-A", description: "Fictional split", regularStartTime: "08:00", regularEndTime: "21:00", calculationPolicy: "legacy", punchPolicy: "legacy" },
      { code: "REVIEWED-B", description: "Fictional ordinary", regularStartTime: "08:00", regularEndTime: "17:00", calculationPolicy: "legacy", punchPolicy: "legacy" },
    ]).returning();
    await database.insert(s.shiftTableBreaks).values([
      { shiftTableId: split.id, slotKey: "mid_break", label: "Mid Breaktime", sortOrder: 1, fromTime: "11:00", toTime: "15:30", deduct: true, deductHours: 4, deductMinutes: 30 },
      { shiftTableId: ordinary.id, slotKey: "mid_break", label: "Mid Breaktime", sortOrder: 1, fromTime: "12:00", toTime: "13:00", deduct: true, deductHours: 1, deductMinutes: 0 },
    ]);
    const templates = new Map((await readShiftCatalog(client)).map(row => [row.id, shiftTableScheduleSnapshot(row)]));
    const [base, overlay] = await database.insert(s.employeeWeeklyShiftPatterns).values([{ employeeId: person.id, effectiveFrom: "2026-09-01", effectiveTo: null }, { employeeId: person.id, effectiveFrom: "2026-10-03", effectiveTo: "2026-10-04" }]).returning();
    await database.insert(s.employeeWeeklyShiftPatternDays).values([base, overlay].flatMap(pattern => scheduleWeekdays.map(weekday => {
      const snapshot = templates.get(pattern.id === base.id ? split.id : ordinary.id)!;
      return { patternId: pattern.id, weekday, shiftTableId: snapshot.shiftTableId, shiftName: snapshot.shiftName, shiftCode: snapshot.shiftCode, checkInTime: snapshot.checkInTime, checkOutTime: snapshot.checkOutTime, breakMinutes: snapshot.breakMinutes, paidBreakMinutes: snapshot.paidBreakMinutes, hoursPerDay: snapshot.hoursPerDay.toFixed(2), calculationPolicy: "legacy", punchPolicy: "legacy" };
    })));
    const snap = templates.get(split.id)!;
    const assignments = await database.insert(s.employeeShiftAssignments).values(["2026-09-30", "2026-10-01"].map(day => ({ employeeId: person.id, effectiveFrom: day, effectiveTo: day, shiftTableId: split.id, shiftName: snap.shiftName, shiftCode: snap.shiftCode, checkInTime: snap.checkInTime!, checkOutTime: snap.checkOutTime!, breakMinutes: snap.breakMinutes, paidBreakMinutes: snap.paidBreakMinutes, hoursPerDay: String(snap.hoursPerDay), confirmedSchedule: snap }))).returning();
    const [posted, reviewed] = await database.insert(s.payrollRuns).values([{ payrollPeriodId: prior.id, runNumber: 1, status: "Posted" }, { payrollPeriodId: period.id, runNumber: 1, status: "Reviewed" }]).returning();
    await database.insert(s.payrollRunEmployees).values([posted, reviewed].map(run => ({ payrollRunId: run.id, employeeId: person.id, employeeNoSnapshot: person.employeeNo, employeeNameSnapshot: "Fictional Conversion", netPay: "800.00" })));
    const [batch] = await database.insert(s.attendanceImportBatches).values({ sourceFileName: "fictional.csv", sourceFormat: "CSV", payrollPeriodId: period.id, status: "Processed" }).returning();
    await database.insert(s.attendanceRawLogs).values(["08:00", "11:00", "15:30", "21:00"].map((time, index) => ({ batchId: batch.id, employeeId: person.id, employeeNo: person.employeeNo, logDate: "2026-10-01", logTime: time, loggedAt: new Date(`2026-10-01T${time}:00Z`), direction: index % 2 ? "OUT" as const : "IN" as const })));
    const input = { reviewedTemplates: [{ shiftTableId: split.id, reviewedSplitGapSlots: ["mid_break" as const] }, { shiftTableId: ordinary.id, reviewedSplitGapSlots: [] }] };
    const baseline = { patterns: await database.select().from(s.employeeWeeklyShiftPatterns), days: await database.select().from(s.employeeWeeklyShiftPatternDays), history: assignments[0], posted: await database.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, posted.id)), raw: await database.select().from(s.attendanceRawLogs) };
    let plan = await previewUnifiedRuleTransition(client, actor, input);
    assert.deepEqual(plan.counts, { catalogVersions: 2, weeklySegments: 3, datedDays: 1, employees: 1 });
    assert.deepEqual(plan.weekly.map(row => [row.effectiveFrom, row.effectiveTo, row.sourcePatternId]), [["2026-10-01", "2026-10-02", base.id], ["2026-10-03", "2026-10-04", overlay.id], ["2026-10-05", null, base.id]], "Only the effective highest-ID timeline is converted");
    assert.deepEqual(plan.affectedPeriodIds, [period.id]);
    await assert.rejects(previewUnifiedRuleTransition(client, { ...actor, role: "MANAGER" }, input), /administrator/);
    await assert.rejects(previewUnifiedRuleTransition(client, actor, { reviewedTemplates: [] }), /mapping is incomplete/);
    await database.update(s.employeeShiftAssignments).set({ graceMinutes: 5, confirmedSchedule: { ...snap, graceMinutes: 5 } }).where(eq(s.employeeShiftAssignments.id, assignments[1].id));
    await assert.rejects(previewUnifiedRuleTransition(client, actor, input), /grace/);
    await database.update(s.employeeShiftAssignments).set({ graceMinutes: 0, confirmedSchedule: snap }).where(eq(s.employeeShiftAssignments.id, assignments[1].id));
    await database.insert(s.employeeAttendancePeriodOverrides).values({ employeeId: person.id, payrollPeriodId: period.id, workedMinutes: 480 });
    await assert.rejects(previewUnifiedRuleTransition(client, actor, input), /whole-period/);
    await database.delete(s.employeeAttendancePeriodOverrides);
    const [draft] = await database.insert(s.scheduleWorkspaceDrafts).values({ departmentId: branch.id, periodId: period.id, revision: 1, cells: [], sourceDigest: "0".repeat(64), updatedByUserId: actor.userId }).returning();
    await assert.rejects(previewUnifiedRuleTransition(client, actor, input), /draft/);
    await database.delete(s.scheduleWorkspaceDrafts).where(eq(s.scheduleWorkspaceDrafts.id, draft.id));
    await database.update(s.payrollRuns).set({ status: "Approved" }).where(eq(s.payrollRuns.id, reviewed.id));
    await assert.rejects(previewUnifiedRuleTransition(client, actor, input), /Approved/);
    await database.update(s.payrollRuns).set({ status: "Reviewed" }).where(eq(s.payrollRuns.id, reviewed.id));
    await database.update(s.payrollPeriods).set({ status: "Closed" }).where(eq(s.payrollPeriods.id, period.id));
    await assert.rejects(previewUnifiedRuleTransition(client, actor, input), /Closed/);
    await database.update(s.payrollPeriods).set({ status: "Open" }).where(eq(s.payrollPeriods.id, period.id));
    await database.insert(s.employeesTimekeeping).values({ employeeId: person.id, checkInTime: "08:00", checkOutTime: "17:00", hoursWorked: "8" });
    await assert.rejects(previewUnifiedRuleTransition(client, actor, input), /fallback/);
    await database.delete(s.employeesTimekeeping);
    plan = await previewUnifiedRuleTransition(client, actor, input);
    await assert.rejects(applyUnifiedRuleTransition(client, actor, { ...input, requestId: randomUUID(), expectedSourceDigest: "0".repeat(64) }), /changed after preview/);
    await pg.exec(`CREATE FUNCTION fail_conversion_weekly() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id > ${overlay.id} THEN RAISE EXCEPTION 'fixture forced weekly failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER conversion_failure BEFORE INSERT ON employee_weekly_shift_patterns FOR EACH ROW EXECUTE FUNCTION fail_conversion_weekly();`);
    await assert.rejects(applyUnifiedRuleTransition(client, actor, { ...input, requestId: randomUUID(), expectedSourceDigest: plan.sourceDigest }), /fixture forced weekly failure/);
    assert.equal((await readShiftCatalog(client, { includeArchived: true })).length, 2, "Outer transaction rolls back catalog versions when later weekly mutation fails");
    assert.equal((await database.select().from(s.shiftCatalogReceipts)).length, 0);
    await pg.exec("DROP TRIGGER conversion_failure ON employee_weekly_shift_patterns; DROP FUNCTION fail_conversion_weekly();");
    await pg.exec(`CREATE FUNCTION ensure_stale_before_summary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM payroll_runs WHERE id='${reviewed.id}' AND status='Reviewed') THEN RAISE EXCEPTION 'summary refreshed before run invalidation'; END IF; RETURN NEW; END $$; CREATE TRIGGER require_stale_summary BEFORE INSERT ON attendance_daily_summaries FOR EACH ROW EXECUTE FUNCTION ensure_stale_before_summary();`);
    const command = { ...input, requestId: randomUUID(), expectedSourceDigest: plan.sourceDigest };
    const retained = await captureUnifiedRuleRetention(client, plan);
    const preserved = await unifiedRuleInvariants(client, retained);
    const receipt = await applyUnifiedRuleTransition(client, actor, command);
    assert.deepEqual(await unifiedRuleInvariants(client, retained), preserved, "Operator invariants retain original catalog, breaks, patterns, snapshots and unrelated payroll while allowing audited revisions and generated derivatives");
    assert.deepEqual(await applyUnifiedRuleTransition(client, actor, command), receipt, "Lost response replay returns the committed receipt without duplicate versions");
    await assert.rejects(applyUnifiedRuleTransition(client, { ...actor, userId: "system:another-actor" }, command), /different instructions or actor/);
    assert.equal((await readShiftCatalog(client)).every(row => row.calculationPolicy === "eight_hour_day"), true);
    assert.equal((await readShiftCatalog(client, { includeArchived: true })).length, 4);
    assert.equal((await database.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, reviewed.id)))[0].status, "Stale");
    assert.deepEqual(await database.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, posted.id)), baseline.posted);
    assert.deepEqual((await database.select().from(s.employeeShiftAssignments).where(eq(s.employeeShiftAssignments.id, assignments[0].id)))[0], baseline.history);
    assert.deepEqual(await database.select().from(s.attendanceRawLogs), baseline.raw);
    const patterns = await database.select().from(s.employeeWeeklyShiftPatterns), days = await database.select().from(s.employeeWeeklyShiftPatternDays);
    assert.deepEqual(patterns.filter(row => row.id === base.id || row.id === overlay.id), baseline.patterns);
    assert.deepEqual(days.filter(row => row.patternId === base.id || row.patternId === overlay.id), baseline.days);
    const current = getActiveWeeklyShiftPatternForDate(patterns.map(row => ({ ...row, days: days.filter(day => day.patternId === row.id) })), "2026-10-03")!;
    assert.equal(current.days[0].shiftTableId, receipt.catalogIds.find(row => row.previousId === ordinary.id)?.newId);
    const summary = (await database.select().from(s.attendanceDailySummaries)).find(row => row.attendanceDate === "2026-10-01")!;
    assert.equal(summary.calculationPolicy, "eight_hour_day"); assert.equal(summary.regularMinutes, 480); assert.equal(summary.overtimeMinutes, 30);
    assert.equal((await database.select().from(s.payrollRuns)).length, 2, "Transition never creates or posts an official run");
    assert.equal((await previewUnifiedRuleTransition(client, actor, { reviewedTemplates: [] })).counts.weeklySegments, 0);
    // A real branch-period can exceed the existing scoped command's 100-day cap.
    const bulkEmployees = await database.insert(s.employees).values(Array.from({ length: 8 }, (_, index) => ({ employeeNo: `BULK-FIX-${index}`, firstName: "Fictional", lastName: `Batch ${index}` }))).returning();
    await database.insert(s.employeesGeneralInfo).values(bulkEmployees.map(employee => ({ employeeId: employee.id, departmentId: branch.id, dateHired: "2026-10-01", payrollTerms: "Semi-Monthly" as const })));
    await database.insert(s.employeesSalary).values(bulkEmployees.map(employee => ({ employeeId: employee.id, dailyRate: "800", monthlyRate: "0", ignoreContributionDeduction: true })));
    const [bulkTemplate] = await database.insert(s.shiftTables).values({ code: "BULK-FIX", description: "Fictional bulk ordinary", regularStartTime: "08:00", regularEndTime: "16:00", calculationPolicy: "legacy", punchPolicy: "legacy" }).returning();
    const bulkSnapshot = shiftTableScheduleSnapshot((await readShiftCatalog(client)).find(template => template.id === bulkTemplate.id)!);
    await database.insert(s.employeeShiftAssignments).values(bulkEmployees.flatMap(employee => Array.from({ length: 15 }, (_, index) => {
      const day = `2026-10-${String(index + 1).padStart(2, "0")}`;
      return { employeeId: employee.id, effectiveFrom: day, effectiveTo: day, shiftTableId: bulkTemplate.id, shiftName: bulkSnapshot.shiftName, shiftCode: bulkSnapshot.shiftCode, checkInTime: "08:00", checkOutTime: "16:00", hoursPerDay: "8", confirmedSchedule: bulkSnapshot };
    })));
    const bulkInput = { reviewedTemplates: [{ shiftTableId: bulkTemplate.id, reviewedSplitGapSlots: [] }] };
    const bulkPlan = await previewUnifiedRuleTransition(client, actor, bulkInput);
    assert.equal(bulkPlan.counts.datedDays, 120);
    const bulkCommand = { ...bulkInput, requestId: randomUUID(), expectedSourceDigest: bulkPlan.sourceDigest };
    const bulkReceipt = await applyUnifiedRuleTransition(client, actor, bulkCommand);
    assert.equal(bulkReceipt.counts.datedDays, 120);
    const bulkIds = new Set(bulkEmployees.map(employee => employee.id));
    const bulkDecisions = (await database.select().from(s.scheduleDecisionRevisions)).filter(row => bulkIds.has(row.employeeId));
    assert.equal(bulkDecisions.length, 120, "All 120 branch-period days convert through bounded scoped commands");
    assert.deepEqual([...new Set(bulkDecisions.map(row => row.requestId))].map(requestId => bulkDecisions.filter(row => row.requestId === requestId).length).sort((a, b) => a - b), [20, 100], "Each chunk respects the service cap and the second uses its refreshed source digest");
    assert.deepEqual(await applyUnifiedRuleTransition(client, actor, bulkCommand), bulkReceipt, "Retry does not duplicate either chunk");
    console.log("PASS unified-rule transition: effective timeline conversion, exact-source review, protected/history preservation, fail-closed mapping/grace/override/draft/profile checks, atomic rollback, Reviewed-to-Stale-before-refresh, 480+30 attendance, 120-day bounded confirmation and idempotent receipts; fictional PGlite only.");
  } finally { await pg.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

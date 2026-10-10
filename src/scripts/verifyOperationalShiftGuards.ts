import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { buildShiftBreakRows } from "@/lib/shifts";
import { assertOperationalSchedule, operationalScheduleSampleDates } from "@/lib/scheduling/operational-rule-guard";
import { saveShiftCatalog, readShiftCatalog } from "@/lib/scheduling/shift-catalog";
import { shiftTableScheduleSnapshot } from "@/lib/scheduling/presentation";
import { archiveWeeklySchedule, confirmScopedScheduleDays, mutatePeriodSchedule, readScheduleWorkspace, saveWeeklySchedules } from "@/lib/scheduling/service";
import { scheduleWeekdays, type ScheduleSnapshot } from "@/lib/scheduling/workspace-types";
import { prepareBulkDaySchedules, saveDateAssignment } from "@/lib/payroll/bulkDaySchedules";
import { upsertEmployeeShiftAssignmentSchema } from "@/zod-schemas/employeeShiftAssignment";
import { freshScheduleDatabase } from "./attendanceTest/freshScheduleDatabase";
import type * as datedActions from "@/app/actions/shiftAssignmentAction";
import type * as calendarActions from "@/app/(ntg)/branchCalendar/actions";
import type * as managerActions from "@/app/actions/managerScheduleApprovalAction";

async function main() {
  const { pg, database, client, transactional } = await freshScheduleDatabase();
  const actor = { userId: randomUUID(), role: "ADMIN" as const };
  let checks = 0;
  // Only framework authentication/cache and module-owned storage are rebound.
  // The exported handlers, Drizzle transactions, policy guards and mutation code run unchanged.
  function actionModule<T>(file: string): T {
    const filename = path.resolve(file), nativeRequire = createRequire(filename), fixtureModule = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const require = (request: string) => request === "@/db" ? { db: transactional }
      : request === "next/cache" ? { revalidatePath() {} }
      : request === "@/lib/admin" ? { ...nativeRequire(request), requireAdminActor: async () => actor }
      : nativeRequire(request);
    new vm.Script(compiled, { filename }).runInNewContext({ module: fixtureModule, exports: fixtureModule.exports, require, Date, Map, Set, Promise, Buffer, console, process });
    return fixtureModule.exports as T;
  }
  try {
    const dated = actionModule<typeof datedActions>("src/app/actions/shiftAssignmentAction.ts"), calendar = actionModule<typeof calendarActions>("src/app/(ntg)/branchCalendar/actions.ts"), manager = actionModule<typeof managerActions>("src/app/actions/managerScheduleApprovalAction.ts");
    const [branch] = await database.insert(s.department).values({ code: "RULE-GUARD", name: "Fictional guard branch" }).returning();
    const [person] = await database.insert(s.employees).values({ employeeNo: "RULE-GUARD", firstName: "Fictional", lastName: "Guard" }).returning();
    await database.insert(s.employeesGeneralInfo).values({ employeeId: person.id, departmentId: branch.id, dateHired: "2026-09-01" });
    await database.insert(s.accountCode).values([
      { accountCode: "LWOP", accountType: "Unpaid Leaves/Absences", description: "Leave Without Pay" },
      { accountCode: "REGULAR", accountType: "Regular Hours", description: "Regular hours" },
      { accountCode: "OT", accountType: "Overtime", description: "Regular overtime" },
      { accountCode: "LATE", accountType: "Unpaid Leaves/Absences", description: "Tardiness" },
    ]);
    const [historical, current] = await database.insert(s.payrollPeriods).values([
      { code: "GUARD-SEP", year: 2026, month: 9, cycle: "B" as const, payrollTerms: "Semi-Monthly" as const, startDate: "2026-09-16", endDate: "2026-09-30", nominalPayDate: "2026-09-30", adjustedPayDate: "2026-09-30", status: "Open" as const },
      { code: "GUARD-OCT", year: 2026, month: 10, cycle: "A" as const, payrollTerms: "Semi-Monthly" as const, startDate: "2026-10-01", endDate: "2026-10-15", nominalPayDate: "2026-10-15", adjustedPayDate: "2026-10-15", status: "Open" as const },
    ]).returning();
    const [old] = await database.insert(s.shiftTables).values({ code: "OLD-FIX", description: "Historical shift", regularStartTime: "08:00", regularEndTime: "16:00", calculationPolicy: "legacy", punchPolicy: "legacy" }).returning();
    const currentShift = await saveShiftCatalog(client, actor, { requestId: randomUUID(), code: "CURRENT-FIX", description: "Current shift", regularStartTime: "08:00", regularEndTime: "16:00", calculationPolicy: "eight_hour_day", punchPolicy: "outer", breaks: buildShiftBreakRows([]) });
    const snapshots = new Map((await readShiftCatalog(client)).map(row => [row.id, shiftTableScheduleSnapshot(row)]));
    const oldSnapshot = snapshots.get(old.id)!, currentSnapshot = snapshots.get(currentShift.shiftTableId)!;
    const [oldPattern] = await database.insert(s.employeeWeeklyShiftPatterns).values({ employeeId: person.id, effectiveFrom: "2026-09-01", effectiveTo: null }).returning();
    const dayValues = (patternId: number, snapshot: ScheduleSnapshot) => scheduleWeekdays.map(weekday => ({ patternId, weekday, scheduleState: snapshot.kind, definitionSnapshot: snapshot, shiftTableId: snapshot.shiftTableId, shiftName: snapshot.shiftName, shiftCode: snapshot.shiftCode, checkInTime: snapshot.checkInTime, checkOutTime: snapshot.checkOutTime, breakMinutes: snapshot.breakMinutes, paidBreakMinutes: snapshot.paidBreakMinutes, hoursPerDay: snapshot.hoursPerDay.toFixed(2), calculationPolicy: snapshot.calculationPolicy, punchPolicy: snapshot.punchPolicy }));
    await database.insert(s.employeeWeeklyShiftPatternDays).values(dayValues(oldPattern.id, oldSnapshot));
    const query = { departmentId: branch.id, periodId: current.id, effectiveDate: "2026-10-01" };
    const state = async () => JSON.stringify(await Promise.all([
      database.select().from(s.employeeShiftAssignments), database.select().from(s.employeeWeeklyShiftPatterns), database.select().from(s.employeeWeeklyShiftPatternDays),
      database.select().from(s.scheduleDecisionRevisions), database.select().from(s.scheduleWorkspaceDrafts), database.select().from(s.scheduleRequestReceipts),
      database.select().from(s.adminAuditEvents), database.select().from(s.payrollRuns), database.select().from(s.branchCalendarScheduleOverrideItems), database.select().from(s.managerScheduleChangeRequests),
    ]));
    async function rejectUnchanged(operation: () => Promise<unknown>) {
      const before = await state(); await assert.rejects(operation, /Use Schedules/); assert.equal(await state(), before, "Rejected operational mutation rolls back schedule, receipt, audit, run and revert rows"); checks++;
    }
    const periodCommand = async (day: string, value: string, customTimes?: { start: string; end: string }) => {
      const periodId = day < "2026-10-01" ? historical.id : current.id;
      const workspace = await readScheduleWorkspace(actor, { ...query, periodId }, client);
      return { requestId: randomUUID(), departmentId: branch.id, periodId, sourceDigest: workspace.sourceDigest, expectedDraftRevision: workspace.draft?.revision ?? null, expectedDraftId: workspace.draft?.id ?? null, changes: [{ employeeId: person.id, day, value, ...(customTimes ? { customTimes } : {}) }] };
    };
    for (const value of [String(old.id), "captured", "saved", "default", "latest-default"]) await rejectUnchanged(async () => confirmScopedScheduleDays(actor, await periodCommand("2026-10-01", value), transactional));
    await rejectUnchanged(async () => confirmScopedScheduleDays(actor, await periodCommand("2026-10-01", "captured", { start: "09:00", end: "17:00" }), transactional));
    await confirmScopedScheduleDays(actor, await periodCommand("2026-09-30", "captured"), transactional); checks++;

    await mutatePeriodSchedule(actor, await periodCommand("2026-10-01", String(old.id)), "draft_saved", transactional);
    await rejectUnchanged(async () => mutatePeriodSchedule(actor, { ...await periodCommand("2026-10-01", "saved"), changes: [] }, "confirmed", transactional));
    await mutatePeriodSchedule(actor, await periodCommand("2026-10-01", "saved"), "draft_deleted", transactional);
    const legacyDate = upsertEmployeeShiftAssignmentSchema.parse({ employeeId: person.id, shiftTableId: old.id, effectiveFrom: "2026-10-02", effectiveTo: "2026-10-02" });
    await rejectUnchanged(() => transactional.transaction(tx => saveDateAssignment(tx, actor, legacyDate, false)));
    await rejectUnchanged(() => prepareBulkDaySchedules(client, { requestId: randomUUID(), periodId: current.id, shiftTableId: old.id, targets: [{ employeeId: person.id, day: "2026-10-02" }] }));
    const historicalDate = { ...legacyDate, effectiveFrom: "2026-09-29", effectiveTo: "2026-09-29" };
    await transactional.transaction(tx => saveDateAssignment(tx, actor, historicalDate, false)); checks++;

    const currentDate = { ...legacyDate, shiftTableId: currentShift.shiftTableId, effectiveFrom: "2026-10-02", effectiveTo: "2026-10-03" };
    const created = await transactional.transaction(tx => saveDateAssignment(tx, actor, currentDate, false));
    await rejectUnchanged(() => transactional.transaction(tx => saveDateAssignment(tx, actor, { ...currentDate, id: created.assignmentId!, effectiveTo: "2026-10-02" }, false)));
    await rejectUnchanged(() => dated.deleteEmployeeShiftAssignment({ id: created.assignmentId }));
    const [applied] = await database.select().from(s.employeeShiftAssignments).where(eq(s.employeeShiftAssignments.id, created.assignmentId!));
    const [batch] = await database.insert(s.branchCalendarScheduleOverrideBatches).values({ attendanceDate: "2026-10-02", mode: "shift", shiftTableId: currentShift.shiftTableId, createdByUserId: actor.userId }).returning();
    const [item] = await database.insert(s.branchCalendarScheduleOverrideItems).values({ batchId: batch.id, employeeId: person.id, attendanceDate: "2026-10-02", mutationType: "created", appliedAssignmentId: created.assignmentId!, staleStartDate: "2026-10-02", staleEndDate: "2026-10-02", appliedAssignmentSnapshot: applied }).returning();
    await rejectUnchanged(() => calendar.revertBranchCalendarScheduleOverrideAction({ itemId: item.id }));

    let workspace = await readScheduleWorkspace(actor, query, client);
    await rejectUnchanged(() => saveWeeklySchedules(actor, { requestId: randomUUID(), departmentId: branch.id, sourceDigest: workspace.weeklyDigest, effectiveFrom: "2026-10-01", effectiveTo: null, employeeIds: [person.id], days: [{ weekday: "Thursday", value: "rest" }] }, transactional));
    await saveWeeklySchedules(actor, { requestId: randomUUID(), departmentId: branch.id, sourceDigest: workspace.weeklyDigest, effectiveFrom: "2026-10-01", effectiveTo: "2026-10-01", employeeIds: [person.id], days: [{ weekday: "Thursday", value: "rest" }] }, transactional); checks++;
    workspace = await readScheduleWorkspace(actor, query, client);
    await saveWeeklySchedules(actor, { requestId: randomUUID(), departmentId: branch.id, sourceDigest: workspace.weeklyDigest, effectiveFrom: "2026-10-01", effectiveTo: null, employeeIds: [person.id], days: scheduleWeekdays.map(weekday => ({ weekday, value: String(currentShift.shiftTableId) })) }, transactional); checks++;
    workspace = await readScheduleWorkspace(actor, query, client);
    const patterns = await database.select().from(s.employeeWeeklyShiftPatterns), latest = patterns.find(row => row.id !== oldPattern.id && row.effectiveTo === null)!;
    await rejectUnchanged(() => archiveWeeklySchedule(actor, { requestId: randomUUID(), departmentId: branch.id, sourceDigest: workspace.weeklyDigest, employeeId: person.id, patternId: latest.id, endDate: "2026-10-01" }, transactional));
    await calendar.revertBranchCalendarScheduleOverrideAction({ itemId: item.id }); checks++;
    const remaining = await database.select().from(s.employeeShiftAssignments).where(eq(s.employeeShiftAssignments.employeeId, person.id));
    const fragment = remaining.find(row => row.effectiveFrom === "2026-10-03")!;
    await dated.deleteEmployeeShiftAssignment({ id: fragment.id }); checks++;

    // Approval must roll back an earlier date when a later date hits a closed period.
    const [closed] = await database.insert(s.payrollPeriods).values({ code: "GUARD-NEXT", year: 2026, month: 10, cycle: "B", payrollTerms: "Semi-Monthly", startDate: "2026-10-16", endDate: "2026-10-31", nominalPayDate: "2026-10-31", adjustedPayDate: "2026-10-31", status: "Closed" }).returning();
    const [failedRequest] = await database.insert(s.managerScheduleChangeRequests).values({ requestedByAccountId: actor.userId, employeeId: person.id, action: "Create", payload: { ...currentDate, effectiveFrom: "2026-10-15", effectiveTo: "2026-10-16", effectiveDates: ["2026-10-15", "2026-10-16"] } }).returning();
    let before = await state();
    await assert.rejects(() => manager.approveManagerScheduleChangeRequest({ requestId: failedRequest.id }), /closed/i);
    assert.equal(await state(), before, "A later blocked date rolls back prior dates and leaves the request Pending"); checks++;
    await database.update(s.payrollPeriods).set({ status: "Open" }).where(eq(s.payrollPeriods.id, closed.id));
    await manager.approveManagerScheduleChangeRequest({ requestId: failedRequest.id });
    const [approved] = await database.select().from(s.managerScheduleChangeRequests).where(eq(s.managerScheduleChangeRequests.id, failedRequest.id));
    assert.equal(approved.status, "Approved"); assert.equal(approved.payload.appliedAssignmentIds?.length, 2); checks++;
    await database.update(s.payrollPeriods).set({ status: "Closed" }).where(eq(s.payrollPeriods.id, closed.id));
    before = await state();
    await assert.rejects(() => manager.voidApprovedManagerScheduleChangeRequest({ requestId: failedRequest.id, reason: "Fictional rollback check" }), /closed/i);
    assert.equal(await state(), before, "A later blocked removal rolls back prior deletes and leaves the request Approved"); checks++;
    await database.update(s.payrollPeriods).set({ status: "Open" }).where(eq(s.payrollPeriods.id, closed.id));
    await manager.voidApprovedManagerScheduleChangeRequest({ requestId: failedRequest.id, reason: "Fictional successful void" });
    assert.equal((await database.select().from(s.managerScheduleChangeRequests).where(eq(s.managerScheduleChangeRequests.id, failedRequest.id)))[0].status, "Voided"); checks++;

    assert.doesNotThrow(() => assertOperationalSchedule(oldSnapshot, { startDate: "2026-09-01", endDate: "2026-09-30" }));
    assert.throws(() => assertOperationalSchedule(oldSnapshot, { startDate: "2026-09-01", endDate: null }), /Use Schedules/);
    assert.throws(() => assertOperationalSchedule({ ...currentSnapshot, punchPolicy: "split_gaps" }, { startDate: "2026-10-01", endDate: null }), /Use Schedules/);
    assert.doesNotThrow(() => assertOperationalSchedule({ ...oldSnapshot, kind: "rest" }, { startDate: "2026-10-01", endDate: null }));
    assert.doesNotThrow(() => assertOperationalSchedule({ ...oldSnapshot, kind: "unconfigured" }, { startDate: "2026-10-01", endDate: null }));
    assert.deepEqual(operationalScheduleSampleDates({ startDate: "9999-12-30", endDate: null }, []), ["9999-12-30", "9999-12-31"]);
    const sampled = operationalScheduleSampleDates({ startDate: "2026-09-01", endDate: null }, [{ effectiveFrom: "2030-04-01", effectiveTo: "2030-04-01" }]);
    assert.ok(sampled.includes("2030-04-01") && sampled.includes("2030-04-02") && sampled.includes("2030-04-08")); checks++;
    console.log(`PASS operational shift guards: ${checks} service/handler/pure groups. Oct1+ catalog/captured/default/custom confirmation, draft confirmation, dated/bulk assignment, shortening/delete, calendar revert and weekly partial/archive fail closed with scoped rollback; finite neutral weeks, pre-Oct1 legacy and explicit replacements remain supported. Bundled manager approval/void is atomic including request status when a later date fails. Fictional current-schema PGlite only; no migration/FK, GUI, production or concurrency acceptance claimed.`);
  } finally { await pg.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

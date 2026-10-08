import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbClient } from "@/db";
import { department, employees, employeesGeneralInfo, employeesTimekeeping, employeeShiftAssignments, employeeWeeklyShiftPatterns, employeeWeeklyShiftPatternDays, payrollPeriods, payrollRuns, payrollRunEmployees, attendanceRawLogs, attendanceDailySummaries, shiftTables, shiftTableBreaks, scheduleWorkspaceDrafts, scheduleDecisionRevisions, scheduleRequestReceipts } from "@/db/schema";
import { getManagerDepartmentIds, requireAuthenticatedUser } from "@/lib/auth/server";
import { currentDepartmentMemberStatusCondition } from "@/lib/employmentStatus";
import { recordAdminAuditEvent } from "@/lib/admin";
import { buildShiftAssignmentSnapshotFromTable } from "@/lib/shifts";
import { getActiveShiftAssignmentForDate, getActiveWeeklyShiftPatternForDate, hasLegacyPaySchedule, type WeeklyShiftPatternRecord } from "@/lib/payroll/scheduleResolver";
import { lockAttendancePayrollInput } from "@/lib/payroll/attendanceSourceGuard";
import { lockShiftAssignmentContext, markAffectedShiftRunsStale, rebuildEmployeeAttendanceSummaries, getLatestImportedAttendanceDate, getRebuildRange } from "@/app/actions/shiftAssignmentHelpers";
import { applyScheduleChanges, emptySchedule, sameSchedule, scheduleDateRange, scheduleLabel, scheduleValue, shiftDate } from "./model";
import { scheduleWeekdays, type ScheduleCell, type ScheduleSnapshot, type ScheduleWorkspace, type ScheduleWorkspaceQuery, type ScheduleReceipt, type SchedulePeriodCommand, type ScheduleWeeklyCommand, type ScheduleArchiveCommand, type ScheduleWeekday, type ScheduleDayRepair } from "./workspace-types";

export type ScheduleActor = { userId: string; role: "ADMIN" | "MANAGER" };
export async function requireScheduleActor(): Promise<ScheduleActor> {
  const auth = await requireAuthenticatedUser();
  if (auth.role !== "ADMIN" && auth.role !== "MANAGER") throw new Error("Only an administrator or branch manager can manage schedules.");
  return { userId: auth.accountId, role: auth.role };
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value; }, "Enter a valid date.");
const value = z.string().regex(/^(rest|unconfigured|captured|default|latest-default|[1-9]\d*)$/);
const periodCommand = z.object({ requestId: z.string().uuid(), departmentId: z.number().int().positive(), periodId: z.string().uuid(), sourceDigest: z.string().length(64), expectedDraftRevision: z.number().int().positive().nullable(), expectedDraftId: z.string().uuid().nullable(), changes: z.array(z.object({ employeeId: z.string().uuid(), day: date, value })).max(10000) });
const weeklyCommand = z.object({ requestId: z.string().uuid(), departmentId: z.number().int().positive(), sourceDigest: z.string().length(64), effectiveFrom: date, effectiveTo: date.nullable(), employeeIds: z.array(z.string().uuid()).min(1).max(100), days: z.array(z.object({ weekday: z.enum(scheduleWeekdays), value })).min(1).max(7) }).refine(input => !input.effectiveTo || input.effectiveTo >= input.effectiveFrom, "The end date must be on or after the start date.");
const archiveCommand = z.object({ requestId: z.string().uuid(), departmentId: z.number().int().positive(), sourceDigest: z.string().length(64), employeeId: z.string().uuid(), patternId: z.number().int().positive(), endDate: date });
const digest = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const weekday = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${day}T12:00:00Z`)) as ScheduleWeekday;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function departmentsFor(actor: ScheduleActor, database: DbClient) {
  const allowed = actor.role === "ADMIN" ? null : await getManagerDepartmentIds(actor.userId, database);
  if (allowed && !allowed.length) return [];
  return database.select({ id: department.id, name: department.name }).from(department).where(allowed ? inArray(department.id, allowed) : undefined).orderBy(asc(department.name));
}

async function loadSources(actor: ScheduleActor, query: ScheduleWorkspaceQuery, database: DbClient) {
  const departments = await departmentsFor(actor, database);
  const contextEmployee = query.employeeId ? await database.select({ departmentId: employeesGeneralInfo.departmentId }).from(employeesGeneralInfo).where(eq(employeesGeneralInfo.employeeId, z.string().uuid().parse(query.employeeId))).limit(1) : [];
  const departmentId = query.departmentId ?? query.branchId ?? contextEmployee[0]?.departmentId ?? departments[0]?.id ?? null;
  if (departmentId && !departments.some(row => row.id === departmentId)) throw new Error("This branch is not assigned to your account.");
  const [periods, shifts, breaks] = await Promise.all([
    database.select().from(payrollPeriods).orderBy(desc(payrollPeriods.startDate)),
    database.select().from(shiftTables).orderBy(asc(shiftTables.code)),
    database.select().from(shiftTableBreaks).orderBy(asc(shiftTableBreaks.shiftTableId), asc(shiftTableBreaks.sortOrder)),
  ]);
  const focusDate = query.day ? date.parse(query.day) : today();
  const selected = query.periodId ? periods.find(row => row.id === query.periodId) : periods.find(row => row.startDate <= focusDate && row.endDate >= focusDate) ?? periods[0];
  if (query.periodId && !selected) throw new Error("The selected payroll period is unavailable.");
  const effectiveDate = date.parse(query.effectiveDate ?? query.day ?? today());
  const roster = departmentId ? await database.select({ employee: employees, info: employeesGeneralInfo }).from(employees).innerJoin(employeesGeneralInfo, eq(employeesGeneralInfo.employeeId, employees.id)).where(and(eq(employeesGeneralInfo.departmentId, departmentId), isNull(employees.deletedAt), isNull(employeesGeneralInfo.deletedAt), actor.role === "MANAGER" ? currentDepartmentMemberStatusCondition() : undefined)).orderBy(asc(employees.lastName), asc(employees.firstName), asc(employees.id)) : [];
  const ids = roster.map(row => row.employee.id);
  const [assignments, patterns, patternDays, timekeeping, draftRows, history] = ids.length ? await Promise.all([
    database.select().from(employeeShiftAssignments).where(inArray(employeeShiftAssignments.employeeId, ids)).orderBy(asc(employeeShiftAssignments.id)),
    database.select().from(employeeWeeklyShiftPatterns).where(inArray(employeeWeeklyShiftPatterns.employeeId, ids)).orderBy(asc(employeeWeeklyShiftPatterns.id)),
    database.select({ day: employeeWeeklyShiftPatternDays }).from(employeeWeeklyShiftPatternDays).innerJoin(employeeWeeklyShiftPatterns, eq(employeeWeeklyShiftPatterns.id, employeeWeeklyShiftPatternDays.patternId)).where(inArray(employeeWeeklyShiftPatterns.employeeId, ids)).orderBy(asc(employeeWeeklyShiftPatternDays.id)),
    database.select().from(employeesTimekeeping).where(inArray(employeesTimekeeping.employeeId, ids)).orderBy(asc(employeesTimekeeping.employeeId)),
    selected && departmentId ? database.select().from(scheduleWorkspaceDrafts).where(and(eq(scheduleWorkspaceDrafts.departmentId, departmentId), eq(scheduleWorkspaceDrafts.periodId, selected.id))) : Promise.resolve([]),
    selected && departmentId ? database.select().from(scheduleDecisionRevisions).where(and(eq(scheduleDecisionRevisions.departmentId, departmentId), eq(scheduleDecisionRevisions.periodId, selected.id))).orderBy(desc(scheduleDecisionRevisions.createdAt)).limit(10000) : Promise.resolve([]),
  ]) : [[], [], [], [], [], []];
  const fullPatterns = patterns.map(pattern => ({ ...pattern, days: patternDays.map(row => row.day).filter(day => day.patternId === pattern.id) }));
  const decisionIds = assignments.flatMap(row => row.scheduleDecisionId ? [row.scheduleDecisionId] : []);
  const confirmedRevisions = decisionIds.length ? await database.select().from(scheduleDecisionRevisions).where(inArray(scheduleDecisionRevisions.id, [...new Set(decisionIds)])) : [];
  const templates = new Map(shifts.map(shift => {
    const shiftBreaks = breaks.filter(row => row.shiftTableId === shift.id).map(({ slotKey, label, fromTime, toTime, deduct, deductHours, deductMinutes, sortOrder }) => ({ slotKey, label, fromTime, toTime, deduct, deductHours, deductMinutes, sortOrder }));
    const snap = buildShiftAssignmentSnapshotFromTable({ ...shift, breaks: shiftBreaks });
    return [String(shift.id), { ...snap, kind: "shift" as const, shiftTableId: shift.id, graceMinutes: 0, isFlexible: false, breaks: shiftBreaks }];
  }));
  const weeklyDigest = digest({ roster, patterns, patternDays, timekeeping, shifts, breaks });
  const sourceDigest = digest({ weeklyDigest, selected, assignments });
  return { departments, departmentId, periods, selected, effectiveDate, roster, assignments, fullPatterns, timekeeping, draft: draftRows[0] ?? null, history, confirmedRevisions, templates, weeklyDigest, sourceDigest };
}
type Sources = Awaited<ReturnType<typeof loadSources>>;

function defaultFor(source: Sources, employeeId: string, day: string, dayName = weekday(day)): ScheduleSnapshot {
  const pattern = getActiveWeeklyShiftPatternForDate(source.fullPatterns.filter(row => row.employeeId === employeeId), day);
  if (pattern) return patternDaySnapshot(source, pattern, dayName);
  const legacy = source.timekeeping.find(row => row.employeeId === employeeId) ?? null;
  if (!hasLegacyPaySchedule(legacy)) return emptySchedule("unconfigured");
  if (legacy?.restDay === dayName) return emptySchedule("rest");
  return { kind: "shift", shiftTableId: null, shiftName: "Employee default schedule", shiftCode: null, checkInTime: legacy?.checkInTime ?? null, checkOutTime: legacy?.checkOutTime ?? null, breakMinutes: 60, paidBreakMinutes: 0, graceMinutes: 0, hoursPerDay: Number(legacy?.hoursWorked) || 8, isFlexible: !legacy?.checkInTime || !legacy?.checkOutTime, breaks: [] };
}
function patternDaySnapshot(source: Sources, pattern: WeeklyShiftPatternRecord, dayName: ScheduleWeekday): ScheduleSnapshot {
  const day = pattern.days.find(row => row.weekday === dayName);
  if (day?.scheduleState === "unconfigured") return emptySchedule("unconfigured");
  if (!day || (!day.checkInTime && !day.checkOutTime && !Number(day.hoursPerDay))) return emptySchedule("rest");
  return { kind: "shift", shiftTableId: day.shiftTableId, shiftName: day.shiftName ?? "Weekly default", shiftCode: day.shiftCode, checkInTime: day.checkInTime, checkOutTime: day.checkOutTime, breakMinutes: day.breakMinutes, paidBreakMinutes: day.paidBreakMinutes, graceMinutes: 0, hoursPerDay: Number(day.hoursPerDay), isFlexible: !day.checkInTime || !day.checkOutTime, breaks: structuredClone(source.templates.get(String(day.shiftTableId))?.breaks ?? []) };
}
function cellsFor(source: Sources): ScheduleCell[] {
  if (!source.selected) return [];
  const days = scheduleDateRange(source.selected.startDate, source.selected.endDate);
  return source.roster.flatMap(({ employee, info }) => days.filter(day => (!info.dateHired || day >= info.dateHired) && (!info.separationDate || day <= info.separationDate)).map(day => {
    const base = defaultFor(source, employee.id, day);
    const assignment = getActiveShiftAssignmentForDate(source.assignments.filter(row => row.employeeId === employee.id), day);
    const snapshot: ScheduleSnapshot = assignment?.confirmedSchedule ?? (assignment ? assignment.restDay === weekday(day) ? emptySchedule("rest") : { kind: "shift", shiftTableId: assignment.shiftTableId, shiftName: assignment.shiftName, shiftCode: assignment.shiftCode, checkInTime: assignment.checkInTime, checkOutTime: assignment.checkOutTime, breakMinutes: assignment.breakMinutes, paidBreakMinutes: assignment.paidBreakMinutes, graceMinutes: assignment.graceMinutes, hoursPerDay: Number(assignment.hoursPerDay), isFlexible: assignment.isFlexible, breaks: structuredClone(source.templates.get(String(assignment.shiftTableId))?.breaks ?? []) } : base);
    const revision = assignment?.scheduleDecisionId ? source.confirmedRevisions.find(row => row.id === assignment.scheduleDecisionId) : null;
    const defaultSnapshot = revision?.defaultSnapshot ?? base;
    return { employeeId: employee.id, day, value: scheduleValue(snapshot), label: scheduleLabel(snapshot), source: assignment?.scheduleDecisionId ? "Confirmed period schedule" : assignment ? "Date exception" : snapshot.kind === "unconfigured" ? "Unconfigured" : source.fullPatterns.some(pattern => pattern.employeeId === employee.id && pattern.effectiveFrom <= day && (!pattern.effectiveTo || pattern.effectiveTo >= day)) ? "Weekly default" : "Employee default schedule", defaultValue: scheduleValue(defaultSnapshot), defaultLabel: scheduleLabel(defaultSnapshot), baselineValue: scheduleValue(snapshot), baselineLabel: scheduleLabel(snapshot), snapshot, defaultSnapshot, baselineSnapshot: snapshot, latestDefaultSnapshot: base };
  }));
}

export async function readScheduleWorkspace(actor: ScheduleActor, query: ScheduleWorkspaceQuery, database: DbClient = db): Promise<ScheduleWorkspace> {
  const source = await loadSources(actor, query, database);
  const cells = cellsFor(source);
  const history = new Map<string, ScheduleWorkspace["history"][number]>();
  for (const row of source.history) {
    const change = { employeeId: row.employeeId, day: row.day, before: scheduleLabel(row.previousSnapshot), after: scheduleLabel(row.snapshot), breaks: row.snapshot.breaks };
    const previous = history.get(row.requestId);
    if (previous) { previous.changedCount++; previous.changes.push(change); }
    else history.set(row.requestId, { revisionId: row.requestId, createdAt: row.createdAt.toISOString(), actorUserId: row.actorUserId, changedCount: 1, changes: [change] });
  }
  return {
    departments: source.departments, departmentId: source.departmentId, periods: source.periods.map(({ id, code, startDate, endDate, status }) => ({ id, code, startDate, endDate, status })), periodId: source.selected?.id ?? null,
    shifts: [...source.templates].map(([id, snapshot]) => ({ id: Number(id), label: scheduleLabel(snapshot), checkInTime: snapshot.checkInTime ?? "", checkOutTime: snapshot.checkOutTime ?? "", snapshot })), effectiveDate: source.effectiveDate,
    employees: source.roster.map(({ employee }) => ({ id: employee.id, employeeNo: employee.employeeNo, name: `${employee.lastName}, ${employee.firstName}`, weeklyDays: scheduleWeekdays.map(day => { const snapshot = defaultFor(source, employee.id, source.effectiveDate, day); return { weekday: day, value: scheduleValue(snapshot), label: scheduleLabel(snapshot) }; }), weeklyHistory: source.fullPatterns.filter(row => row.employeeId === employee.id).reverse().map(({ id, effectiveFrom, effectiveTo }) => ({ id, effectiveFrom, effectiveTo })) })),
    dates: source.selected ? scheduleDateRange(source.selected.startDate, source.selected.endDate) : [], cells,
    draft: source.draft ? { id: source.draft.id, revision: source.draft.revision, cells: source.draft.cells, sourceDigest: source.draft.sourceDigest, updatedAt: source.draft.updatedAt.toISOString() } : null,
    sourceDigest: source.sourceDigest, weeklyDigest: source.weeklyDigest, history: [...history.values()].slice(0, 20),
    warnings: [cells.some(cell => cell.snapshot.kind === "unconfigured") ? "Unconfigured days remain visible and contribute no scheduled work. Missing schedules do not block payroll." : "", source.draft && source.draft.sourceDigest !== source.sourceDigest ? "Source schedules changed since this draft was saved. Discard the obsolete draft and prepare a fresh review; its inputs are preserved until you do." : ""].filter(Boolean),
  };
}

export async function readScheduleDayRepair(actor: ScheduleActor, query: { employeeId: string; day: string; periodId?: string }, database: DbClient = db): Promise<ScheduleDayRepair> {
  const employeeId = z.string().uuid().parse(query.employeeId), day = date.parse(query.day);
  const workspace = await readScheduleWorkspace(actor, { ...query, employeeId, day }, database);
  const cell = workspace.cells.find(row => row.employeeId === employeeId && row.day === day);
  if (!cell || !workspace.departmentId || !workspace.periodId) throw new Error("This employee-day is outside the available branch and payroll period.");
  return { departmentId: workspace.departmentId, periodId: workspace.periodId, sourceDigest: workspace.sourceDigest,
    expectedDraftId: workspace.draft?.id ?? null, expectedDraftRevision: workspace.draft?.revision ?? null,
    cell, pendingDraftCell: workspace.draft?.cells.find(row => row.employeeId === employeeId && row.day === day) ?? null, shifts: workspace.shifts };
}

async function receiptFor(tx: DbClient, actor: ScheduleActor, requestId: string, requestDigest?: string) {
  const [row] = await tx.select().from(scheduleRequestReceipts).where(eq(scheduleRequestReceipts.requestId, requestId));
  if (!row) return null;
  if (row.actorUserId !== actor.userId || requestDigest && row.requestDigest !== requestDigest) throw new Error("This request ID was already used for another schedule action.");
  return row.receipt;
}
export async function readScheduleReceipt(actor: ScheduleActor, requestId: string, database: DbClient = db) { return receiptFor(database, actor, z.string().uuid().parse(requestId)); }
async function recordReceipt(tx: DbClient, actor: ScheduleActor, input: unknown, receipt: ScheduleReceipt) {
  await tx.insert(scheduleRequestReceipts).values({ requestId: receipt.requestId, actorUserId: actor.userId, requestDigest: digest(input), receipt });
  await recordAdminAuditEvent({ actorUserId: actor.userId, entityType: "schedule_workspace", entityId: receipt.requestId, action: `schedule_workspace.${receipt.action}`, details: receipt, database: tx });
  return receipt;
}
async function lockRequest(tx: DbClient, requestId: string) { await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`schedule-request:${requestId}`}))`); }
async function lockScope(tx: DbClient, departmentId: number, periodId: string) { await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`schedule-scope:${departmentId}:${periodId}`}))`); }

export async function mutatePeriodSchedule(actor: ScheduleActor, raw: SchedulePeriodCommand, action: "draft_saved" | "confirmed" | "draft_deleted", database: typeof db = db) {
  const input = periodCommand.parse(raw);
  return database.transaction(async tx => {
    await lockAttendancePayrollInput(tx); await lockRequest(tx, input.requestId); await lockScope(tx, input.departmentId, input.periodId);
    const request = { ...input, action }, prior = await receiptFor(tx, actor, input.requestId, digest(request)); if (prior) return prior;
    let source = await loadSources(actor, { departmentId: input.departmentId, periodId: input.periodId }, tx);
    for (const id of source.roster.map(row => row.employee.id).sort()) await lockShiftAssignmentContext(tx, id);
    source = await loadSources(actor, { departmentId: input.departmentId, periodId: input.periodId }, tx);
    if ((source.draft?.revision ?? null) !== input.expectedDraftRevision || (source.draft?.id ?? null) !== input.expectedDraftId) throw new Error("Another administrator changed this draft. Reload it before saving; no changes were applied.");
    if (action === "draft_deleted") {
      if (source.draft) await tx.delete(scheduleWorkspaceDrafts).where(eq(scheduleWorkspaceDrafts.id, source.draft.id));
      return recordReceipt(tx, actor, request, { requestId: input.requestId, action, message: "Unused draft deleted. Confirmed schedules are unchanged.", changedCount: 0 });
    }
    if (source.sourceDigest !== input.sourceDigest || source.draft && source.draft.sourceDigest !== source.sourceDigest) throw new Error("Schedules or employee details changed. Reload and prepare a fresh review; no schedule was changed.");
    const cells = applyScheduleChanges(source.draft?.cells ?? cellsFor(source), input.changes, source.templates);
    if (!cells.length) throw new Error("There are no employed workdays in this branch and period.");
    const changed = cells.filter(cell => !sameSchedule(cell.snapshot, cell.baselineSnapshot));
    if (action === "draft_saved") {
      const revision = (source.draft?.revision ?? 0) + 1;
      await tx.insert(scheduleWorkspaceDrafts).values({ departmentId: input.departmentId, periodId: input.periodId, revision, cells, sourceDigest: source.sourceDigest, updatedByUserId: actor.userId }).onConflictDoUpdate({ target: [scheduleWorkspaceDrafts.departmentId, scheduleWorkspaceDrafts.periodId], set: { revision, cells, sourceDigest: source.sourceDigest, updatedByUserId: actor.userId, updatedAt: new Date() } });
      return recordReceipt(tx, actor, request, { requestId: input.requestId, action, message: "Draft saved. Effective schedules and payroll are unchanged.", changedCount: changed.length, draftRevision: revision });
    }
    for (const { employee } of source.roster) {
      const edits = changed.filter(cell => cell.employeeId === employee.id).map(cell => cell.day).sort();
      if (edits.length) await markAffectedShiftRunsStale({ tx, employeeId: employee.id, startDate: edits[0], endDate: edits.at(-1)!, actorUserId: actor.userId });
    }
    const toConfirm = cells.filter(cell => {
      const current = getActiveShiftAssignmentForDate(source.assignments.filter(row => row.employeeId === cell.employeeId), cell.day);
      return !current?.scheduleDecisionId || !sameSchedule(cell.snapshot, cell.baselineSnapshot);
    });
    for (const { employee } of source.roster) {
      const rows = toConfirm.filter(cell => cell.employeeId === employee.id);
      if (!rows.length) continue;
      await projectConfirmedDays(tx, actor, input, rows, source);
      const effectiveEdits = changed.filter(cell => cell.employeeId === employee.id).map(cell => cell.day).sort();
      if (effectiveEdits.length) {
        const range = getRebuildRange({ staleRange: { startDate: effectiveEdits[0], endDate: effectiveEdits.at(-1)! }, latestImportedDate: await getLatestImportedAttendanceDate(tx, employee.id) });
        if (range) await rebuildEmployeeAttendanceSummaries({ tx, employeeId: employee.id, ...range });
      }
    }
    if (source.draft) await tx.delete(scheduleWorkspaceDrafts).where(eq(scheduleWorkspaceDrafts.id, source.draft.id));
    return recordReceipt(tx, actor, request, { requestId: input.requestId, action, message: `${toConfirm.length} employee-days confirmed; ${changed.length} effective changes. Payroll was not posted.`, changedCount: toConfirm.length });
  });
}

/** Approve only explicitly reviewed employee-days, leaving the branch review draft intact. */
export async function confirmScopedScheduleDays(actor: ScheduleActor, raw: SchedulePeriodCommand, database: typeof db = db) {
  const input = periodCommand.extend({ changes: periodCommand.shape.changes.min(1).max(100) }).parse(raw);
  return database.transaction(async tx => {
    await lockAttendancePayrollInput(tx); await lockRequest(tx, input.requestId); await lockScope(tx, input.departmentId, input.periodId);
    const request = { ...input, action: "days_confirmed" }, prior = await receiptFor(tx, actor, input.requestId, digest(request));
    if (prior) return prior;
    for (const employeeId of [...new Set(input.changes.map(row => row.employeeId))].sort()) await lockShiftAssignmentContext(tx, employeeId);
    const source = await loadSources(actor, { departmentId: input.departmentId, periodId: input.periodId }, tx);
    if (source.sourceDigest !== input.sourceDigest) throw new Error("Schedules or employee details changed. Reload this day before confirming; no changes were applied.");
    if ((source.draft?.id ?? null) !== input.expectedDraftId || (source.draft?.revision ?? null) !== input.expectedDraftRevision) throw new Error("Another administrator changed the branch draft. Reload this day before confirming; no changes were applied.");
    if (source.selected?.status !== "Open") throw new Error("This payroll period is closed. Use the adjustment workflow for a posted period.");
    const keys = new Set(input.changes.map(row => `${row.employeeId}|${row.day}`));
    const cells = applyScheduleChanges(cellsFor(source), input.changes, source.templates).filter(row => keys.has(`${row.employeeId}|${row.day}`));
    const changed = cells.filter(row => !sameSchedule(row.snapshot, row.baselineSnapshot));
    const toConfirm = cells.filter(cell => !getActiveShiftAssignmentForDate(source.assignments.filter(row => row.employeeId === cell.employeeId), cell.day)?.scheduleDecisionId || !sameSchedule(cell.snapshot, cell.baselineSnapshot));
    const affected = new Map<string, {employeeId:string;day:string}>();
    const overnight = (snapshot: ScheduleSnapshot) => snapshot.kind === "shift" && snapshot.checkInTime && snapshot.checkOutTime && snapshot.checkOutTime <= snapshot.checkInTime;
    for (const cell of changed) {
      affected.set(`${cell.employeeId}|${cell.day}`, { employeeId: cell.employeeId, day: cell.day });
      if (overnight(cell.snapshot) || overnight(cell.baselineSnapshot)) { const day = shiftDate(cell.day, 1); affected.set(`${cell.employeeId}|${day}`, { employeeId: cell.employeeId, day }); }
    }
    // Even freezing an unchanged day must not rewrite posted/approved provenance.
    const protectedTargets = [...toConfirm.map(({employeeId,day}) => ({employeeId,day})), ...affected.values()];
    if (protectedTargets.length) {
      if (protectedTargets.some(target => source.periods.some(period => period.status !== "Open" && period.startDate <= target.day && period.endDate >= target.day))) throw new Error("A closed payroll period includes this employee-day or its overnight neighbor. Use the adjustment workflow; no schedule was changed.");
      const protectedRuns = await tx.select({ employeeId: payrollRunEmployees.employeeId, startDate: payrollPeriods.startDate, endDate: payrollPeriods.endDate }).from(payrollRuns)
        .innerJoin(payrollPeriods, eq(payrollRuns.payrollPeriodId, payrollPeriods.id)).innerJoin(payrollRunEmployees, eq(payrollRunEmployees.payrollRunId, payrollRuns.id))
        .where(and(inArray(payrollRuns.status, ["Approved", "Posted"]), inArray(payrollRunEmployees.employeeId, [...new Set(protectedTargets.map(row => row.employeeId))])));
      if (protectedTargets.some(target => protectedRuns.some(run => run.employeeId === target.employeeId && run.startDate <= target.day && run.endDate >= target.day))) throw new Error("An approved or posted payroll includes this employee-day or its overnight neighbor. Use the adjustment workflow; no schedule was changed.");
    }
    for (const target of affected.values()) await markAffectedShiftRunsStale({ tx, ...target, startDate: target.day, endDate: target.day, actorUserId: actor.userId });
    for (const employeeId of [...new Set(toConfirm.map(row => row.employeeId))]) await projectConfirmedDays(tx, actor, input, toConfirm.filter(row => row.employeeId === employeeId), source);
    let summariesRebuilt = 0;
    for (const target of affected.values()) summariesRebuilt += await rebuildEmployeeAttendanceSummaries({ tx, employeeId: target.employeeId, startDate: target.day, endDate: target.day });
    let draftRevision: number | undefined;
    if (source.draft && source.draft.sourceDigest === source.sourceDigest) {
      const fresh = await loadSources(actor, { departmentId: input.departmentId, periodId: input.periodId }, tx), freshCells = cellsFor(fresh);
      const byKey = new Map(freshCells.map(cell => [`${cell.employeeId}|${cell.day}`, cell]));
      const retained = source.draft.cells.map(cell => keys.has(`${cell.employeeId}|${cell.day}`) ? byKey.get(`${cell.employeeId}|${cell.day}`)! : cell);
      draftRevision = source.draft.revision + 1;
      await tx.update(scheduleWorkspaceDrafts).set({ cells: retained, sourceDigest: fresh.sourceDigest, revision: draftRevision, updatedByUserId: actor.userId, updatedAt: new Date() }).where(eq(scheduleWorkspaceDrafts.id, source.draft.id));
    }
    const affectedTargets = [...new Map([...cells.map(({employeeId,day}) => ({employeeId,day})), ...affected.values()].map(target => [`${target.employeeId}|${target.day}`, target])).values()];
    return recordReceipt(tx, actor, request, { requestId: input.requestId, action: "days_confirmed", changedCount: toConfirm.length,
      message: `${cells.length} selected employee-day${cells.length === 1 ? "" : "s"} confirmed. ${summariesRebuilt} DTR day${summariesRebuilt === 1 ? "" : "s"} refreshed; other draft changes retained. Payroll was not recomputed.`,
      draftRevision, affectedTargets, affectedPeriodIds: source.periods.filter(period => affectedTargets.some(target => period.startDate <= target.day && period.endDate >= target.day)).map(period => period.id), summariesRebuilt });
  });
}

async function projectConfirmedDays(tx: DbClient, actor: ScheduleActor, input: SchedulePeriodCommand, cells: ScheduleCell[], source: Sources) {
  const employeeId = cells[0].employeeId;
  const selected = new Set(cells.map(cell => cell.day));
  // Keep original ranges and their summary foreign keys intact. The resolver gives
  // confirmed exact-day rows precedence; revisions update that projection in place.
  const revisions = await tx.insert(scheduleDecisionRevisions).values(cells.map(cell => ({ requestId: input.requestId, employeeId, day: cell.day, departmentId: input.departmentId, periodId: input.periodId, snapshot: cell.snapshot, defaultSnapshot: cell.defaultSnapshot, previousSnapshot: cell.baselineSnapshot, actorUserId: actor.userId }))).returning({ id: scheduleDecisionRevisions.id, day: scheduleDecisionRevisions.day });
  if (revisions.length !== selected.size) throw new Error("The confirmation could not be recorded completely.");
  const values = cells.map(cell => {
    const snapshot = cell.snapshot;
    return { employeeId, effectiveFrom: cell.day, effectiveTo: cell.day, shiftTableId: source.templates.has(String(snapshot.shiftTableId)) ? snapshot.shiftTableId : null, shiftName: snapshot.shiftName, shiftCode: snapshot.shiftCode, checkInTime: snapshot.checkInTime ?? "00:00:00", checkOutTime: snapshot.checkOutTime ?? "00:00:00", breakMinutes: snapshot.breakMinutes, paidBreakMinutes: snapshot.paidBreakMinutes, graceMinutes: snapshot.graceMinutes, hoursPerDay: snapshot.hoursPerDay.toFixed(2), isFlexible: snapshot.isFlexible, restDay: snapshot.kind === "rest" ? weekday(cell.day) : null, scheduleDecisionId: revisions.find(row => row.day === cell.day)!.id, confirmedSchedule: snapshot };
  });
  const inserts: typeof values = [];
  for (const row of values) {
    const previous = source.assignments.find(assignment => assignment.employeeId === employeeId && assignment.effectiveFrom === row.effectiveFrom && assignment.scheduleDecisionId);
    if (previous) await tx.update(employeeShiftAssignments).set({ ...row, updatedAt: new Date() }).where(eq(employeeShiftAssignments.id, previous.id));
    else inserts.push(row);
  }
  if (inserts.length) await tx.insert(employeeShiftAssignments).values(inserts);
}

async function applyWeeklyImpact(tx: DbClient, actor: ScheduleActor, source: Sources, employeeId: string, from: string, to: string | null, nextForDay: (day: string) => ScheduleSnapshot) {
  // Generated future periods have no inputs to invalidate. Fetch actual runs once,
  // including historical posted runs, rather than issuing queries for every picker row.
  const [runs, latestImportedDate] = await Promise.all([
    tx.select({ periodId: payrollRuns.payrollPeriodId }).from(payrollRuns).innerJoin(payrollRunEmployees, eq(payrollRunEmployees.payrollRunId, payrollRuns.id)).where(and(eq(payrollRunEmployees.employeeId, employeeId), inArray(payrollRuns.status, ["Draft", "Reviewed", "Approved", "Posted"]))),
    getLatestImportedAttendanceDate(tx, employeeId),
  ]);
  const runPeriods = new Set(runs.map(row => row.periodId));
  const assignments = source.assignments.filter(row => row.employeeId === employeeId);
  const changedOn = (day: string) => !getActiveShiftAssignmentForDate(assignments, day) && !sameSchedule(defaultFor(source, employeeId, day), nextForDay(day));
  for (const period of source.periods.filter(row => runPeriods.has(row.id) && row.endDate >= from && (!to || row.startDate <= to))) {
    const changed = scheduleDateRange(period.startDate > from ? period.startDate : from, to && to < period.endDate ? to : period.endDate).filter(changedOn);
    if (!changed.length) continue;
    await markAffectedShiftRunsStale({ tx, employeeId, startDate: changed[0], endDate: changed.at(-1)!, actorUserId: actor.userId });
  }
  const range = getRebuildRange({ staleRange: { startDate: from, endDate: to }, latestImportedDate });
  if (range) {
    const [logs, summaries] = await Promise.all([
      tx.selectDistinct({ day: attendanceRawLogs.logDate }).from(attendanceRawLogs).where(and(eq(attendanceRawLogs.employeeId, employeeId), gte(attendanceRawLogs.logDate, range.startDate), lte(attendanceRawLogs.logDate, shiftDate(range.endDate, 1)))),
      tx.select({ day: attendanceDailySummaries.attendanceDate }).from(attendanceDailySummaries).where(and(eq(attendanceDailySummaries.employeeId, employeeId), gte(attendanceDailySummaries.attendanceDate, range.startDate), lte(attendanceDailySummaries.attendanceDate, range.endDate))),
    ]);
    const actualDays = [...new Set([...logs.flatMap(row => [row.day, shiftDate(row.day, -1)]), ...summaries.map(row => row.day)])].filter(day => day >= range.startDate && day <= range.endDate && changedOn(day)).sort();
    const groups: Array<{startDate:string;endDate:string}> = [];
    for (const day of actualDays) { const previous = groups.at(-1); if (previous && shiftDate(previous.endDate, 1) === day) previous.endDate = day; else groups.push({startDate:day,endDate:day}); }
    for (const group of groups) await rebuildEmployeeAttendanceSummaries({ tx, employeeId, ...group });
  }
}
export async function saveWeeklySchedules(actor: ScheduleActor, raw: ScheduleWeeklyCommand, database: typeof db = db) {
  const input = weeklyCommand.parse(raw);
  if (new Set(input.employeeIds).size !== input.employeeIds.length || new Set(input.days.map(day => day.weekday)).size !== input.days.length) throw new Error("Select each employee and weekday only once.");
  return database.transaction(async tx => {
    await lockAttendancePayrollInput(tx); await lockRequest(tx, input.requestId);
    const prior = await receiptFor(tx, actor, input.requestId, digest(input)); if (prior) return prior;
    for (const id of [...input.employeeIds].sort()) await lockShiftAssignmentContext(tx, id);
    const source = await loadSources(actor, { departmentId: input.departmentId, effectiveDate: input.effectiveFrom }, tx);
    if (source.weeklyDigest !== input.sourceDigest) throw new Error("Weekly defaults or employee details changed. Reload before saving; no defaults were changed.");
    if (input.employeeIds.some(id => !source.roster.some(row => row.employee.id === id))) throw new Error("A selected employee is not assigned to this branch.");
    for (const employeeId of input.employeeIds) {
      const snapshots = new Map(scheduleWeekdays.map(day => [day, defaultFor(source, employeeId, input.effectiveFrom, day)]));
      for (const day of input.days) {
        const snapshot = day.value === "rest" || day.value === "unconfigured" ? emptySchedule(day.value) : source.templates.get(day.value);
        if (!snapshot) throw new Error("Choose a current shift, Rest day or Unconfigured for each selected weekday.");
        snapshots.set(day.weekday, snapshot);
      }
      // A new effective-dated revision wins only inside its range; older records retain their audit history.
      const [pattern] = await tx.insert(employeeWeeklyShiftPatterns).values({ employeeId, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo }).returning();
      await tx.insert(employeeWeeklyShiftPatternDays).values([...snapshots].map(([day, snapshot]) => ({ patternId: pattern.id, weekday: day, scheduleState: snapshot.kind, shiftTableId: snapshot.shiftTableId, shiftName: snapshot.kind === "shift" ? snapshot.shiftName : null, shiftCode: snapshot.shiftCode, checkInTime: snapshot.checkInTime, checkOutTime: snapshot.checkOutTime, breakMinutes: snapshot.breakMinutes, paidBreakMinutes: snapshot.paidBreakMinutes, hoursPerDay: snapshot.hoursPerDay.toFixed(2) })));
      await applyWeeklyImpact(tx, actor, source, employeeId, input.effectiveFrom, input.effectiveTo, day => snapshots.get(weekday(day))!);
      await recordAdminAuditEvent({ actorUserId: actor.userId, entityType: "employee_weekly_shift_pattern", entityId: pattern.id, action: "employee_weekly_shift_pattern.revised", details: { employeeId, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, days: [...snapshots].map(([day, snapshot]) => ({ day, snapshot })) }, database: tx });
    }
    return recordReceipt(tx, actor, input, { requestId: input.requestId, action: "weekly_saved", message: `${input.employeeIds.length} weekly defaults saved. Confirmed period schedules are unchanged.`, changedCount: input.employeeIds.length });
  });
}

export async function archiveWeeklySchedule(actor: ScheduleActor, raw: ScheduleArchiveCommand, database: typeof db = db) {
  const input = archiveCommand.parse(raw);
  return database.transaction(async tx => {
    await lockAttendancePayrollInput(tx); await lockRequest(tx, input.requestId); await lockShiftAssignmentContext(tx, input.employeeId);
    const prior = await receiptFor(tx, actor, input.requestId, digest(input)); if (prior) return prior;
    const source = await loadSources(actor, { departmentId: input.departmentId, effectiveDate: input.endDate }, tx);
    if (source.weeklyDigest !== input.sourceDigest) throw new Error("Weekly defaults changed. Reload before ending this default.");
    if (!source.roster.some(row => row.employee.id === input.employeeId)) throw new Error("The employee is not assigned to this branch.");
    const existing = source.fullPatterns.find(row => row.id === input.patternId && row.employeeId === input.employeeId);
    if (!existing || input.endDate < existing.effectiveFrom || existing.effectiveTo && input.endDate > existing.effectiveTo) throw new Error("Choose an end date within this default's effective range.");
    await tx.update(employeeWeeklyShiftPatterns).set({ effectiveTo: input.endDate, updatedAt: new Date() }).where(eq(employeeWeeklyShiftPatterns.id, input.patternId));
    const revised = { ...source, fullPatterns: source.fullPatterns.map(row => row.id === existing.id ? { ...row, effectiveTo: input.endDate } : row) };
    await applyWeeklyImpact(tx, actor, source, input.employeeId, shiftDate(input.endDate, 1), existing.effectiveTo, day => defaultFor(revised, input.employeeId, day));
    await recordAdminAuditEvent({ actorUserId: actor.userId, entityType: "employee_weekly_shift_pattern", entityId: existing.id, action: "employee_weekly_shift_pattern.ended", details: { previousEffectiveTo: existing.effectiveTo, effectiveTo: input.endDate }, database: tx });
    return recordReceipt(tx, actor, input, { requestId: input.requestId, action: "weekly_archived", message: "Weekly default end date saved. Its history and confirmed schedules are retained.", changedCount: 1 });
  });
}

import { PayrollValidationError } from "@/lib/payroll/validation";
import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbClient } from "@/db";
import { authAccounts, department, employees, employeesGeneralInfo, employeesTimekeeping, employeesLeaveRecords, employeeShiftAssignments, employeeWeeklyShiftPatterns, employeeWeeklyShiftPatternDays, payrollPeriods, payrollRuns, payrollRunEmployees, attendanceRawLogs, attendanceDailySummaries, shiftTables, shiftTableBreaks, scheduleWorkspaceDrafts, scheduleDecisionRevisions, scheduleRequestReceipts, managerScheduleChangeRequests } from "@/db/schema";
import { getManagerDepartmentIds, requireAuthenticatedUser } from "@/lib/auth/server";
import { currentDepartmentMemberStatusCondition } from "@/lib/employmentStatus";
import { getAccountAccessStateTx } from "@/lib/auth/lifecycle";
import { getAppRoleForGroups } from "@/lib/auth/permissions";
import { recordAdminAuditEvent } from "@/lib/admin";
import { buildShiftAssignmentSnapshotFromTable, calculationPolicyFor, punchPolicyFor } from "@/lib/shifts";
import { compareScheduleSnapshots } from "./presentation";
import { assertOperationalSchedule, operationalScheduleSampleDates } from "./operational-rule-guard";
import { getActiveShiftAssignmentForDate, getActiveWeeklyShiftPatternForDate, hasLegacyPaySchedule, type WeeklyShiftPatternRecord } from "@/lib/payroll/scheduleResolver";
import { lockAttendancePayrollInput } from "@/lib/payroll/attendanceSourceGuard";
import { loadEffectiveAttendanceRawLogs } from "@/lib/payroll/effectiveAttendanceInputs";
import { lockShiftAssignmentContext, markAffectedShiftRunsStale, rebuildEmployeeAttendanceSummaries, getLatestImportedAttendanceDate, getRebuildRange } from "@/app/actions/shiftAssignmentHelpers";
import { applyScheduleChanges, emptySchedule, retainRestDesignation, sameSchedule, scheduleDateRange, scheduleLabel, scheduleValue, shiftDate } from "./model";
import { scheduleWeekdays, type ScheduleCell, type ScheduleSnapshot, type ScheduleWorkspace, type ScheduleWorkspaceQuery, type ScheduleReceipt, type SchedulePeriodCommand, type ScheduleWeeklyCommand, type ScheduleArchiveCommand, type ScheduleWeekday, type ScheduleDayRepair, type ScheduleDayOperationCommand, type SchedulePendingOperation, type ScheduleDayOperations, type ScheduleDayHistoryPage } from "./workspace-types";

export type ScheduleActor = { userId: string; role: "ADMIN" | "MANAGER" };
export async function requireScheduleActor(): Promise<ScheduleActor> {
  const auth = await requireAuthenticatedUser();
  if (auth.role !== "ADMIN" && auth.role !== "MANAGER") throw new PayrollValidationError("Only an administrator or branch manager can manage schedules.");
  return { userId: auth.accountId, role: auth.role };
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value; }, "Enter a valid date.");
const value = z.string().regex(/^(rest|unconfigured|saved|captured|default|latest-default|[1-9]\d*)$/);
const clockTime=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const note = z.string().trim().max(500).optional();
const periodCommand = z.object({ requestId: z.string().uuid(), departmentId: z.number().int().positive(), periodId: z.string().uuid(), sourceDigest: z.string().length(64), expectedDraftRevision: z.number().int().positive().nullable(), expectedDraftId: z.string().uuid().nullable(), changes: z.array(z.object({ employeeId: z.string().uuid(), day: date, value, customTimes:z.object({start:clockTime,end:clockTime}).optional() })).max(10000), note });
const dayOperationCommand = periodCommand.omit({changes:true}).extend({employeeId:z.string().uuid(),day:date,operation:z.enum(["adjust","cover","swap"]),replacementEmployeeId:z.string().uuid().optional(),value:value.optional(),customTimes:z.object({start:clockTime,end:clockTime}).optional()});
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

async function loadSources(actor: ScheduleActor, query: ScheduleWorkspaceQuery, database: DbClient, includeHistory = true) {
  const departments = await departmentsFor(actor, database);
  const contextEmployee = query.employeeId ? await database.select({ departmentId: employeesGeneralInfo.departmentId }).from(employeesGeneralInfo).where(eq(employeesGeneralInfo.employeeId, z.string().uuid().parse(query.employeeId))).limit(1) : [];
  const departmentId = query.departmentId ?? query.branchId ?? contextEmployee[0]?.departmentId ?? departments[0]?.id ?? null;
  if (departmentId && !departments.some(row => row.id === departmentId)) throw new PayrollValidationError("This branch is not assigned to your account.");
  const [periods, shifts, breaks] = await Promise.all([
    database.select().from(payrollPeriods).orderBy(desc(payrollPeriods.startDate)),
    database.select().from(shiftTables).orderBy(asc(shiftTables.code)),
    database.select().from(shiftTableBreaks).orderBy(asc(shiftTableBreaks.shiftTableId), asc(shiftTableBreaks.sortOrder)),
  ]);
  const focusDate = query.day ? date.parse(query.day) : today();
  const selected = query.periodId ? periods.find(row => row.id === query.periodId) : periods.find(row => row.startDate <= focusDate && row.endDate >= focusDate) ?? periods[0];
  if (query.periodId && !selected) throw new PayrollValidationError("The selected payroll period is unavailable.");
  const effectiveDate = date.parse(query.effectiveDate ?? query.day ?? today());
  const roster = departmentId ? await database.select({ employee: employees, info: employeesGeneralInfo }).from(employees).innerJoin(employeesGeneralInfo, eq(employeesGeneralInfo.employeeId, employees.id)).where(and(eq(employeesGeneralInfo.departmentId, departmentId), isNull(employees.deletedAt), isNull(employeesGeneralInfo.deletedAt), actor.role === "MANAGER" ? currentDepartmentMemberStatusCondition() : undefined)).orderBy(asc(employees.lastName), asc(employees.firstName), asc(employees.id)) : [];
  const ids = roster.map(row => row.employee.id);
  const [assignments, patterns, patternDays, timekeeping, draftRows, history] = ids.length ? await Promise.all([
    database.select().from(employeeShiftAssignments).where(inArray(employeeShiftAssignments.employeeId, ids)).orderBy(asc(employeeShiftAssignments.id)),
    database.select().from(employeeWeeklyShiftPatterns).where(inArray(employeeWeeklyShiftPatterns.employeeId, ids)).orderBy(asc(employeeWeeklyShiftPatterns.id)),
    database.select({ day: employeeWeeklyShiftPatternDays }).from(employeeWeeklyShiftPatternDays).innerJoin(employeeWeeklyShiftPatterns, eq(employeeWeeklyShiftPatterns.id, employeeWeeklyShiftPatternDays.patternId)).where(inArray(employeeWeeklyShiftPatterns.employeeId, ids)).orderBy(asc(employeeWeeklyShiftPatternDays.id)),
    database.select().from(employeesTimekeeping).where(inArray(employeesTimekeeping.employeeId, ids)).orderBy(asc(employeesTimekeeping.employeeId)),
    selected && departmentId ? database.select().from(scheduleWorkspaceDrafts).where(and(eq(scheduleWorkspaceDrafts.departmentId, departmentId), eq(scheduleWorkspaceDrafts.periodId, selected.id))) : Promise.resolve([]),
    includeHistory && selected && departmentId ? database.select().from(scheduleDecisionRevisions).where(and(eq(scheduleDecisionRevisions.departmentId, departmentId), eq(scheduleDecisionRevisions.periodId, selected.id),inArray(scheduleDecisionRevisions.employeeId,ids))).orderBy(desc(scheduleDecisionRevisions.createdAt)).limit(10000) : Promise.resolve([]),
  ]) : [[], [], [], [], [], []];
  const fullPatterns = patterns.map(pattern => ({ ...pattern, days: patternDays.map(row => row.day).filter(day => day.patternId === pattern.id) }));
  const decisionIds = assignments.flatMap(row => row.scheduleDecisionId ? [row.scheduleDecisionId] : []);
  const confirmedRevisions = decisionIds.length ? await database.select().from(scheduleDecisionRevisions).where(inArray(scheduleDecisionRevisions.id, [...new Set(decisionIds)])) : [];
  const templates = new Map(shifts.map(shift => {
    const shiftBreaks = breaks.filter(row => row.shiftTableId === shift.id).map(({ slotKey, label, fromTime, toTime, deduct, deductHours, deductMinutes, sortOrder, requiresPunches }) => ({ slotKey, label, fromTime, toTime, deduct, deductHours, deductMinutes, sortOrder, requiresPunches }));
    const snap = buildShiftAssignmentSnapshotFromTable({ ...shift, breaks: shiftBreaks });
    return [String(shift.id), { ...snap, kind: "shift" as const, shiftTableId: shift.id, graceMinutes: 0, isFlexible: false, breaks: shiftBreaks }];
  }));
  const activeTemplates = new Map([...templates].filter(([id]) => !shifts.find(shift => String(shift.id) === id)?.archivedAt));
  const weeklyDigest = digest({ roster, patterns, patternDays, timekeeping, shifts, breaks });
  const sourceDigest = digest({ weeklyDigest, selected, assignments });
  return { departments, departmentId, periods, selected, effectiveDate, roster, assignments, fullPatterns, timekeeping, draft: draftRows[0] ?? null, history, confirmedRevisions, templates, activeTemplates, weeklyDigest, sourceDigest };
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
  if (day?.definitionSnapshot) return structuredClone(day.definitionSnapshot);
  if (day?.scheduleState === "unconfigured") return emptySchedule("unconfigured");
  if (!day || (!day.checkInTime && !day.checkOutTime && !Number(day.hoursPerDay))) return emptySchedule("rest");
  return { kind: "shift", shiftTableId: day.shiftTableId, shiftName: day.shiftName ?? "Weekly default", shiftCode: day.shiftCode, checkInTime: day.checkInTime, checkOutTime: day.checkOutTime, breakMinutes: day.breakMinutes, paidBreakMinutes: day.paidBreakMinutes, graceMinutes: 0, hoursPerDay: Number(day.hoursPerDay), isFlexible: !day.checkInTime || !day.checkOutTime, calculationPolicy: calculationPolicyFor(day.calculationPolicy), punchPolicy: punchPolicyFor(day.punchPolicy), breaks: structuredClone(source.templates.get(String(day.shiftTableId))?.breaks ?? []) };
}
function cellsFor(source: Sources): ScheduleCell[] {
  if (!source.selected) return [];
  const days = scheduleDateRange(source.selected.startDate, source.selected.endDate);
  return source.roster.flatMap(({ employee, info }) => days.filter(day => (!info.dateHired || day >= info.dateHired) && (!info.separationDate || day <= info.separationDate)).map(day => {
    const base = defaultFor(source, employee.id, day);
    const assignment = getActiveShiftAssignmentForDate(source.assignments.filter(row => row.employeeId === employee.id), day);
    const snapshot: ScheduleSnapshot = assignment?.confirmedSchedule ?? (assignment ? assignment.restDay === weekday(day) ? emptySchedule("rest") : { kind: "shift", shiftTableId: assignment.shiftTableId, shiftName: assignment.shiftName, shiftCode: assignment.shiftCode, checkInTime: assignment.checkInTime, checkOutTime: assignment.checkOutTime, breakMinutes: assignment.breakMinutes, paidBreakMinutes: assignment.paidBreakMinutes, graceMinutes: assignment.graceMinutes, hoursPerDay: Number(assignment.hoursPerDay), isFlexible: assignment.isFlexible, calculationPolicy: calculationPolicyFor(assignment.calculationPolicy), punchPolicy: punchPolicyFor(assignment.punchPolicy), breaks: structuredClone(source.templates.get(String(assignment.shiftTableId))?.breaks ?? []) } : base);
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
    shifts: [...source.activeTemplates].map(([id, snapshot]) => ({ id: Number(id), label: scheduleLabel(snapshot), checkInTime: snapshot.checkInTime ?? "", checkOutTime: snapshot.checkOutTime ?? "", snapshot })).sort((a, b) => compareScheduleSnapshots(a.snapshot, b.snapshot) || a.id - b.id), effectiveDate: source.effectiveDate,
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
  if (!cell || !workspace.departmentId || !workspace.periodId) throw new PayrollValidationError("This employee-day is outside the available branch and payroll period.");
  return { departmentId: workspace.departmentId, periodId: workspace.periodId, sourceDigest: workspace.sourceDigest,
    expectedDraftId: workspace.draft?.id ?? null, expectedDraftRevision: workspace.draft?.revision ?? null,
    cell, pendingDraftCell: workspace.draft?.cells.find(row => row.employeeId === employeeId && row.day === day) ?? null, shifts: workspace.shifts };
}

async function receiptFor(tx: DbClient, actor: ScheduleActor, requestId: string, requestDigest?: string) {
  const [row] = await tx.select().from(scheduleRequestReceipts).where(eq(scheduleRequestReceipts.requestId, requestId));
  if (!row) return null;
  if (row.actorUserId !== actor.userId || requestDigest && row.requestDigest !== requestDigest) throw new PayrollValidationError("This request ID was already used for another schedule action.");
  await assertReceiptScope(actor,row.receipt,tx);
  return row.receipt;
}
async function assertReceiptScope(actor:ScheduleActor,receipt:ScheduleReceipt,database:DbClient) {
  // Recovery is still scoped after a manager loses a branch or an employee transfers.
  if (actor.role === "MANAGER" && receipt.affectedTargets?.length) {
    const allowed = await departmentsFor(actor, database);
    const members = allowed.length ? await database.select({id:employees.id}).from(employees).innerJoin(employeesGeneralInfo,eq(employees.id,employeesGeneralInfo.employeeId)).where(and(inArray(employees.id,[...new Set(receipt.affectedTargets.map(row=>row.employeeId))]),inArray(employeesGeneralInfo.departmentId,allowed.map(row=>row.id)),isNull(employees.deletedAt),isNull(employeesGeneralInfo.deletedAt),currentDepartmentMemberStatusCondition())) : [];
    if (new Set(receipt.affectedTargets.map(row=>row.employeeId)).size !== members.length) throw new PayrollValidationError("This schedule request is no longer within your assigned scope.");
  }
}
export async function readScheduleReceipt(actor: ScheduleActor, requestId: string, database: DbClient = db) {
  const receipt = await receiptFor(database, actor, z.string().uuid().parse(requestId));
  if (!receipt) return null;
  if (!receipt.reviewRequestId) return receipt;
  const [request] = await database.select({status:managerScheduleChangeRequests.status}).from(managerScheduleChangeRequests).where(eq(managerScheduleChangeRequests.id,receipt.reviewRequestId));
  if (!request || request.status === "Pending") return receipt;
  const outcome = request.status === "Approved" ? "approved" : request.status === "Denied" ? "denied" : "cancelled";
  return {...receipt,outcome,message:outcome === "approved" ? "The schedule request was approved and applied. Reload this day to see its current schedule." : `The schedule request was ${outcome}. It did not apply your proposed schedule.`} as ScheduleReceipt;
}
async function recordReceipt(tx: DbClient, actor: ScheduleActor, input: unknown, receipt: ScheduleReceipt) {
  // Match JSONB's absent optional fields on both first response and replay.
  const storedReceipt = JSON.parse(JSON.stringify({...receipt,actorRole:actor.role})) as ScheduleReceipt;
  await tx.insert(scheduleRequestReceipts).values({ requestId: receipt.requestId, actorUserId: actor.userId, requestDigest: digest(input), receipt: storedReceipt });
  await recordAdminAuditEvent({ actorUserId: actor.userId, entityType: "schedule_workspace", entityId: receipt.requestId, action: `schedule_workspace.${receipt.action}`, details: storedReceipt, database: tx });
  return storedReceipt;
}
async function lockRequest(tx: DbClient, requestId: string) { await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`schedule-request:${requestId}`}))`); }
async function lockScope(tx: DbClient, departmentId: number, periodId: string) { await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`schedule-scope:${departmentId}:${periodId}`}))`); }

type ScheduleTarget = { employeeId: string; day: string };
const overnight = (snapshot: ScheduleSnapshot) => snapshot.kind === "shift" && snapshot.checkInTime && snapshot.checkOutTime && snapshot.checkOutTime.slice(0, 5) <= snapshot.checkInTime.slice(0, 5);
async function scheduleTargets(tx: DbClient, source: Sources, cells: Array<Pick<ScheduleCell, "employeeId" | "day" | "snapshot" | "baselineSnapshot">>): Promise<ScheduleTarget[]> {
  if (!cells.length) return [];
  const days = cells.map(cell => cell.day).sort();
  const logs = await loadEffectiveAttendanceRawLogs(tx, { employeeIds: [...new Set(cells.map(cell => cell.employeeId))], startDate: shiftDate(days[0], -1), endDate: shiftDate(days.at(-1)!, 1), neighborDays: "none" });
  const byDay = new Map<string, typeof logs>();
  for (const log of logs) {
    const key = `${log.employeeId}|${log.logDate}`;
    byDay.set(key, [...(byDay.get(key) ?? []), log]);
  }
  for (const rows of byDay.values()) rows.sort((a, b) => a.logTime.localeCompare(b.logTime));
  // Align with attendance grouping: only an unambiguous first OUT may close a
  // preceding open IN. Inspect both saved and proposed policies before mutation.
  const crosses = (employeeId: string, day: string, snapshot: ScheduleSnapshot) => overnight(snapshot) || snapshot.kind === "shift" && snapshot.calculationPolicy === "eight_hour_day" && snapshot.checkInTime
    && byDay.get(`${employeeId}|${day}`)?.at(-1)?.direction === "IN"
    && byDay.get(`${employeeId}|${shiftDate(day, 1)}`)?.[0]?.direction === "OUT"
    && byDay.get(`${employeeId}|${shiftDate(day, 1)}`)![0].logTime.slice(0, 5) < snapshot.checkInTime.slice(0, 5);
  const existingSnapshot = (employeeId: string, day: string): ScheduleSnapshot => {
    const assignment = getActiveShiftAssignmentForDate(source.assignments.filter(row => row.employeeId === employeeId), day);
    if (!assignment) return defaultFor(source, employeeId, day);
    if (assignment.confirmedSchedule) return assignment.confirmedSchedule;
    if (assignment.restDay === weekday(day)) return emptySchedule("rest");
    return { ...defaultFor(source, employeeId, day), kind: "shift", checkInTime: assignment.checkInTime, checkOutTime: assignment.checkOutTime, calculationPolicy: calculationPolicyFor(assignment.calculationPolicy) };
  };
  const targets = new Map<string, ScheduleTarget>();
  const proposed = new Map(cells.map(cell => [`${cell.employeeId}|${cell.day}`, cell.snapshot]));
  for (const cell of cells) {
    targets.set(`${cell.employeeId}|${cell.day}`, { employeeId: cell.employeeId, day: cell.day });
    if (crosses(cell.employeeId, cell.day, cell.snapshot) || crosses(cell.employeeId, cell.day, cell.baselineSnapshot)) {
      const day = shiftDate(cell.day, 1);
      targets.set(`${cell.employeeId}|${day}`, { employeeId: cell.employeeId, day });
    }
    const previousDay = shiftDate(cell.day, -1);
    const previousProposed = proposed.get(`${cell.employeeId}|${previousDay}`);
    if (crosses(cell.employeeId, previousDay, existingSnapshot(cell.employeeId, previousDay)) || previousProposed && crosses(cell.employeeId, previousDay, previousProposed)) {
      targets.set(`${cell.employeeId}|${previousDay}`, { employeeId: cell.employeeId, day: previousDay });
    }
  }
  return [...targets.values()];
}
async function assertWritableTargets(tx: DbClient, source: Sources, targets: ScheduleTarget[]) {
  if (!targets.length) return;
  if (targets.some(target => source.periods.some(period => period.status !== "Open" && period.startDate <= target.day && period.endDate >= target.day))) {
    throw new PayrollValidationError("A closed payroll period includes this employee-day or its overnight neighbor. Use the adjustment workflow; no schedule was changed.");
  }
  const protectedRuns = await tx.select({ employeeId: payrollRunEmployees.employeeId, startDate: payrollPeriods.startDate, endDate: payrollPeriods.endDate }).from(payrollRuns)
    .innerJoin(payrollPeriods, eq(payrollRuns.payrollPeriodId, payrollPeriods.id)).innerJoin(payrollRunEmployees, eq(payrollRunEmployees.payrollRunId, payrollRuns.id))
    .where(and(inArray(payrollRuns.status, ["Approved", "Posted"]), inArray(payrollRunEmployees.employeeId, [...new Set(targets.map(row => row.employeeId))])));
  if (targets.some(target => protectedRuns.some(run => run.employeeId === target.employeeId && run.startDate <= target.day && run.endDate >= target.day))) {
    throw new PayrollValidationError("An Approved or Posted payroll includes this employee-day or its overnight neighbor. Use the adjustment workflow; no schedule was changed.");
  }
}
async function hasReviewedTargets(tx: DbClient, targets: ScheduleTarget[]) {
  if (!targets.length) return false;
  const runs = await tx.select({employeeId:payrollRunEmployees.employeeId,startDate:payrollPeriods.startDate,endDate:payrollPeriods.endDate}).from(payrollRuns)
    .innerJoin(payrollPeriods,eq(payrollPeriods.id,payrollRuns.payrollPeriodId)).innerJoin(payrollRunEmployees,eq(payrollRunEmployees.payrollRunId,payrollRuns.id))
    .where(and(eq(payrollRuns.status,"Reviewed"),inArray(payrollRunEmployees.employeeId,[...new Set(targets.map(row=>row.employeeId))])));
  return targets.some(target=>runs.some(run=>run.employeeId===target.employeeId&&run.startDate<=target.day&&run.endDate>=target.day));
}
async function assertManagerUnreviewed(tx:DbClient, actor:ScheduleActor, targets:ScheduleTarget[]) {
  if(actor.role === "MANAGER" && await hasReviewedTargets(tx,targets)) throw new PayrollValidationError("This work has already been reviewed. Open the employee-day in Provisional attendance to submit a schedule change request; no effective schedule was changed.");
}
async function invalidateTargets(tx: DbClient, actor: ScheduleActor, targets: ScheduleTarget[]) {
  for (const range of targetRanges(targets)) await markAffectedShiftRunsStale({ tx, ...range, actorUserId: actor.userId });
}
function targetRanges(targets: ScheduleTarget[]) {
  const ranges: Array<{ employeeId: string; startDate: string; endDate: string }> = [];
  for (const target of [...targets].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.day.localeCompare(b.day))) {
    const last = ranges.at(-1);
    if (last?.employeeId === target.employeeId && shiftDate(last.endDate, 1) === target.day) last.endDate = target.day;
    else ranges.push({ employeeId: target.employeeId, startDate: target.day, endDate: target.day });
  }
  return ranges;
}
async function rebuildTargets(tx: DbClient, actor: ScheduleActor, targets: ScheduleTarget[]) {
  let count = 0;
  const cutoff = today();
  for (const range of targetRanges(targets.filter(target => target.day <= cutoff))) count += await rebuildEmployeeAttendanceSummaries({ tx, ...range, actorUserId: actor.userId });
  return count;
}

export async function mutatePeriodSchedule(actor: ScheduleActor, raw: SchedulePeriodCommand, action: "draft_saved" | "confirmed" | "draft_deleted", database: typeof db = db) {
  const input = periodCommand.parse(raw);
  return database.transaction(async tx => {
    await lockAttendancePayrollInput(tx); await lockRequest(tx, input.requestId); await lockScope(tx, input.departmentId, input.periodId);
    const request = { ...input, action }, prior = await receiptFor(tx, actor, input.requestId, digest(request)); if (prior) return prior;
    let source = await loadSources(actor, { departmentId: input.departmentId, periodId: input.periodId }, tx);
    for (const id of source.roster.map(row => row.employee.id).sort()) await lockShiftAssignmentContext(tx, id);
    source = await loadSources(actor, { departmentId: input.departmentId, periodId: input.periodId }, tx);
    if ((source.draft?.revision ?? null) !== input.expectedDraftRevision || (source.draft?.id ?? null) !== input.expectedDraftId) throw new PayrollValidationError("Another administrator changed this draft. Reload it before saving; no changes were applied.");
    if (action === "draft_deleted") {
      if (source.draft) await tx.delete(scheduleWorkspaceDrafts).where(eq(scheduleWorkspaceDrafts.id, source.draft.id));
      return recordReceipt(tx, actor, request, { requestId: input.requestId, action, message: "Unused draft deleted. Confirmed schedules are unchanged.", changedCount: 0 });
    }
    if (source.sourceDigest !== input.sourceDigest || source.draft && source.draft.sourceDigest !== source.sourceDigest) throw new PayrollValidationError("Schedules or employee details changed. Reload and prepare a fresh review; no schedule was changed.");
    const cells = applyScheduleChanges(source.draft?.cells ?? cellsFor(source), input.changes, source.activeTemplates);
    if (!cells.length) throw new PayrollValidationError("There are no employed workdays in this branch and period.");
    const changed = cells.filter(cell => !sameSchedule(cell.snapshot, cell.baselineSnapshot));
    if (action === "draft_saved") {
      const revision = (source.draft?.revision ?? 0) + 1;
      await tx.insert(scheduleWorkspaceDrafts).values({ departmentId: input.departmentId, periodId: input.periodId, revision, cells, sourceDigest: source.sourceDigest, updatedByUserId: actor.userId }).onConflictDoUpdate({ target: [scheduleWorkspaceDrafts.departmentId, scheduleWorkspaceDrafts.periodId], set: { revision, cells, sourceDigest: source.sourceDigest, updatedByUserId: actor.userId, updatedAt: new Date() } });
      return recordReceipt(tx, actor, request, { requestId: input.requestId, action, message: "Draft saved. Effective schedules and payroll are unchanged.", changedCount: changed.length, draftRevision: revision });
    }
    if (source.selected?.status !== "Open") throw new PayrollValidationError("This payroll period is closed. Use the adjustment workflow for a posted period.");
    const toConfirm = cells.filter(cell => {
      const current = getActiveShiftAssignmentForDate(source.assignments.filter(row => row.employeeId === cell.employeeId), cell.day);
      return !current?.scheduleDecisionId || !sameSchedule(cell.snapshot, cell.baselineSnapshot);
    });
    // First capture also changes input provenance, even if the clock times are unchanged.
    const targets = await scheduleTargets(tx, source, toConfirm);
    await assertWritableTargets(tx, source, targets);
    await assertManagerUnreviewed(tx, actor, targets);
    if(actor.role === "MANAGER" && toConfirm.some(cell=>cell.snapshot.kind==="shift"&&cell.snapshot.designatedRestDay)) throw new PayrollValidationError("Rest-day work needs a specific review. Open this employee-day in Provisional attendance to submit the proposed schedule.");
    await invalidateTargets(tx, actor, targets);
    for (const employeeId of [...new Set(toConfirm.map(row => row.employeeId))]) {
      await projectConfirmedDays(tx, actor, input, toConfirm.filter(row => row.employeeId === employeeId), source);
    }
    const summariesRebuilt = await rebuildTargets(tx, actor, targets);
    if (source.draft) await tx.delete(scheduleWorkspaceDrafts).where(eq(scheduleWorkspaceDrafts.id, source.draft.id));
    return recordReceipt(tx, actor, request, { requestId: input.requestId, action, message: `${toConfirm.length} employee-days confirmed; ${changed.length} effective changes. Payroll was not posted.`, changedCount: toConfirm.length, affectedTargets: targets, affectedPeriodIds: source.periods.filter(period => targets.some(target => period.startDate <= target.day && period.endDate >= target.day)).map(period => period.id), summariesRebuilt });
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
    if (source.sourceDigest !== input.sourceDigest) throw new PayrollValidationError("Schedules or employee details changed. Reload this day before confirming; no changes were applied.");
    if ((source.draft?.id ?? null) !== input.expectedDraftId || (source.draft?.revision ?? null) !== input.expectedDraftRevision) throw new PayrollValidationError("Another administrator changed the branch draft. Reload this day before confirming; no changes were applied.");
    if (source.selected?.status !== "Open") throw new PayrollValidationError("This payroll period is closed. Use the adjustment workflow for a posted period.");
    const keys = new Set(input.changes.map(row => `${row.employeeId}|${row.day}`));
    const cells = applyScheduleChanges(cellsFor(source), input.changes, source.activeTemplates).filter(row => keys.has(`${row.employeeId}|${row.day}`));
    const toConfirm = cells.filter(cell => !getActiveShiftAssignmentForDate(source.assignments.filter(row => row.employeeId === cell.employeeId), cell.day)?.scheduleDecisionId || !sameSchedule(cell.snapshot, cell.baselineSnapshot));
    const affected = await scheduleTargets(tx, source, toConfirm);
    await assertWritableTargets(tx, source, affected);
    if(actor.role === "MANAGER") {
      const reasons = [...(await hasReviewedTargets(tx,affected) ? ["This work has already been reviewed."] : []),...(toConfirm.some(cell=>cell.snapshot.kind==="shift"&&cell.snapshot.designatedRestDay) ? ["The proposed work retains a designated rest day and needs rest-work review."] : [])];
      if(reasons.length) return queueScheduleOperation(tx,actor,request,input,source,toConfirm,"adjust",cells.map(({employeeId,day})=>({employeeId,day})),reasons);
    }
    await invalidateTargets(tx, actor, affected);
    for (const employeeId of [...new Set(toConfirm.map(row => row.employeeId))]) await projectConfirmedDays(tx, actor, input, toConfirm.filter(row => row.employeeId === employeeId), source);
    const summariesRebuilt = await rebuildTargets(tx, actor, affected);
    let draftRevision: number | undefined;
    if (source.draft && source.draft.sourceDigest === source.sourceDigest) {
      const fresh = await loadSources(actor, { departmentId: input.departmentId, periodId: input.periodId }, tx), freshCells = cellsFor(fresh);
      const byKey = new Map(freshCells.map(cell => [`${cell.employeeId}|${cell.day}`, cell]));
      const retained = source.draft.cells.map(cell => keys.has(`${cell.employeeId}|${cell.day}`) ? byKey.get(`${cell.employeeId}|${cell.day}`)! : cell);
      draftRevision = source.draft.revision + 1;
      await tx.update(scheduleWorkspaceDrafts).set({ cells: retained, sourceDigest: fresh.sourceDigest, revision: draftRevision, updatedByUserId: actor.userId, updatedAt: new Date() }).where(eq(scheduleWorkspaceDrafts.id, source.draft.id));
    }
    const affectedTargets = [...new Map([...cells.map(({employeeId,day}) => ({employeeId,day})), ...affected].map(target => [`${target.employeeId}|${target.day}`, target])).values()];
    return recordReceipt(tx, actor, request, { requestId: input.requestId, action: "days_confirmed", changedCount: toConfirm.length,
      message: `${cells.length} selected employee-day${cells.length === 1 ? "" : "s"} confirmed. ${summariesRebuilt} attendance day${summariesRebuilt === 1 ? "" : "s"} refreshed; other draft changes retained. Payroll inputs may have changed and need recalculation or review. No payroll was posted.`,
      draftRevision, affectedTargets, affectedPeriodIds: source.periods.filter(period => affectedTargets.some(target => period.startDate <= target.day && period.endDate >= target.day)).map(period => period.id), summariesRebuilt, outcome:"applied",operation:"adjust",note:input.note });
  });
}

async function projectConfirmedDays(tx: DbClient, actor: ScheduleActor, input: SchedulePeriodCommand, cells: ScheduleCell[], source: Sources) {
  for (const cell of cells) assertOperationalSchedule(cell.snapshot, { startDate: cell.day, endDate: cell.day });
  const employeeId = cells[0].employeeId;
  const selected = new Set(cells.map(cell => cell.day));
  // Keep original ranges and their summary foreign keys intact. The resolver gives
  // confirmed exact-day rows precedence; revisions update that projection in place.
  const revisions = await tx.insert(scheduleDecisionRevisions).values(cells.map(cell => ({ requestId: input.requestId, employeeId, day: cell.day, departmentId: input.departmentId, periodId: input.periodId, snapshot: cell.snapshot, defaultSnapshot: cell.defaultSnapshot, previousSnapshot: cell.baselineSnapshot, actorUserId: actor.userId }))).returning({ id: scheduleDecisionRevisions.id, day: scheduleDecisionRevisions.day });
  if (revisions.length !== selected.size) throw new PayrollValidationError("The confirmation could not be recorded completely.");
  const values = cells.map(cell => {
    const snapshot = cell.snapshot;
    return { employeeId, effectiveFrom: cell.day, effectiveTo: cell.day, shiftTableId: source.templates.has(String(snapshot.shiftTableId)) ? snapshot.shiftTableId : null, shiftName: snapshot.shiftName, shiftCode: snapshot.shiftCode, checkInTime: snapshot.checkInTime ?? "00:00:00", checkOutTime: snapshot.checkOutTime ?? "00:00:00", breakMinutes: snapshot.breakMinutes, paidBreakMinutes: snapshot.paidBreakMinutes, graceMinutes: snapshot.graceMinutes, hoursPerDay: snapshot.hoursPerDay.toFixed(2), isFlexible: snapshot.isFlexible, restDay: snapshot.kind === "rest" || snapshot.designatedRestDay ? weekday(cell.day) : null, calculationPolicy: calculationPolicyFor(snapshot.calculationPolicy), punchPolicy: punchPolicyFor(snapshot.punchPolicy), scheduleDecisionId: revisions.find(row => row.day === cell.day)!.id, confirmedSchedule: snapshot };
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
  const [runs, latestImportedDate] = await Promise.all([
    tx.select({ periodId: payrollRuns.payrollPeriodId }).from(payrollRuns).innerJoin(payrollRunEmployees, eq(payrollRunEmployees.payrollRunId, payrollRuns.id)).where(and(eq(payrollRunEmployees.employeeId, employeeId), inArray(payrollRuns.status, ["Draft", "Reviewed", "Approved", "Posted"]))),
    getLatestImportedAttendanceDate(tx, employeeId),
  ]);
  const runPeriods = new Set(runs.map(row => row.periodId));
  const assignments = source.assignments.filter(row => row.employeeId === employeeId);
  const changedOn = (day: string) => day >= from && (!to || day <= to) && !getActiveShiftAssignmentForDate(assignments, day) && !sameSchedule(defaultFor(source, employeeId, day), nextForDay(day));
  const changedDays = new Set<string>();
  // Include closed periods even without runs, and their preceding workday: an overnight
  // change at a cutoff can alter the next period's raw-log ownership and summaries.
  for (const period of source.periods.filter(row => (row.status !== "Open" || runPeriods.has(row.id)) && row.endDate >= from && (!to || row.startDate <= shiftDate(to, 1)))) {
    const start = shiftDate(period.startDate, -1) > from ? shiftDate(period.startDate, -1) : from;
    const end = to && to < period.endDate ? to : period.endDate;
    if (start <= end) for (const day of scheduleDateRange(start, end)) if (changedOn(day)) changedDays.add(day);
  }
  const range = getRebuildRange({ staleRange: { startDate: from, endDate: to }, latestImportedDate });
  if (range) {
    const [logs, summaries] = await Promise.all([
      tx.selectDistinct({ day: attendanceRawLogs.logDate }).from(attendanceRawLogs).where(and(eq(attendanceRawLogs.employeeId, employeeId), gte(attendanceRawLogs.logDate, range.startDate), lte(attendanceRawLogs.logDate, shiftDate(range.endDate, 1)))),
      tx.select({ day: attendanceDailySummaries.attendanceDate }).from(attendanceDailySummaries).where(and(eq(attendanceDailySummaries.employeeId, employeeId), gte(attendanceDailySummaries.attendanceDate, range.startDate), lte(attendanceDailySummaries.attendanceDate, shiftDate(range.endDate, 1)))),
    ]);
    for (const day of [...logs.flatMap(row => [row.day, shiftDate(row.day, -1)]), ...summaries.map(row => row.day)]) {
      if (changedOn(day)) changedDays.add(day);
    }
  }
  const targets = await scheduleTargets(tx, source, [...changedDays].sort().map(day => ({ employeeId, day, snapshot: nextForDay(day), baselineSnapshot: defaultFor(source, employeeId, day) })));
  await assertWritableTargets(tx, source, targets);
  await assertManagerUnreviewed(tx, actor, targets);
  await invalidateTargets(tx, actor, targets);
  await rebuildTargets(tx, actor, targets);
}
export async function saveWeeklySchedules(actor: ScheduleActor, raw: ScheduleWeeklyCommand, database: typeof db = db) {
  const input = weeklyCommand.parse(raw);
  if (new Set(input.employeeIds).size !== input.employeeIds.length || new Set(input.days.map(day => day.weekday)).size !== input.days.length) throw new PayrollValidationError("Select each employee and weekday only once.");
  return database.transaction(async tx => {
    await lockAttendancePayrollInput(tx); await lockRequest(tx, input.requestId);
    const prior = await receiptFor(tx, actor, input.requestId, digest(input)); if (prior) return prior;
    for (const id of [...input.employeeIds].sort()) await lockShiftAssignmentContext(tx, id);
    const source = await loadSources(actor, { departmentId: input.departmentId, effectiveDate: input.effectiveFrom }, tx);
    if (source.weeklyDigest !== input.sourceDigest) throw new PayrollValidationError("Weekly defaults or employee details changed. Reload before saving; no defaults were changed.");
    if (input.employeeIds.some(id => !source.roster.some(row => row.employee.id === id))) throw new PayrollValidationError("A selected employee is not assigned to this branch.");
    for (const employeeId of input.employeeIds) {
      const snapshots = new Map(scheduleWeekdays.map(day => [day, defaultFor(source, employeeId, input.effectiveFrom, day)]));
      for (const day of input.days) {
        const snapshot = day.value === "rest" || day.value === "unconfigured" ? emptySchedule(day.value) : source.activeTemplates.get(day.value) ?? (snapshots.get(day.weekday)?.shiftTableId === Number(day.value) ? snapshots.get(day.weekday) : undefined);
        if (!snapshot) throw new PayrollValidationError("Choose a current shift, Rest day or Unconfigured for each selected weekday.");
        snapshots.set(day.weekday, snapshot);
      }
      const effectiveWeekdays = new Set(operationalScheduleSampleDates({ startDate: input.effectiveFrom, endDate: input.effectiveTo }, []).map(day => weekday(day)));
      for (const [day, snapshot] of snapshots) if (effectiveWeekdays.has(day)) assertOperationalSchedule(snapshot, { startDate: input.effectiveFrom, endDate: input.effectiveTo });
      // A new effective-dated revision wins only inside its range; older records retain their audit history.
      const [pattern] = await tx.insert(employeeWeeklyShiftPatterns).values({ employeeId, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo }).returning();
      const days = await tx.insert(employeeWeeklyShiftPatternDays).values([...snapshots].map(([day, snapshot]) => ({ patternId: pattern.id, weekday: day, scheduleState: snapshot.kind, definitionSnapshot: structuredClone(snapshot), calculationPolicy: calculationPolicyFor(snapshot.calculationPolicy), punchPolicy: punchPolicyFor(snapshot.punchPolicy), shiftTableId: snapshot.shiftTableId, shiftName: snapshot.kind === "shift" ? snapshot.shiftName : null, shiftCode: snapshot.shiftCode, checkInTime: snapshot.checkInTime, checkOutTime: snapshot.checkOutTime, breakMinutes: snapshot.breakMinutes, paidBreakMinutes: snapshot.paidBreakMinutes, hoursPerDay: snapshot.hoursPerDay.toFixed(2) }))).returning();
      const revised = { ...source, fullPatterns: [...source.fullPatterns, { ...pattern, days }] };
      await applyWeeklyImpact(tx, actor, source, employeeId, input.effectiveFrom, input.effectiveTo, day => defaultFor(revised, employeeId, day));
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
    if (source.weeklyDigest !== input.sourceDigest) throw new PayrollValidationError("Weekly defaults changed. Reload before ending this default.");
    if (!source.roster.some(row => row.employee.id === input.employeeId)) throw new PayrollValidationError("The employee is not assigned to this branch.");
    const existing = source.fullPatterns.find(row => row.id === input.patternId && row.employeeId === input.employeeId);
    if (!existing || input.endDate < existing.effectiveFrom || existing.effectiveTo && input.endDate > existing.effectiveTo) throw new PayrollValidationError("Choose an end date within this default's effective range.");
    await tx.update(employeeWeeklyShiftPatterns).set({ effectiveTo: input.endDate, updatedAt: new Date() }).where(eq(employeeWeeklyShiftPatterns.id, input.patternId));
    const revised = { ...source, fullPatterns: source.fullPatterns.map(row => row.id === existing.id ? { ...row, effectiveTo: input.endDate } : row) };
    const assignments = source.assignments.filter(row => row.employeeId === input.employeeId);
    const patterns = revised.fullPatterns.filter(row => row.employeeId === input.employeeId);
    for (const day of operationalScheduleSampleDates({ startDate: shiftDate(input.endDate, 1), endDate: existing.effectiveTo }, [...assignments, ...patterns])) {
      if (getActiveShiftAssignmentForDate(assignments, day)) continue;
      const successor = defaultFor(revised, input.employeeId, day);
      if (!sameSchedule(defaultFor(source, input.employeeId, day), successor)) assertOperationalSchedule(successor, { startDate: day, endDate: day });
    }
    await applyWeeklyImpact(tx, actor, source, input.employeeId, shiftDate(input.endDate, 1), existing.effectiveTo, day => defaultFor(revised, input.employeeId, day));
    await recordAdminAuditEvent({ actorUserId: actor.userId, entityType: "employee_weekly_shift_pattern", entityId: existing.id, action: "employee_weekly_shift_pattern.ended", details: { previousEffectiveTo: existing.effectiveTo, effectiveTo: input.endDate }, database: tx });
    return recordReceipt(tx, actor, input, { requestId: input.requestId, action: "weekly_archived", message: "Weekly default end date saved. Its history and confirmed schedules are retained.", changedCount: 1 });
  });
}

function effectiveSnapshot(source:Sources,employeeId:string,day:string):ScheduleSnapshot {
  const assignment=getActiveShiftAssignmentForDate(source.assignments.filter(row=>row.employeeId===employeeId),day);
  if(assignment?.confirmedSchedule) return structuredClone(assignment.confirmedSchedule);
  if(!assignment) return defaultFor(source,employeeId,day);
  return {kind:"shift",shiftTableId:assignment.shiftTableId,shiftName:assignment.shiftName,shiftCode:assignment.shiftCode,
    checkInTime:assignment.checkInTime,checkOutTime:assignment.checkOutTime,breakMinutes:assignment.breakMinutes,paidBreakMinutes:assignment.paidBreakMinutes,
    graceMinutes:assignment.graceMinutes,hoursPerDay:Number(assignment.hoursPerDay),isFlexible:assignment.isFlexible,
    calculationPolicy:calculationPolicyFor(assignment.calculationPolicy),punchPolicy:punchPolicyFor(assignment.punchPolicy),
    ...(assignment.restDay===weekday(day)?{designatedRestDay:true}:{}),breaks:structuredClone(source.templates.get(String(assignment.shiftTableId))?.breaks??[])};
}
function workInterval(snapshot:ScheduleSnapshot,day:string) {
  if(snapshot.kind!=="shift"||!snapshot.checkInTime||!snapshot.checkOutTime)return null;
  const minute=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
  const start=Date.parse(`${day}T00:00:00Z`)/60000+minute(snapshot.checkInTime);
  const duration=(minute(snapshot.checkOutTime)-minute(snapshot.checkInTime)+1440)%1440;
  return duration?{start,end:start+duration}:null;
}
type OperationLeave = {employeeId:string;status:string;startDate:string|null;endDate:string|null;dateFiled:string};
async function operationLeaves(tx:DbClient,ids:string[],first:string,last:string):Promise<OperationLeave[]> {
  if(!ids.length)return [];
  return tx.select({employeeId:employeesLeaveRecords.employeeId,status:employeesLeaveRecords.leaveStatus,startDate:employeesLeaveRecords.leaveStartDate,endDate:employeesLeaveRecords.leaveEndDate,dateFiled:employeesLeaveRecords.dateFiled}).from(employeesLeaveRecords).where(and(
    inArray(employeesLeaveRecords.employeeId,ids),isNull(employeesLeaveRecords.deletedAt),inArray(employeesLeaveRecords.leaveStatus,["Approved","Pending"]),
    sql`coalesce(${employeesLeaveRecords.leaveStartDate},${employeesLeaveRecords.dateFiled}) <= ${last}`,
    sql`coalesce(${employeesLeaveRecords.leaveEndDate},${employeesLeaveRecords.leaveStartDate},${employeesLeaveRecords.dateFiled}) >= ${first}`));
}
async function operationChecks(tx:DbClient, source:Sources,cells:ScheduleCell[],availableLeaves?:OperationLeave[],checkUnchanged=false) {
  const restrictions:string[]=[],reviewReasons:string[]=[];
  const proposed=new Map(cells.map(cell=>[`${cell.employeeId}|${cell.day}`,cell.snapshot]));
  const changed=checkUnchanged?cells:cells.filter(cell=>!sameSchedule(cell.snapshot,cell.baselineSnapshot));
  const dates=changed.map(cell=>cell.day).sort();
  const available=availableLeaves??(dates.length?await operationLeaves(tx,[...new Set(changed.map(cell=>cell.employeeId))],dates[0],dates.at(-1)!):[]);
  for(const cell of changed) {
    const person=source.roster.find(row=>row.employee.id===cell.employeeId);
    if(!person)throw new PayrollValidationError("An employee is no longer in this branch.");
    const name=`${person.employee.firstName} ${person.employee.lastName}`;
    const interval=workInterval(cell.snapshot,cell.day);
    if(!interval)continue;
    const leaves=available.filter(row=>row.employeeId===cell.employeeId&&(row.startDate??row.dateFiled)<=cell.day&&(row.endDate??row.startDate??row.dateFiled)>=cell.day);
    if(leaves.some(row=>row.status==="Approved"))restrictions.push(`${name} has approved leave on this date. Review the leave before changing their working schedule.`);
    else if(leaves.length)reviewReasons.push(`${name} has a pending leave request on this date.`);
    for(const neighbor of [shiftDate(cell.day,-1),shiftDate(cell.day,1)]) {
      const existing=workInterval(proposed.get(`${cell.employeeId}|${neighbor}`)??effectiveSnapshot(source,cell.employeeId,neighbor),neighbor);
      if(existing&&existing.start<interval.end&&existing.end>interval.start)restrictions.push(`${name}'s proposed hours overlap the schedule on ${neighbor}.`);
    }
    // Six nearby shifts can exhaust the weekly rest period even across a payroll cutoff.
    const windows=scheduleDateRange(shiftDate(cell.day,-6),shiftDate(cell.day,6)).map(day=>workInterval(proposed.get(`${cell.employeeId}|${day}`)??effectiveSnapshot(source,cell.employeeId,day),day)).filter((row):row is NonNullable<typeof row>=>row!==null).sort((a,b)=>a.start-b.start);
    let continuous=1;
    for(let i=1;i<windows.length;i++) {
      continuous=windows[i].start-windows[i-1].end>=1440?1:continuous+1;
      if(continuous>6&&windows[i].start>=interval.start&&windows[i-continuous+1].start<=interval.start) {
        reviewReasons.push(`${name}'s nearby schedules do not show a full 24-hour rest after six workdays. Review the rest arrangement.`);break;
      }
    }
    if(cell.snapshot.designatedRestDay)reviewReasons.push("The proposed work retains a designated rest day and needs rest-work review.");
  }
  return {restrictions:[...new Set(restrictions)],reviewReasons:[...new Set(reviewReasons)]};
}
function operationCells(source:Sources,input:ScheduleDayOperationCommand) {
  const all=cellsFor(source),primary=all.find(cell=>cell.employeeId===input.employeeId&&cell.day===input.day);
  if(!primary)throw new PayrollValidationError("This employee-day is outside the available branch and period.");
  if(input.operation==="adjust") {
    if(!input.value)throw new PayrollValidationError("Choose a schedule for this date.");
    return applyScheduleChanges([primary],[{employeeId:input.employeeId,day:input.day,value:input.value,customTimes:input.customTimes}],source.activeTemplates);
  }
  if(!input.replacementEmployeeId||input.replacementEmployeeId===input.employeeId)throw new PayrollValidationError("Choose a different employee in this branch.");
  const replacement=all.find(cell=>cell.employeeId===input.replacementEmployeeId&&cell.day===input.day);
  if(!replacement)throw new PayrollValidationError("The replacement employee is unavailable in this branch on this date.");
  if(primary.snapshot.kind!=="shift")throw new PayrollValidationError("Choose a day with a working schedule to cover or swap.");
  if(input.operation==="swap"&&replacement.snapshot.kind==="unconfigured")throw new PayrollValidationError("The other employee needs a configured shift or rest day before a swap.");
  const changed=(cell:ScheduleCell,snapshot:ScheduleSnapshot)=>{const next=retainRestDesignation(cell.baselineSnapshot,snapshot);return {...cell,snapshot:next,value:scheduleValue(next),label:scheduleLabel(next),source:"Period exception"};};
  // A rest designation belongs to the destination employee, not to the copied shift.
  const copy=(snapshot:ScheduleSnapshot)=>{const next=structuredClone(snapshot);delete next.designatedRestDay;return next;};
  return [input.operation==="swap"?changed(primary,copy(replacement.snapshot)):structuredClone(primary),changed(replacement,copy(primary.snapshot))];
}
async function queueScheduleOperation(tx:DbClient,actor:ScheduleActor,request:unknown,input:Pick<SchedulePeriodCommand,"requestId"|"departmentId"|"periodId"|"note">,source:Sources,cells:ScheduleCell[],kind:SchedulePendingOperation["kind"],linkedEmployees:ScheduleTarget[],requestReasons:string[]) {
  if(!cells.length)throw new PayrollValidationError("No schedule changes were selected.");
  const [pending]=await tx.select({id:managerScheduleChangeRequests.id}).from(managerScheduleChangeRequests).where(and(eq(managerScheduleChangeRequests.status,"Pending"),
    or(...linkedEmployees.map(target=>sql`${managerScheduleChangeRequests.payload}->'scheduleOperation'->'linkedEmployees' @> ${JSON.stringify([target])}::jsonb`)))).limit(1);
  if(pending)throw new PayrollValidationError("A pending schedule request already includes one of these employee-days. Review or cancel that request before submitting another.");
  const first=cells[0],operation:SchedulePendingOperation={version:1,kind,primaryEmployeeId:linkedEmployees[0]?.employeeId??first.employeeId,day:first.day,departmentId:input.departmentId,periodId:input.periodId,
    note:input.note,cells:cells.map(cell=>({employeeId:cell.employeeId,day:cell.day,before:cell.baselineSnapshot,after:cell.snapshot,defaultSnapshot:cell.defaultSnapshot})),linkedEmployees,requestReasons,requiresRestReview:cells.some(cell=>cell.snapshot.kind==="shift"&&cell.snapshot.designatedRestDay===true)};
  // The existing request queue holds typed snapshots; no effective schedule or financial input changes here.
  await tx.insert(managerScheduleChangeRequests).values({id:input.requestId,requestedByAccountId:actor.userId,employeeId:operation.primaryEmployeeId,action:"Update",status:"Pending",reason:input.note||null,
    payload:{employeeId:operation.primaryEmployeeId,shiftTableId:null,effectiveFrom:first.day,effectiveTo:first.day,graceMinutes:0,isFlexible:false,scheduleOperation:operation}});
  return recordReceipt(tx,actor,request,{requestId:input.requestId,action:"schedule_requested",outcome:"pending-review",reviewRequestId:input.requestId,operation:kind,note:input.note,
    changedCount:0,affectedTargets:linkedEmployees,linkedEmployees,affectedPeriodIds:source.selected?[source.selected.id]:[],message:"Schedule change requested. The effective schedules and attendance remain unchanged until Payroll Admin reviews and accepts this request."});
}
async function applyOperationCells(tx:DbClient,actor:ScheduleActor,source:Sources,input:SchedulePeriodCommand,cells:ScheduleCell[],kind:SchedulePendingOperation["kind"],linkedEmployees:ScheduleTarget[]) {
  const changed=cells.filter(cell=>!sameSchedule(cell.snapshot,cell.baselineSnapshot));
  const targets=await scheduleTargets(tx,source,changed);
  await assertWritableTargets(tx,source,targets);
  for(const cell of cells)assertOperationalSchedule(cell.snapshot,{startDate:cell.day,endDate:cell.day});
  await invalidateTargets(tx,actor,targets);
  for(const employeeId of [...new Set(changed.map(cell=>cell.employeeId))])await projectConfirmedDays(tx,actor,input,changed.filter(cell=>cell.employeeId===employeeId),source);
  // A coverage link is history for the absent employee, without changing their schedule or absence evidence.
  const unchanged=cells.filter(cell=>!changed.includes(cell));
  if(kind!=="adjust"&&unchanged.length)await tx.insert(scheduleDecisionRevisions).values(unchanged.map(cell=>({requestId:input.requestId,employeeId:cell.employeeId,day:cell.day,departmentId:input.departmentId,periodId:input.periodId,snapshot:cell.snapshot,defaultSnapshot:cell.defaultSnapshot,previousSnapshot:cell.baselineSnapshot,actorUserId:actor.userId})));
  const summariesRebuilt=await rebuildTargets(tx,actor,targets);
  if(source.draft&&source.draft.sourceDigest===source.sourceDigest&&changed.length) {
    const fresh=await loadSources(actor,{departmentId:input.departmentId,periodId:input.periodId},tx,false),byKey=new Map(cellsFor(fresh).map(cell=>[`${cell.employeeId}|${cell.day}`,cell]));
    const keys=new Set(changed.map(cell=>`${cell.employeeId}|${cell.day}`));
    await tx.update(scheduleWorkspaceDrafts).set({cells:source.draft.cells.map(cell=>keys.has(`${cell.employeeId}|${cell.day}`)?byKey.get(`${cell.employeeId}|${cell.day}`)!:cell),sourceDigest:fresh.sourceDigest,revision:source.draft.revision+1,updatedByUserId:actor.userId,updatedAt:new Date()}).where(eq(scheduleWorkspaceDrafts.id,source.draft.id));
  }
  return {requestId:input.requestId,action:"days_confirmed",outcome:"applied",operation:kind,note:input.note,linkedEmployees,changedCount:changed.length,affectedTargets:[...new Map([...targets,...linkedEmployees].map(target=>[`${target.employeeId}|${target.day}`,target])).values()],affectedPeriodIds:source.periods.filter(period=>targets.some(target=>period.startDate<=target.day&&period.endDate>=target.day)).map(period=>period.id),summariesRebuilt,
    message:kind==="cover"?"Coverage saved. The original employee's schedule and absence/leave evidence were retained. Affected attendance was refreshed; payroll may need recalculation and review.":"Date schedules saved and affected attendance refreshed. Payroll may need recalculation and review; no payroll was posted."} satisfies ScheduleReceipt;
}
export async function submitScheduleDayOperation(actor:ScheduleActor,raw:ScheduleDayOperationCommand,database:typeof db=db) {
  const input=dayOperationCommand.parse(raw);
  return database.transaction(async tx=>{
    await lockAttendancePayrollInput(tx);await lockRequest(tx,input.requestId);await lockScope(tx,input.departmentId,input.periodId);
    const prior=await receiptFor(tx,actor,input.requestId,digest(input));if(prior)return (await readScheduleReceipt(actor,input.requestId,tx))!;
    for(const id of [...new Set([input.employeeId,...(input.replacementEmployeeId?[input.replacementEmployeeId]:[])])].sort())await lockShiftAssignmentContext(tx,id);
    const source=await loadSources(actor,{departmentId:input.departmentId,periodId:input.periodId},tx,false);
    if(source.sourceDigest!==input.sourceDigest)throw new PayrollValidationError("Schedules or employee details changed. Reload this day and review the current values; nothing was saved.");
    if((source.draft?.id??null)!==input.expectedDraftId||(source.draft?.revision??null)!==input.expectedDraftRevision)throw new PayrollValidationError("The branch draft changed. Reload this day before saving; nothing was applied.");
    if(source.selected?.status!=="Open")throw new PayrollValidationError("This period is protected. Payroll Admin must use the adjustment workflow.");
    const cells=operationCells(source,input),linkedEmployees=cells.map(({employeeId,day})=>({employeeId,day}));
    const changed=cells.filter(cell=>!sameSchedule(cell.snapshot,cell.baselineSnapshot));
    const targets=await scheduleTargets(tx,source,changed);
    await assertWritableTargets(tx,source,targets);
    const checks=await operationChecks(tx,source,input.operation==="cover"?cells.slice(1):cells,undefined,input.operation==="cover");if(checks.restrictions.length)throw new PayrollValidationError(checks.restrictions.join(" "));
    if(actor.role==="MANAGER"&&await hasReviewedTargets(tx,targets))checks.reviewReasons.push("This work has already been reviewed.");
    if(checks.reviewReasons.length)return queueScheduleOperation(tx,actor,input,input,source,cells,input.operation,linkedEmployees,[...new Set(checks.reviewReasons)]);
    return recordReceipt(tx,actor,input,await applyOperationCells(tx,actor,source,{...input,changes:[]},cells,input.operation,linkedEmployees));
  });
}

/** Called by the Admin request decision inside its existing locked transaction. */
export async function applyScheduleOperationRequest(tx:DbClient,actor:ScheduleActor,request:typeof managerScheduleChangeRequests.$inferSelect,options:{restWorkReviewed?:boolean;restWorkBasis?:"voluntary-written"|"exception-reviewed";restWorkEvidence?:string}={}) {
  if(actor.role!=="ADMIN")throw new PayrollValidationError("Only Payroll Admin may accept a schedule request.");
  const operation=request.payload.scheduleOperation;
  if(!operation||operation.version!==1||request.status!=="Pending")throw new PayrollValidationError("This pending schedule operation is unavailable.");
  await lockAttendancePayrollInput(tx);await lockScope(tx,operation.departmentId,operation.periodId);
  for(const employeeId of [...new Set(operation.linkedEmployees.map(row=>row.employeeId))].sort())await lockShiftAssignmentContext(tx,employeeId);
  // Recheck the requester and every linked employee, not merely the first row in a paired request.
  const requester=await getAccountAccessStateTx(tx,request.requestedByAccountId),requesterRole=getAppRoleForGroups(requester.groupKeys);
  if(requester.account.status!=="Active"||requester.employeeDeletedAt||!requesterRole||!["ADMIN","MANAGER"].includes(requesterRole))throw new PayrollValidationError("The requesting account no longer has schedule authority. Prepare a new authorized schedule review.");
  const requesterActor:ScheduleActor={userId:request.requestedByAccountId,role:requesterRole as ScheduleActor["role"]};
  const source=await loadSources(requesterActor,{departmentId:operation.departmentId,periodId:operation.periodId},tx,false);
  const all=cellsFor(source),cells=operation.cells.map(saved=>{
    const current=all.find(cell=>cell.employeeId===saved.employeeId&&cell.day===saved.day);
    if(!current||!sameSchedule(current.snapshot,saved.before))throw new PayrollValidationError("A linked employee or schedule changed since this request. Nothing was applied. Ask the manager to review current schedules and submit a new request.");
    return {...current,snapshot:retainRestDesignation(current.snapshot,saved.after),defaultSnapshot:structuredClone(saved.defaultSnapshot),value:scheduleValue(saved.after),label:scheduleLabel(saved.after)};
  });
  const checks=await operationChecks(tx,source,operation.kind==="cover"?cells.slice(1):cells,undefined,operation.kind==="cover");if(checks.restrictions.length)throw new PayrollValidationError(checks.restrictions.join(" "));
  // Pending leave and a missing weekly rest arrangement remain real conflicts after approval.
  if(checks.reviewReasons.some(reason=>reason.includes("pending leave")||reason.includes("24-hour rest")))throw new PayrollValidationError("Resolve the pending leave or weekly rest arrangement before accepting this schedule request. No schedule was changed.");
  if(operation.requiresRestReview) {
    if(!options.restWorkReviewed||!["voluntary-written","exception-reviewed"].includes(options.restWorkBasis??"")||!options.restWorkEvidence?.trim())throw new PayrollValidationError("Review the rest-work basis and record the written willingness reference or applicable exception evidence. The original rest-day designation and applicable premiums will be retained.");
    if(options.restWorkEvidence.trim().length>1000)throw new PayrollValidationError("Keep the rest-work evidence reference within 1,000 characters.");
  }
  const input:SchedulePeriodCommand={requestId:request.id,departmentId:operation.departmentId,periodId:operation.periodId,sourceDigest:source.sourceDigest,expectedDraftId:source.draft?.id??null,expectedDraftRevision:source.draft?.revision??null,changes:[],note:operation.note};
  const receipt=await applyOperationCells(tx,actor,source,input,cells,operation.kind,operation.linkedEmployees);
  await recordAdminAuditEvent({actorUserId:actor.userId,entityType:"manager_schedule_change_request",entityId:request.id,action:"manager_schedule_change_request.operation_applied",database:tx,
    details:{operation:operation.kind,affectedTargets:receipt.affectedTargets,restWorkReviewed:operation.requiresRestReview,restWorkBasis:options.restWorkBasis,restWorkEvidence:options.restWorkEvidence?.trim()}});
  // Preserve the original idempotency digest and creator; only the safe committed outcome changes.
  await tx.update(scheduleRequestReceipts).set({receipt:{...receipt,reviewRequestId:request.id,outcome:"approved",actorRole:"ADMIN"}}).where(eq(scheduleRequestReceipts.requestId,request.id));
  return receipt;
}

export async function cancelScheduleOperationRequest(actor:ScheduleActor,rawRequestId:string,database:typeof db=db) {
  const requestId=z.string().uuid().parse(rawRequestId);
  return database.transaction(async tx=>{
    await lockAttendancePayrollInput(tx);await lockRequest(tx,requestId);
    const [request]=await tx.select().from(managerScheduleChangeRequests).where(eq(managerScheduleChangeRequests.id,requestId)).for("update");
    const operation=request?.payload.scheduleOperation;
    if(!request||!operation||request.requestedByAccountId!==actor.userId)throw new PayrollValidationError("This schedule request is not available to your account.");
    const source=await loadSources(actor,{departmentId:operation.departmentId,periodId:operation.periodId},tx,false);
    if(operation.linkedEmployees.some(target=>!source.roster.some(row=>row.employee.id===target.employeeId)))throw new PayrollValidationError("One of the linked employees is no longer in your branch scope. Payroll Admin must review this request.");
    if(request.status==="Cancelled")return (await readScheduleReceipt(actor,requestId,tx))!;
    if(request.status!=="Pending")throw new PayrollValidationError("This request has already been decided. Reload its history; no schedule was changed.");
    await tx.update(managerScheduleChangeRequests).set({status:"Cancelled",updatedAt:new Date(),decidedAt:new Date(),decidedByAccountId:actor.userId}).where(eq(managerScheduleChangeRequests.id,requestId));
    await recordAdminAuditEvent({actorUserId:actor.userId,entityType:"manager_schedule_change_request",entityId:requestId,action:"manager_schedule_change_request.cancelled",details:{operation:operation.kind,linkedEmployees:operation.linkedEmployees},database:tx});
    return (await readScheduleReceipt(actor,requestId,tx))!;
  });
}

function safeSnapshot(snapshot:ScheduleSnapshot):ScheduleSnapshot {
  return {kind:snapshot.kind,designatedRestDay:snapshot.designatedRestDay===true,shiftTableId:snapshot.shiftTableId,shiftName:snapshot.shiftName,shiftCode:snapshot.shiftCode,
    checkInTime:snapshot.checkInTime,checkOutTime:snapshot.checkOutTime,breakMinutes:snapshot.breakMinutes,paidBreakMinutes:snapshot.paidBreakMinutes,graceMinutes:snapshot.graceMinutes,hoursPerDay:snapshot.hoursPerDay,isFlexible:snapshot.isFlexible,
    calculationPolicy:snapshot.calculationPolicy,punchPolicy:snapshot.punchPolicy,breaks:snapshot.breaks.map(slot=>({slotKey:slot.slotKey,label:slot.label,fromTime:slot.fromTime,toTime:slot.toTime,deduct:slot.deduct,deductHours:slot.deductHours,deductMinutes:slot.deductMinutes,sortOrder:slot.sortOrder,requiresPunches:slot.requiresPunches}))};
}
async function historyForDay(actor:ScheduleActor,source:Sources,employeeId:string,day:string,cursor:string|undefined,database:DbClient):Promise<ScheduleDayHistoryPage> {
  if(!source.roster.some(row=>row.employee.id===employeeId))throw new PayrollValidationError("This employee-day is outside your current branch scope.");
  let boundary:{createdAt:Date;id:string}|undefined;
  if(cursor) {
    const [at,id]=z.string().max(160).parse(cursor).split("~"),createdAt=new Date(at);
    if(!Number.isFinite(createdAt.valueOf())||!z.string().uuid().safeParse(id).success)throw new PayrollValidationError("The history cursor is invalid. Reload this date's history.");
    boundary={createdAt,id};
  }
  const rows=await database.select({revision:scheduleDecisionRevisions,receipt:scheduleRequestReceipts.receipt,creator:scheduleRequestReceipts.actorUserId,firstName:employees.firstName,lastName:employees.lastName}).from(scheduleDecisionRevisions)
    .leftJoin(scheduleRequestReceipts,eq(scheduleRequestReceipts.requestId,scheduleDecisionRevisions.requestId))
    .leftJoin(authAccounts,sql`${authAccounts.id}::text = ${scheduleDecisionRevisions.actorUserId}`).leftJoin(employees,eq(employees.id,authAccounts.employeeId))
    .where(and(eq(scheduleDecisionRevisions.employeeId,employeeId),eq(scheduleDecisionRevisions.day,day),eq(scheduleDecisionRevisions.departmentId,source.departmentId!),
      boundary?or(lt(scheduleDecisionRevisions.createdAt,boundary.createdAt),and(eq(scheduleDecisionRevisions.createdAt,boundary.createdAt),lt(scheduleDecisionRevisions.id,boundary.id))):undefined))
    .orderBy(desc(scheduleDecisionRevisions.createdAt),desc(scheduleDecisionRevisions.id)).limit(21);
  const page=rows.slice(0,20),last=page.at(-1),scope=new Set(source.roster.map(row=>row.employee.id));
  // Requests are explicitly a recent summary; the complete applied revision list is paged above.
  const requests=await database.select({id:managerScheduleChangeRequests.id,status:managerScheduleChangeRequests.status,payload:managerScheduleChangeRequests.payload,createdAt:managerScheduleChangeRequests.createdAt,decidedAt:managerScheduleChangeRequests.decidedAt,requestedBy:managerScheduleChangeRequests.requestedByAccountId}).from(managerScheduleChangeRequests)
    .where(and(sql`${managerScheduleChangeRequests.payload}->'scheduleOperation'->>'departmentId' = ${String(source.departmentId)}`,
      sql`${managerScheduleChangeRequests.payload}->'scheduleOperation'->'linkedEmployees' @> ${JSON.stringify([{employeeId,day}])}::jsonb`))
    .orderBy(desc(managerScheduleChangeRequests.createdAt),desc(managerScheduleChangeRequests.id)).limit(20);
  return {entries:page.map(({revision,receipt,creator,firstName,lastName})=>({id:revision.id,requestId:revision.requestId,day:revision.day,createdAt:revision.createdAt.toISOString(),
    actorName:firstName||lastName?`${firstName??""} ${lastName??""}`.trim():"Former schedule editor",actorRole:receipt?.actorRole==="ADMIN"?"Payroll Admin":receipt?.actorRole==="MANAGER"?"Manager":"Schedule editor",
    before:safeSnapshot(revision.previousSnapshot),after:safeSnapshot(revision.snapshot),operation:receipt?.operation??"adjust",
    note:creator===actor.userId?receipt?.note?.slice(0,500):undefined,linkedEmployees:(receipt?.linkedEmployees??[{employeeId,day}]).filter(row=>scope.has(row.employeeId))})),
    nextCursor:rows.length>20&&last?`${last.revision.createdAt.toISOString()}~${last.revision.id}`:null,
    requests:requests.flatMap(request=>{
      const operation=request.payload.scheduleOperation;if(!operation)return [];
      const completeScope=operation.linkedEmployees.every(target=>scope.has(target.employeeId));
      return [{id:request.id,operation:operation.kind,status:request.status,createdAt:request.createdAt.toISOString(),decidedAt:request.decidedAt?.toISOString()??null,
        reasons:completeScope?operation.requestReasons:["A linked employee is no longer in your current branch scope. Payroll Admin must review this request."],canCancel:completeScope&&request.requestedBy===actor.userId&&request.status==="Pending"}];
    })};
}
export async function readScheduleDayHistory(actor:ScheduleActor,query:{employeeId:string;day:string;periodId?:string;cursor?:string},database:DbClient=db) {
  const employeeId=z.string().uuid().parse(query.employeeId),day=date.parse(query.day);
  const source=await loadSources(actor,{employeeId,day,periodId:query.periodId},database,false);
  if(!cellsFor(source).some(cell=>cell.employeeId===employeeId&&cell.day===day))throw new PayrollValidationError("This employee-day is outside the available branch and period.");
  return historyForDay(actor,source,employeeId,day,query.cursor,database);
}
export async function readScheduleDayOperations(actor:ScheduleActor,query:{employeeId:string;day:string;periodId?:string},database:DbClient=db):Promise<ScheduleDayOperations> {
  const employeeId=z.string().uuid().parse(query.employeeId),day=date.parse(query.day),source=await loadSources(actor,{employeeId,day,periodId:query.periodId},database,false);
  const all=cellsFor(source),cell=all.find(row=>row.employeeId===employeeId&&row.day===day);
  if(!cell||!source.departmentId||!source.selected)throw new PayrollValidationError("This employee-day is outside the available branch and period.");
  const restrictions:string[]=[],reviewReasons:string[]=[];
  const ids=source.roster.map(row=>row.employee.id);
  const [available,runs]=await Promise.all([operationLeaves(database,ids,day,day),database.select({employeeId:payrollRunEmployees.employeeId,status:payrollRuns.status,startDate:payrollPeriods.startDate,endDate:payrollPeriods.endDate}).from(payrollRuns)
    .innerJoin(payrollPeriods,eq(payrollPeriods.id,payrollRuns.payrollPeriodId)).innerJoin(payrollRunEmployees,eq(payrollRunEmployees.payrollRunId,payrollRuns.id))
    .where(and(inArray(payrollRuns.status,["Reviewed","Approved","Posted"]),inArray(payrollRunEmployees.employeeId,ids)))]);
  const protectedTargets=(targets:ScheduleTarget[])=>targets.some(target=>source.periods.some(period=>period.status!=="Open"&&period.startDate<=target.day&&period.endDate>=target.day)||runs.some(run=>run.employeeId===target.employeeId&&run.status!=="Reviewed"&&run.startDate<=target.day&&run.endDate>=target.day));
  const reviewedTargets=(targets:ScheduleTarget[])=>targets.some(target=>runs.some(run=>run.employeeId===target.employeeId&&run.status==="Reviewed"&&run.startDate<=target.day&&run.endDate>=target.day));
  if(protectedTargets([{employeeId,day}]))restrictions.push("This employee-day is protected. Payroll Admin must use the adjustment workflow.");
  if(reviewedTargets([{employeeId,day}]))reviewReasons.push("This work has already been reviewed.");
  const candidates:ScheduleDayOperations["candidates"]=[];
  const proposedCandidates=source.roster.filter(row=>row.employee.id!==employeeId).flatMap(person=>{
    const candidate=all.find(row=>row.employeeId===person.employee.id&&row.day===day);if(!candidate)return [];
    const copy=structuredClone(cell.snapshot);delete copy.designatedRestDay;
    return [{person,candidate,proposed:{...candidate,snapshot:retainRestDesignation(candidate.snapshot,copy)}}];
  });
  const candidateTargets=await scheduleTargets(database,source,proposedCandidates.map(row=>row.proposed));
  for(const {person,candidate,proposed} of proposedCandidates) {
    const checks=await operationChecks(database,source,[proposed],available,true),targets=candidateTargets.filter(row=>row.employeeId===candidate.employeeId);
    if(protectedTargets(targets))checks.restrictions.push("This employee-day or an affected overnight day is protected. Payroll Admin must use the adjustment workflow.");
    if(reviewedTargets(targets))checks.reviewReasons.push("This employee's work has already been reviewed.");
    candidates.push({employeeId:candidate.employeeId,employeeNo:person.employee.employeeNo,name:`${person.employee.firstName} ${person.employee.lastName}`,day,snapshot:safeSnapshot(candidate.snapshot),label:candidate.label,
      restrictions:checks.restrictions,requiresReview:checks.reviewReasons.length>0,reviewReasons:[...new Set(checks.reviewReasons)]});
  }
  return {departmentId:source.departmentId,periodId:source.selected.id,sourceDigest:source.sourceDigest,expectedDraftId:source.draft?.id??null,expectedDraftRevision:source.draft?.revision??null,
    cell,pendingDraftCell:source.draft?.cells.find(row=>row.employeeId===employeeId&&row.day===day)??null,
    shifts:[...source.activeTemplates].map(([id,snapshot])=>({id:Number(id),label:scheduleLabel(snapshot),checkInTime:snapshot.checkInTime??"",checkOutTime:snapshot.checkOutTime??"",snapshot:safeSnapshot(snapshot)})).sort((a,b)=>compareScheduleSnapshots(a.snapshot,b.snapshot)||a.id-b.id),
    candidates,restrictions,reviewRequired:reviewReasons.length>0,reviewReasons,history:await historyForDay(actor,source,employeeId,day,undefined,database)};
}

import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { db, DbClient } from "@/db";
import * as s from "@/db/schema";
import { buildShiftBreakRows, calculationPolicyFor, punchPolicyFor, type ShiftBreakSlotKey } from "@/lib/shifts";
import { lockAttendancePayrollInput } from "@/lib/payroll/attendanceSourceGuard";
import { getActiveShiftAssignmentForDate, getActiveWeeklyShiftPatternForDate, hasLegacyPaySchedule, type WeeklyShiftPatternRecord } from "@/lib/payroll/scheduleResolver";
import { convertUnifiedRuleSnapshot, partitionUnifiedRuleRange, UNIFIED_RULE_EFFECTIVE_FROM, type UnifiedRuleProtection } from "./unified-rule-conversion";
import { readShiftCatalog, saveShiftCatalog } from "./shift-catalog";
import { shiftTableScheduleSnapshot } from "./presentation";
import { emptySchedule, scheduleDateRange, shiftDate } from "./model";
import { confirmScopedScheduleDays, readScheduleWorkspace, saveWeeklySchedules, type ScheduleActor } from "./service";
import { scheduleWeekdays, type ScheduleSnapshot, type ScheduleWeekday } from "./workspace-types";

export type UnifiedRuleTemplateReview = { shiftTableId: number; reviewedSplitGapSlots: ShiftBreakSlotKey[] };
export type UnifiedRuleTransitionInput = { reviewedTemplates: UnifiedRuleTemplateReview[] };
type WeeklyChange = { employeeId: string; departmentId: number; effectiveFrom: string; effectiveTo: string | null; sourcePatternId: number; days: Array<{ weekday: ScheduleWeekday; templateId: number | null; kind: ScheduleSnapshot["kind"] }> };
type DatedChange = { employeeId: string; departmentId: number; periodId: string; day: string; templateId: number };
export type UnifiedRuleTransitionPreview = {
  sourceDigest: string;
  effectiveFrom: typeof UNIFIED_RULE_EFFECTIVE_FROM;
  counts: { catalogVersions: number; weeklySegments: number; datedDays: number; employees: number };
  catalog: Array<{ id: number; version: number; snapshot: ScheduleSnapshot }>;
  weekly: WeeklyChange[];
  dated: DatedChange[];
  affectedPeriodIds: string[];
};
export type UnifiedRuleTransitionReceipt = { requestId: string; sourceDigest: string; effectiveFrom: string; counts: UnifiedRuleTransitionPreview["counts"]; catalogIds: Array<{ previousId: number; newId: number }>; affectedPeriodIds: string[] };
const action = "unified_shift_rule.completed";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function requireAdmin(actor: ScheduleActor) { if (actor.role !== "ADMIN" || !actor.userId.trim()) throw new Error("Only an identified administrator can transition shift rules."); }
function reviewed(input: UnifiedRuleTransitionInput) {
  if (!Array.isArray(input.reviewedTemplates) || input.reviewedTemplates.some(row => !Number.isInteger(row.shiftTableId) || row.shiftTableId <= 0 || !Array.isArray(row.reviewedSplitGapSlots)) || new Set(input.reviewedTemplates.map(row => row.shiftTableId)).size !== input.reviewedTemplates.length) throw new Error("Supply each reviewed template and its explicit split-gap mapping exactly once.");
  return [...input.reviewedTemplates].sort((a, b) => a.shiftTableId - b.shiftTableId);
}

/** Compare financial inputs, not IDs/labels or harmless :00 serialization. */
function financialSnapshot(snapshot: ScheduleSnapshot) {
  const time = (value: string | null) => value?.replace(/:00$/, match => value.length === 8 ? "" : match) ?? null;
  return { kind: snapshot.kind, start: time(snapshot.checkInTime), end: time(snapshot.checkOutTime), unpaid: snapshot.breakMinutes, paid: snapshot.paidBreakMinutes, grace: snapshot.graceMinutes, hours: snapshot.hoursPerDay, flexible: snapshot.isFlexible,
    breaks: [...snapshot.breaks].sort((a, b) => a.slotKey.localeCompare(b.slotKey)).map(row => ({ slot: row.slotKey, start: time(row.fromTime), end: time(row.toTime), deduct: row.deduct, hours: row.deductHours, minutes: row.deductMinutes, punches: Boolean(row.requiresPunches) })) };
}

async function sources(database: DbClient) {
  const [catalog, people, info, timekeeping, patterns, patternDays, assignments, periods, runs, runEmployees, drafts, requests, overrides] = await Promise.all([
    readShiftCatalog(database, { includeArchived: true }),
    database.select().from(s.employees).orderBy(asc(s.employees.id)),
    database.select().from(s.employeesGeneralInfo).orderBy(asc(s.employeesGeneralInfo.employeeId)),
    database.select().from(s.employeesTimekeeping).orderBy(asc(s.employeesTimekeeping.employeeId)),
    database.select().from(s.employeeWeeklyShiftPatterns).orderBy(asc(s.employeeWeeklyShiftPatterns.id)),
    database.select().from(s.employeeWeeklyShiftPatternDays).orderBy(asc(s.employeeWeeklyShiftPatternDays.id)),
    database.select().from(s.employeeShiftAssignments).orderBy(asc(s.employeeShiftAssignments.id)),
    database.select().from(s.payrollPeriods).orderBy(asc(s.payrollPeriods.startDate), asc(s.payrollPeriods.id)),
    database.select().from(s.payrollRuns).orderBy(asc(s.payrollRuns.id)),
    database.select().from(s.payrollRunEmployees).orderBy(asc(s.payrollRunEmployees.id)),
    database.select().from(s.scheduleWorkspaceDrafts).orderBy(asc(s.scheduleWorkspaceDrafts.id)),
    database.select().from(s.managerScheduleChangeRequests).orderBy(asc(s.managerScheduleChangeRequests.id)),
    database.select().from(s.employeeAttendancePeriodOverrides).orderBy(asc(s.employeeAttendancePeriodOverrides.id)),
  ]);
  return { catalog, people, info, timekeeping, patterns, patternDays, assignments, periods, runs, runEmployees, drafts, requests, overrides };
}

export async function previewUnifiedRuleTransition(database: DbClient, actor: ScheduleActor, input: UnifiedRuleTransitionInput): Promise<UnifiedRuleTransitionPreview> {
  requireAdmin(actor);
  const mappings = reviewed(input), source = await sources(database);
  const scopedPeriods = source.periods.filter(row => row.endDate >= UNIFIED_RULE_EFFECTIVE_FROM);
  const periodIds = new Set(scopedPeriods.map(row => row.id));
  if (source.drafts.some(row => periodIds.has(row.periodId))) throw new Error("A saved schedule draft needs review before the rule transition; nothing was converted.");
  if (source.requests.some(row => row.status === "Pending")) throw new Error("A pending manager schedule request needs review before the rule transition.");
  if (source.overrides.some(row => periodIds.has(row.payrollPeriodId) && [row.workedMinutes, row.lateMinutes, row.undertimeMinutes, row.overtimeMinutes].some(value => value !== null))) throw new Error("Resolve whole-period time overrides per employee-day before the rule transition.");
  const activeCatalog = source.catalog.filter(row => !row.archivedAt);
  const oldCatalog = activeCatalog.filter(row => row.calculationPolicy !== "eight_hour_day");
  if (mappings.length !== oldCatalog.length || mappings.some(row => !oldCatalog.some(template => template.id === row.shiftTableId))) throw new Error("Review exactly the currently active previous-policy catalog versions; the catalog changed or mapping is incomplete.");
  const converted = new Map(oldCatalog.map(row => [row.id, convertUnifiedRuleSnapshot(shiftTableScheduleSnapshot(row), mappings.find(item => item.shiftTableId === row.id)!)]));
  const templates = new Map(source.catalog.map(row => [row.id, shiftTableScheduleSnapshot(row)]));
  const match = (snapshot: ScheduleSnapshot) => {
    if (snapshot.kind !== "shift" || snapshot.calculationPolicy === "eight_hour_day") return null;
    const mapping = mappings.find(row => row.shiftTableId === snapshot.shiftTableId);
    if (!mapping) throw new Error("An effective working snapshot has no reviewed active template mapping.");
    const next = convertUnifiedRuleSnapshot(snapshot, mapping), template = converted.get(mapping.shiftTableId)!;
    if (digest(financialSnapshot(next)) !== digest(financialSnapshot(template))) throw new Error("An effective saved schedule differs from its reviewed template (times, breaks, grace or flexible settings). Review it separately; no partial transition is allowed.");
    return mapping.shiftTableId;
  };
  const weekly: WeeklyChange[] = [], dated: DatedChange[] = [];
  const activePeople = source.people.filter(row => !row.deletedAt);
  for (const person of activePeople) {
    const personInfo = source.info.find(row => row.employeeId === person.id && !row.deletedAt);
    const personPatterns: WeeklyShiftPatternRecord[] = source.patterns.filter(row => row.employeeId === person.id).map(row => ({ ...row, days: source.patternDays.filter(day => day.patternId === row.id) }));
    const personAssignments = source.assignments.filter(row => row.employeeId === person.id);
    const profile = source.timekeeping.find(row => row.employeeId === person.id) ?? null;
    if (hasLegacyPaySchedule(profile)) throw new Error("A configured employee profile fallback needs a complete reviewed definition before conversion.");
    const eligiblePatterns = personPatterns.filter(row => !row.effectiveTo || row.effectiveTo >= UNIFIED_RULE_EFFECTIVE_FROM);
    const eligibleAssignments = personAssignments.filter(row => !row.effectiveTo || row.effectiveTo >= UNIFIED_RULE_EFFECTIVE_FROM);
    if (!eligiblePatterns.length && !eligibleAssignments.length) continue;
    if (!personInfo?.departmentId) throw new Error("An employee with an effective schedule has no available branch; no partial transition is allowed.");
    const departmentId = personInfo.departmentId;
    const protections = scopedPeriods.flatMap<UnifiedRuleProtection>(period => {
      if (period.status !== "Open") return [{ startDate: period.startDate, endDate: period.endDate, status: "Closed" as const, reference: period.id }];
      return source.runs.filter(run => run.payrollPeriodId === period.id && (run.status === "Approved" || run.status === "Posted") && source.runEmployees.some(employee => employee.payrollRunId === run.id && employee.employeeId === person.id)).map(run => ({ startDate: period.startDate, endDate: period.endDate, status: run.status as "Approved" | "Posted", reference: run.id }));
    });
    const assertRange = (from: string, to: string | null) => { if (partitionUnifiedRuleRange({ effectiveFrom: from, effectiveTo: to }, protections).blocked.length) throw new Error("The transition overlaps Closed, Approved or Posted payroll. Preserve its history and resolve the protected scope first."); };
    const boundaries = new Set([UNIFIED_RULE_EFFECTIVE_FROM]);
    for (const pattern of eligiblePatterns) {
      if (pattern.effectiveFrom > UNIFIED_RULE_EFFECTIVE_FROM) boundaries.add(pattern.effectiveFrom);
      if (pattern.effectiveTo && pattern.effectiveTo < "9999-12-31") boundaries.add(shiftDate(pattern.effectiveTo, 1));
    }
    const starts = [...boundaries].sort();
    for (const [index, from] of starts.entries()) {
      const pattern = getActiveWeeklyShiftPatternForDate(personPatterns, from);
      if (!pattern) continue;
      const to = starts[index + 1] ? shiftDate(starts[index + 1], -1) : null;
      const days = scheduleWeekdays.map(weekday => {
        const row = pattern.days.find(day => day.weekday === weekday);
        const fallback = row?.shiftTableId ? templates.get(row.shiftTableId) : undefined;
        const snapshot: ScheduleSnapshot = row?.definitionSnapshot ?? (row?.scheduleState === "unconfigured" ? emptySchedule("unconfigured") : !row || (!row.checkInTime && !row.checkOutTime && !Number(row.hoursPerDay)) ? emptySchedule("rest") : {
          kind: "shift", shiftTableId: row.shiftTableId, shiftName: row.shiftName ?? "Weekly default", shiftCode: row.shiftCode, checkInTime: row.checkInTime, checkOutTime: row.checkOutTime,
          breakMinutes: row.breakMinutes, paidBreakMinutes: row.paidBreakMinutes, graceMinutes: 0, hoursPerDay: Number(row.hoursPerDay), isFlexible: !row.checkInTime || !row.checkOutTime,
          calculationPolicy: calculationPolicyFor(row.calculationPolicy), punchPolicy: punchPolicyFor(row.punchPolicy), breaks: structuredClone(fallback?.breaks ?? []),
        });
        const oldId = match(snapshot);
        if (snapshot.kind === "shift" && oldId === null && (!snapshot.shiftTableId || !activeCatalog.some(template => template.id === snapshot.shiftTableId) || digest(financialSnapshot(snapshot)) !== digest(financialSnapshot(templates.get(snapshot.shiftTableId)!)))) throw new Error("A current-policy default cannot be represented losslessly by an active catalog version; review separately.");
        return { weekday, templateId: oldId ?? snapshot.shiftTableId, kind: snapshot.kind, changed: oldId !== null };
      });
      if (!days.some(day => day.changed)) continue;
      assertRange(from, to);
      weekly.push({ employeeId: person.id, departmentId, sourcePatternId: pattern.id, effectiveFrom: from, effectiveTo: to, days: days.map(day => ({ weekday: day.weekday, templateId: day.templateId, kind: day.kind })) });
    }
    const dates = new Set<string>();
    for (const assignment of eligibleAssignments) {
      if (!assignment.effectiveTo) throw new Error("An open-ended dated assignment needs an explicit bounded transition plan.");
      const start = assignment.effectiveFrom < UNIFIED_RULE_EFFECTIVE_FROM ? UNIFIED_RULE_EFFECTIVE_FROM : assignment.effectiveFrom;
      for (const day of scheduleDateRange(start, assignment.effectiveTo)) dates.add(day);
    }
    for (const day of [...dates].sort()) {
      if (personInfo.dateHired && day < personInfo.dateHired || personInfo.separationDate && day > personInfo.separationDate) continue;
      const assignment = getActiveShiftAssignmentForDate(personAssignments, day)!;
      const snapshot = assignment.confirmedSchedule;
      if (!snapshot) throw new Error("An uncaptured dated assignment needs a complete reviewed snapshot before conversion.");
      const templateId = match(snapshot);
      if (templateId === null) continue;
      assertRange(day, day);
      const periods = scopedPeriods.filter(period => period.startDate <= day && period.endDate >= day);
      if (periods.length !== 1) throw new Error("Every converted dated schedule must belong to exactly one payroll period.");
      dated.push({ employeeId: person.id, departmentId, periodId: periods[0].id, day, templateId });
    }
  }
  return { sourceDigest: digest({ effectiveFrom: UNIFIED_RULE_EFFECTIVE_FROM, mappings, source }), effectiveFrom: UNIFIED_RULE_EFFECTIVE_FROM,
    counts: { catalogVersions: converted.size, weeklySegments: weekly.length, datedDays: dated.length, employees: new Set([...weekly, ...dated].map(row => row.employeeId)).size },
    catalog: oldCatalog.map(row => ({ id: row.id, version: row.version!, snapshot: converted.get(row.id)! })), weekly, dated,
    affectedPeriodIds: [...new Set([...dated.map(row => row.periodId), ...scopedPeriods.filter(period => weekly.some(change => period.endDate >= change.effectiveFrom && (!change.effectiveTo || period.startDate <= change.effectiveTo))).map(period => period.id)])].sort() };
}

/** Atomic transition through existing audited mutations. Replays never repeat a partial conversion. */
export async function applyUnifiedRuleTransition(database: DbClient, actor: ScheduleActor, input: UnifiedRuleTransitionInput & { requestId: string; expectedSourceDigest: string }): Promise<UnifiedRuleTransitionReceipt> {
  requireAdmin(actor);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId) || !/^[0-9a-f]{64}$/.test(input.expectedSourceDigest)) throw new Error("A valid request ID and reviewed source digest are required.");
  const commandDigest = digest({ ...input, reviewedTemplates: reviewed(input) });
  return database.transaction(async tx => {
    await lockAttendancePayrollInput(tx);
    const [prior] = await tx.select().from(s.adminAuditEvents).where(and(eq(s.adminAuditEvents.action, action), eq(s.adminAuditEvents.entityId, input.requestId)));
    if (prior) {
      const saved = JSON.parse(prior.details ?? "null") as { commandDigest: string; receipt: UnifiedRuleTransitionReceipt } | null;
      if (prior.actorUserId !== actor.userId || saved?.commandDigest !== commandDigest) throw new Error("This transition request ID was already used with different instructions or actor.");
      return saved.receipt;
    }
    const plan = await previewUnifiedRuleTransition(tx, actor, input);
    if (plan.sourceDigest !== input.expectedSourceDigest) throw new Error("Schedule or payroll inputs changed after preview. Review a fresh transition; nothing was changed.");
    const replacements = new Map<number, number>(), affected = new Set<string>();
    for (const item of plan.catalog) {
      const snapshot = item.snapshot;
      const receipt = await saveShiftCatalog(tx, actor, { requestId: randomUUID(), id: item.id, expectedVersion: item.version, code: snapshot.shiftCode!, description: snapshot.shiftName,
        regularStartTime: snapshot.checkInTime!, regularEndTime: snapshot.checkOutTime!, calculationPolicy: "eight_hour_day", punchPolicy: snapshot.punchPolicy, breaks: buildShiftBreakRows(snapshot.breaks) });
      replacements.set(item.id, receipt.shiftTableId);
    }
    const weeklyGroups = new Map<string, WeeklyChange[]>();
    for (const change of plan.weekly) {
      const key = digest({ departmentId: change.departmentId, from: change.effectiveFrom, to: change.effectiveTo, days: change.days });
      weeklyGroups.set(key, [...(weeklyGroups.get(key) ?? []), change]);
    }
    for (const changes of weeklyGroups.values()) for (let index = 0; index < changes.length; index += 100) {
      const chunk = changes.slice(index, index + 100), change = chunk[0];
      const workspace = await readScheduleWorkspace(actor, { departmentId: change.departmentId, effectiveDate: change.effectiveFrom }, tx);
      await saveWeeklySchedules(actor, { requestId: randomUUID(), departmentId: change.departmentId, sourceDigest: workspace.weeklyDigest, effectiveFrom: change.effectiveFrom, effectiveTo: change.effectiveTo, employeeIds: chunk.map(row => row.employeeId),
        days: change.days.map(day => ({ weekday: day.weekday, value: day.kind === "shift" ? String(replacements.get(day.templateId!) ?? day.templateId) : day.kind })) }, tx as unknown as typeof db);
      for (const period of workspace.periods) if (period.endDate >= change.effectiveFrom && (!change.effectiveTo || period.startDate <= change.effectiveTo)) affected.add(period.id);
    }
    const groups = new Map<string, DatedChange[]>();
    for (const change of plan.dated) { const key = `${change.departmentId}|${change.periodId}`; groups.set(key, [...(groups.get(key) ?? []), change]); }
    for (const changes of groups.values()) for (let index = 0; index < changes.length; index += 100) {
      const chunk = changes.slice(index, index + 100);
      const { departmentId, periodId } = chunk[0];
      // Each prior chunk changes the source digest. Re-read inside the same outer
      // transaction; a later chunk failure still rolls back the entire transition.
      const workspace = await readScheduleWorkspace(actor, { departmentId, periodId }, tx);
      const receipt = await confirmScopedScheduleDays(actor, { requestId: randomUUID(), departmentId, periodId, sourceDigest: workspace.sourceDigest, expectedDraftId: null, expectedDraftRevision: null,
        changes: chunk.map(change => ({ employeeId: change.employeeId, day: change.day, value: String(replacements.get(change.templateId)!) })) }, tx as unknown as typeof db);
      for (const id of receipt.affectedPeriodIds ?? []) affected.add(id);
    }
    // A second inventory proves no effective old-policy schedule was missed. No repeat writes.
    const remaining = await previewUnifiedRuleTransition(tx, actor, { reviewedTemplates: [] });
    if (remaining.counts.catalogVersions || remaining.counts.weeklySegments || remaining.counts.datedDays) throw new Error("The rule transition was incomplete; every change was rolled back.");
    const receipt: UnifiedRuleTransitionReceipt = { requestId: input.requestId, sourceDigest: plan.sourceDigest, effectiveFrom: plan.effectiveFrom, counts: plan.counts, catalogIds: [...replacements].map(([previousId, newId]) => ({ previousId, newId })), affectedPeriodIds: [...affected].sort() };
    await tx.insert(s.adminAuditEvents).values({ actorUserId: actor.userId, entityType: "shift_rule_transition", entityId: input.requestId, action, details: JSON.stringify({ commandDigest, receipt }) });
    return receipt;
  });
}

import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type DbClient } from "@/db";
import { employees, payrollPeriods, payrollRuns, payrollRunEvents, adminAuditEvents } from "@/db/schema";
import { attendanceSourceMappings as mappings, attendanceSourceIdentities as identities, attendanceMatchBatches as batches, attendanceMatchChanges as changes, attendanceSourceEvents as events, attendanceSourceProjections as projections, attendanceSourcePeriods as sourcePeriods } from "@/db/attendanceSourceSchema";
import { attendanceMatchingInbox } from "./attendanceMatchingInbox";
import { batchSuggestion, nameDifferenceWarning, verificationReason, type IdentityClassification, type MatchBoard, type MatchHistoryBatch, type MatchMutation, type MatchPerson } from "./attendanceMatching";
import { lockAttendancePayrollInput } from "./attendanceSourceGuard";
import { PayrollValidationError } from "./validation";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(message: string): never { throw new PayrollValidationError(message); }
const enabled = () => { if (process.env.ATTENDANCE_SOURCE_ENABLED !== "true") fail("Attendance connection is disabled."); };

export async function loadMatchBoard(database: DbClient, historyBefore?: string): Promise<MatchBoard> {
  enabled();
  const people = await attendanceMatchingInbox(database);
  const roster = await database.select({ id: employees.id, employeeNo: employees.employeeNo, first: employees.firstName, middle: employees.middleName, last: employees.lastName }).from(employees).where(isNull(employees.deletedAt)).orderBy(employees.id);
  const active = roster.map(e => ({ id: e.id, employeeNo: e.employeeNo, name: [e.first, e.middle, e.last].filter(Boolean).join(" ") }));
  const rosterVersion = digest(active);
  const links = await database.select({ sourceId: mappings.sourceEmployeeId, employeeId: mappings.employeeId, updatedAt: sql<string>`${mappings.updatedAt}::text` }).from(mappings);
  const states = await database.select().from(identities);
  const byLink = new Map(links.map(item => [item.sourceId, item]));
  const byState = new Map(states.map(item => [item.sourceEmployeeId, item]));
  const result: MatchPerson[] = people.map(person => {
    const link = byLink.get(person.sourceId), state = byState.get(person.sourceId);
    return { ...person, employeeId: link?.employeeId ?? null, classification: (state?.classification ?? "Active") as IdentityClassification,
      version: digest([person, rosterVersion, link ?? null, state?.revision ?? null]), classificationReason: state?.reason ?? "", classificationActor: state?.actorUserId ?? null, classificationAt: state?.updatedAt.toISOString() ?? null };
  });
  if (historyBefore && !uuid.test(historyBefore)) fail("Invalid history page. Refresh the matching screen.");
  const recent = await database.select().from(batches).where(historyBefore ? sql`(${batches.createdAt}, ${batches.id}) < (select created_at, id from attendance_match_batches where id = ${historyBefore}::uuid)` : undefined).orderBy(desc(batches.createdAt), desc(batches.id)).limit(51);
  const page = recent.slice(0, 50);
  const entries = page.length ? await database.select().from(changes).where(inArray(changes.batchId, page.map(b => b.id))).orderBy(changes.sourceEmployeeId) : [];
  const history: MatchHistoryBatch[] = page.map(batch => ({ id: batch.id, kind: batch.kind, actor: batch.actorUserId, reason: batch.reason, createdAt: batch.createdAt.toISOString(), changes: entries.filter(c => c.batchId === batch.id).map(change => ({
    id: change.id, sourceId: change.sourceEmployeeId, sourceName: change.sourceName,
    beforeEmployeeId: change.beforeEmployeeId, afterEmployeeId: change.afterEmployeeId,
    beforeLabel: change.beforeEmployeeLabel, afterLabel: change.afterEmployeeLabel,
    beforeClassification: change.beforeClassification, afterClassification: change.afterClassification, reversesChangeId: change.reversesChangeId,
    canUndo: ["Match", "Unmatch"].includes(batch.kind) && byState.get(change.sourceEmployeeId)?.revision === change.afterRevision && (byLink.get(change.sourceEmployeeId)?.employeeId ?? null) === change.afterEmployeeId && (!change.beforeEmployeeId || active.some(e => e.id === change.beforeEmployeeId)),
  })) }));
  return { people: result, employees: active.sort((a, b) => a.name.localeCompare(b.name)), history, historyCursor: recent.length > 50 ? page.at(-1)!.id : null };
}

/** Shared input lock is already held. Never alter closed/posted periods. */
async function invalidateMappings(database: DbClient, actor: string, sourceIds: string[]) {
  const affected = await database.selectDistinct({ periodId: projections.payrollPeriodId }).from(projections).innerJoin(events, eq(events.eventId, projections.eventId)).where(inArray(events.sourceEmployeeId, sourceIds));
  const open: string[] = [], protectedIds: string[] = [];
  for (const { periodId } of affected.sort((a, b) => a.periodId.localeCompare(b.periodId))) {
    const [period] = await database.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId)).for("update");
    const runs = await database.select().from(payrollRuns).where(eq(payrollRuns.payrollPeriodId, periodId)).for("update");
    if (!period || period.status !== "Open" || runs.some(r => r.status === "Posted")) { protectedIds.push(periodId); continue; }
    open.push(periodId);
    await database.update(sourcePeriods).set({ summariesRunId: null }).where(eq(sourcePeriods.payrollPeriodId, periodId));
    for (const run of runs.filter(r => ["Draft", "Reviewed", "Approved"].includes(r.status))) {
      await database.update(payrollRuns).set({ status: "Stale", reviewedAt: null, reviewedByUserId: null, approvedAt: null, approvedByUserId: null, updatedAt: new Date() }).where(eq(payrollRuns.id, run.id));
      await database.insert(payrollRunEvents).values({ payrollRunId: run.id, actorUserId: actor, eventType: "MarkedStale", fromStatus: run.status, toStatus: "Stale", notes: "Employee mapping changed. Sync attendance, refresh DTR summaries and recompute payroll." });
    }
  }
  return { affectedPeriodIds: open, protectedPeriodIds: protectedIds };
}

type ChangeSpec = { person: MatchPerson; employeeId: string | null; classification: IdentityClassification; reversesChangeId?: string };
/** Caller MUST supply a transaction. Validation of every row precedes every write. */
export async function mutateAttendanceMatching(database: DbClient, actor: string, request: MatchMutation) {
  enabled();
  if (!request || request.confirmed !== true || !["Match", "Unmatch", "Undo", "TestOnly", "Restore"].includes(request.kind)) fail("Confirm the selected changes before saving.");
  let reason = request.kind === "Match" ? (typeof request.method === "string" && typeof request.note === "string" ? verificationReason(request.method, request.note) : null) : request.reason;
  if (typeof reason !== "string" || !reason.trim() || reason.length > 500) fail("Enter a verification reason of 1–500 characters.");
  await lockAttendancePayrollInput(database);
  // Keep active/name/number checks stable through the write, including undo to a
  // previous employee. Personnel edits wait until this short transaction ends.
  await database.select({ id: employees.id }).from(employees).for("share");
  const board = await loadMatchBoard(database);
  const specs: ChangeSpec[] = [];
  const nameWarningSourceIds: string[] = [];
  function checked(sourceId: string, version: string) {
    const person = board.people.find(p => p.sourceId === sourceId);
    if (!person || typeof version !== "string" || person.version !== version) fail("The attendance identity, employee roster or match changed while you were reviewing. Refresh and review the batch again; nothing was saved.");
    return person!;
  }
  function activeEmployee(id: string) {
    if (!uuid.test(id) || !board.employees.some(e => e.id === id)) fail("Select an active Integra employee. Refresh if the employee record changed.");
  }
  if (request.kind === "Match") {
    if (!Array.isArray(request.items) || !request.items.length || request.items.length > 100 || new Set(request.items.map(i => i?.sourceId)).size !== request.items.length) fail("Choose 1–100 different attendance people per batch.");
    for (const item of request.items) {
      const person = checked(item.sourceId, item.version); activeEmployee(item.employeeId);
      if (person.classification === "TestOnly") fail("A test-only identity cannot be matched. Restore it to Needs review first.");
      if (item.reviewed !== true && (person.classification !== "Active" || person.employeeId || batchSuggestion(person, board.people, board.employees)?.id !== item.employeeId)) fail("This person needs individual identity verification before joining the batch.");
      if (nameDifferenceWarning(person, board.employees.find(e => e.id === item.employeeId)!)) nameWarningSourceIds.push(person.sourceId);
      specs.push({ person, employeeId: item.employeeId, classification: "Active" });
    }
  } else if (request.kind === "Undo") {
    if (!uuid.test(request.batchId) || !Array.isArray(request.items) || !request.items.length || request.items.length > 100 || new Set(request.items.map(i => i?.changeId)).size !== request.items.length || request.items.some(i => !uuid.test(i.changeId))) fail("Select the matches to reverse.");
    const [batch] = await database.select().from(batches).where(eq(batches.id, request.batchId));
    if (!batch || !["Match", "Unmatch"].includes(batch.kind)) fail("This entry cannot be undone as a matching batch. Use Restore to Needs review for test identities.");
    const originals = await database.select().from(changes).where(eq(changes.batchId, request.batchId));
    for (const item of request.items) {
      const original = originals.find(c => c.id === item.changeId);
      if (!original) fail("A selected change does not belong to this batch.");
      const person = checked(original!.sourceEmployeeId, item.version);
      const [state] = await database.select().from(identities).where(eq(identities.sourceEmployeeId, person.sourceId));
      if (state?.revision !== original!.afterRevision || person.employeeId !== original!.afterEmployeeId || person.classification !== original!.afterClassification) fail("A selected match changed after this batch. Review its current state instead; nothing was reversed.");
      if (original!.beforeEmployeeId) activeEmployee(original!.beforeEmployeeId);
      specs.push({ person, employeeId: original!.beforeEmployeeId, classification: original!.beforeClassification as IdentityClassification, reversesChangeId: original!.id });
    }
  } else {
    const person = checked(request.sourceId, request.version);
    if (request.kind === "TestOnly") {
      if (person.employeeId) fail("Remove the existing match before marking this attendance identity test only.");
      if (person.classification === "TestOnly") fail("This identity is already test only.");
      specs.push({ person, employeeId: null, classification: "TestOnly" });
    } else if (request.kind === "Restore") {
      if (person.classification !== "TestOnly") fail("This identity is no longer test only. Refresh its current state.");
      specs.push({ person, employeeId: null, classification: "NeedsReview" });
    } else {
      if (!person.employeeId) fail("This identity is already unmatched.");
      specs.push({ person, employeeId: null, classification: "NeedsReview" });
    }
  }
  if (nameWarningSourceIds.length) {
    if (request.kind !== "Match" || request.nameDifferencesAcknowledged !== true) fail("Acknowledge the highlighted name differences or missing names before saving. Nothing was saved.");
    reason = `${reason.trim()} Name differences or missing names acknowledged for ${nameWarningSourceIds.length} selected identities.`;
  }
  const changed = specs.filter(s => s.employeeId !== s.person.employeeId || s.classification !== s.person.classification);
  if (!changed.length) fail("These matches are already current. No changes were needed.");
  const batchId = randomUUID();
  await database.insert(batches).values({ id: batchId, kind: request.kind, actorUserId: actor, reason: reason.trim(), createdAt: sql`clock_timestamp()` });
  const allEmployees = await database.select({ id: employees.id, employeeNo: employees.employeeNo, first: employees.firstName, middle: employees.middleName, last: employees.lastName }).from(employees).where(inArray(employees.id, [...new Set(changed.flatMap(s => [s.employeeId, s.person.employeeId]).filter((id): id is string => !!id))]));
  const label = (id: string | null) => { const e = allEmployees.find(e => e.id === id); return e ? `${[e.first, e.middle, e.last].filter(Boolean).join(" ")} · ${e.employeeNo}` : null; };
  const mappingChanges: string[] = [];
  for (const spec of changed) {
    const sourceEmployeeId = spec.person.sourceId, revision = randomUUID();
    if (spec.employeeId !== spec.person.employeeId) {
      mappingChanges.push(sourceEmployeeId);
      if (spec.employeeId) await database.insert(mappings).values({ sourceEmployeeId, employeeId: spec.employeeId, actorUserId: actor, reason }).onConflictDoUpdate({ target: mappings.sourceEmployeeId, set: { employeeId: spec.employeeId, actorUserId: actor, reason, updatedAt: sql`clock_timestamp()` } });
      else await database.delete(mappings).where(eq(mappings.sourceEmployeeId, sourceEmployeeId));
    }
    await database.insert(identities).values({ sourceEmployeeId, classification: spec.classification, revision, actorUserId: actor, reason, updatedAt: sql`clock_timestamp()` }).onConflictDoUpdate({ target: identities.sourceEmployeeId, set: { classification: spec.classification, revision, actorUserId: actor, reason, updatedAt: sql`clock_timestamp()` } });
    await database.insert(changes).values({ batchId, sourceEmployeeId, sourceName: spec.person.names.join(" / ") || sourceEmployeeId,
      beforeEmployeeId: spec.person.employeeId, afterEmployeeId: spec.employeeId, beforeEmployeeLabel: label(spec.person.employeeId), afterEmployeeLabel: label(spec.employeeId),
      beforeClassification: spec.person.classification, afterClassification: spec.classification, afterRevision: revision, reversesChangeId: spec.reversesChangeId ?? null });
  }
  const impact = mappingChanges.length ? await invalidateMappings(database, actor, mappingChanges) : { affectedPeriodIds: [], protectedPeriodIds: [] };
  await database.insert(adminAuditEvents).values({ actorUserId: actor, entityType: "attendance_match_batch", entityId: batchId, action: `attendance.matching.${request.kind.toLowerCase()}`, details: JSON.stringify({ sourceIds: changed.map(s => s.person.sourceId), reason, nameWarningSourceIds, nameDifferencesAcknowledged: nameWarningSourceIds.length > 0, ...impact }) });
  const message = request.kind === "TestOnly" ? "Moved to Test only. Matching queues are updated; existing punches and payroll exceptions still need separate review." : request.kind === "Restore" ? "Restored to Needs review. Verify the identity before matching; attendance corrections are unchanged." : `${changed.length} employee match(es) updated. Sync affected periods, refresh DTR and recompute/review open payroll. ${impact.affectedPeriodIds.length} open period(s) need reconciliation.${impact.protectedPeriodIds.length ? ` ${impact.protectedPeriodIds.length} closed/posted period(s) were preserved and need separate reviewed adjustments.` : ""}`;
  return { batchId, message, ...impact };
}

/** Trusted CLI compatibility. Browser actions must provide their reviewed version. */
export async function saveAttendanceSourceMapping(database: DbClient, actor: string, sourceId: string, employeeId: string, reason: string, nameDifferencesAcknowledged = false) {
  enabled(); await lockAttendancePayrollInput(database);
  const board = await loadMatchBoard(database), person = board.people.find(p => p.sourceId === sourceId);
  if (!person) fail("Sync this attendance identity before matching it.");
  if (person!.classification === "TestOnly") fail("A test-only identity cannot be matched. Restore it for review first.");
  if (!board.employees.some(e => e.id === employeeId)) fail("Select an active payroll employee");
  if (typeof reason !== "string" || !reason.trim() || reason.length > 450) fail("Employee IDs and a verification reason are required");
  if (person!.employeeId === employeeId) return { changed: false, affectedPeriodIds: [] as string[] };
  const result = await mutateAttendanceMatching(database, actor, { kind: "Match", items: [{ sourceId, employeeId, version: person!.version, reviewed: true }], method: "other", note: reason, confirmed: true, nameDifferencesAcknowledged });
  return { changed: true, affectedPeriodIds: result.affectedPeriodIds };
}

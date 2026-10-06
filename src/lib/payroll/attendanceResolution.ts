import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { employees, payrollPeriods, payrollRuns, payrollRunEvents, adminAuditEvents } from "@/db/schema";
import { attendanceResolutions as resolutions, attendanceSourceEvents as events, attendanceSourceProjections as projections, attendanceSourceMappings as mappings, attendanceSourceIdentities as identities, attendanceSourceRuns as runs, attendanceSourcePeriods as periods } from "@/db/attendanceSourceSchema";
import { assertAttendanceSourceReady, lockAttendancePayrollInput, AttendanceSourceIssue } from "./attendanceSourceGuard";
import { chronological, periodAttendanceScope, validateManualSequence, type AttendanceReadiness, type ManualPunch, type ResolutionPerson, type ResolutionRequest } from "./attendanceResolutionModel";
import { type SourcePunch } from "./attendanceSourceClient";
import { PayrollValidationError } from "./validation";

function fail(message: string): never { throw new PayrollValidationError(message); }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
export const resolutionDigest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const enabled = () => { if (process.env.ATTENDANCE_SOURCE_ENABLED !== "true") fail("Attendance connection is disabled."); };
export async function resolutionPeople(database: DbClient, period: { id: string; startDate: string; endDate: string }, incoming?: SourcePunch[]): Promise<ResolutionPerson[]> {
  const records = incoming ?? (await database.select({ payload: events.payload }).from(projections).innerJoin(events, eq(events.eventId, projections.eventId)).where(eq(projections.payrollPeriodId, period.id))).map(r => r.payload as SourcePunch);
  const links = await database.select({ sourceId: mappings.sourceEmployeeId, employeeId: employees.id, employeeNo: employees.employeeNo, first: employees.firstName, middle: employees.middleName, last: employees.lastName, deleted: employees.deletedAt, changed: sql<string>`${mappings.updatedAt}::text` }).from(mappings).innerJoin(employees, eq(employees.id, mappings.employeeId));
  const states = await database.select().from(identities);
  const decisions = await database.select().from(resolutions).where(eq(resolutions.payrollPeriodId, period.id)).orderBy(desc(resolutions.createdAt), desc(resolutions.id));
  const scope = periodAttendanceScope(records, period.startDate, period.endDate);
  return [...new Set(records.map(p => p.employeeId))].sort().map(sourceId => {
    const group = records.filter(p => p.employeeId === sourceId).sort(chronological), link = links.find(p => p.sourceId === sourceId && !p.deleted), classification = states.find(s => s.sourceEmployeeId === sourceId);
    const version = resolutionDigest([period, group, link ?? null, classification?.revision ?? null]);
    const decision = decisions.find(d => d.sourceEmployeeId === sourceId && ["Pending", "Approved", "Sending", "Failed", "Expired"].includes(d.state));
    const relevant = group.filter(p => scope.relevant.has(p.eventId)), valid = relevant.filter(p => p.status === "VALID");
    const approved = decision?.state === "Approved" && decision.sourceVersion === version;
    const issues: string[] = [];
    if (valid.length && !link) issues.push("Employee match needed");
    if (valid.length && classification?.classification === "TestOnly") issues.push("Test punches need correction");
    if (valid.some(p => p.clockFlag)) issues.push("Device clock needs investigation");
    if (!approved && valid.some(p => !p.reviewResolved && p.reviewFlags.some(f => ["NO_EARLIER_IN", "NO_FOLLOWING_OUT"].includes(f)))) issues.push("Missing IN or OUT");
    if (!approved && valid.some(p => !p.reviewResolved && p.reviewFlags.some(f => f.startsWith("CONSECUTIVE_") || f === "CLOSE_PUNCHES_ACROSS_PHONES"))) issues.push("Repeated punches need review");
    if (!approved && valid.some(p => scope.boundary.has(p.eventId))) issues.push("Period boundary needs a partner");
    if (!approved && valid.some(p => !p.reviewResolved && p.reviewFlags.length) && !issues.length) issues.push("Source warning needs review");
    if (link && relevant.length && !valid.length && !(approved && decision?.kind === "NoAttendance")) issues.push("No usable period attendance");
    if (decision && decision.sourceVersion !== version && ["Pending", "Approved"].includes(decision.state)) issues.push("Evidence changed — review again");
    else if (decision?.state === "Pending") issues.push("Awaiting approval");
    else if (decision && ["Sending", "Failed"].includes(decision.state)) issues.push("Source correction awaiting confirmation");
    return { sourceId, name: group.at(-1)?.employeeName ?? sourceId, employeeId: link?.employeeId ?? null, employeeNo: link?.employeeNo ?? null, employeeName: link ? [link.first, link.middle, link.last].filter(Boolean).join(" ") : null, classification: classification?.classification ?? "Active", version, records: group, relevantIds: relevant.map(p => p.eventId), issues, contextOnly: !relevant.length, resolution: decision ? { id: decision.id, state: decision.sourceVersion !== version && ["Pending", "Approved"].includes(decision.state) ? "Expired" : decision.state, kind: decision.kind, reason: decision.reason, evidence: decision.evidence, manualPunches: decision.manualPunches as ManualPunch[], eventIds: decision.eventIds as string[] } : null };
  });
}

export async function loadAttendanceReadiness(periodId: string, database: DbClient = db, historyPage = 0): Promise<AttendanceReadiness> {
  enabled(); if (!uuid.test(periodId)) fail("Select a payroll period.");
  const [period] = await database.select().from(payrollPeriods).where(eq(payrollPeriods.id, periodId));
  if (!period) fail("Payroll period not found.");
  const [run] = await database.select().from(runs).where(eq(runs.payrollPeriodId, periodId)).orderBy(desc(runs.startedAt), desc(runs.id)).limit(1);
  const [state] = await database.select().from(periods).where(eq(periods.payrollPeriodId, periodId));
  const people = await resolutionPeople(database, { id: period.id, startDate: period.startDate, endDate: period.endDate });
  const history = await database.select().from(resolutions).where(eq(resolutions.payrollPeriodId, periodId)).orderBy(desc(resolutions.createdAt), desc(resolutions.id)).limit(51).offset(Math.max(0, Math.min(10000, Math.floor(historyPage))) * 50);
  const posted = await database.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.payrollPeriodId, periodId), eq(payrollRuns.status, "Posted"),sql`coalesce(${payrollRuns.inputSnapshot}->>'payrollGroup','Legacy') <> 'Monthly'`)).limit(1);
  const blockers: string[] = [];
  let needsSync=!run||run.state!=="Complete";
  try { await assertAttendanceSourceReady(periodId, database); } catch (error) { if(error instanceof AttendanceSourceIssue)needsSync ||= error.needsSync; if (error instanceof PayrollValidationError) blockers.push(error.message); else throw error; }
  if (!run&&process.env.ATTENDANCE_WORKBENCH_ENABLED!=="true") blockers.push("Sync attendance for this period before continuing.");
  const counts = (run?.counts ?? {}) as Record<string, number>;
  return { periodId, code: period.code, startDate: period.startDate, endDate: period.endDate, periodOpen: period.status === "Open" && !posted.length, runState: run?.state ?? null, syncedAt: run?.completedAt?.toISOString() ?? null, needsSync, summariesOutdated: !!state && state.inputRunId !== state.summariesRunId || blockers.some(b=>/DTR refresh|Refresh attendance summaries/.test(b)), ready: !blockers.length, blockers, counts, people, history: history.slice(0, 50).map(h => ({ id: h.id, sourceId: h.sourceEmployeeId, kind: h.kind, state: h.state, reason: h.reason, evidence: h.evidence, createdAt: h.createdAt.toISOString(), updatedAt: h.updatedAt.toISOString(), actor: h.actorUserId, reviewer: h.reviewerUserId, manualPunches: h.manualPunches as ManualPunch[], eventIds: h.eventIds as string[], result: h.result })), historyHasMore: history.length > 50, sourceCorrectionsEnabled: (process.env.ATTENDANCE_CORRECTION_TOKEN?.length ?? 0) >= 32 };
}

async function openPeriod(tx: DbClient, id: string) {
  const [period] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, id)).for("update");
  const payroll = await tx.select().from(payrollRuns).where(eq(payrollRuns.payrollPeriodId, id)).for("update");
  if (!period || period.status !== "Open" || payroll.some(p => p.status === "Posted"&&p.inputSnapshot?.payrollGroup!=="Monthly")) fail("This affects closed or posted payroll. Arrange a linked payroll adjustment before changing the attendance.");
  return { period, payroll };
}
export async function invalidateResolutionPeriod(tx: DbClient, periodId: string, actor: string) {
  const { payroll } = await openPeriod(tx, periodId);
  await tx.update(periods).set({ summariesRunId: null }).where(eq(periods.payrollPeriodId, periodId));
  for (const run of payroll.filter(p => ["Draft", "Reviewed", "Approved"].includes(p.status)&&p.inputSnapshot?.payrollGroup!=="Monthly")) {
    await tx.update(payrollRuns).set({ status: "Stale", reviewedAt: null, reviewedByUserId: null, approvedAt: null, approvedByUserId: null, updatedAt: new Date() }).where(eq(payrollRuns.id, run.id));
    await tx.insert(payrollRunEvents).values({ payrollRunId: run.id, actorUserId: actor, eventType: "MarkedStale", fromStatus: run.status, toStatus: "Stale", notes: "Attendance resolution changed. Sync, refresh DTR and recompute before payroll review." });
  }
}
async function audit(tx: DbClient, actor: string, id: string, action: string, details: unknown) { await tx.insert(adminAuditEvents).values({ actorUserId: actor, entityType: "attendance_resolution", entityId: id, action, details: JSON.stringify(details) }); }
export type SourceCorrectionRequest = { id: string; eventId: string; action: "VOID" | "RESTORE"; reason: string; actor: string; expectedVersion: string; expectedEmployeeId: string; expectedUpdatedAt: string; confirmed?: boolean; duplicate?: {keptEventId:string;eventIds:string[];ruleVersion:string;automatic:boolean;enabledAfter:string|null;contextToken:string;from:string;through:string} };

/** The caller supplies a transaction and a server-authenticated administrator. */
export async function proposeAttendanceResolution(tx: DbClient, actor: string, request: ResolutionRequest, allowAdjacentSourceRecords = false) {
  enabled(); if (!request || !uuid.test(request.periodId) || request.confirmed !== true || !["Manual", "NoAttendance", "SourceVoid", "SourceRestore"].includes(request.kind)) fail("Review and confirm the proposed treatment before saving.");
  for (const value of [request.reason, request.evidence]) if (typeof value !== "string" || value.trim().length < 3 || value.length > 500) fail("Enter the verification evidence and reason (3–500 characters each).");
  await lockAttendancePayrollInput(tx);
  await tx.select({ id: employees.id }).from(employees).for("share");
  const { period } = await openPeriod(tx, request.periodId);
  const person = (await resolutionPeople(tx, { id: period.id, startDate: period.startDate, endDate: period.endDate })).find(p => p.sourceId === request.sourceId);
  if (!person || person.version !== request.version) fail("Attendance or the employee match changed. Sync and review the current evidence; nothing was saved.");
  if (person.contextOnly) fail("These records are adjacent-day context. Open the period containing the work date to correct them.");
  if (person.resolution && ["Pending", "Approved", "Sending", "Failed"].includes(person.resolution.state)) fail("Review, reverse or reject the existing proposal before creating another.");
  if (!Array.isArray(request.manualPunches) || !Array.isArray(request.eventIds)) fail("Invalid proposal. Refresh the review screen.");
  const id = randomUUID(); let sourceRequests: SourceCorrectionRequest[] = [];
  if (["Manual", "NoAttendance"].includes(request.kind)) {
    if (!person.employeeId || person.classification === "TestOnly") fail("Verify the real employee match before proposing payable attendance.");
    if (request.eventIds.length) fail("Manual DTR proposals cannot void source records.");
    if (request.kind === "Manual") {
      const problem = validateManualSequence(person.records, request.manualPunches, period.startDate, period.endDate); if (problem) fail(problem);
    } else if (request.manualPunches.length || person.records.some(p => person.relevantIds.includes(p.eventId) && p.status === "VALID")) fail("No-attendance approval requires all period source punches to be voided with evidence. It does not create leave or paid hours.");
  } else {
    if ((process.env.ATTENDANCE_CORRECTION_TOKEN?.length ?? 0) < 32) fail("The source correction connection is not configured. Contact the administrator.");
    if (request.manualPunches.length || !request.eventIds.length || request.eventIds.length > 50 || new Set(request.eventIds).size !== request.eventIds.length) fail("Select 1–50 specific source records to correct.");
    const impacted = await tx.selectDistinct({ periodId: projections.payrollPeriodId }).from(projections).where(inArray(projections.eventId, request.eventIds));
    for (const p of impacted.sort((a, b) => a.periodId.localeCompare(b.periodId))) await openPeriod(tx, p.periodId);
    sourceRequests = request.eventIds.map(eventId => {
      const punch = person.records.find(p => p.eventId === eventId && (person.relevantIds.includes(eventId) || allowAdjacentSourceRecords));
      if (!punch || punch.status !== (request.kind === "SourceVoid" ? "VALID" : "VOID") || punch.correctionVersion === undefined) fail("A selected source record changed or needs a fresh sync. Review it again.");
      return { id: randomUUID(), eventId, action: request.kind === "SourceVoid" ? "VOID" : "RESTORE", reason: `Integra ${id}: ${request.reason.trim()} | Evidence: ${request.evidence.trim()}`.replace(/\s+/g, " "), actor, expectedVersion: punch.correctionVersion!, expectedEmployeeId: punch.employeeId, expectedUpdatedAt: punch.updatedAt };
    });
  }
  await tx.insert(resolutions).values({ id, payrollPeriodId: period.id, sourceEmployeeId: person.sourceId, kind: request.kind, state: "Pending", sourceVersion: person.version, employeeId: person.employeeId, reason: request.reason.trim(), evidence: request.evidence.trim(), manualPunches: request.manualPunches, eventIds: request.eventIds, sourceRequests, actorUserId: actor });
  await audit(tx, actor, id, "attendance.resolution_proposed", request);
  return id;
}

export async function reviewAttendanceResolution(tx: DbClient, actor: string, id: string, action: "Approve" | "Reject" | "Reverse", reason: string) {
  enabled(); if (!uuid.test(id) || !["Approve", "Reject", "Reverse"].includes(action) || typeof reason !== "string" || reason.trim().length < 3 || reason.length > 500) fail("Enter a review reason (3–500 characters).");
  await lockAttendancePayrollInput(tx);
  await tx.select({ id: employees.id }).from(employees).for("share");
  const [row] = await tx.select().from(resolutions).where(eq(resolutions.id, id)).for("update");
  if (!row) fail("Proposal not found.");
  const { period } = await openPeriod(tx, row.payrollPeriodId);
  if (action === "Approve") {
    if (row.state !== "Pending") fail("This proposal has already changed. Refresh the review screen.");
    const person = (await resolutionPeople(tx, { id: period.id, startDate: period.startDate, endDate: period.endDate })).find(p => p.sourceId === row.sourceEmployeeId);
    if (!person || person.version !== row.sourceVersion) fail("Source evidence or the employee match changed. Reject this proposal, sync and review again.");
    if (row.kind === "Manual") { const problem = validateManualSequence(person.records, row.manualPunches as ManualPunch[], period.startDate, period.endDate); if (problem) fail(problem); }
  } else if (action === "Reject") {
    if (!["Pending", "Expired", "Failed"].includes(row.state)) fail("An active source delivery must finish before retrying or stopping it. Approved corrections require reversal.");
  } else if (row.state !== "Approved" || !["Manual", "NoAttendance"].includes(row.kind)) fail("For a source correction, select the original record and propose the opposite correction. This preserves source history and checks for later changes.");
  const source = action === "Approve" && row.kind.startsWith("Source");
  if (source) {
    const impacted = await tx.selectDistinct({ periodId: projections.payrollPeriodId }).from(projections).where(inArray(projections.eventId, row.eventIds as string[]));
    for (const p of impacted.sort((a, b) => a.periodId.localeCompare(b.periodId))) await invalidateResolutionPeriod(tx, p.periodId, actor);
  } else if (action !== "Reject") await invalidateResolutionPeriod(tx, period.id, actor);
  const state = action === "Reject" ? "Rejected" : action === "Reverse" ? "Reversed" : source ? "Sending" : "Approved";
  await tx.update(resolutions).set({ state, ...(source ? { sourceRequests: (row.sourceRequests as SourceCorrectionRequest[]).map(r => ({ ...r, actor })) } : {}), reviewerUserId: actor, updatedAt: sql`clock_timestamp()`, result: reason.trim() }).where(eq(resolutions.id, id));
  await audit(tx, actor, id, `attendance.resolution_${action.toLowerCase()}`, { previousState: row.state, state, reason });
  return { periodId: row.payrollPeriodId, source };
}

/** Idempotent outbox: never erase a source success when reconciliation fails. */
export async function applySourceResolution(id: string, actor: string, justApproved = false, database = db, fetcher: typeof fetch = fetch) {
  const row = await database.transaction(async tx => {
    await lockAttendancePayrollInput(tx);
    const [current] = await tx.select().from(resolutions).where(eq(resolutions.id, id)).for("update");
    if (!current || !["Sending", "Failed"].includes(current.state) || !current.reviewerUserId) fail("This correction is not approved for delivery.");
    if (!justApproved && current.state === "Sending" && Date.now() - current.updatedAt.getTime() < 90000) fail("Source delivery is still being confirmed. Check history and retry after 90 seconds if it remains unfinished.");
    await tx.update(resolutions).set({ state: "Sending", updatedAt: sql`clock_timestamp()` }).where(eq(resolutions.id, id));
    return current;
  });
  const origin = new URL(process.env.ATTENDANCE_SOURCE_ORIGIN ?? "");
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) fail("Invalid attendance connection configuration.");
  await database.transaction(async tx => {
    await lockAttendancePayrollInput(tx);
    const impacted = await tx.selectDistinct({ periodId: projections.payrollPeriodId }).from(projections).where(inArray(projections.eventId, row.eventIds as string[]));
    const duplicatePeriods=(row.duplicateMetadata as {impactedPeriodIds?:string[]}|null)?.impactedPeriodIds??[];
    for (const periodId of [...new Set([row.payrollPeriodId,...impacted.map(p=>p.periodId),...duplicatePeriods])].sort()) await openPeriod(tx, periodId);
  });
  let succeeded = 0;
  let sourceConflict = false;
  const deliveryDeadline = Date.now() + 35000;
  for (const request of row.sourceRequests as SourceCorrectionRequest[]) {
    if (request.confirmed) { succeeded++; continue; }
    if (Date.now() > deliveryDeadline) break;
    try {
      const response = await fetcher(new URL("/v1/integra/corrections", origin), { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.ATTENDANCE_CORRECTION_TOKEN ?? ""}` }, body: JSON.stringify(request) });
      if(response.status===409 && request.duplicate) { sourceConflict=true; break; }
      if (!response.ok) throw Error("Not confirmed");
      const result = await response.json(); if (result.accepted !== true || result.id !== request.id) throw Error("Not confirmed");
      request.confirmed = true;
      await database.update(resolutions).set({ sourceRequests: row.sourceRequests }).where(and(eq(resolutions.id, id), eq(resolutions.state, "Sending")));
      succeeded++;
    } catch { break; }
  }
  const total = (row.sourceRequests as SourceCorrectionRequest[]).length, complete = succeeded === total;
  const message = sourceConflict ? "Source evidence changed and the duplicate request was rejected. Sync, review the current records and create a fresh proposal. Earlier confirmed corrections are retained." : complete ? `Source confirmed ${total} correction(s). Sync every affected period to confirm payroll input.` : `${succeeded} of ${total} source corrections confirmed in this attempt. Sync to inspect current records, then retry delivery with the same request IDs. No confirmed correction is repeated.`;
  await database.transaction(async tx => {
    await lockAttendancePayrollInput(tx);
    await tx.update(resolutions).set({ state: sourceConflict ? "Expired" : complete ? "Applied" : "Failed", result: message, updatedAt: sql`clock_timestamp()` }).where(and(eq(resolutions.id, id), inArray(resolutions.state, ["Sending", "Failed"])));
    await audit(tx, actor, id, "attendance.source_delivery", { succeeded, total, complete });
  });
  return message;
}

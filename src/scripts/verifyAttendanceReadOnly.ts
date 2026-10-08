import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { db, DbClient } from "@/db";
import { employees, employeesTimekeeping, payrollPeriods, payrollRuns, attendanceRawLogs, adminAuditEvents } from "@/db/schema";
import { attendanceSourceMappings, attendanceSourceEvents, attendanceSourceRuns, attendanceResolutions } from "@/db/attendanceSourceSchema";
import { workPlans, workHistory, workBatches, adjustmentCases } from "@/db/attendanceWorkbenchSchema";
import { matchingDatabase } from "./attendanceTest/matchingDatabase";
import { workEmployees, draftVersion, saveWorkDraft, prepareWorkApproval, approveWorkBatch, workSource } from "@/lib/payroll/attendanceWorkbench";
import { processWorkDelivery, reconcileWorkbenchInputs, undoWorkDraft } from "@/lib/payroll/attendanceWorkbenchDelivery";
import { reconcileAttendanceSource } from "@/lib/payroll/attendanceSourceSync";
import { type SourcePunch } from "@/lib/payroll/attendanceSourceClient";
import { type WorkDraft } from "@/lib/payroll/attendanceWorkbenchModel";
import { readAttendanceSourceReceipt } from "@/lib/payroll/attendanceSourceReadOnly";
import { loadWorkPlanViews } from "@/lib/payroll/attendanceWorkProgress";
import { proposeAttendanceResolution, applySourceResolution } from "@/lib/payroll/attendanceResolution";
import { approveDuplicateBatch, undoDuplicate, processAutomaticDuplicates, setDuplicatePolicy } from "@/lib/payroll/attendanceDuplicates";

async function main() {
  Object.assign(process.env, { ATTENDANCE_WORKBENCH_ENABLED: "true", ATTENDANCE_SOURCE_ENABLED: "true", ATTENDANCE_SOURCE_ORIGIN: "https://fictional.invalid", ATTENDANCE_SOURCE_TOKEN: "fictional-read-only-token-".repeat(3), ATTENDANCE_CORRECTION_TOKEN: "obsolete-write-token-".repeat(3) });
  const { pg, database, client } = await matchingDatabase();
  const localDb = database as unknown as typeof db;
  try {
    const actor = randomUUID(), employeeId = randomUUID(), periodId = randomUUID(), day = "2026-09-30";
    await database.insert(employees).values({ id: employeeId, employeeNo: "00303", firstName: "ReadOnly", lastName: "Fixture" });
    await database.insert(employeesTimekeeping).values({ employeeId, checkInTime: "08:00:00", checkOutTime: "17:00:00", hoursWorked: "8" });
    await database.insert(attendanceSourceMappings).values({ sourceEmployeeId: "303", employeeId, actorUserId: actor, reason: "Fixture match" });
    await database.insert(payrollPeriods).values({ id: periodId, code: "READONLY-2026-09-B", payrollTerms: "Semi-Monthly", cycle: "B", year: 2026, month: 9, startDate: day, endDate: day, nominalPayDate: day, adjustedPayDate: day });
    const punch = (type: "IN" | "OUT", capturedAt: string): SourcePunch => ({ eventId: randomUUID(), employeeId: "303", employeeName: "ReadOnly Fixture", originalEmployeeId: "303", originalEmployeeName: "ReadOnly Fixture", branchId: "B1", type, originalType: type, capturedAt, originalCapturedAt: capturedAt, receivedAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", status: "VALID", clockFlag: false, clockVerified: false, reviewFlags: [], reviewResolved: false, correctionVersion: "original", effectiveRevision: "original" });
    const records = [punch("OUT", "2026-09-30T00:00:00.000Z"), punch("OUT", "2026-09-30T09:00:00.000Z")];
    const sourceRun = randomUUID();
    await database.insert(attendanceSourceRuns).values({ id: sourceRun, payrollPeriodId: periodId, actorUserId: actor, state: "Fetching", fromDate: "2026-09-29", throughDate: "2026-10-01", startedAt: sql`clock_timestamp()` });
    await reconcileAttendanceSource(localDb, periodId, sourceRun, actor, records);
    const sourceBefore = await database.select().from(attendanceSourceEvents);
    let networkCalls = 0;
    const forbiddenFetch: typeof fetch = async () => { networkCalls++; throw Error("Unexpected outbound request"); };
    for (const operation of ["apply-plan", "context", "verify-context", "duplicateContext"]) await assert.rejects(() => workSource({ operation }, forbiddenFetch), /read-only/);
    await assert.rejects(() => approveDuplicateBatch(periodId, [], "", true, actor, false, localDb, forbiddenFetch), /read-only/);
    await assert.rejects(() => undoDuplicate(randomUUID(), "", actor, localDb, forbiddenFetch), /read-only/);
    await assert.rejects(() => setDuplicatePolicy(client, actor, "Automatic", "revision", true), /read-only/);
    assert.equal(await processAutomaticDuplicates(periodId, actor, localDb, forbiddenFetch), 0);
    await assert.rejects(() => proposeAttendanceResolution(client, actor, { periodId, sourceId: "303", version: "old", kind: "SourceVoid", reason: "", evidence: "", confirmed: true, eventIds: [records[0].eventId], manualPunches: [] }), /read-only/);
    assert.equal(networkCalls, 0, "Every retired mutation path rejects before network access");

    const person = (await workEmployees(periodId, client))[0];
    const draft: WorkDraft = { employeeId, days: [day], changes: [{ id: randomUUID(), day, kind: "Direction", eventId: records[0].eventId, type: "IN", reason: "", evidence: "", verified: false }], reason: "", ownerId: actor, needed: "", rejected: false, version: draftVersion(person, [day]) };
    const saved = await database.transaction(tx => saveWorkDraft(tx as unknown as DbClient, actor, periodId, [draft]));
    const preview = await prepareWorkApproval(periodId, saved.id, saved.revision, client, forbiddenFetch);
    assert.equal(preview.prepared[0].sourceRequest, null);
    await approveWorkBatch(actor, periodId, saved.id, saved.revision, preview.digest, localDb, forbiddenFetch);
    assert.equal(networkCalls, 0);
    const [approved] = await database.select().from(workPlans).where(eq(workPlans.batchId, saved.id));
    assert.equal(approved.state, "Resolved");
    assert.equal((approved.sourceResult as { state: string }).state, "LocalOnly");
    assert.equal((await workEmployees(periodId, client))[0].days[0].records[0].type, "IN");
    assert.deepEqual(await database.select().from(attendanceSourceEvents), sourceBefore, "Approval preserves phone evidence and source versions");
    const rawAfterApproval = await database.select().from(attendanceRawLogs);
    await assert.rejects(() => approveWorkBatch(actor, periodId, saved.id, saved.revision, preview.digest, localDb, forbiddenFetch), /saved batch/);
    assert.deepEqual(await database.select().from(attendanceRawLogs), rawAfterApproval, "Repeated approval cannot duplicate effective inputs");
    assert.deepEqual(await processWorkDelivery(actor, { database: localDb, batchId: saved.id, fetcher: forbiddenFetch }), { completed: 0, remaining: 0 });
    const undo = await undoWorkDraft(client, actor, approved.id);
    assert.equal(undo[0].changes.find(c => c.kind === "UndoCapture")?.type, "OUT", "Undo restores the earlier local value without a source write");

    // A historical ambiguous outbox is checked with GET and retired, retaining its local decision.
    const historicalRequest = { operation: "apply-plan", id: randomUUID(), changes: [{ eventId: records[0].eventId, type: "IN" }] };
    await database.update(workPlans).set({ state: "Failed", sourceRequest: historicalRequest, sourceResult: null, result: "Interrupted historical delivery" }).where(eq(workPlans.id, approved.id));
    const calls: { url: string; method: string; auth: string }[] = [];
    const receiptFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input)); calls.push({ url: url.pathname, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("Authorization") ?? "" });
      assert.equal(url.pathname, "/v1/integra/receipts");
      assert.equal(init?.method, "GET");
      return Response.json({ state: "Not found", id: url.searchParams.get("id"), plan: null, changes: [] });
    };
    assert.equal((await processWorkDelivery(actor, { database: localDb, batchId: saved.id, fetcher: receiptFetch })).completed, 1);
    const [retired] = await database.select().from(workPlans).where(eq(workPlans.id, approved.id));
    assert.equal(retired.state, "Resolved"); assert.match(retired.result!, /no applied source receipt/);
    assert.deepEqual(retired.sourceRequest, historicalRequest, "Historical request is retained for audit");
    assert.equal((await loadWorkPlanViews(periodId, client)).find(p => p.id === approved.id)?.approved, true, "A retained local decision remains approved after retirement");
    assert.deepEqual(await database.select().from(attendanceRawLogs), rawAfterApproval, "Retirement never changes effective inputs");
    assert.deepEqual(await database.select().from(attendanceSourceEvents), sourceBefore);
    await processWorkDelivery(actor, { database: localDb, batchId: saved.id, fetcher: receiptFetch });
    assert.equal(calls.length, 1, "Retirement retries are idempotent");
    assert.ok(calls.every(c => c.auth === `Bearer ${process.env.ATTENDANCE_SOURCE_TOKEN}`), "Only read credentials are used");
    assert.equal((await database.select().from(workHistory)).filter(h => h.action === "Source delivery retired").length, 1);

    // An unverified historical job with no local approval is retained for explicit review.
    const oldBatch = randomUUID(), oldPlan = randomUUID();
    await database.insert(workBatches).values({ id: oldBatch, periodId, actor });
    await database.insert(workPlans).values({ id: oldPlan, batchId: oldBatch, periodId, employeeId, draft, state: "Sync pending", sourceRequest: historicalRequest, evidenceVersion: draft.version, ownerId: actor });
    const pendingPlans = await database.select().from(workPlans);
    await database.transaction(tx => reconcileWorkbenchInputs(tx as unknown as DbClient, periodId, records, sourceRun));
    assert.deepEqual(await database.select().from(workPlans), pendingPlans, "An ordinary source pull cannot replay or rewrite an unresolved historical job");
    assert.deepEqual(await database.select().from(attendanceRawLogs), rawAfterApproval);
    await processWorkDelivery(actor, { database: localDb, batchId: oldBatch, fetcher: forbiddenFetch });
    const [unverified] = await database.select().from(workPlans).where(eq(workPlans.id, oldPlan));
    assert.equal(unverified.state, "Needs fresh review"); assert.match(unverified.result!, /unverified/);
    assert.deepEqual(unverified.sourceRequest, historicalRequest, "Unverified source request remains available as audit evidence");
    assert.equal((unverified.sourceResult as { readOnlyCutover: { localApproved: boolean } }).readOnlyCutover.localApproved, false);
    assert.equal((await loadWorkPlanViews(periodId, client)).find(p => p.id === oldPlan)?.approved, false, "Retired source requests without a local decision cannot appear approved");

    // Legacy retry also reads receipts only and retires without changing posted or effective payroll.
    const resolutionId = randomUUID(), correctionId = randomUUID();
    await database.insert(attendanceResolutions).values({ id: resolutionId, payrollPeriodId: periodId, sourceEmployeeId: "303", employeeId, kind: "SourceVoid", state: "Failed", sourceVersion: "historical", reason: "Historical", evidence: "Historical", manualPunches: [], eventIds: [records[0].eventId], sourceRequests: [{ id: correctionId, eventId: records[0].eventId, action: "VOID" }], actorUserId: actor, reviewerUserId: actor });
    await applySourceResolution(resolutionId, actor, false, localDb, receiptFetch);
    const [resolution] = await database.select().from(attendanceResolutions).where(eq(attendanceResolutions.id, resolutionId));
    assert.equal(resolution.state, "Expired"); assert.match(resolution.result!, /No source change was sent/);
    await applySourceResolution(resolutionId, actor, false, localDb, forbiddenFetch);
    assert.equal((await database.select().from(adminAuditEvents)).filter(e => e.action === "attendance.source_delivery_retired").length, 1);
    await assert.rejects(() => readAttendanceSourceReceipt("plan", "invalid", forbiddenFetch), /valid historical/);

    // Posted corrections produce an immediately reviewable adjustment, never altered payroll.
    await database.update(workPlans).set({ state: "Resolved" }).where(eq(workPlans.id, oldPlan));
    const [posted] = await database.insert(payrollRuns).values({ payrollPeriodId: periodId, runNumber: 1, status: "Posted", inputSnapshot: { payrollGroup: "Daily" } }).returning();
    const fresh = (await workEmployees(periodId, client))[0];
    const postedDraft: WorkDraft = { ...draft, version: draftVersion(fresh, [day]), changes: [{ ...draft.changes[0], id: randomUUID(), kind: "Time", at: `${day}T08:05:00` }] };
    const postedSaved = await database.transaction(tx => saveWorkDraft(tx as unknown as DbClient, actor, periodId, [postedDraft]));
    const postedPreview = await prepareWorkApproval(periodId, postedSaved.id, postedSaved.revision, client, forbiddenFetch);
    await approveWorkBatch(actor, periodId, postedSaved.id, postedSaved.revision, postedPreview.digest, localDb, forbiddenFetch);
    assert.deepEqual((await database.select().from(payrollRuns))[0], posted);
    assert.deepEqual(await database.select().from(attendanceRawLogs), rawAfterApproval);
    const [adjustment] = await database.select().from(adjustmentCases);
    assert.ok(adjustment.afterEvidence && adjustment.impact, "Posted adjustment impact is available without source delivery");
    assert.deepEqual(await database.select().from(attendanceSourceEvents), sourceBefore);
    console.log("PASS read-only source boundary, local optional-note approval, original evidence, approval retry, local undo, receipt-only retirement/idempotency, legacy/automatic rejection and posted adjustment preservation");
  } finally { await pg.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { eq } from "drizzle-orm";
import type { DbClient } from "@/db";
import { adminAuditEvents, department, employees, employeesGeneralInfo, managerScheduleChangeRequests } from "@/db/schema";
import { emptySchedule } from "@/lib/scheduling/model";
import type { SchedulePendingOperation, ScheduleReceipt } from "@/lib/scheduling/workspace-types";
import { freshScheduleDatabase } from "./attendanceTest/freshScheduleDatabase";
import type * as approvalActions from "@/app/actions/managerScheduleApprovalAction";
import type * as managerActions from "@/app/actions/managerAction";

// Real Admin handlers, SQL predicates, transactions, financial lock and audit writes.
// Only framework auth/cache and the separately tested operation service are replaced.
// A new, memory-only fictional store is used; no environment URL supplies test data.
async function main() {
  const { pg, database, transactional } = await freshScheduleDatabase();
  const actor = { userId: randomUUID(), role: "ADMIN" as const };
  const employeeId = randomUUID(), replacementId = randomUUID(), managerId = randomUUID();
  const checks: string[] = [], cachePaths: string[] = [];
  let authorized = true, failService = false, serviceCalls = 0, transactions = 0;
  let activeTransaction: DbClient | null = null;
  const fixtureDb = new Proxy(transactional, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return async (callback: (tx: DbClient) => Promise<unknown>) => {
        transactions++;
        return transactional.transaction(async tx => {
          activeTransaction = tx;
          try { return await callback(tx); } finally { activeTransaction = null; }
        });
      };
    },
  });
  const operation: SchedulePendingOperation = {
    version: 1, kind: "cover", primaryEmployeeId: employeeId, day: "2026-10-15",
    departmentId: 1, periodId: randomUUID(), linkedEmployees: [{ employeeId, day: "2026-10-15" }, { employeeId: replacementId, day: "2026-10-15" }],
    requestReasons: ["Rest-day coverage requires review"], requiresRestReview: true,
    cells: [{ employeeId: replacementId, day: "2026-10-15", before: emptySchedule("rest"),
      after: { ...emptySchedule("rest"), kind: "shift", shiftName: "Captured coverage", checkInTime: "08:00:00", checkOutTime: "17:00:00", hoursPerDay: 8 }, defaultSnapshot: emptySchedule("rest") }],
  };
  const filename = path.resolve("src/app/actions/managerScheduleApprovalAction.ts");
  const nativeRequire = createRequire(filename), fixture = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const forbidLegacy = () => { throw new Error("New captured operation reached legacy assignment mutation"); };
  const require = (request: string) => request === "@/db" ? { db: fixtureDb }
    : request === "next/cache" ? { revalidatePath(value: string) { cachePaths.push(value); } }
    : request === "@/lib/admin" ? { ...nativeRequire(request), requireAdminActor: async () => { if (!authorized) throw new Error("Forbidden Admin actor"); return actor; } }
    : request === "@/lib/auth/server" ? { ...nativeRequire(request), requireAdmin: async () => { if (!authorized) throw new Error("Forbidden Admin actor"); return actor; } }
    : request === "@/lib/payroll/bulkDaySchedules" ? { saveDateAssignment: forbidLegacy }
    : request === "@/app/actions/shiftAssignmentHelpers" ? { deleteDateAssignment: forbidLegacy }
    : request === "@/lib/scheduling/service" ? {
      async applyScheduleOperationRequest(tx: DbClient, receivedActor: typeof actor,
        requestRow: typeof managerScheduleChangeRequests.$inferSelect,
        options?: { restWorkReviewed?: boolean; restWorkBasis?: "voluntary-written" | "exception-reviewed"; restWorkEvidence?: string }): Promise<ScheduleReceipt> {
        serviceCalls++;
        assert.equal(tx, activeTransaction, "The operation service receives the handler's real transaction");
        assert.equal(receivedActor.userId, actor.userId); assert.equal(receivedActor.role, "ADMIN");
        assert.equal(requestRow.status, "Pending");
        assert.equal(requestRow.payload.scheduleOperation?.primaryEmployeeId, employeeId);
        assert.equal(requestRow.payload.scheduleOperation?.cells[0].employeeId, replacementId);
        await tx.insert(adminAuditEvents).values({ actorUserId: actor.userId, entityType: "fixture", entityId: requestRow.id, action: "fixture.schedule-applied" });
        if (requestRow.payload.scheduleOperation?.requiresRestReview && !options?.restWorkReviewed) throw new Error("Explicit rest-work review required");
        assert.equal(options?.restWorkBasis, "voluntary-written");
        assert.equal(options?.restWorkEvidence, "Fictional written willingness reference");
        if (failService) throw new Error("Stale captured schedule; no changes saved");
        return { requestId: requestRow.id, action: "days_confirmed", message: "Fixture applied", changedCount: 1, outcome: "approved", operation: "cover" };
      },
    } : nativeRequire(request);
  new vm.Script(compiled, { filename }).runInNewContext({ module: fixture, exports: fixture.exports, require, Date, Map, Set, Promise, Buffer, Error, console, process });
  const actions = fixture.exports as typeof approvalActions;
  const create = async (captured = true) => (await database.insert(managerScheduleChangeRequests).values({
    requestedByAccountId: managerId, employeeId, action: "Create", status: "Pending",
    payload: { employeeId, shiftTableId: 0, effectiveFrom: operation.day, effectiveTo: operation.day, graceMinutes: 0, isFlexible: false,
      ...(captured ? { scheduleOperation: operation } : { shiftTableId: 1 }) },
  }).returning())[0];
  const stored = (id: string) => database.query.managerScheduleChangeRequests.findFirst({ where: eq(managerScheduleChangeRequests.id, id) });
  const state = async () => JSON.stringify(await Promise.all([
    database.select().from(managerScheduleChangeRequests).orderBy(managerScheduleChangeRequests.id),
    database.select().from(adminAuditEvents).orderBy(adminAuditEvents.id),
  ]));
  const auditFor = (id: string) => database.select().from(adminAuditEvents).where(eq(adminAuditEvents.entityId, id));
  async function rejectsUnchanged(operationToTest: () => Promise<unknown>, expected: RegExp) {
    const before = await state(), cacheBefore = cachePaths.length;
    await assert.rejects(operationToTest, (error: unknown) => {
      const messages: string[] = [];
      for (let current = error, depth = 0; current instanceof Error && depth < 5; current = current.cause, depth++) messages.push(current.message);
      assert.match(messages.join("\n"), expected);
      return true;
    });
    assert.equal(await state(), before, "Rejected action rolls back request and operation/audit writes");
    assert.equal(cachePaths.length, cacheBefore, "Failure does not invalidate as if saved");
  }
  try {
    const pending = await create();
    await rejectsUnchanged(() => actions.approveManagerScheduleChangeRequest({ requestId: pending.id }), /rest-work review/);
    assert.equal((await stored(pending.id))?.status, "Pending");
    checks.push("Rest-work acknowledgement is forwarded; rejection leaves Pending and rolls back the service marker");

    const approval = { requestId: pending.id, decisionNote: "  Reviewed coverage  ", restWorkReviewed: true,
      restWorkBasis: "voluntary-written" as const, restWorkEvidence: "Fictional written willingness reference" };
    await actions.approveManagerScheduleChangeRequest(approval);
    const approved = await stored(pending.id), approvalAudit = await auditFor(pending.id);
    assert.equal(approved?.status, "Approved"); assert.equal(approved?.decisionNote, "Reviewed coverage");
    assert.equal(approved?.decidedByAccountId, actor.userId); assert(approved?.decidedAt);
    assert.deepEqual(approved?.payload, pending.payload, "Captured operation remains available for history");
    assert.equal(approved?.targetAssignmentId, null, "New operation does not fabricate legacy assignment links");
    assert.deepEqual(approvalAudit.map(row => row.action).sort(), ["fixture.schedule-applied", "manager_schedule_change_request.approved"]);
    const detail = JSON.parse(approvalAudit.find(row => row.action === "manager_schedule_change_request.approved")!.details!);
    assert.equal(detail.operation, "cover"); assert.equal(detail.receipt.requestId, pending.id);
    assert(cachePaths.includes("/managerProvisional")); assert(cachePaths.includes("/schedules"));
    const afterApproval = await state(), appliedCalls = serviceCalls;
    await actions.approveManagerScheduleChangeRequest({ ...approval, decisionNote: "Replay must not replace original" });
    assert.equal(serviceCalls, appliedCalls); assert.equal(await state(), afterApproval);
    checks.push("Actual Admin approval commits operation/status/audit together; repeat delivery is a storage no-op and refreshes current surfaces");

    await rejectsUnchanged(() => actions.voidApprovedManagerScheduleChangeRequest({ requestId: pending.id, reason: "Try legacy deletion" }), /retain their history/);
    await rejectsUnchanged(() => actions.denyManagerScheduleChangeRequest({ requestId: pending.id }), /Pending/);
    checks.push("Captured approved operation cannot use destructive legacy Void or later Deny");

    const stale = await create(); failService = true;
    await rejectsUnchanged(() => actions.approveManagerScheduleChangeRequest({ ...approval, requestId: stale.id }), /Stale captured/);
    failService = false;
    assert.equal((await stored(stale.id))?.status, "Pending");
    checks.push("Service failure after a transaction write rolls back all handler effects");

    const auditFailure = await create();
    await pg.exec("ALTER TABLE admin_audit_events ADD CONSTRAINT fixture_reject_approval_audit CHECK (action <> 'manager_schedule_change_request.approved') NOT VALID");
    await rejectsUnchanged(() => actions.approveManagerScheduleChangeRequest({ ...approval, requestId: auditFailure.id }), /fixture_reject_approval_audit|check constraint/);
    await pg.exec("ALTER TABLE admin_audit_events DROP CONSTRAINT fixture_reject_approval_audit");
    assert.equal((await stored(auditFailure.id))?.status, "Pending");
    checks.push("Actual SQL audit failure after status update rolls back status and service writes");

    const denied = await create(), serviceBeforeDenial = serviceCalls;
    await actions.denyManagerScheduleChangeRequest({ requestId: denied.id, decisionNote: "  " });
    const denial = await stored(denied.id);
    assert.equal(denial?.status, "Denied"); assert.equal(denial?.decisionNote, null);
    assert.equal(denial?.decidedByAccountId, actor.userId); assert(denial?.decidedAt);
    assert.equal(serviceCalls, serviceBeforeDenial);
    assert.deepEqual((await auditFor(denied.id)).map(row => row.action), ["manager_schedule_change_request.denied"]);
    const afterDenial = await state();
    await actions.denyManagerScheduleChangeRequest({ requestId: denied.id, decisionNote: "Retry" });
    assert.equal(await state(), afterDenial);
    await rejectsUnchanged(() => actions.approveManagerScheduleChangeRequest({ ...approval, requestId: denied.id }), /Pending/);
    checks.push("New operation permits an optional denial note, records one audit, replays safely and cannot later approve");

    const legacy = await create(false);
    await rejectsUnchanged(() => actions.denyManagerScheduleChangeRequest({ requestId: legacy.id }), /denial note is required/);
    await actions.denyManagerScheduleChangeRequest({ requestId: legacy.id, decisionNote: "Legacy reason retained" });
    assert.equal((await stored(legacy.id))?.decisionNote, "Legacy reason retained");
    checks.push("Existing legacy request denial contract is preserved");

    const [branch, otherBranch] = await database.insert(department).values([
      { code: "APPROVAL-QA", name: "Fictional manager branch" }, { code: "OTHER-QA", name: "Outside manager scope" },
    ]).returning();
    await database.insert(employees).values([
      { id: employeeId, employeeNo: "APPROVAL-QA", firstName: "Primary", lastName: "Fixture" },
      { id: replacementId, employeeNo: "PRIVATE-QA", firstName: "Private replacement", lastName: "Sentinel" },
    ]);
    await database.insert(employeesGeneralInfo).values([
      { employeeId, departmentId: branch.id, employmentStatus: "Regular" },
      { employeeId: replacementId, departmentId: otherBranch.id, employmentStatus: "Regular" },
    ]);
    const managerFilename = path.resolve("src/app/actions/managerAction.ts"), managerNativeRequire = createRequire(managerFilename), managerFixture = { exports: {} };
    const managerCompiled = ts.transpileModule(readFileSync(managerFilename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const managerRequire = (request: string) => request === "@/db" ? { db: fixtureDb }
      : request === "next/cache" ? { revalidatePath(value: string) { cachePaths.push(value); } }
      : request === "@/lib/auth/server" ? { ...managerNativeRequire(request),
        requireManager: async () => ({ accountId: managerId, role: "MANAGER" }),
        getManagerDepartmentIds: async () => [branch.id],
        assertManagerCanAccessEmployee: async (input: { accountId: string; employeeId: string }) => {
          assert.equal(input.accountId, managerId); assert.equal(input.employeeId, employeeId);
        },
      } : managerNativeRequire(request);
    new vm.Script(managerCompiled, { filename: managerFilename }).runInNewContext({ module: managerFixture, exports: managerFixture.exports, require: managerRequire, Date, Map, Set, Promise, Buffer, Error, console, process });
    const manager = managerFixture.exports as typeof managerActions;
    const beforeLegacyRead = await state(), visibleRequests = await manager.getManagerScheduleRequests();
    assert.deepEqual(visibleRequests.map(row => row.id), [legacy.id], "Actual legacy SQL excludes all captured operations even when the primary employee is in scope");
    assert(!JSON.stringify(visibleRequests).includes(replacementId));
    assert(!JSON.stringify(visibleRequests).includes("Private replacement"));
    assert.equal(await state(), beforeLegacyRead);
    await rejectsUnchanged(() => manager.updateManagerScheduleChangeRequest({ requestId: stale.id,
      payload: { employeeId, shiftTableId: 1, effectiveFrom: operation.day, effectiveTo: operation.day } }), /captured day changes/);
    await rejectsUnchanged(() => manager.cancelManagerScheduleChangeRequest({ requestId: stale.id }), /captured day request/);
    checks.push("Actual legacy manager query excludes captured payload/out-of-scope participant; legacy edit and cancel reject unchanged");

    const deniedAuditFailure = await create();
    await pg.exec("ALTER TABLE admin_audit_events ADD CONSTRAINT fixture_reject_denial_audit CHECK (action <> 'manager_schedule_change_request.denied') NOT VALID");
    await rejectsUnchanged(() => actions.denyManagerScheduleChangeRequest({ requestId: deniedAuditFailure.id }), /fixture_reject_denial_audit|check constraint/);
    await pg.exec("ALTER TABLE admin_audit_events DROP CONSTRAINT fixture_reject_denial_audit");
    checks.push("Actual denial-audit SQL failure leaves request Pending");

    authorized = false;
    const transactionCount = transactions, serviceCount = serviceCalls;
    for (const call of [
      () => actions.approveManagerScheduleChangeRequest({ ...approval, requestId: stale.id }),
      () => actions.denyManagerScheduleChangeRequest({ requestId: stale.id }),
      () => actions.voidApprovedManagerScheduleChangeRequest({ requestId: pending.id, reason: "Unauthorized" }),
    ]) await rejectsUnchanged(call, /Forbidden Admin actor/);
    assert.equal(transactions, transactionCount); assert.equal(serviceCalls, serviceCount);
    checks.push("All mutation entrypoints reject a failed Admin gate before opening a transaction");
    console.log(JSON.stringify({ passed: true, suite: "Manager schedule Admin actions", checks,
      limits: "Actual handlers and PGlite SQL/rollback; operation application and authenticated identity are controlled fixtures. No live session, FK/migration or multi-connection concurrency acceptance; no production access." }));
  } finally { await pg.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

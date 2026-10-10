import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { eq } from "drizzle-orm";
import { managerScheduleChangeRequests } from "@/db/schema";
import { freshScheduleDatabase } from "./attendanceTest/freshScheduleDatabase";
import type * as managerActions from "@/app/actions/managerAction";

// Execute the actual manager handlers and SQL updates on fresh fictional PGlite.
// An approval commits immediately after the handler's Pending read. This models
// the adverse interleaving deterministically; it is not a live concurrency test.
async function main() {
  const { pg, database } = await freshScheduleDatabase();
  const accountId = randomUUID(), employeeId = randomUUID(), approverId = randomUUID();
  let approveAfterRead = false;
  let approved: typeof managerScheduleChangeRequests.$inferSelect | null = null;
  let cacheCalls = 0;
  const fixtureDb = new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "query") return Reflect.get(target, property, receiver);
      return { ...database.query, managerScheduleChangeRequests: {
        ...database.query.managerScheduleChangeRequests,
        async findFirst(...args: Parameters<typeof database.query.managerScheduleChangeRequests.findFirst>) {
          const captured = await database.query.managerScheduleChangeRequests.findFirst(...args);
          if (approveAfterRead && captured) {
            approveAfterRead = false;
            [approved] = await database.update(managerScheduleChangeRequests).set({
              status: "Approved", payload: { ...captured.payload, appliedAssignmentIds: [101] },
              targetAssignmentId: 101, decidedByAccountId: approverId, decidedAt: new Date(),
            }).where(eq(managerScheduleChangeRequests.id, captured.id)).returning();
          }
          return captured;
        },
      } };
    },
  });
  const filename = path.resolve("src/app/actions/managerAction.ts"), nativeRequire = createRequire(filename);
  const fixtureModule = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = (request: string) => request === "@/db" ? { db: fixtureDb }
    : request === "next/cache" ? { revalidatePath() { cacheCalls++; } }
    : request === "@/lib/auth/server" ? {
      requireManager: async () => ({ accountId }),
      assertManagerCanAccessEmployee: async (input: { accountId: string; employeeId: string }) => {
        assert.equal(input.accountId, accountId); assert.equal(input.employeeId, employeeId);
      },
    } : nativeRequire(request);
  new vm.Script(compiled, { filename }).runInNewContext({ module: fixtureModule, exports: fixtureModule.exports, require, Date, Map, Set, Promise, Buffer, console, process });
  const actions = fixtureModule.exports as typeof managerActions;
  const payload = { employeeId, shiftTableId: 1, effectiveFrom: "2026-10-01", effectiveTo: "2026-10-01", graceMinutes: 0, isFlexible: false };
  const create = async () => (await database.insert(managerScheduleChangeRequests).values({
    requestedByAccountId: accountId, employeeId, action: "Create", status: "Pending", payload,
  }).returning())[0];
  try {
    for (const action of ["edit", "cancel"] as const) {
      const request = await create();
      approved = null; approveAfterRead = true;
      const beforeCacheCalls = cacheCalls;
      const operation = () => action === "edit"
        ? actions.updateManagerScheduleChangeRequest({ requestId: request.id, payload: { ...payload, shiftTableId: 2 }, reason: "Fictional stale edit" })
        : actions.cancelManagerScheduleChangeRequest({ requestId: request.id });
      await assert.rejects(operation, /no longer pending/);
      assert.ok(approved, "The approval committed after the Pending read");
      const stored = await database.query.managerScheduleChangeRequests.findFirst({ where: eq(managerScheduleChangeRequests.id, request.id) });
      assert.deepEqual(stored, approved, `${action} preserves approved status, payload, assignment links and audit metadata`);
      assert.equal(cacheCalls, beforeCacheCalls, "A rejected request does not return successful invalidation");
    }
    const editable = await create();
    await actions.updateManagerScheduleChangeRequest({ requestId: editable.id, payload: { ...payload, shiftTableId: 2 }, reason: "Fictional valid edit" });
    const updated = await database.query.managerScheduleChangeRequests.findFirst({ where: eq(managerScheduleChangeRequests.id, editable.id) });
    assert.equal(updated?.status, "Pending"); assert.equal(updated?.payload.shiftTableId, 2); assert.equal(updated?.reason, "Fictional valid edit");
    const cancellable = await create();
    await actions.cancelManagerScheduleChangeRequest({ requestId: cancellable.id });
    assert.equal((await database.query.managerScheduleChangeRequests.findFirst({ where: eq(managerScheduleChangeRequests.id, cancellable.id) }))?.status, "Cancelled");
    console.log("PASS manager pending-request guards: actual edit/cancel handlers reject 2 approval-after-read interleavings without changing approved payload/status/assignment links; normal pending edit/cancel pass. Fresh fictional PGlite predicates only; no production or live-concurrency acceptance.");
  } finally { await pg.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

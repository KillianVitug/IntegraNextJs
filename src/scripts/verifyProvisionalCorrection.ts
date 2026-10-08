import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { authAccounts, employees, employeesGeneralInfo, employeesTimekeeping, payrollPeriods, attendanceImportBatches, attendanceRawLogs } from "@/db/schema";
import { workBatches, workPlans, workHistory } from "@/db/attendanceWorkbenchSchema";
import { saveWorkDraft, workEmployees } from "@/lib/payroll/attendanceWorkbench";
import { draftVersion, type WorkDraft } from "@/lib/payroll/attendanceWorkbenchModel";
import { saveProvisionalCorrectionDraft } from "@/lib/payroll/provisionalCorrection";

const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseKeys(entry)])) : value;
async function main() {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1", "Restored LOCAL database only");
  const rollback = new Error("ROLLBACK_PROVISIONAL_CORRECTION"), ids = [randomUUID(), randomUUID()], requestId = randomUUID();
  try {
    await db.transaction(async tx => {
      const [account] = await tx.select().from(authAccounts).where(eq(authAccounts.status, "Active")).limit(1);
      assert(account, "Normal restored administrator required");
      const actor = { userId: account.id };
      const people = await tx.insert(employees).values(ids.map((id, i) => ({ id, employeeNo: "PV-TEST-" + id.slice(0, 8), firstName: "Fictional", lastName: "Idempotency " + i }))).returning();
      await tx.insert(employeesGeneralInfo).values(people.map(person => ({ employeeId: person.id, dateHired: "2001-01-01", payrollTerms: "Semi-Monthly" as const })));
      await tx.insert(employeesTimekeeping).values(people.map(person => ({ employeeId: person.id, checkInTime: "08:00", checkOutTime: "17:00", hoursWorked: "8.00" })));
      const [period] = await tx.insert(payrollPeriods).values({ code: "PV-TEST-" + requestId.slice(0, 8), payrollTerms: "Semi-Monthly", cycle: "B", year: 2001, month: 9, startDate: "2001-09-28", endDate: "2001-09-30", nominalPayDate: "2001-10-05", adjustedPayDate: "2001-10-05", status: "Open" }).returning();
      const [batch] = await tx.insert(attendanceImportBatches).values({ payrollPeriodId: period.id, sourceFileName: "FICTIONAL-REQUEST-TEST.csv", sourceFormat: "CSV", status: "Processed", totalRows: 2, matchedRows: 2 }).returning();
      await tx.insert(attendanceRawLogs).values(people.map(person => ({ employeeId: person.id, employeeNo: person.employeeNo, batchId: batch.id, logDate: "2001-09-29", logTime: "08:00:00", loggedAt: sql.raw("'2001-09-29 08:00:00'::timestamp"), direction: "IN" as const, rawText: "FICTIONAL REQUEST TEST" })));
      const loaded = await workEmployees(period.id, tx);
      const drafts: WorkDraft[] = people.map(person => {
        const current = loaded.find(row => row.id === person.id)!;
        assert(current);
        return { employeeId: person.id, days: ["2001-09-29"], changes: [{ id: randomUUID(), day: "2001-09-29", kind: "Manual", type: "OUT", at: "2001-09-29T17:00", reason: "", evidence: "", verified: false }], reason: "", ownerId: account.id, needed: "", rejected: false, version: draftVersion(current, ["2001-09-29"]) };
      });
      const wrapped = new Proxy(db, { get(_target, key) { if (key === "transaction") return (fn: Parameters<typeof db.transaction>[0]) => tx.transaction(fn); const value = Reflect.get(tx, key); return typeof value === "function" ? value.bind(tx) : value; } });
      const history = () => tx.select().from(workHistory);
      const input = { requestId, periodId: period.id, draft: drafts[0] };
      const saved = await saveProvisionalCorrectionDraft(actor, input, wrapped);
      assert.deepEqual(saved, { id: requestId, revision: 1 });
      const firstHistory = await history();
      const recovered = await saveProvisionalCorrectionDraft(actor, { ...input, draft: reverseKeys(drafts[0]) as WorkDraft }, wrapped);
      assert.deepEqual(recovered, saved, "Lost response with reordered JSON must recover exactly the first request");
      assert.deepEqual(await history(), firstHistory, "Recovery must not create another draft or audit revision");
      const revised = { ...drafts[0], changes: drafts[0].changes.map(change => ({ ...change, at: "2001-09-29T18:00" })) };
      assert.deepEqual(await saveProvisionalCorrectionDraft(actor, { ...input, draft: revised, expectedRevision: 1 }, wrapped), { id: requestId, revision: 2 });
      assert.deepEqual(await saveProvisionalCorrectionDraft(actor, { ...input, draft: revised }, wrapped), { id: requestId, revision: 2 }, "Retry after a lost revised receipt must recover without the prior revision");
      await assert.rejects(() => saveProvisionalCorrectionDraft(actor, { ...input, expectedRevision: 1 }, wrapped), /Another saved revision/);
      const differentDay = { ...revised, days: ["2001-09-30"], changes: revised.changes.map(change => ({ ...change, day: "2001-09-30", at: "2001-09-30T18:00" })) };
      await assert.rejects(() => saveProvisionalCorrectionDraft(actor, { ...input, draft: differentDay, expectedRevision: 2 }, wrapped), /another employee, workday or saved batch/);
      await assert.rejects(() => saveProvisionalCorrectionDraft(actor, { ...input, draft: drafts[1], expectedRevision: 2 }, wrapped), /another employee, workday or saved batch/);
      await assert.rejects(() => saveProvisionalCorrectionDraft({ userId: randomUUID() }, { ...input, expectedRevision: 2 }, wrapped), /request has changed/);
      await assert.rejects(() => saveProvisionalCorrectionDraft(actor, { ...input, periodId: randomUUID(), expectedRevision: 2 }, wrapped), /request has changed/);
      await assert.rejects(() => saveProvisionalCorrectionDraft(actor, { ...input, requestId: randomUUID(), expectedRevision: 2 }, wrapped), /unavailable/);
      const sibling = await saveWorkDraft(tx, actor.userId, period.id, drafts);
      const priorPlans = await tx.select().from(workPlans).where(eq(workPlans.batchId, sibling.id));
      const priorBatch = await tx.select().from(workBatches).where(eq(workBatches.id, sibling.id));
      await assert.rejects(() => saveProvisionalCorrectionDraft(actor, { ...input, requestId: sibling.id, expectedRevision: sibling.revision }, wrapped), /another employee, workday or saved batch/);
      assert.deepEqual(await tx.select().from(workPlans).where(eq(workPlans.batchId, sibling.id)), priorPlans, "Another saved batch's sibling plans must not be removed or edited");
      assert.deepEqual(await tx.select().from(workBatches).where(eq(workBatches.id, sibling.id)), priorBatch);
      const [final] = await tx.select().from(workBatches).where(eq(workBatches.id, requestId));
      assert.equal(final.revision, 2, "Rejected or replayed requests cannot bump revisions");
      assert.equal((await tx.select().from(workPlans).where(eq(workPlans.batchId, requestId))).length, 1);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  assert.equal((await db.select().from(workBatches).where(eq(workBatches.id, requestId))).length, 0);
  console.log("PASS actual saved-request replay across JSONB ordering, revised-response recovery, stale rejection, actor/period/day/employee scope and sibling-batch preservation; fixtures rolled back");
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

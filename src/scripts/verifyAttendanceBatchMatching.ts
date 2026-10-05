import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { attendanceSourceEvents as events, attendanceSourceMappings as mappings, attendanceSourceRuns as runs, attendanceSourceIdentities as identities, attendanceMatchBatches as batches, attendanceMatchChanges as changes } from "@/db/attendanceSourceSchema";
import { matchingDatabase } from "./attendanceTest/matchingDatabase";
import { loadMatchBoard, mutateAttendanceMatching, saveAttendanceSourceMapping } from "@/lib/payroll/attendanceIdentityWorkflow";
import { assertAttendanceSourceReady, confirmAttendanceSourceSummaryRefresh, attendanceSourceVersion } from "@/lib/payroll/attendanceSourceGuard";
import { reconcileAttendanceSource } from "@/lib/payroll/attendanceSourceSync";
import { batchSuggestion, nameDifferenceWarning, matchQueue, type MatchMutation } from "@/lib/payroll/attendanceMatching";
import type { SourcePunch } from "@/lib/payroll/attendanceSourceClient";
import type { DbClient } from "@/db";

async function main() {
  const { pg, database, client } = await matchingDatabase();
  process.env.ATTENDANCE_SOURCE_ENABLED = "true";
  try {
    const actor = randomUUID(), a = randomUUID(), b = randomUUID(), c = randomUUID(), period = randomUUID(), payroll = randomUUID();
    await database.insert(schema.employees).values([{ id: a, employeeNo: "00404", firstName: "Maria", lastName: "Santos" }, { id: b, employeeNo: "00521", firstName: "Carlo", lastName: "Reyes" }, { id: c, employeeNo: "00999", firstName: "Another", lastName: "Person" }]);
    await database.insert(schema.payrollPeriods).values({ id: period, code: "BATCH-TEST", payrollTerms: "Semi-Monthly", cycle: "A", year: 2026, month: 9, startDate: "2026-09-01", endDate: "2026-09-15", nominalPayDate: "2026-09-15", adjustedPayDate: "2026-09-15" });
    const punch = (employeeId: string, employeeName: string, type: "IN" | "OUT", time: string): SourcePunch => ({ eventId: randomUUID(), employeeId, employeeName, originalEmployeeId: employeeId, originalEmployeeName: employeeName, branchId: "TEST", type, capturedAt: `2026-09-10T${time}+08:00`, receivedAt: `2026-09-10T${time}+08:00`, updatedAt: `2026-09-10T${time}+08:00`, status: "VALID", clockFlag: false, reviewFlags: [], reviewResolved: false });
    const records = [punch("404", "M. Santos", "IN", "08:00:00"), punch("404", "M. Santos", "OUT", "17:00:00"), punch("521", "REYES, CARLO", "IN", "08:00:00"), punch("521", "REYES, CARLO", "OUT", "17:00:00")];
    const sync = async (data = records) => { const id = randomUUID(); await database.insert(runs).values({ id, payrollPeriodId: period, state: "Fetching", actorUserId: actor, fromDate: "2026-08-31", throughDate: "2026-09-16" }); return reconcileAttendanceSource(database as unknown as Parameters<typeof reconcileAttendanceSource>[0], period, id, actor, data); };
    const mutate = (request: MatchMutation) => database.transaction(tx => mutateAttendanceMatching(tx as unknown as DbClient, actor, request));
    const refresh = async () => { const version = await attendanceSourceVersion(period, client); await database.transaction(tx => confirmAttendanceSourceSummaryRefresh(tx as unknown as DbClient, period, version)); };
    const item = (board: Awaited<ReturnType<typeof loadMatchBoard>>, id: string, employeeId: string, reviewed = false) => ({ sourceId: id, employeeId, version: board.people.find(p => p.sourceId === id)!.version, reviewed });
    const mark = (items: ReturnType<typeof item>[]): Extract<MatchMutation, { kind: "Match" }> => ({ kind: "Match", items, method: "roster", note: "Checked synthetic HR roster", confirmed: true, nameDifferencesAcknowledged: true });
    await sync(); let board = await loadMatchBoard(client);
    assert.equal(batchSuggestion(board.people[0], board.people, board.employees)?.id, a);
    for (const names of [["M. Santos"], ["Maria Santos", "Other Person"], [], [""], ["Maria Middle Santos"]]) {
      const person = { ...board.people[0], names };
      assert.equal(batchSuggestion(person, board.people, board.employees)?.id, a);
      assert.ok(nameDifferenceWarning(person, board.employees.find(e => e.id === a)!));
      assert.equal(matchQueue(person, board.people, board.employees), "suggested");
    }
    assert.equal(nameDifferenceWarning({ ...board.people[0], names: ["SANTOS, María"] }, board.employees.find(e => e.id === a)!), null);
    assert.equal(batchSuggestion({ ...board.people[0], sourceId: "9007199254740992" }, [{ ...board.people[0], sourceId: "9007199254740992" }], [{ id: a, employeeNo: "9007199254740993", name: "Maria Santos" }]), null);
    assert.equal(batchSuggestion(board.people[0], [...board.people, { ...board.people[0], sourceId: "00404" }], board.employees), null);
    assert.equal(batchSuggestion(board.people[0], board.people, [...board.employees, { id: randomUUID(), employeeNo: "404", name: "Maria Santos" }]), null);
    const before = await database.select().from(batches);
    await assert.rejects(() => mutate(mark([item(board, "404", a), { ...item(board, "521", b), version: "stale" }])), /changed while/);
    assert.deepEqual(await database.select().from(batches), before); assert.equal((await database.select().from(mappings)).length, 0);
    await assert.rejects(() => mutate(mark([item(board, "404", a), item(board, "404", a)])), /different attendance/);
    await assert.rejects(() => mutate({ ...mark([item(board, "404", a)]), confirmed: false }), /Confirm/);
    await assert.rejects(() => mutate(mark([item(board, "404", c)])), /individual identity/);
    for (const acknowledgment of [undefined, false]) {
      // A normal row followed by a warned row must not leave a partial mapping.
      await assert.rejects(() => mutate({ ...mark([item(board, "521", b), item(board, "404", a)]), nameDifferencesAcknowledged: acknowledgment }), /Acknowledge/);
      await assert.rejects(() => mutate({ ...mark([item(board, "404", a, true)]), nameDifferencesAcknowledged: acknowledgment }), /Acknowledge/, "Individual review does not bypass batch acknowledgment");
      for (const table of [mappings, identities, batches, changes, schema.adminAuditEvents]) {
        if (table === schema.adminAuditEvents) continue; // Existing sync audit is retained.
        assert.equal((await database.select().from(table)).length, 0);
      }
    }
    const priorAudit = await database.select().from(schema.adminAuditEvents);
    await database.update(schema.employees).set({ middleName: "Changed" }).where(eq(schema.employees.id, b));
    await assert.rejects(() => mutate(mark([item(board, "404", a), item(board, "521", b)])), /changed while/);
    assert.deepEqual(await database.select().from(schema.adminAuditEvents), priorAudit);
    await database.update(schema.employees).set({ middleName: null }).where(eq(schema.employees.id, b));
    await database.update(schema.employees).set({ deletedAt: new Date() }).where(eq(schema.employees.id, a));
    const inactiveBoard = await loadMatchBoard(client);
    assert.equal(batchSuggestion(inactiveBoard.people[0], inactiveBoard.people, inactiveBoard.employees), null);
    await assert.rejects(() => mutate(mark([item(inactiveBoard, "404", a)])), /active Integra/);
    await database.update(schema.employees).set({ deletedAt: null }).where(eq(schema.employees.id, a));
    const duplicate = randomUUID();
    await database.insert(schema.employees).values({ id: duplicate, employeeNo: "404", firstName: "Other", lastName: "Person" });
    const duplicateBoard = await loadMatchBoard(client);
    assert.equal(matchQueue(duplicateBoard.people[0], duplicateBoard.people, duplicateBoard.employees), "review");
    await assert.rejects(() => mutate(mark([item(duplicateBoard, "404", a)])), /individual identity/);
    await database.delete(schema.employees).where(eq(schema.employees.id, duplicate));
    board = await loadMatchBoard(client);
    const saved = await mutate(mark([item(board, "404", a), item(board, "521", b)]));
    const savedBoard = await loadMatchBoard(client);
    assert.match(savedBoard.history.find(h => h.id === saved.batchId)!.reason, /Name differences or missing names acknowledged/);
    const savedAudit = (await database.select().from(schema.adminAuditEvents)).find(e => e.entityId === saved.batchId)!;
    assert.deepEqual(JSON.parse(savedAudit.details!).nameWarningSourceIds, ["404"]);
    assert.equal(JSON.parse(savedAudit.details!).nameDifferencesAcknowledged, true);
    assert.equal((await database.select().from(changes)).length, 2); assert.equal((await database.select().from(mappings)).length, 2);
    await assert.rejects(() => mutate(mark([item(board, "404", a)])), /changed while/);
    await sync(); await refresh(); assert.ok(await assertAttendanceSourceReady(period, client));
    await database.insert(schema.payrollRuns).values({ id: payroll, payrollPeriodId: period, runNumber: 1, status: "Reviewed" });
    const raw = await database.select().from(schema.attendanceRawLogs);
    board = await loadMatchBoard(client);
    const original = board.history.find(h => h.id === saved.batchId)!;
    await mutate({ kind: "Undo", batchId: original.id, items: [{ changeId: original.changes.find(i => i.sourceId === "404")!.id, version: board.people.find(p => p.sourceId === "404")!.version }], reason: "Correct one synthetic mistake", confirmed: true });
    assert.equal((await database.select().from(mappings)).length, 1); assert.equal((await database.select().from(mappings))[0].employeeId, b);
    assert.equal((await database.select().from(schema.payrollRuns))[0].status, "Stale"); assert.deepEqual(await database.select().from(schema.attendanceRawLogs), raw);
    await refresh(); await assert.rejects(() => assertAttendanceSourceReady(period, client), /mappings or classifications changed/);
    board = await loadMatchBoard(client);
    await assert.rejects(() => mutate({ kind: "Undo", batchId: original.id, items: [{ changeId: original.changes.find(i => i.sourceId === "404")!.id, version: board.people.find(p => p.sourceId === "404")!.version }], reason: "Repeat must not apply", confirmed: true }), /changed after/);
    // Undo a reassignment restores its exact prior mapping; later edits block it.
    const changed = await mutate(mark([item(board, "521", c, true)])); board = await loadMatchBoard(client);
    const change = board.history.find(h => h.id === changed.batchId)!;
    await mutate({ kind: "Undo", batchId: change.id, items: [{ changeId: change.changes[0].id, version: board.people.find(p => p.sourceId === "521")!.version }], reason: "Restore prior employee", confirmed: true });
    assert.equal((await database.select().from(mappings))[0].employeeId, b);
    board = await loadMatchBoard(client);
    await assert.rejects(() => mutate({ kind: "Undo", batchId: original.id, items: [{ changeId: original.changes.find(i => i.sourceId === "521")!.id, version: board.people.find(p => p.sourceId === "521")!.version }], reason: "Cannot overwrite later verification", confirmed: true }), /changed after/);
    // Classification keeps source evidence and exceptions; it is not payroll exclusion.
    await mutate({ kind: "TestOnly", sourceId: "404", version: board.people.find(p => p.sourceId === "404")!.version, reason: "Synthetic training identity", confirmed: true });
    board = await loadMatchBoard(client); assert.equal(matchQueue(board.people[0], board.people, board.employees), "test");
    await assert.rejects(() => mutate(mark([item(board, "404", a, true)])), /test-only identity/);
    await assert.rejects(() => database.transaction(tx => saveAttendanceSourceMapping(tx as unknown as DbClient, actor, "404", a, "Old caller")), /test-only/);
    const counts = await sync(); assert.equal(counts.unmatched, 2); assert.equal(counts.withheld, 2); assert.equal((await database.select().from(events)).length, 4);
    board = await loadMatchBoard(client);
    await mutate({ kind: "Restore", sourceId: "404", version: board.people.find(p => p.sourceId === "404")!.version, reason: "Synthetic restoration", confirmed: true });
    board = await loadMatchBoard(client); assert.equal(matchQueue(board.people[0], board.people, board.employees), "review");
    await assert.rejects(() => mutate(mark([item(board, "404", a)])), /individual identity/);
    await mutate(mark([item(board, "404", a, true)])); await sync(); await refresh();
    await database.update(schema.payrollRuns).set({ status: "Posted" }).where(eq(schema.payrollRuns.id, payroll));
    const postedRaw = await database.select().from(schema.attendanceRawLogs); board = await loadMatchBoard(client);
    const removed = await mutate({ kind: "Unmatch", sourceId: "404", version: board.people.find(p => p.sourceId === "404")!.version, reason: "Correction after posting", confirmed: true });
    assert.deepEqual(removed.protectedPeriodIds, [period]); assert.equal((await database.select().from(schema.payrollRuns))[0].status, "Posted");
    assert.deepEqual(await database.select().from(schema.attendanceRawLogs), postedRaw); assert.ok((await sync()).lateChanges > 0); assert.deepEqual(await database.select().from(schema.attendanceRawLogs), postedRaw);
    // A restored inactive employee must not be reintroduced by undo.
    board = await loadMatchBoard(client); const removal = board.history.find(h => h.id === removed.batchId)!;
    await database.update(schema.employees).set({ deletedAt: new Date() }).where(eq(schema.employees.id, a)); board = await loadMatchBoard(client);
    await assert.rejects(() => mutate({ kind: "Undo", batchId: removed.batchId, items: [{ changeId: removal.changes[0].id, version: board.people.find(p => p.sourceId === "404")!.version }], reason: "Inactive employee", confirmed: true }), /active Integra/);
    assert.ok((await database.select().from(identities)).length === 2);
    assert.ok((await database.select().from(schema.adminAuditEvents)).some(e => e.action === "attendance.matching.undo"));
    await database.update(schema.employees).set({ deletedAt: null }).where(eq(schema.employees.id, a)); board = await loadMatchBoard(client);
    const whole = await mutate(mark([item(board, "404", c, true), item(board, "521", a, true)])); board = await loadMatchBoard(client);
    const wholeBatch = board.history.find(h => h.id === whole.batchId)!;
    assert.equal(wholeBatch.changes.length, 2);
    const reversals = wholeBatch.changes.map(change => ({ changeId: change.id, version: board.people.find(p => p.sourceId === change.sourceId)!.version }));
    await assert.rejects(() => mutate({ kind: "Undo", batchId: whole.batchId, items: [reversals[0], { ...reversals[1], version: "stale" }], reason: "Atomic undo test", confirmed: true }), /changed while/);
    assert.equal((await database.select().from(mappings)).length, 2, "Failed partial batch reversal must roll back all rows");
    await mutate({ kind: "Undo", batchId: whole.batchId, items: reversals, reason: "Reverse complete synthetic batch", confirmed: true });
    assert.deepEqual((await database.select().from(mappings)).map(m => [m.sourceEmployeeId, m.employeeId]), [["521", b]]);
    // Complete history is retained and older entries are reachable.
    await database.insert(batches).values(Array.from({ length: 51 }, () => ({ kind: "Restore", actorUserId: actor, reason: "Synthetic pagination fixture" })));
    board = await loadMatchBoard(client); assert.equal(board.history.length, 50); assert.ok(board.historyCursor);
    const older = await loadMatchBoard(client, board.historyCursor!); assert.ok(older.history.length > 0); assert.ok(!older.history.some(b => board.history.some(first => first.id === b.id)));
    console.log("Batch matching SQL checks passed: ID-first suggestions, required name acknowledgment, atomic saves, duplicate/inactive IDs, stale review rejection, partial undo, prior-match restoration, later-edit protection, test-only/restoration, retained exceptions/history, unmapped freshness, posted input preservation, inactive targets and history pagination.");
  } finally { delete process.env.ATTENDANCE_SOURCE_ENABLED; await pg.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

import assert from "node:assert/strict";
import { changesForPunch, removeDraftChanges, upsertPunchChange } from "@/lib/payroll/provisionalPunchEdits";
import { draftVersion, simulateWork, type WorkChange, type WorkDraft, type WorkRecord } from "@/lib/payroll/attendanceWorkbenchModel";
import { batchReviewFixture } from "./attendanceTest/batchReviewFixture";

const { board } = batchReviewFixture();
const person = board.employees[0], day = person.days[0].day, record = person.days[0].records[0];
const empty: WorkDraft = { employeeId: person.id, days: [day], changes: [], reason: "Shared optional note", ownerId: "retained-owner", needed: "Retained context", rejected: false, version: draftVersion(person, [day]), replaces: "saved-plan" };
const change = (patch: Partial<WorkChange> = {}): WorkChange => ({ id: "direction-1", day, kind: "Direction", eventId: record.id, type: "IN", reason: "", evidence: "", verified: false, ...patch });
const checks: string[] = [];
function check(name: string, verify: () => void) { verify(); checks.push(name); }

check("Repeated action retains the first pending value and optional notes", () => {
  const first = change({ type: "OUT", reason: "Supervisor note", evidence: "Optional reference" });
  const draft = upsertPunchChange(empty, first);
  const result = upsertPunchChange(draft, change({ id: "duplicate-click" }));
  assert.deepEqual(result.changes, [first]);
  assert.equal(result.replaces, empty.replaces);
  assert.equal(result.reason, empty.reason);
  assert.equal(result.ownerId, empty.ownerId);
  assert.equal(result.version, empty.version);
  assert.deepEqual(empty.changes, [], "Previous state must remain immutable");
});

check("Restored duplicate actions collapse to the first edit without losing another edit kind", () => {
  const first = change({ type: "OUT", reason: "Retain this note" });
  const time = change({ id: "time-1", kind: "Time", at: "2026-09-30T07:45:31.725" });
  const draft = { ...empty, changes: [first, time, change({ id: "legacy-duplicate" })] };
  const before = structuredClone(draft);
  const result = upsertPunchChange(draft, change({ id: "reselection" }));
  assert.deepEqual(result.changes, [first, time]);
  assert.deepEqual(draft, before);
});

check("Direction and time compose on the same source punch and preserve capture history", () => {
  const direction = change({ type: "IN" });
  const time = change({ id: "time-1", kind: "Time", at: "2026-09-30T07:45:31.725" });
  const draft = upsertPunchChange(upsertPunchChange(empty, direction), time);
  assert.deepEqual(changesForPunch(draft, record, day), [direction, time]);
  const result = simulateWork([record], draft.changes, person.id);
  assert.deepEqual(result.errors, []);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].type, "IN");
  assert.equal(result.records[0].at, "2026-09-29T23:45:31.725Z");
  assert.equal(result.records[0].originalAt, record.originalAt);
  assert.equal(result.records[0].originalType, record.originalType);
});

check("Repeated time selection preserves the entered actual date and seconds", () => {
  const time = change({ id: "time-1", kind: "Time", at: "2026-10-01T00:01:09.125", reason: "Overnight capture" });
  const result = upsertPunchChange({ ...empty, changes: [time] }, change({ id: "time-again", kind: "Time" }));
  assert.deepEqual(result.changes, [time]);
});

check("An action on another punch or workday cannot replace this punch's action", () => {
  const first = change();
  const otherPunch = change({ id: "other-punch", eventId: "different-capture" });
  const otherDay = change({ id: "other-day", day: "2026-10-01" });
  const result = upsertPunchChange(upsertPunchChange({ ...empty, changes: [first] }, otherPunch), otherDay);
  assert.deepEqual(result.changes, [first, otherPunch, otherDay]);
  assert.deepEqual(changesForPunch(result, record, day), [first]);
  assert.deepEqual(changesForPunch(result, record, "2026-10-01"), [otherDay]);
});

check("API event identity takes precedence over a coincident raw-log ID", () => {
  const api: WorkRecord = { ...record, rawLogId: 42 };
  const event = change({ rawLogId: 42 });
  const differentEvent = change({ id: "other-event", eventId: "different-event", rawLogId: 42 });
  const raw = change({ id: "raw-only", eventId: undefined, rawLogId: 42 });
  const draft = { ...empty, changes: [event, differentEvent, raw] };
  assert.deepEqual(changesForPunch(draft, api, day), [event]);
  assert.deepEqual(upsertPunchChange(draft, change({ id: "api-again", rawLogId: 42 })).changes, draft.changes);
});

check("Manual source identity uses an explicit raw-log ID, including zero", () => {
  const manual: WorkRecord = { ...record, id: "manual-0", source: "Manual", rawLogId: 0 };
  const first = change({ eventId: undefined, rawLogId: 0, id: "raw-zero", type: "OUT" });
  const other = change({ eventId: undefined, rawLogId: 1, id: "raw-one" });
  const result = upsertPunchChange({ ...empty, changes: [first, other] }, change({ eventId: undefined, rawLogId: 0, id: "raw-zero-again" }));
  assert.deepEqual(result.changes, [first, other]);
  assert.deepEqual(changesForPunch(result, manual, day), [first]);
  assert.deepEqual(changesForPunch(result, { ...manual, rawLogId: undefined }, day), []);
  assert.deepEqual(changesForPunch(null, manual, day), []);
});

check("Opposite status actions replace only their same-punch, same-day counterpart", () => {
  for (const [previous, next] of [["Void", "Restore"], ["Restore", "Void"], ["Exclude", "Retain"], ["Retain", "Exclude"]] as const) {
    const direction = change();
    const old = change({ kind: previous, id: "old-status" });
    const otherPunch = change({ kind: previous, id: "other-punch-status", eventId: "other-capture" });
    const otherDay = change({ kind: previous, id: "other-day-status", day: "2026-10-01" });
    const replacement = change({ kind: next, id: "new-status" });
    const result = upsertPunchChange({ ...empty, changes: [direction, old, otherPunch, otherDay] }, replacement);
    assert.deepEqual(new Set(result.changes), new Set([direction, otherPunch, otherDay, replacement]));
    assert.equal(result.changes.length, 4);
  }
});

check("Per-edit undo leaves the other edit on the punch and its saved metadata", () => {
  const direction = change();
  const time = change({ id: "time-1", kind: "Time", at: "2026-09-30T07:45:31.725" });
  const draft = { ...empty, changes: [direction, time] };
  const result = removeDraftChanges(draft, [time.id]);
  assert(result);
  assert.deepEqual(result.changes, [direction]);
  assert.deepEqual(result.days, [day]);
  assert.equal(result.version, draft.version);
  assert.equal(result.replaces, draft.replaces);
  assert.equal(draft.changes.length, 2, "Undo must not mutate previous state");
});

check("Undo removes empty day scopes without silently refreshing retained source versions", () => {
  const nextDay = "2026-10-01";
  const first = change();
  const next = change({ id: "next-day", day: nextDay });
  const draft: WorkDraft = { ...empty, days: [day, nextDay], changes: [first, next], version: `${day}:stale-source-version|${nextDay}:retained-source-version` };
  const result = removeDraftChanges(draft, [first.id]);
  assert(result);
  assert.deepEqual(result.days, [nextDay]);
  assert.equal(result.version, `${nextDay}:retained-source-version`);
  assert.deepEqual(result.changes, [next]);
});

check("Undo all pending edits on a punch retains a new punch and edits on other captures", () => {
  const direction = change(), time = change({ id: "time-1", kind: "Time" });
  const other = change({ id: "other-punch", eventId: "other-capture" });
  const manual = change({ id: "new-punch", kind: "Manual", eventId: undefined, at: "2026-09-30T17:00" });
  const draft = { ...empty, changes: [direction, time, other, manual] };
  const result = removeDraftChanges(draft, changesForPunch(draft, record, day).map(value => value.id));
  assert(result);
  assert.deepEqual(result.changes, [other, manual]);
});

check("Undoing the last pending edit returns an empty draft state", () => {
  assert.equal(removeDraftChanges({ ...empty, changes: [change()] }, ["direction-1"]), null);
});

console.log(JSON.stringify({ passed: true, scope: "Pure provisional punch draft transformations; no server or database calls", checks: checks.length, cases: checks }, null, 2));

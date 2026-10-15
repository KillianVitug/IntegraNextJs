import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import type * as FormActions from "@/app/(manager)/managerLeaves/actions";
import type { LeaveFormState, LeaveFormValues } from "@/app/(manager)/managerLeaves/form-state";

async function main() {
  const calls: { operation: string; value: unknown }[] = [];
  let nextId = 100;
  const saved = (operation: string) => async (input: Record<string, unknown>) => {
    calls.push({ operation, value: input });
    return { data: { ...input, id: input.id ? Number(input.id) : nextId++, leaveStatus: "Pending", noOfDays: "1.00", leaveEndDate: input.leaveEndDate || null }, error: null };
  };
  const managerActions = {
    createManagerLeaveRecord: saved("create"), updateManagerLeaveRecord: saved("update"),
    cancelManagerLeaveRecord: async (id: number) => { calls.push({ operation: "cancel", value: id }); return { error: null }; },
    getManagerLeaveBalanceSummary: async (employeeId: string, year: number) => {
      calls.push({ operation: "balance", value: { employeeId, year } });
      return { data: [{ code: "VL", balance: 5, requiresBalance: true }], error: null };
    },
  };
  const filename = path.resolve("src/app/(manager)/managerLeaves/actions.ts"), nativeRequire = createRequire(filename);
  const fixture = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new vm.Script(compiled, { filename }).runInNewContext({ module: fixture, exports: fixture.exports,
    require: (name: string) => name === "@/app/actions/managerAction" ? managerActions : nativeRequire(name), FormData, Error, Date });
  const actions = fixture.exports as typeof FormActions;
  const values: LeaveFormValues = { id: "84", year: "2026", employeeId: "10000000-0000-4000-8000-000000000001",
    leaveType: "VL", dateFiled: "2026-10-15", leaveStartDate: "2026-10-16", leaveEndDate: "", dayPart: "FullDay", reason: "Fictional intent regression" };
  const initial: LeaveFormState = { values, revision: 0 };
  const form = (current = values, revision = 0) => {
    const data = new FormData(); Object.entries(current).forEach(([key, value]) => data.append(key, value)); data.append("formRevision", String(revision)); return data;
  };

  for (const intents of [[], [""], ["unknown"], ["save", "cancel"], ["save", "save"]]) {
    const data = form(); intents.forEach(intent => data.append("intent", intent));
    const result = await actions.submitManagerLeaveForm(initial, data);
    assert.match(result.error ?? "", /Choose an action/); assert.deepEqual(result.values, values);
    assert.equal(calls.length, 0, "missing/unknown/duplicate legacy intents cannot read balances or mutate requests");
  }
  const update = await actions.saveManagerLeaveForm(initial, form());
  assert.equal(update.revision, 1); assert.deepEqual(calls.map(call => call.operation), ["update"]);
  const changed = { ...update.values, reason: "Retain latest text\nacross different actions" };
  const balance = await actions.checkManagerLeaveBalanceForm(initial, form(changed, update.revision));
  assert.equal(balance.revision, 2); assert.deepEqual(balance.values, changed); assert.equal(balance.balance?.leaveType, "VL");
  const cancel = await actions.cancelManagerLeaveForm(initial, form(balance.values, balance.revision));
  assert.equal(cancel.revision, 3); assert.equal(cancel.values.id, ""); assert.match(cancel.message ?? "", /#84 cancelled/);
  assert.deepEqual(calls.map(call => call.operation), ["update", "balance", "cancel"]);
  assert.equal(calls[2].value, 84, "explicit cancel works without a named submitter field and cannot route to save");
  const create = await actions.saveManagerLeaveForm(update, form(cancel.values, cancel.revision));
  assert.equal(create.revision, 4); assert.equal(create.values.id, "100"); assert.equal(calls.at(-1)?.operation, "create");
  const invalid = { ...create.values, leaveEndDate: "2026-10-10", reason: "Retain invalid date and this text" };
  const failure = await actions.saveManagerLeaveForm(create, form(invalid, create.revision));
  assert.equal(failure.revision, 5); assert.match(failure.error ?? "", /on or after/); assert.deepEqual(failure.values, invalid); assert.equal(calls.length, 4);
  const retry = await actions.saveManagerLeaveForm(failure, form({ ...failure.values, leaveEndDate: "" }, failure.revision));
  assert.equal(retry.revision, 6); assert.match(retry.message ?? "", /Pending/); assert.equal(calls.at(-1)?.operation, "update");
  const staleHook = await actions.checkManagerLeaveBalanceForm(initial, form(retry.values, retry.revision));
  assert.equal(staleHook.revision, 7, "a different hook's newer response cannot be hidden behind an earlier result");
  const backwardsPosted = await actions.checkManagerLeaveBalanceForm(staleHook, form(staleHook.values, 1));
  assert.equal(backwardsPosted.revision, 8, "revision never moves behind the responding hook's own prior state");

  const count = calls.length;
  for (const revision of ["", "-1", "1.5", "NaN", "Infinity", " 1 ", String(Number.MAX_SAFE_INTEGER)]) {
    const data = form(); data.set("formRevision", revision);
    const result = await actions.saveManagerLeaveForm(initial, data);
    assert.match(result.error ?? "", /form changed/); assert.equal(calls.length, count);
  }
  const duplicateRevision = form(); duplicateRevision.append("formRevision", "0");
  assert.match((await actions.saveManagerLeaveForm(initial, duplicateRevision)).error ?? "", /form changed/);
  const contradictory = form(); contradictory.set("intent", "save");
  assert.match((await actions.cancelManagerLeaveForm(initial, contradictory)).error ?? "", /Choose an action/);
  assert.equal(calls.length, count, "malformed operation/revision metadata cannot reach business handlers");
  console.log("PASS ManagerLeaveIntent: actual server action dispatch, absent submitter field, strict legacy intents, update/balance/cancel/create/validation/retry sequence, shared monotonic revisions and retained inputs. Fictional handler spies; no database/network/credentials.");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

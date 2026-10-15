import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { eq } from "drizzle-orm";
import { employees, employeesGeneralInfo, employeesLeaveRecords, employeeLeaveApprovalEvents, leaveTypes, leavePolicies, leaveBalanceLedger } from "@/db/schema";
import { freshScheduleDatabase } from "./attendanceTest/freshScheduleDatabase";
import type * as ManagerActions from "@/app/actions/managerAction";
import type * as LeaveDomain from "@/lib/payroll/leave";
import type * as FormActions from "@/app/(manager)/managerLeaves/actions";
import { leaveFormPayload, type LeaveFormState, type LeaveFormValues } from "@/app/(manager)/managerLeaves/form-state";
import { NextRequest } from "next/server";
import { saveLeaveRequestFromRequest, cancelLeaveRequestFromRequest } from "@/app/(manager)/managerLeaves/form-handlers";

function load<T>(relative: string, overrides: Record<string, unknown>): T {
  const filename = path.resolve(relative), nativeRequire = createRequire(filename), fixture = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = (request: string) => Object.hasOwn(overrides, request) ? overrides[request] : nativeRequire(request);
  new vm.Script(compiled, { filename }).runInNewContext({ module: fixture, exports: fixture.exports, require, Date, Map, Set, Promise, Buffer, console, process, FormData, Error, Intl });
  return fixture.exports as T;
}

async function main() {
  const { pg, database, client } = await freshScheduleDatabase();
  const managerId = randomUUID(), employeeA = randomUUID(), employeeB = randomUUID(), outside = randomUUID();
  const allowed = new Set<string>([employeeA, employeeB]);
  const guardCalls: string[] = [];
  const auth = {
    requireManager: async () => ({ accountId: managerId }), getManagerDepartmentIds: async () => [1],
    assertManagerCanAccessEmployee: async (input: { accountId: string; employeeId: string }) => {
      assert.equal(input.accountId, managerId); guardCalls.push(input.employeeId);
      if (!allowed.has(input.employeeId)) throw new Error("Employee is not assigned to one of this manager's departments.");
    },
  };
  const domain = load<typeof LeaveDomain>("src/lib/payroll/leave.ts", { "@/db": { db: client } });
  const actions = load<typeof ManagerActions>("src/app/actions/managerAction.ts", {
    "@/db": { db: client }, "@/lib/payroll/leave": domain, "@/lib/auth/server": auth, "next/cache": { revalidatePath() {} },
  });
  const formActions = load<typeof FormActions>("src/app/(manager)/managerLeaves/actions.ts", { "@/app/actions/managerAction": actions });
  const values: LeaveFormValues = { id: "", year: "2026", employeeId: employeeA, leaveType: "SL", dateFiled: "2026-10-14", leaveStartDate: "2026-10-16", leaveEndDate: "2026-10-17", dayPart: "FullDay", reason: "Fictional personal request" };
  const state: LeaveFormState = { revision: 0, values };
  const form = (current: LeaveFormValues, intent = "save") => {
    const data = new FormData(); for (const [key, value] of Object.entries(current)) data.set(key, value); data.set("intent", intent); return data;
  };
  try {
    for (const [id, name, departmentId] of [[employeeA, "Alpha", 1], [employeeB, "Bravo", 1], [outside, "Outside", 2]] as const) {
      await database.insert(employees).values({ id, employeeNo: name, firstName: name, lastName: "Fictional" });
      await database.insert(employeesGeneralInfo).values({ employeeId: id, departmentId });
    }
    const types = await database.insert(leaveTypes).values([
      { code: "SL", name: "Sick Leave", requiresBalance: true, isPaid: true, annualEntitlement: "5.00" },
      { code: "VL", name: "Vacation Leave", requiresBalance: true, isPaid: true, annualEntitlement: "5.00" },
    ]).returning();
    await database.insert(leavePolicies).values(types.map((type) => ({ leaveTypeId: type.id, grantModel: "Annual" as const })));
    const policiesBefore = await database.select().from(leavePolicies);
    const balanceInput = form(values, "balance"); balanceInput.delete("intent");
    const balance = await formActions.checkManagerLeaveBalanceForm(state, balanceInput);
    assert.equal(balance.balance?.days, 0); assert.equal(balance.error, undefined);
    assert.deepEqual(await database.select().from(leavePolicies), policiesBefore, "balance check cannot seed policies");
    assert.equal((await database.select().from(leaveBalanceLedger)).length, 0, "balance check cannot grant or reserve leave");

    const first = await actions.createManagerLeaveRecord(leaveFormPayload(values));
    assert.equal(first.data.leaveStatus, "Pending"); assert.equal(Number(first.data.noOfDays), 2);
    const retry = await actions.createManagerLeaveRecord(leaveFormPayload(values));
    assert.equal(retry.data.id, first.data.id);
    assert.equal((await database.select().from(employeeLeaveApprovalEvents)).length, 1, "identical retry creates no second submission audit or record");

    const current = { ...values, employeeId: employeeB, leaveType: "VL", reason: "Visible changed person and type" };
    const saveInput = form(current); saveInput.delete("intent"); saveInput.set("formRevision", String(balance.revision));
    const saved = await formActions.saveManagerLeaveForm(state, saveInput);
    assert.equal(saved.error, undefined); assert.equal(saved.values.employeeId, employeeB); assert.equal(saved.values.leaveType, "VL");
    const persisted = await database.query.employeesLeaveRecords.findFirst({ where: eq(employeesLeaveRecords.id, Number(saved.values.id)) });
    assert.equal(persisted?.employeeId, employeeB); assert.equal(persisted?.leaveType, "VL"); assert.match(saved.message ?? "", /Pending/);

    const invalid = { ...current, leaveEndDate: "2026-10-10", reason: "Retain this exact reason\nincluding a second line" };
    const failed = await formActions.submitManagerLeaveForm(saved, form(invalid));
    assert.match(failed.error ?? "", /on or after/); assert.deepEqual(failed.values, invalid);
    const missing = await formActions.submitManagerLeaveForm(state, form({ ...values, employeeId: "", leaveType: "" }));
    assert.match(missing.error ?? "", /Select an employee/);
    assert.equal((await database.select().from(employeesLeaveRecords)).length, 2, "validation errors create no records");

    await assert.rejects(() => actions.createManagerLeaveRecord(leaveFormPayload({ ...values, employeeId: outside })), /not assigned/);
    allowed.delete(employeeA);
    guardCalls.length = 0;
    await assert.rejects(() => actions.updateManagerLeaveRecord({ ...leaveFormPayload(current), id: first.data.id }), /not assigned/);
    assert.ok(guardCalls.includes(employeeA), "cannot take over a formerly managed record by changing its employee");
    allowed.add(employeeA);
    await database.update(employeesLeaveRecords).set({ leaveStatus: "Approved" }).where(eq(employeesLeaveRecords.id, first.data.id));
    await assert.rejects(() => actions.updateManagerLeaveRecord({ ...leaveFormPayload(values), id: first.data.id }), /Only pending/);
    await assert.rejects(() => actions.cancelManagerLeaveRecord(first.data.id), /Only pending/);
    const changed = await actions.updateManagerLeaveRecord({ ...leaveFormPayload({ ...current, reason: "Updated pending request" }), id: Number(saved.values.id) });
    assert.equal(changed.data.reason, "Updated pending request"); assert.equal(changed.data.leaveStatus, "Pending");
    const cancelInput = form({ ...current, id: String(changed.data.id), reason: changed.data.reason ?? "" });
    cancelInput.delete("intent"); cancelInput.set("formRevision", String(saved.revision));
    const cancelled = await formActions.cancelManagerLeaveForm(state, cancelInput);
    assert.match(cancelled.message ?? "", /cancelled/); assert.equal(cancelled.values.id, "");
    assert.equal((await database.query.employeesLeaveRecords.findFirst({ where: eq(employeesLeaveRecords.id, changed.data.id) }))?.leaveStatus, "Cancelled");

    const readback = await actions.getManagerLeaveRecordsByYear(2026);
    assert.equal(readback.length, 2); assert.ok(readback.every((row) => row.canEdit));
    assert.equal((await database.select().from(leaveBalanceLedger)).length, 0, "pending filing/edit/cancel preserves balance ledger");
    await database.delete(leavePolicies).where(eq(leavePolicies.leaveTypeId, types[1].id));
    const noPolicy = await formActions.submitManagerLeaveForm(state, form({ ...current, leaveStartDate: "2026-10-20", leaveEndDate: "" }));
    assert.match(noPolicy.error ?? "", /policy is not configured/);
    assert.equal((await database.select().from(employeesLeaveRecords)).length, 2, "failed policy validation rolls back request and does not seed outside transaction");
    assert.equal((await database.select().from(leavePolicies)).length, 1);
    for (const handler of [saveLeaveRequestFromRequest, cancelLeaveRequestFromRequest]) {
      const request = new NextRequest("http://localhost/managerLeaves/request", { method: "POST", body: form({ ...values, reason: "Keep this reason </textarea><script>bad()</script>" }) });
      const response = await handler(request);
      assert.equal(response.status, 409); assert.equal(response.headers.get("Cache-Control"), "no-store");
      const html = await response.text();
      assert.ok(html.includes("Keep this reason &lt;/textarea&gt;&lt;script&gt;"));
      assert.ok(!html.includes("<script>"));
      assert.equal((await database.select().from(employeesLeaveRecords)).length, 2, "legacy stale hidden-target forms never mutate");
    }
    console.log("PASS manager leave: actual form action + SQL handlers preserve visible target and failed input; explicit selection; scoped original/new employee authorization; identical pending retries reused; read-only balance; pending-only edit/cancel; audited totals; no ledger changes; missing-policy rollback. Fictional in-memory PGlite; auth identity/scope mocked, no production access.");
  } finally { await pg.close(); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });

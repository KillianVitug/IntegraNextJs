import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as schema from "../db/schema";
import * as employeeNo from "../utils/employeeNo";
import * as employeeCode from "../utils/employeeCode";
import * as guard from "../lib/scheduling/profile-schedule-guard";

// Pure rule cases and actual command-boundary execution. Database/auth/framework
// adapters are fictional; this deliberately makes no connection or payroll claim.
const legacy = {
  checkInTime: "08:00:00", checkOutTime: "17:00:00", restDay: "Sunday",
  hoursWorked: "8.00", minutesWorked: "0.00", shiftSchedule: "Regular",
};
let checks = 0;
function allowed(current: Parameters<typeof guard.assertProfileScheduleUnchanged>[0], incoming: Parameters<typeof guard.assertProfileScheduleUnchanged>[1]) {
  guard.assertProfileScheduleUnchanged(current, incoming); checks++;
}
function denied(current: Parameters<typeof guard.assertProfileScheduleUnchanged>[0], incoming: Parameters<typeof guard.assertProfileScheduleUnchanged>[1]) {
  assert.throws(() => guard.assertProfileScheduleUnchanged(current, incoming), guard.ProfileScheduleChangeError); checks++;
}
allowed(legacy, {});
allowed(legacy, { ...legacy, checkInTime: "8:00", checkOutTime: "17:00", hoursWorked: 8, minutesWorked: 0 });
allowed(null, { checkInTime: "", checkOutTime: null, shiftSchedule: null, restDay: "", hoursWorked: "0.00", minutesWorked: 0 });
allowed({ checkInTime: "08:00:30.500" }, { checkInTime: "08:00:30.5" });
denied({ checkInTime: "08:00:30" }, { checkInTime: "08:00" });
for (const [field, value] of Object.entries(legacy)) {
  denied(null, { [field]: field === "minutesWorked" ? 30 : value });
  if (field !== "minutesWorked") denied(legacy, { [field]: null });
}
for (const [field, value] of Object.entries({ checkInTime: "09:00", checkOutTime: "18:00", restDay: "Saturday", hoursWorked: 7, minutesWorked: 30, shiftSchedule: "Flexible" })) {
  denied(legacy, { [field]: value });
}

type Values = Record<string, unknown>;
let current: Values | null = legacy;
let writes = 0;
let events: string[] = [];
class ReachedWrite extends Error { constructor() { super("Fixture reached an allowed write boundary"); } }
const existing = { id: "fixture-employee", employeeNo: "00001", employeeType: "EMP" };
const tx = {
  query: { employeesTimekeeping: { async findFirst() {
    assert.equal(events[0], "payroll lock");
    assert.ok(events.includes("account auth"));
    events.push("read stored timekeeping"); return current;
  } } },
  select() {
    let table: unknown;
    const chain = {
      from(value: unknown) { table = value; return chain; },
      where() { return chain; },
      limit() { return chain; },
      then(resolve: (rows: unknown[]) => unknown) {
        return Promise.resolve(table === schema.employees ? [existing] : []).then(resolve);
      },
    };
    return chain;
  },
  update() { writes++; throw new ReachedWrite(); },
  insert() { writes++; throw new ReachedWrite(); },
};
function load(file: string): Record<string, (...args: unknown[]) => Promise<Values>> {
  const source = readFileSync(path.join(process.cwd(), file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const dependencies: Record<string, unknown> = {
    "drizzle-orm": { eq: () => ({}), and: () => ({}), inArray: () => ({}) },
    "@/db/schema": schema,
    "@/db": { db: { transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } },
    "@/lib/auth/server": { requireAdmin: async () => ({ accountId: "fictional-admin", confidentialityLevel: "Managerial" }) },
    "@/lib/auth/lifecycle": {
      acquireAccountLifecycleLockTx: async () => { events.push("account lock"); },
      assertAccountAdminTx: async () => { events.push("account auth"); },
    },
    "@/lib/payroll/attendanceSourceGuard": { lockAttendancePayrollInput: async () => { events.push("payroll lock"); } },
    "@/lib/scheduling/profile-schedule-guard": guard,
    "@/utils/employeeNo": employeeNo,
    "@/utils/employeeCode": employeeCode,
    "@/lib/safe-action": { actionClient: { metadata() { return this; }, schema() { return this; }, action(callback: unknown) { return callback; } } },
    "@/zod-schemas/employee": {},
    "next-safe-action": {}, "next/cache": {}, "csv-parse/sync": {},
    "@/utils/generateEmployeeNo": {}, "@/lib/payroll/salaryNormalization": {}, "@/lib/payroll/staleRuns": {},
  };
  new vm.Script(compiled, { filename: file }).runInNewContext({
    exports,
    require(name: string) { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; },
    console: { error() {} },
  });
  return exports;
}
function reset(value: Values | null = legacy) { current = value; writes = 0; events = []; }
const save = load("src/app/actions/saveEmployeeAction.ts").saveEmployeeAction;
const importCsv = load("src/app/actions/employeeCSVImport.ts").importEmployeesFromCsv;
const input = { id: existing.id, employeeNo: "00001", firstName: "Fixture", lastName: "Employee" };
const csv = { "Employee No": "00001", "First Name": "Fixture", "Last Name": "Employee" };

async function main() {
  for (const timekeeping of [{ checkInTime: "09:00" }, { hoursWorked: 7 }, { checkInTime: null }]) {
    reset();
    const result = await save({ parsedInput: { ...input, timekeeping } });
    assert.match(String(result.serverError), /Use Schedules \(\/schedules\)/);
    assert.equal(writes, 0);
    assert.deepEqual(events, ["payroll lock", "account lock", "account auth", "read stored timekeeping"]);
    checks++;
  }
  reset(null);
  const newHire = await save({ parsedInput: { ...input, id: undefined, timekeeping: { checkInTime: "08:00" } } });
  assert.match(String(newHire.serverError), /Use Schedules/); assert.equal(writes, 0); checks++;

  for (const timekeeping of [{ timekeepingId: "new-device-id" }, { ...legacy, checkInTime: "08:00", hoursWorked: 8 }]) {
    reset(); await save({ parsedInput: { ...input, timekeeping } });
    assert.equal(writes, 1); checks++;
  }
  reset(null);
  await save({ parsedInput: { ...input, id: undefined, timekeeping: { checkInTime: null, checkOutTime: "", hoursWorked: 0, minutesWorked: 0 } } });
  assert.equal(writes, 1); checks++;

  for (const change of [{ "Check In": "09:00" }, { Hours: "7" }, { "Rest Day": "Saturday" }]) {
    reset();
    await assert.rejects(() => importCsv([{ ...csv, ...change }]), (error: unknown) => {
      const result = error as { errors?: string[] };
      assert.match(result.errors?.[0] ?? "", /Row 2: .*Use Schedules \(\/schedules\)/);
      return true;
    });
    assert.equal(writes, 0);
    assert.deepEqual(events, ["payroll lock", "account lock", "account auth", "read stored timekeeping"]);
    checks++;
  }
  for (const values of [{ "Timekeeping ID": "new-device-id" }, { "Check In": "8:00 AM", Hours: "8.00" }]) {
    reset(); await assert.rejects(() => importCsv([{ ...csv, ...values }]), ReachedWrite);
    assert.equal(writes, 1); checks++;
  }
  reset(null);
  await assert.rejects(() => importCsv([{ ...csv, "Employee No": "00002", "Check In": "08:00" }]), (error: unknown) => {
    assert.match((error as { errors: string[] }).errors[0], /Row 2: .*Use Schedules/);
    return true;
  });
  assert.equal(writes, 0); checks++;
  reset(null);
  await assert.rejects(() => importCsv([{ ...csv, "Employee No": "00002", Hours: "0", Minutes: "0", "Check In": "" }]), ReachedWrite);
  assert.equal(writes, 1); checks++;
  console.log(`PASS profile schedule guard: ${checks} fictional rule/actual-handler cases; stored values read under shared lock; CRUD and CSV reject fallback edits before writes; unchanged values and metadata reach the write boundary. No database, full-save, rollback or production acceptance claimed.`);
}
void main();

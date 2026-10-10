import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as dates from "date-fns";
import * as orm from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { resolveEmployeeScheduleForDate, type ShiftAssignmentRecord, type LegacyTimekeepingRecord, type WeeklyShiftPatternRecord } from "@/lib/payroll/scheduleResolver";
import type * as ActualHelpers from "@/app/actions/shiftAssignmentHelpers";

const employeeId = "00000000-0000-4000-8000-000000000001";
const day = "2098-10-15", previous = "2098-10-14", next = "2098-10-16";
type RawLog = { logDate: string; logTime: string; direction: "IN" | "OUT" };
let assignments: ShiftAssignmentRecord[] = [], patterns: WeeklyShiftPatternRecord[] = [];
let timekeeping: LegacyTimekeepingRecord = null;
let logs: RawLog[] = [];
let reads: Array<{ employeeIds: string[]; startDate: string; endDate: string; neighborDays: string }> = [];
let locks: string[] = [];
const denied = new Proxy({}, { get(_target, property) { throw new Error(`Unexpected imported boundary ${String(property)}`); } });
const dialect = new PgDialect();
const tx = {
  select() { return { from(table: unknown) { assert.equal(table, schema.employeeShiftAssignments); return { where() { return Promise.resolve(assignments); } }; } }; },
  query: { employeeWeeklyShiftPatterns: { findMany: async () => patterns }, employeesTimekeeping: { findFirst: async () => timekeeping } },
  execute: async (statement: orm.SQL) => { locks.push(dialect.sqlToQuery(statement).sql); },
} as unknown as Parameters<typeof ActualHelpers.withOvernightScheduleBoundary>[0];

// The actual helper functions execute against synthetic rows. Real pure resolver,
// date arithmetic and SQL expressions are retained; DB and network are unavailable.
function loadHelpers() {
  const file = "src/app/actions/shiftAssignmentHelpers.ts";
  const compiled = ts.transpileModule(readFileSync(path.join(process.cwd(), file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const require = (name: string) => {
    if (name === "date-fns") return dates;
    if (name === "drizzle-orm") return orm;
    if (name === "@/db/schema") return schema;
    if (name === "@/lib/payroll/scheduleResolver") return { resolveEmployeeScheduleForDate };
    if (name === "@/lib/payroll/attendanceSourceGuard") return { lockAttendancePayrollInput: async () => { locks.push("global attendance/payroll lock"); } };
    if (name === "@/lib/payroll/effectiveAttendanceInputs") return { loadEffectiveAttendanceRawLogs: async (_tx: unknown, range: typeof reads[number]) => { assert.equal(_tx, tx); reads.push(range); return logs.filter(log => log.logDate >= range.startDate && log.logDate <= range.endDate); } };
    return denied;
  };
  new vm.Script(compiled, { filename: file }).runInNewContext({ exports, require });
  return exports as typeof ActualHelpers;
}
const helpers = loadHelpers();
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function assignment(id: number, date: string, start = "08:00", end = "17:00", policy: "legacy" | "eight_hour_day" = "legacy"): ShiftAssignmentRecord {
  return { id, employeeId, shiftTableId: null, shiftName: "Fictional", shiftCode: null, shiftSchedule: null, effectiveFrom: date, effectiveTo: date, checkInTime: start, checkOutTime: end, breakMinutes: 0, paidBreakMinutes: 0, graceMinutes: 0, restDay: null, hoursPerDay: "8.00", isFlexible: false, calculationPolicy: policy, punchPolicy: "outer", confirmedSchedule: null, scheduleDecisionId: null, createdAt: new Date(0), updatedAt: new Date(0) };
}
function reset() { assignments = []; patterns = []; timekeeping = null; logs = []; reads = []; locks = []; }
const boundary = (extra: Partial<Parameters<typeof ActualHelpers.withOvernightScheduleBoundary>[1]> = {}) => helpers.withOvernightScheduleBoundary(tx, { employeeId, range: { startDate: day, endDate: day }, ...extra });

async function main() {
  const finite = { effectiveFrom: day, effectiveTo: day };
  assert.deepEqual(plain(helpers.getAffectedScheduleRange({ nextAssignment: finite })), { startDate: day, endDate: day });
  assert.deepEqual(plain(helpers.getAffectedScheduleRange({ existingRecord: finite })), { startDate: day, endDate: day });
  assert.deepEqual(plain(helpers.getAffectedScheduleRange({ existingRecord: finite, nextAssignment: { effectiveFrom: next, effectiveTo: "2098-10-20" } })), { startDate: day, endDate: "2098-10-20" });
  assert.equal(helpers.getAffectedScheduleRange({ existingRecord: finite, nextAssignment: { effectiveFrom: next, effectiveTo: null } }).endDate, null);
  assert.equal(helpers.getAffectedScheduleRange({ existingRecord: { effectiveFrom: day, effectiveTo: null }, nextAssignment: finite }).endDate, null);
  assert.deepEqual(plain(helpers.getAffectedScheduleRange({})), { startDate: null, endDate: null });
  reset(); assignments = [assignment(1, day)];
  assert.deepEqual(plain(await boundary()), { startDate: day, endDate: day }, "Daytime changes must not guard unrelated adjacent days");
  assert.equal(reads.length, 0, "Legacy daytime boundaries need no raw log query");
  assignments = [assignment(1, day, "22:00", "06:00")];
  assert.deepEqual(plain(await boundary()), { startDate: day, endDate: next });
  reset(); assignments = [assignment(1, day)];
  assert.deepEqual(plain(await boundary({ nextWindow: { checkInTime: "22:00", checkOutTime: "06:00" } })), { startDate: day, endDate: next });
  reset(); assignments = [assignment(1, day), assignment(2, previous)];
  timekeeping = { checkInTime: "22:00", checkOutTime: "06:00", hoursWorked: "8.00", restDay: null } as LegacyTimekeepingRecord;
  assert.deepEqual(plain(await boundary({ removedAssignmentIds: [1] })), { startDate: day, endDate: next }, "Deleting daytime override must cover the revealed overnight default");
  reset(); assignments = [assignment(1, previous, "22:00", "06:00"), assignment(2, day)];
  assert.deepEqual(plain(await boundary()), { startDate: previous, endDate: day }, "Include the preceding overnight day whose OUT ownership can change");
  assert.deepEqual(plain(await boundary({ range: { startDate: day, endDate: null } })), { startDate: previous, endDate: null });
  reset(); assignments = [assignment(1, day, "08:00", "17:00", "eight_hour_day")];
  logs = [{ logDate: day, logTime: "08:00:00", direction: "IN" }, { logDate: next, logTime: "01:00:00", direction: "OUT" }];
  assert.deepEqual(plain(await boundary()), { startDate: day, endDate: next }, "Explicit daytime schedule with actual after-midnight OUT also spans the next date");
  assert.deepEqual(plain(reads), [{ employeeIds: [employeeId], startDate: day, endDate: next, neighborDays: "none" }], "Raw log read remains employee-scoped and bounded to the two boundary dates");
  logs = [{ logDate: day, logTime: "17:00:00", direction: "OUT" }, { logDate: next, logTime: "01:00:00", direction: "OUT" }];
  assert.deepEqual(plain(await boundary()), { startDate: day, endDate: day }, "Unpaired following OUT must not create adjacency");
  logs = [{ logDate: day, logTime: "08:00:00", direction: "IN" }, { logDate: next, logTime: "09:00:00", direction: "OUT" }];
  assert.deepEqual(plain(await boundary()), { startDate: day, endDate: day }, "Following OUT after the next start is not borrowed from that date");
  reset(); assignments = [assignment(1, previous, "08:00", "17:00", "eight_hour_day"), assignment(2, day)];
  logs = [{ logDate: previous, logTime: "08:00:00", direction: "IN" }, { logDate: day, logTime: "01:00:00", direction: "OUT" }];
  assert.deepEqual(plain(await boundary()), { startDate: previous, endDate: day });
  reset(); await helpers.lockShiftAssignmentContext(tx, employeeId);
  assert.equal(locks.length, 4); assert.equal(locks[0], "global attendance/payroll lock");
  assert.match(locks[1], /from employees.*for update/); assert.match(locks[2], /employee_shift_assignments.*for update/); assert.match(locks[3], /employee_weekly_shift_patterns.*for update/);
  console.log("PASS legacy schedule boundaries: finite create/delete and open ranges, current/revealed/new and preceding overnight, bounded explicit after-midnight logs, daytime exact scope and global-before-row locks");
}
void main();

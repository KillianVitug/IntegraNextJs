import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { NeonPreparedQuery } from "drizzle-orm/neon-serverless/session";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  adminAuditEvents, attendanceDailySummaries, authAccountPermissionGroups,
  authAccounts, authManagerDepartments, authPermissionGroups, authSessions,
  department, employeeAttendanceDayMetricOverrides, employeePayrollExceptionRows,
  employees, employeesGeneralInfo, employeesSalary, payrollPeriods,
  payrollRunEmployees, payrollRunLines, payrollRuns,
} from "@/db/schema";

// Actual calculator and actual authenticated manager metric action against an
// isolated restore. Scheduling pauses happen only after real database queries.
const mode = process.env.P2A_TEST_MODE ?? "test";
assert.ok(["baseline", "test"].includes(mode));
const destination = new URL(process.env.DATABASE_URL ?? "");
assert.equal(destination.hostname, "127.0.0.1");
assert.match(destination.pathname, /_p2a$/);
assert.ok(process.env.PAYROLL_LOCAL_REHEARSAL_PROXY_PORT);
const lane = new AsyncLocalStorage<string>();
const token = randomUUID();
const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (request, ...args) {
  if (request === "next/headers") return {
    cookies: async () => ({ get: () => ({ value: token }) }),
    headers: async () => new Headers(),
  };
  if (request === "next/cache") return { revalidatePath() {} };
  return originalLoad.call(this, request, ...args);
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
type Barrier = {
  lane: string; matches: (query: string) => boolean; used: boolean;
  reached: ReturnType<typeof deferred>; release: ReturnType<typeof deferred>;
};
let barrier: Barrier | null = null;
const originalExecute = NeonPreparedQuery.prototype.execute;
NeonPreparedQuery.prototype.execute = async function (...args) {
  const result = await originalExecute.apply(this, args);
  const query = (this as unknown as { queryConfig: { text: string } }).queryConfig.text;
  const active = barrier;
  if (active && !active.used && lane.getStore() === active.lane && active.matches(query)) {
    active.used = true;
    active.reached.resolve();
    await active.release.promise;
  }
  return result;
};
function pauseAfter(laneName: string, matches: Barrier["matches"]) {
  assert.equal(barrier, null);
  barrier = { lane: laneName, matches, used: false, reached: deferred(), release: deferred() };
  return barrier;
}
async function bounded<T>(promise: Promise<T>, label: string, ms = 45_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function waitForFinancialLock() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`select count(*)::int as waiting from pg_locks where locktype='advisory' and objid=73612849 and not granted and database=(select oid from pg_database where datname=current_database())`);
    if (Number(result.rows[0]?.waiting) > 0) return;
    await delay(20);
  }
  throw new Error("Competing command never waited on the actual financial advisory lock");
}
const employeeId = randomUUID(), accountId = randomUUID(), periodId = randomUUID();
const numericId = -3_000_000 - Math.floor(Math.random() * 1_000_000);
const tag = `P2AC-${randomUUID().slice(0, 8)}`;
const date = "2099-09-16";
const restoredTables: string[] = [];
const checks: Array<Record<string, unknown>> = [];
async function fingerprint() {
  if (!restoredTables.length) {
    const result = await db.execute(sql`select tablename from pg_tables where schemaname='public' order by tablename`);
    restoredTables.push(...result.rows.map(row => String(row.tablename)));
  }
  return (await db.execute(sql.raw(restoredTables.map(table => {
    assert.match(table, /^[A-Za-z_][A-Za-z0-9_]*$/);
    return `select '${table}' as name,count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as hash from "${table}" t`;
  }).join(" union all ")))).rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
async function resultAmounts() {
  const run = await db.query.payrollRuns.findFirst({ where: eq(payrollRuns.payrollPeriodId, periodId) });
  assert.ok(run);
  const [employee] = await db.select().from(payrollRunEmployees).where(and(eq(payrollRunEmployees.payrollRunId, run.id), eq(payrollRunEmployees.employeeId, employeeId)));
  assert.ok(employee);
  const lines = await db.select({ code: payrollRunLines.code, amount: payrollRunLines.amount, quantity: payrollRunLines.quantity }).from(payrollRunLines).where(eq(payrollRunLines.payrollRunEmployeeId, employee.id));
  return { status: run.status, gross: employee.grossPay, deductions: employee.totalDeductions, net: employee.netPay, lines: lines.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
}
async function main() {
  const before = await fingerprint();
  let preserved = false;
  try {
    const [{ saveManagerAttendanceDtrDayMetricOverrideAction: metric }, { createOrRecomputePayrollRun: compute }, { attendancePayrollSnapshot }] = await Promise.all([
      import("@/app/actions/attendanceImportAction"), import("@/lib/payroll/engine"), import("@/lib/payroll/attendanceSourceGuard"),
    ]);
    const [group] = await db.select().from(authPermissionGroups).where(eq(authPermissionGroups.key, "MANAGER"));
    assert.ok(group);
    await db.insert(department).values({ id: numericId, code: tag, name: tag });
    await db.insert(employees).values({ id: employeeId, employeeNo: tag, firstName: "Fictional", lastName: "P2A compute", employeeType: "EMP" });
    await db.insert(employeesGeneralInfo).values({ id: numericId, employeeId, departmentId: numericId, employmentStatus: "Regular", payrollTerms: "Semi-Monthly", dateHired: "2099-01-01" });
    await db.insert(employeesSalary).values({ id: numericId, employeeId, dailyRate: "800.0000", ignoreContributionDeduction: true });
    await db.insert(authAccounts).values({ id: accountId, employeeId, email: `${tag.toLowerCase()}@fixture.invalid`, status: "Active", mustSetPassword: false });
    await db.insert(authAccountPermissionGroups).values({ accountId, groupId: group.id });
    await db.insert(authManagerDepartments).values({ accountId, departmentId: numericId });
    await db.insert(authSessions).values({ accountId, sessionTokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 30 * 60_000) });
    await db.insert(payrollPeriods).values({ id: periodId, code: tag, year: 2099, month: 9, cycle: "B", payrollTerms: "Semi-Monthly", startDate: date, endDate: "2099-09-30", nominalPayDate: "2099-10-05", adjustedPayDate: "2099-10-05", status: "Open" });
    await db.insert(attendanceDailySummaries).values({ employeeId, attendanceDate: date, scheduledInTime: "08:00", scheduledOutTime: "17:00", scheduledMinutes: 480, workedMinutes: 480, regularMinutes: 480, firstInAt: new Date(`${date}T00:00:00Z`), lastOutAt: new Date(`${date}T09:00:00Z`) });
    const saveMetric = (minutes: number) => metric({ payrollPeriodId: periodId, employeeId, attendanceDate: date, lateMinutes: minutes, undertimeMinutes: 0, overtimeMinutes: 0 });
    const calculate = () => compute(periodId, accountId, { payrollGroup: "Daily", bypassTemporaryReadinessCategories: true });
    const reset = async () => {
      const result = await saveMetric(0);
      assert.equal(result.payrollRecompute.status, "computed", result.payrollRecompute.message);
      return resultAmounts();
    };
    const original = await reset();
    assert.equal(original.status, "Draft");
    const sourceSnapshot = await attendancePayrollSnapshot(db, periodId);
    const expectedResult = await saveMetric(60);
    assert.equal(expectedResult.payrollRecompute.status, "computed", expectedResult.payrollRecompute.message);
    const expected = await resultAmounts();
    assert.notEqual(expected.net, original.net, "Fictional late-minute correction must materially change actual computed net pay");
    assert.equal(await attendancePayrollSnapshot(db, periodId), sourceSnapshot, "Source snapshot alone does not include manager metric/generated-pay changes");
    assert.deepEqual(await reset(), original);

    // Compute has already loaded old generated rows. On the baseline, the
    // manager's entire actual action (including its recomputation) can finish
    // before that earlier computation overwrites the new amounts as Draft.
    const gate = pauseAfter("compute", query => /^select /i.test(query) && / from "employee_payroll_exception_rows" /i.test(query));
    const computing = lane.run("compute", calculate);
    let manager: ReturnType<typeof saveMetric> | undefined;
    try {
      await bounded(gate.reached.promise, "calculator loaded old manager-generated rows");
      manager = lane.run("manager", () => saveMetric(60));
      if (mode === "baseline") {
        const update = await bounded(manager, "manager save and recomputation before original compute");
        assert.equal(update.payrollRecompute.status, "computed", update.payrollRecompute.message);
        assert.deepEqual(await resultAmounts(), expected);
      } else {
        await waitForFinancialLock();
      }
      gate.release.resolve();
      await bounded(computing, "original computation commits");
      const update = await bounded(manager, "manager save and recomputation finishes");
      assert.equal(update.payrollRecompute.status, "computed", update.payrollRecompute.message);
      const after = await resultAmounts();
      const [override] = await db.select().from(employeeAttendanceDayMetricOverrides).where(eq(employeeAttendanceDayMetricOverrides.payrollPeriodId, periodId));
      assert.equal(override?.lateMinutes, 60, "New manager input persists");
      assert.equal(await attendancePayrollSnapshot(db, periodId), sourceSnapshot);
      if (mode === "baseline") {
        assert.deepEqual(after, original, "Baseline reproduces old Draft amounts overriding saved manager correction");
        checks.push({ case: "baseline-compute-loaded-before-manager-save", reproduced: true, managerLateMinutes: 60, expectedPay: expected, incorrectlyStoredPay: after, snapshotUnchanged: true });
      } else {
        assert.deepEqual(after, expected, "Latest committed manager inputs remain reflected in Draft payroll");
        checks.push({ case: "compute-first-manager-waits", passed: true, lockWaitObserved: true, managerLateMinutes: 60, actualPay: after });
      }
    } finally {
      gate.release.resolve();
      await computing.catch(() => undefined);
      await manager?.catch(() => undefined);
      barrier = null;
    }

    if (mode === "test") {
      assert.deepEqual(await reset(), original);
      const managerGate = pauseAfter("manager", query => /^insert into "employee_attendance_day_metric_overrides" /i.test(query));
      const updating = lane.run("manager", () => saveMetric(60));
      let calculating: ReturnType<typeof calculate> | undefined;
      try {
        await bounded(managerGate.reached.promise, "manager input written under lock before commit");
        calculating = lane.run("compute", calculate);
        await waitForFinancialLock();
        managerGate.release.resolve();
        const update = await bounded(updating, "manager-first action finishes");
        assert.equal(update.payrollRecompute.status, "computed", update.payrollRecompute.message);
        await bounded(calculating, "competing calculator reads committed manager input");
        assert.deepEqual(await resultAmounts(), expected);
        checks.push({ case: "manager-first-compute-waits", passed: true, lockWaitObserved: true, actualPay: await resultAmounts() });
      } finally {
        managerGate.release.resolve();
        await updating.catch(() => undefined);
        await calculating?.catch(() => undefined);
        barrier = null;
      }
    }
    const inputRows = await db.select().from(employeePayrollExceptionRows).where(eq(employeePayrollExceptionRows.payrollPeriodId, periodId));
    assert.ok(inputRows.length > 0, "Actual generated manager-payroll inputs were exercised");
  } finally {
    barrier?.release.resolve();
    barrier = null;
    await db.delete(adminAuditEvents).where(eq(adminAuditEvents.actorUserId, accountId));
    await db.delete(payrollPeriods).where(eq(payrollPeriods.id, periodId));
    await db.delete(employees).where(eq(employees.id, employeeId));
    await db.delete(department).where(eq(department.id, numericId));
    assert.deepEqual(await fingerprint(), before, "Every restored table must be exact after fixture cleanup");
    preserved = true;
    const outputDirectory = process.env.P2A_REPORT_DIRECTORY ?? path.resolve("tmp/p2a-concurrency");
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(path.join(outputDirectory, `${mode}-compute-acceptance.json`), JSON.stringify({ mode, checks, tableCount: restoredTables.length, restoredTableRowsExact: preserved, actualManagerMetricAction: true, actualPayrollCalculator: true, requestAdapterOnly: true, productionAccess: false }, null, 2));
    NeonPreparedQuery.prototype.execute = originalExecute;
    loader._load = originalLoad;
  }
  console.log(JSON.stringify({ mode, checks: checks.length, passed: true, restoredTablesExact: restoredTables.length }));
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

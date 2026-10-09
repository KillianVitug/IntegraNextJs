import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { NeonPreparedQuery } from "drizzle-orm/neon-serverless/session";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  adminAuditEvents, attendanceDailySummaries, attendanceDtrHoldApprovals, attendanceImportBatches, attendanceRawLogs, authAccountPermissionGroups, authAccounts,
  authManagerDepartments, authPermissionGroups, authSessions, department,
  employeeAttendanceDayMetricOverrides, employees, employeesGeneralInfo, employeesSalary, payrollPeriods, payrollRunEmployees,
  payrollRunEvents, payrollRunLines, payrollRuns,
} from "@/db/schema";

// Restored database acceptance only. Business commands, sessions, permissions,
// transactions and status transitions below are real. Only Next request/caching
// adapters and query scheduling are supplied by this test process.
const mode = process.env.P2A_TEST_MODE ?? "test";
assert.ok(["baseline", "test"].includes(mode));
const destination = new URL(process.env.DATABASE_URL ?? "");
assert.equal(destination.hostname, "127.0.0.1");
assert.match(destination.pathname, /_p2a$/);
assert.ok(process.env.PAYROLL_LOCAL_REHEARSAL_PROXY_PORT);
const lane = new AsyncLocalStorage<string>();
let sessionToken: string | null = null;
const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (request, ...args) {
  if (request === "next/headers") return {
    cookies: async () => ({ get: () => sessionToken ? { value: sessionToken } : undefined }),
    headers: async () => new Headers(),
  };
  if (request === "next/cache") return { revalidatePath() {} };
  return originalLoad.call(this, request, ...args);
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
type Barrier = {
  lane: string; matches: (query: string) => boolean;
  reached: ReturnType<typeof deferred>; release: ReturnType<typeof deferred>;
  used: boolean;
};
let barrier: Barrier | null = null;
let injectedFailure: { lane: string; matches: (query: string) => boolean; used: boolean; repeat?: boolean } | null = null;
const originalExecute = NeonPreparedQuery.prototype.execute;
NeonPreparedQuery.prototype.execute = async function (...args) {
  const result = await originalExecute.apply(this, args);
  const query = (this as unknown as { queryConfig: { text: string } }).queryConfig.text;
  if (injectedFailure && (!injectedFailure.used || injectedFailure.repeat) && lane.getStore() === injectedFailure.lane && injectedFailure.matches(query)) {
    injectedFailure.used = true;
    throw new Error("Synthetic P2a failure after actual input write");
  }
  const active = barrier;
  if (active && !active.used && lane.getStore() === active.lane && active.matches(query)) {
    active.used = true;
    active.reached.resolve();
    await active.release.promise;
  }
  return result;
};
const checks: Array<Record<string, unknown>> = [];
const fixtures: Array<{ periodId: string; runId: string }> = [];
const batchIds: string[] = [];
const employeeId = randomUUID(), accountId = randomUUID();
const payrollActorEmployeeId = randomUUID(), payrollActorId = randomUUID();
const departmentId = -1_000_000 - Math.floor(Math.random() * 1_000_000);
const tag = `P2A-${randomUUID().slice(0, 8)}`;
const employeeNo = `99${Date.now()}${Math.floor(Math.random() * 1000)}`;
const restoredTableNames: string[] = [];

async function fingerprint() {
  if (!restoredTableNames.length) {
    const result = await db.execute(sql`select tablename from pg_tables where schemaname='public' order by tablename`);
    restoredTableNames.push(...result.rows.map(row => String(row.tablename)));
  }
  const result = await db.execute(sql.raw(restoredTableNames.map(table => {
    assert.match(table, /^[A-Za-z_][A-Za-z0-9_]*$/);
    return `select '${table}' as name,count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as hash from "${table}" t`;
  }).join(" union all ")));
  return result.rows.sort((left, right) => String(left.name).localeCompare(String(right.name)));
}
async function bounded<T>(promise: Promise<T>, description: string, ms = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
function pauseAfter(laneName: string, matches: Barrier["matches"]) {
  assert.equal(barrier, null);
  barrier = { lane: laneName, matches, reached: deferred(), release: deferred(), used: false };
  return barrier;
}
async function waitForFinancialLock() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`select count(*)::int as waiting from pg_locks where locktype='advisory' and objid=73612849 and not granted and database=(select oid from pg_database where datname=current_database())`);
    if (Number(result.rows[0]?.waiting) > 0) return;
    await delay(20);
  }
  throw new Error("No competing command observed waiting for the actual financial advisory lock");
}
async function fixture() {
  const periodId = randomUUID(), runId = randomUUID();
  fixtures.push({ periodId, runId });
  await db.insert(payrollPeriods).values({
    id: periodId, code: `${tag}-${fixtures.length}`, year: 2099, month: 9, cycle: "B",
    payrollTerms: "Semi-Monthly", startDate: "2099-09-16", endDate: "2099-09-30",
    nominalPayDate: "2099-10-05", adjustedPayDate: "2099-10-05", status: "Open",
  });
  await db.insert(payrollRuns).values({
    id: runId, payrollPeriodId: periodId, status: "Reviewed", inputSnapshot: { payrollGroup: "Daily" },
    reviewedAt: new Date(), reviewedByUserId: accountId,
  });
  const [person] = await db.insert(payrollRunEmployees).values({
    payrollRunId: runId, employeeId, employeeNoSnapshot: employeeNo, employeeNameSnapshot: "Fictional concurrency fixture",
    grossPay: "1000.00", totalDeductions: "100.00", netPay: "900.00",
  }).returning({ id: payrollRunEmployees.id });
  await db.insert(payrollRunLines).values([
    { payrollRunEmployeeId: person.id, lineType: "Earning", code: "P2A-FIXTURE", description: "Fictional earnings", amount: "1000.00" },
    { payrollRunEmployeeId: person.id, lineType: "Deduction", code: "P2A-FIXTURE-DED", description: "Fictional deductions", amount: "100.00" },
  ]);
  const { attendancePayrollSnapshot } = await import("@/lib/payroll/attendanceSourceGuard");
  await db.insert(payrollRunEvents).values({
    payrollRunId: runId, actorUserId: accountId, eventType: "Computed",
    notes: JSON.stringify({ attendanceSourceInputRunId: await attendancePayrollSnapshot(db, periodId) }),
  });
  return { periodId, runId };
}
async function runState(runId: string) {
  return db.query.payrollRuns.findFirst({ where: eq(payrollRuns.id, runId) });
}
async function runEvidence(runId: string) {
  return {
    run: await runState(runId),
    employees: await db.select().from(payrollRunEmployees).where(eq(payrollRunEmployees.payrollRunId, runId)),
    events: await db.select().from(payrollRunEvents).where(eq(payrollRunEvents.payrollRunId, runId)).orderBy(payrollRunEvents.id),
  };
}
async function main() {
  const before = await fingerprint();
  let preserved = false;
  try {
    const [{ markManagerDtrPayrollStaleAction: stale, saveManagerAttendanceDtrDayMetricOverrideAction: metric, submitManagerAttendanceDtrHoldRowsAction: hold, importManagerDtrLogsAction: importLogs, revertManagerDtrImportBatchAction: removeBatch, refreshManagerAttendancePeriodSummariesAction: refresh, syncManagerDtrPayrollPeriodAction: sync }, { transitionPayrollRunStatus: transition }] = await Promise.all([
      import("@/app/actions/attendanceImportAction"), import("@/lib/payroll/engine"),
    ]);
    const [managerGroup] = await db.select().from(authPermissionGroups).where(eq(authPermissionGroups.key, "MANAGER"));
    const [adminGroup] = await db.select().from(authPermissionGroups).where(eq(authPermissionGroups.key, "SYSTEM_ADMIN"));
    assert.ok(managerGroup, "Restored Manager permission group must exist");
    assert.ok(adminGroup, "Restored System Admin permission group must exist");
    sessionToken = randomUUID();
    await db.insert(department).values({ id: departmentId, code: tag, name: tag });
    await db.insert(employees).values({ id: employeeId, employeeNo, firstName: "Fictional", lastName: "P2A" });
    await db.insert(employeesGeneralInfo).values({ id: departmentId, employeeId, departmentId, employmentStatus: "Regular", payrollTerms: "Semi-Monthly", dateHired: "2099-01-01" });
    await db.insert(employeesSalary).values({ id: departmentId, employeeId, dailyRate: "1000.00", ignoreContributionDeduction: true });
    await db.insert(authAccounts).values({ id: accountId, employeeId, email: `${tag.toLowerCase()}@fixture.invalid`, status: "Active", mustSetPassword: false });
    await db.insert(authAccountPermissionGroups).values({ accountId, groupId: managerGroup.id });
    await db.insert(authManagerDepartments).values({ accountId, departmentId });
    await db.insert(authSessions).values({ accountId, sessionTokenHash: createHash("sha256").update(sessionToken).digest("hex"), expiresAt: new Date(Date.now() + 60_000 * 30) });
    await db.insert(employees).values({ id: payrollActorEmployeeId, employeeType: "ADMIN", employeeNo: `${tag}-ADMIN`, firstName: "Fictional", lastName: "P2A Payroll" });
    await db.insert(authAccounts).values({ id: payrollActorId, employeeId: payrollActorEmployeeId, email: `${tag.toLowerCase()}-admin@fixture.invalid`, status: "Active", mustSetPassword: false });
    await db.insert(authAccountPermissionGroups).values({ accountId: payrollActorId, groupId: adminGroup.id });
    const move = (runId: string, status: "Approved" | "Posted") => transition(runId, status, payrollActorId, "Fictional P2a acceptance", db, { actorRole: "ADMIN" });
    const staleSelect = (query: string) => /^select "id", "status" from "payroll_runs"/i.test(query);

    if (mode === "baseline") {
      for (const target of ["Approved", "Posted"] as const) {
        const { periodId, runId } = await fixture();
        const gate = pauseAfter("manager", staleSelect);
        const manager = lane.run("manager", () => stale(periodId));
        try {
          await bounded(gate.reached.promise, "manager selected Reviewed run");
          await bounded(move(runId, "Approved"), "concurrent real approval");
          if (target === "Posted") await bounded(move(runId, "Posted"), "concurrent real posting");
          assert.equal((await runState(runId))?.status, target);
          gate.release.resolve();
          await bounded(manager, "manager stale action completes");
          const after = await runState(runId);
          assert.equal(after?.status, "Stale", "Baseline must demonstrate protected status overwritten");
          assert.equal(after.approvedAt, null);
          assert.equal(after.approvedByUserId, null);
          if (target === "Posted") assert.ok(after.postedAt, "Posting metadata survives despite contradictory Stale status");
          checks.push({ case: `baseline-manager-select-then-${target.toLowerCase()}`, reproduced: true, protectedStatusBeforeResume: target, statusAfterResume: after.status, approvalMetadataCleared: true, actualActions: true });
        } finally { gate.release.resolve(); await manager.catch(() => undefined); barrier = null; }
      }
    } else {
      // Manager gets the lock first: a later real approval waits, then sees
      // Stale and is rejected. Waiting is verified in PostgreSQL, not by sleep.
      {
        const { periodId, runId } = await fixture();
        const gate = pauseAfter("manager", staleSelect);
        const manager = lane.run("manager", () => stale(periodId));
        let financial: Promise<{ error: unknown }> | undefined;
        try {
          await bounded(gate.reached.promise, "manager holds lock after run selection");
          financial = lane.run("financial", () => move(runId, "Approved")).then(() => ({ error: null }), error => ({ error }));
          await waitForFinancialLock();
          gate.release.resolve();
          await bounded(manager, "manager stale commit");
          const result = await bounded(financial, "approval observes new state");
          assert.ok(result.error instanceof Error);
          assert.match(result.error.message, /Stale|transition|recompute/i);
          assert.equal((await runState(runId))?.status, "Stale");
          const events = await db.select().from(payrollRunEvents).where(and(eq(payrollRunEvents.payrollRunId, runId), inArray(payrollRunEvents.eventType, ["Approved", "Posted"])));
          assert.equal(events.length, 0);
          const unchanged = await runEvidence(runId);
          await stale(periodId);
          assert.deepEqual(await runEvidence(runId), unchanged, "Already-stale retry must not add duplicate events");
          checks.push({ case: "manager-first-approval-waits-then-rejects", passed: true, lockWaitObserved: true, repeatedStaleIdempotent: true });
        } finally { gate.release.resolve(); await manager.catch(() => undefined); await financial; barrier = null; }
      }
      for (const target of ["Approved", "Posted"] as const) {
        const { periodId, runId } = await fixture();
        if (target === "Posted") await move(runId, "Approved");
        const gate = pauseAfter("financial", query => /^update "payroll_runs" set /i.test(query));
        const financial = lane.run("financial", () => move(runId, target));
        let manager: Promise<{ error: unknown }> | undefined;
        try {
          await bounded(gate.reached.promise, `real ${target} update before commit`);
          manager = lane.run("manager", () => stale(periodId)).then(() => ({ error: null }), error => ({ error }));
          await waitForFinancialLock();
          gate.release.resolve();
          await bounded(financial, `${target} commit`);
          const protectedEvidence = await runEvidence(runId);
          const result = await bounded(manager, "manager sees committed financial state");
          assert.ok(result.error instanceof Error);
          assert.match(result.error.message, new RegExp(`${target}|period is closed`));
          assert.deepEqual(await runEvidence(runId), protectedEvidence, `${target} and audit unchanged after blocked manager action`);
          await assert.rejects(() => stale(periodId), new RegExp(`${target}|period is closed`));
          assert.deepEqual(await runEvidence(runId), protectedEvidence, "Repeated blocked request preserves financial evidence");
          const beforeSync = await fingerprint();
          const blockedSync = await sync(periodId);
          assert.equal(blockedSync.status, "blocked");
          assert.match(blockedSync.message, new RegExp(target));
          assert.deepEqual(await fingerprint(), beforeSync, "Direct sync gives truthful blocked result and changes no table");
          checks.push({ case: `${target.toLowerCase()}-first-manager-waits-then-rejects`, passed: true, lockWaitObserved: true, protectedEvidenceExact: true });
          checks.push({ case: `direct-sync-${target.toLowerCase()}-blocked`, passed: true, allTablesExactAfterDenial: true });
        } finally { gate.release.resolve(); await financial.catch(() => undefined); await manager; barrier = null; }
      }
      const { periodId } = await fixture();
      const token = sessionToken;
      sessionToken = null;
      await assert.rejects(() => stale(periodId), /Unauthorized/);
      sessionToken = token;
      checks.push({ case: "anonymous-real-manager-command-rejected", passed: true });

      // These are actual manager input actions, including their real scope,
      // status checks and generated-input transaction. Approved/Posted wins
      // between the outside preflight and the authoritative transactional check.
      await db.insert(attendanceDailySummaries).values({ employeeId, attendanceDate: "2099-09-20", scheduledMinutes: 480, workedMinutes: 480, anomalyFlags: "MISSING_OUT" });
      const metricInput = (id: string) => ({ payrollPeriodId: id, employeeId, attendanceDate: "2099-09-20", lateMinutes: 20 });
      const holdInput = (source: string, target = source) => ({ sourcePayrollPeriodId: source, targetPayrollPeriodId: target, employeeId, attendanceDates: ["2099-09-20"], workedMinutes: 480, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0 });
      for (const kind of ["metric", "metric-clear", "hold", "import", "removal", "refresh"] as const) {
        for (const target of ["Approved", "Posted"] as const) {
          const current = await fixture();
          if (kind === "metric-clear") await db.insert(employeeAttendanceDayMetricOverrides).values(metricInput(current.periodId));
          let batchId = "";
          if (kind === "removal") {
            batchId = randomUUID();
            batchIds.push(batchId);
            await db.insert(attendanceImportBatches).values({ id: batchId, payrollPeriodId: current.periodId, sourceFileName: `${tag}.csv`, sourceFormat: "CSV", status: "Processed", totalRows: 1, matchedRows: 1 });
            await db.insert(attendanceRawLogs).values({ id: departmentId - batchIds.length, batchId, employeeId, employeeNo, loggedAt: new Date("2099-09-20T08:00:00"), logDate: "2099-09-20", logTime: "08:00:00", direction: "IN" });
          }
          const invoke = (): Promise<unknown> => {
            if (kind === "metric") return metric(metricInput(current.periodId));
            if (kind === "metric-clear") return metric({ ...metricInput(current.periodId), lateMinutes: null });
            if (kind === "hold") return hold(holdInput(current.periodId));
            if (kind === "removal") return removeBatch(batchId);
            if (kind === "refresh") return refresh(current.periodId);
            return importLogs({ payrollPeriodId: current.periodId, fileName: `${tag}.csv`, contentBase64: Buffer.from(`EmployeeNo,DateTime,Direction,Device\n${employeeNo},2099-09-20 08:00:00,IN,P2A\n${employeeNo},2099-09-20 17:00:00,OUT,P2A`).toString("base64") });
          };
          if (target === "Posted") {
            // Starting from Approved would make the outside preflight reject
            // immediately. Pause that real preflight while it still sees
            // Reviewed, then commit both real financial commands before the
            // manager proceeds to its authoritative transactional check.
            const gate = pauseAfter("manager", query => /^select "status", "run_number" from "payroll_runs"/i.test(query));
            const manager = lane.run("manager", invoke).then(() => ({ error: null }), error => ({ error }));
            try {
              await bounded(gate.reached.promise, `${kind} outside preflight returned while Reviewed`);
              await move(current.runId, "Approved");
              await move(current.runId, "Posted");
              assert.equal((await runState(current.runId))?.status, "Posted");
              const protectedEvidence = await fingerprint();
              gate.release.resolve();
              const result = await bounded(manager, `${kind} rejects posting after initial preflight`);
              assert.ok(result.error instanceof Error);
              assert.match(result.error.message, /Posted|period is closed/);
              assert.deepEqual(await fingerprint(), protectedEvidence, "Posting after preflight protects every table against the delayed manager input");
              checks.push({ case: `${kind}-posted-after-manager-preflight`, passed: true, actualApprovalAndPosting: true, allTablesExactAfterDenial: true });
            } finally { gate.release.resolve(); await manager; barrier = null; }
            continue;
          }
          const gate = pauseAfter("financial", query => /^update "payroll_runs" set /i.test(query));
          const financial = lane.run("financial", () => move(current.runId, target));
          let manager: Promise<{ error: unknown }> | undefined;
          try {
            await bounded(gate.reached.promise, `${target} updated before ${kind} input`);
            manager = lane.run("manager", invoke).then(() => ({ error: null }), error => ({ error }));
            await waitForFinancialLock();
            gate.release.resolve();
            await bounded(financial, `${target} commits before ${kind}`);
            const protectedEvidence = await fingerprint();
            const result = await bounded(manager, `${kind} rejected after ${target}`);
            assert.ok(result.error instanceof Error);
            assert.match(result.error.message, new RegExp(`${target}|period is closed`));
            assert.deepEqual(await fingerprint(), protectedEvidence, "Rejected input and every financial/source/audit table stay exact");
            checks.push({ case: `${kind}-${target.toLowerCase()}-concurrency`, passed: true, lockWaitObserved: true, allTablesExactAfterDenial: true });
          } finally { gate.release.resolve(); await financial.catch(() => undefined); await manager; barrier = null; }
        }
        if (kind !== "metric" && kind !== "metric-clear" && kind !== "hold") continue;
        const current = await fixture();
        if (kind === "metric-clear") await db.insert(employeeAttendanceDayMetricOverrides).values(metricInput(current.periodId));
        const beforeFailure = await fingerprint();
        const table = kind === "hold" ? "attendance_dtr_hold_approvals" : "employee_attendance_day_metric_overrides";
        const command = kind === "metric-clear" ? "delete from" : "insert into";
        injectedFailure = { lane: "manager", matches: query => query.startsWith(`${command} "${table}"`), used: false };
        try {
          await assert.rejects(() => lane.run("manager", () => kind === "hold" ? hold(holdInput(current.periodId)) : metric({ ...metricInput(current.periodId), lateMinutes: kind === "metric-clear" ? null : 20 })), /Synthetic P2a failure/);
          assert.equal(injectedFailure.used, true, "Failure was injected only after real input write completed");
          assert.deepEqual(await fingerprint(), beforeFailure, "Input write, stale state and audit roll back together");
          checks.push({ case: `${kind}-input-write-failure-atomic-rollback`, passed: true, allTablesExactAfterFailure: true });
        } finally { injectedFailure = null; }
      }

      // Retargeting must protect the old target, as well as the selected source
      // and new target. No previous approval may be removed from protected pay.
      {
        const source = await fixture(), previous = await fixture(), next = await fixture();
        await db.update(payrollPeriods).set({ month: 10, cycle: "A", startDate: "2099-10-01", endDate: "2099-10-15", nominalPayDate: "2099-10-20", adjustedPayDate: "2099-10-20" }).where(eq(payrollPeriods.id, previous.periodId));
        await db.update(payrollPeriods).set({ month: 10, cycle: "B", startDate: "2099-10-16", endDate: "2099-10-31", nominalPayDate: "2099-11-05", adjustedPayDate: "2099-11-05" }).where(eq(payrollPeriods.id, next.periodId));
        await db.insert(attendanceDtrHoldApprovals).values({ sourcePayrollPeriodId: source.periodId, targetPayrollPeriodId: previous.periodId, employeeId, attendanceDate: "2099-09-20", workedMinutes: 480, status: "Approved", approvedByUserId: accountId, approvedAt: new Date() });
        await move(previous.runId, "Approved");
        const protectedEvidence = await fingerprint();
        await assert.rejects(() => hold(holdInput(source.periodId, next.periodId)), /Approved/);
        assert.deepEqual(await fingerprint(), protectedEvidence, "Retarget denial preserves prior hold, all runs and audit");
        checks.push({ case: "hold-retarget-protects-previous-approved-target", passed: true, allTablesExactAfterDenial: true });
      }
      {
        // Seed a Monthly protected snapshot specifically to verify the existing
        // manager all-group guard. This is not a Monthly payroll calculation or
        // transition test, and does not change the general Daily refresh rule.
        const monthly = await fixture();
        await db.update(payrollRuns).set({ inputSnapshot: { payrollGroup: "Monthly" }, status: "Approved", approvedAt: new Date(), approvedByUserId: payrollActorId }).where(eq(payrollRuns.id, monthly.runId));
        const protectedEvidence = await fingerprint();
        await assert.rejects(() => metric(metricInput(monthly.periodId)), /Approved/);
        await assert.rejects(() => refresh(monthly.periodId), /Approved/);
        assert.deepEqual(await fingerprint(), protectedEvidence);
        checks.push({ case: "manager-input-and-refresh-preserve-monthly-approved-snapshot", passed: true, seededProtectedSnapshot: true, allTablesExactAfterDenial: true });
        const source = await fixture(), next = await fixture();
        await db.insert(attendanceDtrHoldApprovals).values({ sourcePayrollPeriodId: source.periodId, targetPayrollPeriodId: monthly.periodId, employeeId, attendanceDate: "2099-09-20", workedMinutes: 480, status: "Approved", approvedByUserId: accountId, approvedAt: new Date() });
        const beforeRetarget = await fingerprint();
        await assert.rejects(() => hold(holdInput(source.periodId, next.periodId)), /Approved/);
        assert.deepEqual(await fingerprint(), beforeRetarget);
        checks.push({ case: "hold-retarget-preserves-monthly-approved-old-target", passed: true, seededProtectedSnapshot: true, allTablesExactAfterDenial: true });
      }

      const importInput = (id: string, dates: number[], suffix: string) => ({
        payrollPeriodId: id, fileName: `${tag}-${suffix}.csv`,
        contentBase64: Buffer.from(["EmployeeNo,DateTime,Direction,Device", ...dates.flatMap(day => [`${employeeNo},2099-09-${day} 08:00:00,IN,P2A`, `${employeeNo},2099-09-${day} 17:00:00,OUT,P2A`])].join("\n")).toString("base64"),
      });
      // Failure after the real audit INSERT must roll back the earlier input
      // and stale event, including the audit itself.
      for (const kind of ["metric", "hold", "import"] as const) {
        const current = await fixture();
        const beforeFailure = await fingerprint();
        injectedFailure = { lane: "manager", matches: query => query.startsWith('insert into "admin_audit_events"'), used: false };
        try {
          await assert.rejects(() => lane.run("manager", () => kind === "metric" ? metric(metricInput(current.periodId)) : kind === "hold" ? hold(holdInput(current.periodId)) : importLogs(importInput(current.periodId, [25], "audit-failure"))), /Synthetic P2a failure/);
          assert.equal(injectedFailure.used, true);
          assert.deepEqual(await fingerprint(), beforeFailure, "Audit failure rolls back the complete input mutation");
          checks.push({ case: `${kind}-audit-write-failure-atomic-rollback`, passed: true, allTablesExactAfterFailure: true });
        } finally { injectedFailure = null; }
      }
      {
        const source = await fixture(), previous = await fixture(), next = await fixture();
        // A transferred hold belongs to later, distinct periods. Reusing the
        // source dates would introduce an unrelated unresolved held day in each
        // target and correctly prevent their payroll calculations.
        await db.update(payrollPeriods).set({ month: 10, cycle: "A", startDate: "2099-10-01", endDate: "2099-10-15", nominalPayDate: "2099-10-20", adjustedPayDate: "2099-10-20" }).where(eq(payrollPeriods.id, previous.periodId));
        await db.update(payrollPeriods).set({ month: 10, cycle: "B", startDate: "2099-10-16", endDate: "2099-10-31", nominalPayDate: "2099-11-05", adjustedPayDate: "2099-11-05" }).where(eq(payrollPeriods.id, next.periodId));
        await db.insert(attendanceDtrHoldApprovals).values({ sourcePayrollPeriodId: source.periodId, targetPayrollPeriodId: previous.periodId, employeeId, attendanceDate: "2099-09-20", workedMinutes: 480, status: "Approved", approvedByUserId: accountId, approvedAt: new Date() });
        // Real input transaction and manual baseline succeed. Fail only the
        // subsequent real calculator's source-readiness query, once per period,
        // so the action must truthfully return saved input + failed recompute.
        injectedFailure = { lane: "manager", matches: query => / from "attendance_source_periods"/.test(query), used: false, repeat: true };
        let result: Awaited<ReturnType<typeof hold>>;
        try {
          result = await lane.run("manager", () => hold(holdInput(source.periodId, next.periodId)));
          assert.equal(injectedFailure.used, true, "Later computation boundary was exercised");
        } finally { injectedFailure = null; }
        const expectedPeriods = [source.periodId, previous.periodId, next.periodId].sort();
        assert.deepEqual(result.affectedTargetPeriods.map(row => row.payrollPeriodId).sort(), expectedPeriods);
        assert.equal(result.affectedTargetPeriods.every(row => row.staleRunCount === 1), true);
        assert.equal(result.payrollRecompute.length, 3);
        assert.equal(result.payrollRecompute.every(row => row.status === "failed" && /Synthetic P2a failure/.test(row.message)), true);
        const [saved] = await db.select().from(attendanceDtrHoldApprovals).where(and(eq(attendanceDtrHoldApprovals.sourcePayrollPeriodId, source.periodId), eq(attendanceDtrHoldApprovals.employeeId, employeeId)));
        assert.equal(saved.targetPayrollPeriodId, next.periodId);
        assert.equal(saved.workedMinutes, 480);
        for (const current of [source, previous, next]) assert.equal((await runState(current.runId))?.status, "Stale");
        checks.push({ case: "successful-hold-retarget-input-saved-compute-failure-truthful", passed: true, affectedPeriods: 3, sourceStaleCount: 1, previousTargetStaleCount: 1, nextTargetStaleCount: 1, failedRecomputations: 3 });
        for (const current of [source, previous, next]) {
          const retried = await sync(current.periodId, { markStale: false });
          assert.equal(retried.status, "computed", retried.message);
          assert.equal((await runState(current.runId))?.status, "Draft");
        }
        const retained = await db.select().from(attendanceDtrHoldApprovals).where(eq(attendanceDtrHoldApprovals.id, saved.id));
        assert.deepEqual(retained, [saved], "Calculation retries retain the already saved hold input exactly");
        checks.push({ case: "hold-retarget-compute-retry-all-three-periods", passed: true, computedPeriods: 3, savedInputExact: true });
      }
      {
        const current = await fixture();
        const input = importInput(current.periodId, [21], "success");
        const [first, simultaneous] = await Promise.all([importLogs(input), importLogs(input)]);
        assert.ok(first && simultaneous);
        assert.equal(first.id, simultaneous.id, "Simultaneous same-file retries create one batch");
        batchIds.push(first.id);
        const raw = await db.select().from(attendanceRawLogs).where(eq(attendanceRawLogs.batchId, first.id));
        assert.equal(raw.length, 2);
        assert.equal(raw.every(row => row.employeeId === employeeId), true);
        assert.equal((await runState(current.runId))?.status, "Stale");
        const beforeRetry = await fingerprint();
        assert.equal((await importLogs(input))?.id, first.id);
        assert.deepEqual(await fingerprint(), beforeRetry, "Duplicate retry preserves exact batch, input, run and audit");
        checks.push({ case: "successful-import-concurrent-same-file-and-retry", passed: true, actualMatchedPunches: 2, sameBatch: true, retryTablesExact: true });
        injectedFailure = { lane: "manager", matches: query => query.startsWith('insert into "admin_audit_events"'), used: false };
        try {
          await assert.rejects(() => lane.run("manager", () => removeBatch(first.id)), /Synthetic P2a failure/);
          assert.equal(injectedFailure.used, true);
          assert.deepEqual(await fingerprint(), beforeRetry, "Removal audit failure restores batch and raw input");
          checks.push({ case: "removal-audit-write-failure-atomic-rollback", passed: true, allTablesExactAfterFailure: true });
        } finally { injectedFailure = null; }
        const removed = await removeBatch(first.id);
        assert.equal(removed.rawLogCount, 2);
        assert.equal((await db.select().from(attendanceRawLogs).where(eq(attendanceRawLogs.batchId, first.id))).length, 0);
        assert.equal((await db.select().from(attendanceImportBatches).where(eq(attendanceImportBatches.id, first.id))).length, 0);
        assert.equal((await runState(current.runId))?.status, "Stale");
        checks.push({ case: "successful-manager-import-removal", passed: true, removedPunches: 2 });
      }
      {
        const current = await fixture();
        const gate = pauseAfter("overlap-first", query => /^select "normalized_hash" from "attendance_raw_logs"/i.test(query));
        const first = lane.run("overlap-first", () => importLogs(importInput(current.periodId, [23], "overlap-a")));
        let second: ReturnType<typeof importLogs> | undefined;
        let results: Awaited<ReturnType<typeof importLogs>>[];
        try {
          await bounded(gate.reached.promise, "first overlapping import read current hashes under lock");
          second = lane.run("overlap-second", () => importLogs(importInput(current.periodId, [23, 24], "overlap-b")));
          await waitForFinancialLock();
          gate.release.resolve();
          results = await Promise.all([first, second]);
        } finally { gate.release.resolve(); await first.catch(() => undefined); await second?.catch(() => undefined); barrier = null; }
        assert.ok(results[0] && results[1]);
        assert.notEqual(results[0].id, results[1].id);
        const ids = results.map(result => result!.id);
        batchIds.push(...ids);
        const raw = await db.select().from(attendanceRawLogs).where(inArray(attendanceRawLogs.batchId, ids));
        assert.equal(raw.length, 4, "Overlapping files must not duplicate common punches");
        assert.equal(new Set(raw.map(row => row.normalizedHash)).size, 4);
        assert.equal(raw.every(row => row.employeeId === employeeId), true);
        checks.push({ case: "simultaneous-overlapping-file-imports", passed: true, lockWaitObserved: true, uniqueMatchedPunches: 4, batches: 2 });
      }
    }
  } finally {
    barrier?.release.resolve();
    barrier = null;
    await db.delete(adminAuditEvents).where(inArray(adminAuditEvents.actorUserId, [accountId, payrollActorId]));
    if (batchIds.length) await db.delete(attendanceImportBatches).where(inArray(attendanceImportBatches.id, batchIds));
    if (fixtures.length) await db.delete(payrollPeriods).where(inArray(payrollPeriods.id, fixtures.map(row => row.periodId)));
    await db.delete(employees).where(inArray(employees.id, [employeeId, payrollActorEmployeeId]));
    await db.delete(department).where(eq(department.id, departmentId));
    const after = await fingerprint();
    assert.deepEqual(after, before, "Every restored table must be exact after synthetic fixture cleanup");
    preserved = true;
    const outputDirectory = process.env.P2A_REPORT_DIRECTORY ?? path.resolve("tmp/p2a-concurrency");
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(path.join(outputDirectory, `${mode}-acceptance.json`), JSON.stringify({ mode, checks, tableCount: restoredTableNames.length, restoredTableRowsExact: preserved, actualManagerActions: true, actualFinancialTransitions: true, payrollTransitionBoundary: "Actual engine with explicit ADMIN authorization and a stored System Admin fixture; manager commands use an actual stored Manager session", requestAdapterOnly: true, productionAccess: false }, null, 2));
    NeonPreparedQuery.prototype.execute = originalExecute;
    loader._load = originalLoad;
  }
  console.log(JSON.stringify({ mode, checks: checks.length, passed: true, restoredTablesExact: restoredTableNames.length }));
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

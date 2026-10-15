import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Actual exported actions/routes, isolated request adapters and fail-closed
// database/engine tripwires. No environment file, server or database is opened.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://authority_test:unused@127.0.0.1:1/authority_test",
});
Object.assign(globalThis, { React }); // tsx's standalone JSX adapter; Next uses automatic JSX.
let role: "MANAGER" | "ADMIN" | "EMPLOYEE" | null = "MANAGER";
let allowReads = false;
let departmentIds: number[] = [];
let selectResults: unknown[][] = [];
const calls = { database: 0, compute: 0, audit: 0, scope: 0 };
const context = () => role ? { role, accountId: "fictional-actor", email: "fixture@example.invalid" } : null;
const guard = (expected: string) => async () => {
  if (!role) throw new Error("Unauthorized.");
  if (role !== expected) throw new Error("Forbidden.");
  return context();
};
const period = { id: "fictional-period", code: "2026-10-A", startDate: "2026-10-01", endDate: "2026-10-15", adjustedPayDate: "2026-10-15", nominalPayDate: "2026-10-15", cycle: "A", status: "Open" };
const failDatabase = () => { calls.database++; throw new Error("DATABASE_TRIPWIRE"); };
function selectChain(rows: unknown[]) {
  const chain = {
    from() { return chain; }, innerJoin() { return chain; }, where() { return chain; }, orderBy() { return chain; }, limit() { return chain; },
    then(resolve: (value: unknown[]) => unknown) { return Promise.resolve(rows).then(resolve); },
  };
  return chain;
}
const database = new Proxy({}, {
  get(_target, key) {
    if (key === "query") return new Proxy({}, { get() { return { findFirst: async () => {
      if (!allowReads) return failDatabase(); calls.database++; return period;
    }, findMany: async () => { if (!allowReads) return failDatabase(); calls.database++; return []; } }; } });
    if (key === "select") return () => { if (!allowReads) return failDatabase(); calls.database++; return selectChain(selectResults.shift() ?? []); };
    return failDatabase;
  },
});
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function(name, ...args) {
  const parentFile = (args[0] as { filename?: string } | undefined)?.filename;
  const localName = name.startsWith(".") && parentFile
    ? path.resolve(path.dirname(parentFile), name).replaceAll("\\", "/").replace(/\.(?:ts|tsx|js)$/, "")
    : name.replaceAll("\\", "/").replace(/\.(?:ts|tsx|js)$/, "");
  if (name === "server-only") return {};
  if (name === "@/db" || /\/src\/db(?:\/index)?$/.test(localName)) return { db: database };
  if (name === "@/lib/auth/server" || /\/src\/lib\/auth\/server$/.test(localName)) return {
    requireManager: guard("MANAGER"), requireAdmin: guard("ADMIN"), getCurrentAuthContext: async () => context(),
    getManagerDepartmentIds: async () => { calls.scope++; return departmentIds; },
  };
  if (name === "@/lib/payroll/engine" || /\/src\/lib\/payroll\/engine$/.test(localName)) return new Proxy({}, { get() { return () => { calls.compute++; throw new Error("COMPUTE_TRIPWIRE"); }; } });
  if (name === "@/lib/holidays") return { fetchConfirmedHolidayRowsForRange: async () => [] };
  if (name === "next/cache") return { revalidatePath() {} };
  if (name === "next/link") return function FixtureLink(props: Record<string, unknown>) { return React.createElement("a", props); };
  return originalLoad.call(this, name, ...args);
};

const checks: string[] = [];
async function main() {
  const actions = await import("@/app/actions/attendanceImportAction");
  const { MANAGER_ATTENDANCE_READ_ONLY_MESSAGE } = await import("@/lib/auth/manager-attendance-policy");
  const mutationCases = [
    ["whole-period compute", () => actions.syncManagerDtrPayrollPeriodAction("fictional-period")],
    ["import", () => actions.importManagerDtrLogsAction({ fileName: "fixture.csv", contentBase64: "aW52YWxpZA==", payrollPeriodId: "fictional-period", replaceExisting: true })],
    ["refresh summaries", () => actions.refreshManagerAttendancePeriodSummariesAction("fictional-period")],
    ["mark stale", () => actions.markManagerDtrPayrollStaleAction("fictional-period")],
    ["Hold approval", () => actions.submitManagerAttendanceDtrHoldRowsAction({ employeeId: "outside-branch", sourcePayrollPeriodId: "posted-period" })],
    ["metric override", () => actions.saveManagerAttendanceDtrDayMetricOverrideAction({ employeeId: "outside-branch", payrollPeriodId: "posted-period" })],
    ["import removal", () => actions.revertManagerDtrImportBatchAction("outside-branch-batch")],
  ] as const;
  for (const actor of ["MANAGER", "EMPLOYEE", "ADMIN", null] as const) {
    role = actor;
    for (const [name, operation] of mutationCases) {
      const before = { ...calls };
      await assert.rejects(operation, (error: unknown) => {
        assert.equal((error as Error).message, actor === "MANAGER" ? MANAGER_ATTENDANCE_READ_ONLY_MESSAGE : actor ? "Forbidden." : "Unauthorized.");
        return true;
      });
      assert.deepEqual(calls, before, `${name}: rejection must precede scope/data/compute`);
    }
    checks.push(`${actor ?? "anonymous"}: seven direct financial writes denied before scope/data/compute`);
  }

  role = "MANAGER";
  const beforeDiagnostics = { ...calls };
  await assert.rejects(() => actions.getManagerAttendanceImportBatchUnmatchedDiagnosticsAction("outside-branch"), /Payroll Admin reviews unmatched/);
  assert.deepEqual(calls, beforeDiagnostics);
  checks.push("raw unmatched diagnostics denied without resource disclosure");

  const routeNames = ["import", "attendance-hold", "refresh-summaries", "remove"];
  for (const actor of ["MANAGER", "EMPLOYEE", "ADMIN", null] as const) {
    role = actor;
    for (const routeName of routeNames) {
      const route = await import(pathToFileURL(path.resolve(`src/app/(manager)/managerDtrFiles/${routeName}/route.ts`)).href);
      const before = { ...calls };
      const response = await route.POST(new Proxy({}, { get() { throw new Error("REQUEST_BODY_MUST_NOT_BE_READ"); } }));
      assert.equal(response.status, actor ? 403 : 401);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(await response.json(), { error: actor ? MANAGER_ATTENDANCE_READ_ONLY_MESSAGE : "Sign in to continue." });
      assert.deepEqual(calls, before);
    }
    checks.push(`${actor ?? "anonymous"}: four legacy POSTs denied before body parsing`);
  }

  role = "MANAGER"; allowReads = true;
  assert.deepEqual(await actions.listManagerDtrImportBatchesAction("fictional-period"), []);
  assert.equal((await actions.listManagerDtrPayrollPeriodsAction({ year: 2026 })).managerEmployeeCount, 0);
  assert.deepEqual((await actions.getManagerAttendancePeriodDtrAction("fictional-period")).employees, []);
  assert.deepEqual((await actions.getManagerAttendanceDtrHeldRowsAction("fictional-period")).rows, []);
  checks.push("empty assigned scope retains four reads with no fallback to company employees");
  departmentIds = [7];
  selectResults = [
    [{ id: "fictional-employee" }], [{ batchId: "fictional-batch" }], [],
    [{ id: "fictional-batch", payrollPeriodId: period.id, sourceFileName: "SALARY_SECRET_12345", sourceFormat: "API", status: "Processed", totalRows: 99, matchedRows: 90, unmatchedRows: 9, duplicateRows: 0, notes: "SALARY_SECRET_12345", importedAt: new Date("2026-10-14T00:00:00Z") }],
  ];
  const safeBatches = await actions.listManagerDtrImportBatchesAction(period.id);
  assert.equal(selectResults.length, 0);
  assert.equal(safeBatches.length, 1);
  assert.equal(safeBatches[0].scopedMatchedRows, 1);
  assert.equal(safeBatches[0].totalRows, 1);
  assert.equal(safeBatches[0].kind, "Phone sync");
  assert.ok(!JSON.stringify(safeBatches).includes("SALARY_SECRET_12345"));
  assert.ok(!("notes" in safeBatches[0]) && !("sourceFileName" in safeBatches[0]) && !("unmatchedRows" in safeBatches[0]));
  checks.push("actual manager batch action omits arbitrary notes/filenames and company-wide counts");
  departmentIds = [];
  allowReads = false;

  // The Admin path still passes its original Admin gate and reaches the original
  // database operation. The tripwire proves no legacy manager denial intercepts it.
  role = "ADMIN";
  const beforeAdmin = calls.database;
  await assert.rejects(() => actions.revertAttendanceImportBatchAction("fictional-batch"), /DATABASE_TRIPWIRE/);
  assert.equal(calls.database, beforeAdmin + 1);
  role = "MANAGER";
  const afterAdmin = calls.database;
  await assert.rejects(() => actions.revertAttendanceImportBatchAction("fictional-batch"), /Forbidden/);
  assert.equal(calls.database, afterAdmin);
  checks.push("Admin removal keeps Admin-only gate and reaches original storage path");

  const refreshHelpers = [
    (actorUserId: string) => actions.refreshGeneratedDtrRowsForBranchCalendarAccountCodeOverride({ actorUserId, attendanceDate: "2026-10-02", departmentId: 7 }),
    (actorUserId: string) => actions.refreshGeneratedDtrRowsForHolidayCalendarChange({ actorUserId, startDate: "2026-10-02", endDate: "2026-10-02" }),
  ];
  for (const actor of ["MANAGER", "EMPLOYEE", null] as const) {
    role = actor;
    for (const operation of refreshHelpers) {
      const before = { ...calls };
      await assert.rejects(() => operation("fictional-actor"), actor ? /Forbidden/ : /Unauthorized/);
      assert.deepEqual(calls, before);
    }
  }
  role = "ADMIN";
  for (const operation of refreshHelpers) {
    const before = { ...calls };
    await assert.rejects(() => operation("another-admin"), /Forbidden/);
    assert.deepEqual(calls, before, "Caller-supplied actor identity cannot be impersonated");
    await assert.rejects(() => operation("fictional-actor"), /DATABASE_TRIPWIRE/);
    assert.equal(calls.database, before.database + 1, "Matching authenticated Admin reaches unchanged calculation transaction");
  }
  checks.push("two exported calculation refresh helpers reject wrong roles/actor impersonation; matching Admin reaches original transaction");

  const functionBodies = (text: string) => {
    const file = ts.createSourceFile("actions.ts", text, ts.ScriptTarget.Latest, true);
    return new Map(file.statements.filter(ts.isFunctionDeclaration).filter(node => node.name && node.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword) && !node.name.text.includes("Manager")).map(node => {
      let body = node.getText(file).replaceAll("\r\n", "\n");
      if (["refreshGeneratedDtrRowsForBranchCalendarAccountCodeOverride", "refreshGeneratedDtrRowsForHolidayCalendarChange"].includes(node.name!.text)) {
        body = body.replace('  const actor = await requireAdminActor();\n  if (args.actorUserId !== actor.userId) throw new Error("Forbidden.");\n', "");
      }
      return [node.name!.text, createHash("sha256").update(body).digest("hex")];
    }));
  };
  const source = readFileSync("src/app/actions/attendanceImportAction.ts", "utf8");
  const baseline = execFileSync("git", ["show", "HEAD:src/app/actions/attendanceImportAction.ts"], { encoding: "utf8" });
  assert.deepEqual(functionBodies(source), functionBodies(baseline), "Non-manager attendance actions stay unchanged except the two explicit Admin entry guards (normalized line endings)");
  checks.push(`${functionBodies(source).size} non-manager attendance action bodies preserved except two Admin entry guards`);

  const { ManagerDtrFilesClient } = await import("@/app/(manager)/managerDtrFiles/ManagerDtrFilesClient");
  const row = { attendanceDate: "2026-10-02", dayName: "Friday", rawPunches: ["08:00 AM", "05:00 PM"], scheduledInTime: "08:00", scheduledOutTime: "17:00", biometricWorkedMinutes: 480, lateMinutes: 0, undertimeMinutes: 0, overtimeMinutes: 0, effectiveStatus: "Hold", anomalyFlags: ["SALARY_SECRET_12345"], isLateOverridden: true, holdApprovalStatus: null };
  const fixture = {
    year: 2026, periods: [{ ...period, year: 2026, month: 10, payrollTerms: "Semi-Monthly", attendanceBatchCount: 1 }], selectedPeriodId: period.id, managerEmployeeCount: 1,
    employeeId: "fictional-employee", dtr: { payrollPeriod: period, employees: [{ employeeId: "fictional-employee", employeeNo: "10001", employeeName: "Fictional Worker", departmentId: 7, departmentName: "Test Branch", rows: [row] }] },
    heldRows: { payrollPeriod: period, rows: [{ ...row, employeeId: "fictional-employee", employeeName: "Fictional Worker", departmentName: "Test Branch", approvalStatus: "Hold", notes: "SALARY_SECRET_12345" }] },
    batches: [{ id: "batch", sourceFormat: "API", importedAt: "2026-10-14T00:00:00Z", scopedMatchedRows: 2, sourceFileName: "SALARY_SECRET_12345", notes: "SALARY_SECRET_12345" }],
  } as unknown as Parameters<typeof ManagerDtrFilesClient>[0];
  const html = renderToStaticMarkup(React.createElement(ManagerDtrFilesClient, fixture));
  assert.ok(html.includes("Fictional Worker") && html.includes("08:00 AM") && html.includes("05:00 PM"));
  assert.ok(html.includes("does not approve attendance or calculate payroll"));
  assert.ok(html.includes("departmentId=7") && html.includes("day=2026-10-02"));
  assert.ok(!html.includes("SALARY_SECRET_12345"));
  assert.ok(!/method="post"|type="file"|Save|Import DTR|Refresh Stored|\/managerDtrFiles\/(?:remove|attendance-hold|import|refresh-summaries)/.test(html));
  checks.push("read-only rendered UI retains evidence/date handoff, omits unsafe controls and unrestricted text");
  const wrongPersonHtml = renderToStaticMarkup(React.createElement(ManagerDtrFilesClient, { ...fixture, employeeId: "outside-scope" }));
  assert.ok(wrongPersonHtml.includes("requested employee is unavailable"));
  assert.ok(!wrongPersonHtml.includes("Effective first in / last out"), "Unknown employee must not silently select another employee's DTR");
  checks.push("unknown employee link shows explicit unavailable state instead of another employee's DTR");
  assert.equal(calls.compute, 0);
  console.log(JSON.stringify({ result: "PASS", checks, writes: 0, computeCalls: calls.compute, limits: "Isolated adapters/tripwires and source preservation; no live manager session or production database acceptance." }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { loader._load = originalLoad; });

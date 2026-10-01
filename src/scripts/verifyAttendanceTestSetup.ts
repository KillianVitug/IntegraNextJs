import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { is, SQL } from "drizzle-orm";
import * as schema from "@/db/schema";
import { BRANCH, PROJECT, parseArgs, parseConfig, safeJson, validateDestination, validateScope, type TestConfig } from "./attendanceTest/guard";
import { destination } from "./attendanceTest/destination";
import { checkScope, compare, inspectSchema, queryWith, readOnly, requiredTables, sourceScope, writeOnce, type Database } from "./attendanceTest/workflow";
import type { SourcePunch } from "@/lib/payroll/attendanceSourceClient";
import { attendanceSchedulerActorAuthorized } from "@/lib/payroll/attendanceSourceActor";

let passed = 0;
async function test(name: string, run: () => unknown | Promise<unknown>) { await run(); passed++; console.log(`PASS ${name}`); }
async function main() {
  const pin = { projectId: PROJECT, branchId: BRANCH, branchName: "attendance-test", endpointId: "ep-synthetic-test-a1", hosts: ["ep-synthetic-test-a1.ap-southeast-1.aws.neon.tech"], database: "synthetic", verifiedFromDashboardAt: "2026-10-01T00:00:00Z" };
  const url = `postgresql://synthetic_user:synthetic_password@${pin.hosts[0]}/synthetic?sslmode=require`;
  const c: TestConfig = { databaseUrl: url, sourceToken: "synthetic-source-token-never-a-real-secret", periodId: randomUUID(), periodStart: "2026-09-10", periodEnd: "2026-09-11", actorUserId: randomUUID(), mappings: [{ sourceEmployeeId: "0001", employeeId: randomUUID(), reason: "Synthetic verified fixture" }], comparisons: [{ sourceEmployeeId: "0001", attendanceDate: "2026-09-10", checkInTime: "08:00", checkOutTime: "17:00", breakMinutes: 60, expectedWorkedMinutes: 480 }] };
  const command = ["sync", `--write-test=${BRANCH}`, `--period=${c.periodId}`];
  await test("unverified shipped pin blocks before credentials or networking", () => assert.throws(() => validateDestination(url, destination), /endpoint_not_independently_verified/));
  await test("exact independent endpoint accepted", () => assert.equal(validateDestination(url, pin).branchId, BRANCH));
  await test("production/wrong endpoint refused despite test database name", () => assert.throws(() => validateDestination(url.replace(pin.endpointId, "ep-production-a2"), pin), /destination_mismatch/));
  await test("wrong project and branch refused", () => { for (const key of ["projectId", "branchId"] as const) assert.throws(() => validateDestination(url, { ...pin, [key]: "main" }), /wrong_destination_pin/); });
  await test("missing, duplicate and mixed endpoint pins refused", () => { for (const hosts of [[], [pin.hosts[0], pin.hosts[0]], [pin.hosts[0], "ep-other.a.neon.tech"]]) assert.throws(() => validateDestination(url, { ...pin, hosts })); });
  await test("suffix tricks, host overrides and duplicate URL parameters refused", () => { for (const bad of [url.replace(".neon.tech", ".neon.tech.attacker.test"), url + "&host=production", url + "&sslmode=disable", url.replace("sslmode=require", "sslmode=disable"), url.replace("/synthetic?", "/production?")]) assert.throws(() => validateDestination(bad, pin)); });
  await test("default is read only; writes require exact branch and period", () => { assert.equal(parseArgs([]).mode, "preflight"); for (const args of [["sync"], ["sync", `--write-test=${BRANCH}`], ["sync", "--write-test=main", `--period=${c.periodId}`], ["compare", `--write-test=${BRANCH}`], ["sync", `--write-test=${BRANCH}`, `--period=${c.periodId}`, `--period=${randomUUID()}`]]) assert.throws(() => parseArgs(args)); });
  await test("scope rejects absent actor, mappings, wrong period and ambiguous identity", () => { validateScope(c, parseArgs(command)); for (const config of [{ ...c, actorUserId: "" }, { ...c, mappings: [] }, { ...c, periodId: randomUUID() }, { ...c, mappings: [...c.mappings, c.mappings[0]] }]) assert.throws(() => validateScope(config, parseArgs(command))); });
  await test("config never obtains secrets from process environment", () => { const empty = parseConfig({ ...c, databaseUrl: "", sourceToken: "" }); assert.equal(empty.databaseUrl, ""); assert.throws(() => validateDestination(empty.databaseUrl, pin)); });
  await test("launcher strips inherited production config, preloads and proxies", () => { const require = createRequire(path.resolve("package.json")); const launcher = require("./scripts/attendance-test.cjs") as { isolatedEnvironment: (env: Record<string, string>) => Record<string, string> }; const clean = launcher.isolatedEnvironment({ DATABASE_URL: url, PGHOST: "production", PGPASSWORD: "synthetic", NODE_OPTIONS: "--require=unsafe", ATTENDANCE_SOURCE_TOKEN: c.sourceToken, HTTPS_PROXY: "proxy", NODE_ENV: "development", SystemRoot: "C:/Windows" }); assert.deepEqual(Object.keys(clean).sort(), ["ATTENDANCE_TEST_ISOLATED", "NODE_ENV", "PATH", "SystemRoot", "TSX_DISABLE_CACHE", "TZ"].sort()); assert.equal(clean.NODE_ENV, "test"); });
  await test("reports redact URL, encoded/decoded credentials and source token", () => { const json = safeJson({ error: [url, "synthetic_user", "synthetic_password", c.sourceToken], benign: "counts" }, c); for (const secret of [url, "synthetic_user", "synthetic_password", c.sourceToken]) assert.ok(!json.includes(secret)); assert.ok(json.includes("counts")); });

  const pg = new PGlite();
  try {
    const database = drizzle(pg, { schema }) as unknown as Database, dialect = new PgDialect(), enums = new Set<string>();
    for (const table of requiredTables.filter(t => !getTableConfig(t).name.startsWith("attendance_source_"))) {
      const config = getTableConfig(table), columns: string[] = [];
      for (const col of config.columns) {
        const type = col.getSQLType();
        if (col.enumValues?.length && !enums.has(type)) { await pg.exec(`CREATE TYPE "${type}" AS ENUM (${col.enumValues.filter(v => v !== "API").map(v => `'${v.replaceAll("'", "''")}'`).join(",")})`); enums.add(type); }
        let value = "";
        if (is(col.default, SQL)) value = " DEFAULT " + dialect.sqlToQuery(col.default).sql;
        else if (col.default !== undefined) value = " DEFAULT " + (typeof col.default === "string" ? `'${col.default.replaceAll("'", "''")}'` : String(col.default));
        columns.push(`"${col.name}" ${type}${value}${col.notNull ? " NOT NULL" : ""}${col.primary ? " PRIMARY KEY" : ""}`);
      }
      await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`);
    }
    await test("preflight reports missing migration without applying it", async () => { const report = await readOnly(database, inspectSchema); assert.equal(report.compatible, false); assert.ok(report.differences.some(r => r.table === "attendance_source_events" && r.issue === "missing_table")); assert.equal((await pg.query("SELECT to_regclass('attendance_source_events') AS t")).rows[0] && ((await pg.query<{t: string | null}>("SELECT to_regclass('attendance_source_events') AS t")).rows[0].t), null); });
    await pg.exec(await readFile("src/db/migrations/0119_attendance_source.sql", "utf8")); // In-memory fixture ONLY.
    await test("schema preflight accepts required fixture schema", async () => { const report = await readOnly(database, inspectSchema); assert.deepEqual(report.differences, []); });
    await test("schema type drift is reported without repair", async () => { await pg.exec("ALTER TABLE attendance_source_events ALTER COLUMN revision TYPE bigint"); const report = await readOnly(database, inspectSchema); assert.ok(report.differences.some(r => r.column === "revision" && r.issue === "different_type")); await pg.exec("ALTER TABLE attendance_source_events ALTER COLUMN revision TYPE integer"); });
    const person = c.mappings[0].employeeId;
    await database.insert(schema.employees).values({ id: person, employeeNo: "0001", firstName: "Synthetic", lastName: "Only" });
    await database.insert(schema.authAccounts).values({ id: c.actorUserId, employeeId: person, email: "synthetic@example.test", status: "Active", mustSetPassword: false });
    const groupId = randomUUID();
    await database.insert(schema.authPermissionGroups).values({ id: groupId, key: "HR_ADMIN", name: "Synthetic" });
    await database.insert(schema.authAccountPermissionGroups).values({ accountId: c.actorUserId, groupId });
    await database.insert(schema.payrollPeriods).values({ id: c.periodId, code: "SYNTHETIC-TEST", payrollTerms: "Semi-Monthly", cycle: "A", year: 2026, month: 9, startDate: c.periodStart, endDate: c.periodEnd, nominalPayDate: c.periodEnd, adjustedPayDate: c.periodEnd, status: "Open" });
    await test("read-only transaction rejects writes", async () => { await assert.rejects(() => readOnly(database, query => query("UPDATE payroll_periods SET status='Closed' WHERE id=$1", [c.periodId]))); assert.equal((await pg.query<{status: string}>("SELECT status FROM payroll_periods")).rows[0].status, "Open"); });
    await test("scope accepts clean period and existing admin", async () => assert.deepEqual(await readOnly(database, q => checkScope(q, c)), { ready: true, blockers: [] }));
    await test("scheduler accepts active admin and rejects nonexistent actor", async () => {
      assert.equal(await attendanceSchedulerActorAuthorized(database, c.actorUserId), true);
      assert.equal(await attendanceSchedulerActorAuthorized(database, randomUUID()), false);
    });
    await test("scheduler rejects inactive, non-admin and deleted actors", async () => {
      const query = queryWith(database);
      await query("UPDATE auth_accounts SET status='Disabled' WHERE id=$1", [c.actorUserId]);
      assert.equal(await attendanceSchedulerActorAuthorized(database, c.actorUserId), false);
      await query("UPDATE auth_accounts SET status='Active' WHERE id=$1", [c.actorUserId]);
      await query("UPDATE auth_permission_groups SET key='EMPLOYEE' WHERE id=$1", [groupId]);
      assert.equal(await attendanceSchedulerActorAuthorized(database, c.actorUserId), false);
      await query("UPDATE auth_permission_groups SET key='HR_ADMIN' WHERE id=$1", [groupId]);
      await query("UPDATE employees SET deleted_at=now() WHERE id=$1", [person]);
      assert.equal(await attendanceSchedulerActorAuthorized(database, c.actorUserId), false);
      await query("UPDATE employees SET deleted_at=NULL WHERE id=$1", [person]);
      assert.equal(await attendanceSchedulerActorAuthorized(database, c.actorUserId), true);
    });
    await test("scope rejects nonexistent audit account", async () => assert.ok((await readOnly(database, q => checkScope(q, { ...c, actorUserId: randomUUID() }))).blockers.includes("active_admin_audit_actor_required")));
    const punch = (type: "IN" | "OUT", capturedAt: string): SourcePunch => ({ eventId: randomUUID(), employeeId: "0001", employeeName: "Synthetic", originalEmployeeId: "0001", originalEmployeeName: "Synthetic", branchId: type === "IN" ? "B1" : "B2", type, capturedAt, receivedAt: capturedAt, updatedAt: capturedAt, status: "VALID", clockFlag: false, reviewFlags: [], reviewResolved: false });
    const records = [punch("IN", "2026-09-10T00:00:00Z"), punch("OUT", "2026-09-10T09:00:00Z")];
    await test("comparison reports source hours and missing imports accurately", async () => { const report = await readOnly(database, q => compare(q, c, records)); assert.equal(report.counts.source, 2); assert.equal(report.counts.imported, 0); assert.equal(report.cases[0].sourceMinutes, 480); assert.equal(report.cases[0].importedMinutes, 0); assert.equal(report.matches, false); });
    await test("unscoped source and direct unscoped write refused", async () => { assert.equal(sourceScope(c, [...records, { ...records[0], employeeId: "9999" }]).ready, false); await assert.rejects(() => writeOnce(database, c, records, ["sync"])); await assert.rejects(() => writeOnce(database, c, [...records, { ...records[0], employeeId: "9999" }], command)); assert.equal((await pg.query("SELECT * FROM attendance_source_runs")).rows.length, 0); });
    process.env.ATTENDANCE_SOURCE_ENABLED = "true";
    await test("bad expected hours roll back mappings, run and raw import atomically", async () => { await assert.rejects(() => writeOnce(database, { ...c, comparisons: [{ ...c.comparisons[0], expectedWorkedMinutes: 450 }] }, records, command), /comparison_failed/); for (const table of ["attendance_source_mappings", "attendance_source_runs", "attendance_raw_logs", "attendance_source_events"]) assert.equal((await pg.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0] && ((await pg.query<{n: number}>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n), 0); });
    await test("explicit sync imports two punches and proves eight-hour comparison", async () => { const result = await writeOnce(database, c, records, command); assert.equal(result.reconciliation.projected, 2); assert.equal(result.comparison.matches, true); assert.equal(result.comparison.cases[0].importedHours, 8); });
    await test("repeat sync does not duplicate or rewrite raw records", async () => { const before = await pg.query("SELECT * FROM attendance_raw_logs ORDER BY id"); const result = await writeOnce(database, c, records, command); assert.equal(result.reconciliation.projected, 0); assert.equal(result.comparison.counts.duplicateRawHashGroups, 0); assert.deepEqual(await pg.query("SELECT * FROM attendance_raw_logs ORDER BY id"), before); });
    await test("mapping conflict refused without changing identity", async () => { const altered = { ...c, mappings: [{ ...c.mappings[0], employeeId: randomUUID() }] }; assert.ok((await checkScope(queryWith(database), altered)).blockers.includes("mapping_conflicts_with_existing_identity")); await assert.rejects(() => writeOnce(database, altered, records, command), /write_scope_changed/); });
    await test("events already projected in another period cannot be modified", async () => { const otherId = randomUUID(); await database.insert(schema.payrollPeriods).values({ id: otherId, code: "SYNTHETIC-OTHER", payrollTerms: "Semi-Monthly", cycle: "A", year: 2026, month: 9, startDate: c.periodStart, endDate: c.periodEnd, nominalPayDate: c.periodEnd, adjustedPayDate: c.periodEnd, status: "Open" }); await database.insert(schema.attendanceSourceProjections).values({ payrollPeriodId: otherId, eventId: records[0].eventId, employeeId: person, payloadHash: "synthetic" }); await assert.rejects(() => writeOnce(database, c, records, command), /source_event_used_by_another_period/); await pg.query("DELETE FROM attendance_source_projections WHERE payroll_period_id=$1", [otherId]); });
    await test("comparison samples retain branches and expected civil punch times", async () => { const report = await compare(queryWith(database), c, records); assert.equal(report.counts.totalApiRawRows, 2); assert.equal(report.punchSamples[0].source.time, "08:00:00.000"); assert.equal(report.punchSamples[0].imported?.time, "08:00:00"); assert.equal(report.punchSamples[1].source.branch, "B2"); });
    await test("duplicate/orphan raw row is visible in comparison", async () => { await pg.exec("INSERT INTO attendance_raw_logs(batch_id,employee_id,employee_no,logged_at,log_date,log_time,direction,normalized_hash) SELECT batch_id,employee_id,employee_no,logged_at,log_date,log_time,direction,normalized_hash FROM attendance_raw_logs ORDER BY id LIMIT 1"); const r = await compare(queryWith(database), c, records); assert.equal(r.counts.duplicateRawHashGroups, 1); assert.equal(r.counts.orphanApiRows, 1); assert.equal(r.matches, false); await pg.exec("DELETE FROM attendance_raw_logs WHERE id=(SELECT max(id) FROM attendance_raw_logs)"); });
    await test("closed period rejected without new sync records", async () => { await pg.exec("UPDATE payroll_periods SET status='Closed'"); const before = await pg.query("SELECT * FROM attendance_source_runs ORDER BY id"); await assert.rejects(() => writeOnce(database, c, records, command), /write_scope_changed/); assert.deepEqual(await pg.query("SELECT * FROM attendance_source_runs ORDER BY id"), before); await pg.exec("UPDATE payroll_periods SET status='Open'"); });
    await test("payroll-bearing period rejected", async () => { await database.insert(schema.payrollRuns).values({ payrollPeriodId: c.periodId, runNumber: 1, status: "Posted" }); assert.ok((await checkScope(queryWith(database), c)).blockers.includes("test_period_has_payroll_runs")); await assert.rejects(() => writeOnce(database, c, records, command), /write_scope_changed/); });
  } finally { delete process.env.ATTENDANCE_SOURCE_ENABLED; await pg.close(); }
  console.log(`Attendance test setup checks passed: ${passed}. In-memory fixture only; no network or persistent migration.`);
}
main().catch(() => { console.error("Attendance test setup synthetic verification failed (details suppressed)."); process.exitCode = 1; });

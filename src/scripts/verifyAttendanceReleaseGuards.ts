import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { SQL, eq, is } from "drizzle-orm";
import * as schema from "@/db/schema";
import { attendanceSourceRuns as runs, attendanceSourceMappings as mappings } from "@/db/attendanceSourceSchema";
import { reconcileAttendanceSource, saveAttendanceSourceMapping } from "@/lib/payroll/attendanceSourceSync";
import { assertAttendanceSourceReady, attendanceSourceVersion, attendancePayrollSnapshot, confirmAttendanceSourceSummaryRefresh } from "@/lib/payroll/attendanceSourceGuard";
import { transitionPayrollRunStatus } from "@/lib/payroll/engine";
import { assertFileAttendanceBatch, PayrollValidationError, payrollActionResult } from "@/lib/payroll/validation";
import type { SourcePunch } from "@/lib/payroll/attendanceSourceClient";
import type { DbClient } from "@/db";

async function main() {
  const pg = new PGlite();
  try {
    const database = drizzle(pg, { schema });
    const client = database as unknown as DbClient;
    const engineDb = database as unknown as Parameters<typeof transitionPayrollRunStatus>[4];
    const dialect = new PgDialect(), enums = new Set<string>();
    // Real column definitions and real connector migration, isolated in memory.
    for (const table of [schema.employees, schema.payrollPeriods, schema.payrollRuns, schema.payrollRunEmployees, schema.payrollRunLines, schema.employeesLoans, schema.loanInstallments, schema.loanPayments, schema.attendanceImportBatches, schema.attendanceRawLogs, schema.attendanceDailySummaries, schema.adminAuditEvents, schema.payrollRunEvents, schema.employeeAttendanceDayStatusOverrides, schema.attendanceDtrHoldApprovals]) {
      const config = getTableConfig(table), columns: string[] = [];
      for (const col of config.columns) {
        const type = col.getSQLType();
        if (col.enumValues?.length && !enums.has(type)) {
          await pg.exec(`CREATE TYPE "${type}" AS ENUM (${col.enumValues.filter(v => v !== "API").map(v => `'${v.replaceAll("'", "''")}'`).join(",")})`);
          enums.add(type);
        }
        const value = is(col.default, SQL) ? " DEFAULT " + dialect.sqlToQuery(col.default).sql : col.default !== undefined ? " DEFAULT " + (typeof col.default === "string" ? `'${col.default.replaceAll("'", "''")}'` : String(col.default)) : "";
        columns.push(`"${col.name}" ${type}${value}${col.primary ? " PRIMARY KEY" : ""}`);
      }
      await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`);
    }
    await pg.exec(await readFile("src/db/migrations/0119_attendance_source.sql", "utf8"));
    await pg.exec(await readFile("src/db/migrations/0120_attendance_matching_workflow.sql", "utf8"));
  await pg.exec(await readFile("src/db/migrations/0121_attendance_resolution.sql", "utf8"));
  await pg.exec(await readFile("src/db/migrations/0122_attendance_duplicates.sql", "utf8"));
    const actor = randomUUID(), employee = randomUUID(), replacement = randomUUID(), periodId = randomUUID(), payrollId = randomUUID();
    process.env.ATTENDANCE_SOURCE_ENABLED = "true";
    process.env.ATTENDANCE_API_REQUIRED_PERIOD_IDS = periodId;
    await database.insert(schema.employees).values([{ id: employee, employeeNo: "10001", firstName: "Synthetic", lastName: "One" }, { id: replacement, employeeNo: "10002", firstName: "Synthetic", lastName: "Two" }]);
    await database.insert(schema.payrollPeriods).values({ id: periodId, code: "GUARD-TEST", payrollTerms: "Semi-Monthly", cycle: "A", year: 2026, month: 9, startDate: "2026-09-01", endDate: "2026-09-15", nominalPayDate: "2026-09-15", adjustedPayDate: "2026-09-15" });
    await database.insert(mappings).values({ sourceEmployeeId: "10001", employeeId: employee, actorUserId: actor, reason: "Synthetic fixture" });
    await assert.rejects(() => assertAttendanceSourceReady(periodId, client), /no successful/);
    process.env.ATTENDANCE_SOURCE_ENABLED = "false";
    await assert.rejects(() => assertAttendanceSourceReady(periodId, client), /connection is disabled/);
    process.env.ATTENDANCE_SOURCE_ENABLED = "true";
    process.env.ATTENDANCE_API_REQUIRED_PERIOD_IDS = "invalid-period-id";
    await assert.rejects(() => assertAttendanceSourceReady(periodId, client), /configuration is invalid/);
    delete process.env.ATTENDANCE_API_REQUIRED_PERIOD_IDS;
    assert.equal(await assertAttendanceSourceReady(periodId, client), null, "Legacy file-only period stays supported");
    const punch = (type: "IN" | "OUT", time: string): SourcePunch => ({ eventId: randomUUID(), employeeId: "10001", employeeName: "Synthetic One", originalEmployeeId: "10001", originalEmployeeName: "Synthetic One", branchId: "TEST", type, capturedAt: `2026-09-10T${time}+08:00`, receivedAt: `2026-09-10T${time}+08:00`, updatedAt: `2026-09-10T${time}+08:00`, status: "VALID", clockFlag: false, reviewFlags: [], reviewResolved: false });
    const records = [punch("IN", "08:00:00"), punch("OUT", "17:00:00")];
    const sync = async (data = records) => {
      const id = randomUUID();
      await database.insert(runs).values({ id, payrollPeriodId: periodId, state: "Fetching", actorUserId: actor, fromDate: "2026-08-31", throughDate: "2026-09-16" });
      await reconcileAttendanceSource(database as unknown as Parameters<typeof reconcileAttendanceSource>[0], periodId, id, actor, data);
      return id;
    };
    const refresh = async () => {
      const version = await attendanceSourceVersion(periodId, client);
      await database.transaction(tx => confirmAttendanceSourceSummaryRefresh(tx as unknown as DbClient, periodId, version));
    };
    const snapshot = async () => {
      await database.insert(schema.payrollRunEvents).values({ payrollRunId: payrollId, eventType: "Computed", actorUserId: actor, notes: JSON.stringify({ attendanceSourceInputRunId: await attendancePayrollSnapshot(client, periodId) }) });
    };
    const move = (status: "Reviewed" | "Approved" | "Posted") => transitionPayrollRunStatus(payrollId, status, actor, undefined, engineDb);
    await sync(); await refresh();
    process.env.ATTENDANCE_SOURCE_ENABLED = "false";
    await assert.rejects(() => assertAttendanceSourceReady(periodId, client), /connection is disabled/, "Disabling the connector must not bypass existing API-batch checks");
    process.env.ATTENDANCE_SOURCE_ENABLED = "true";
    await database.insert(schema.payrollRuns).values({ id: payrollId, payrollPeriodId: periodId, runNumber: 1, status: "Draft" });
    await assert.rejects(() => move("Reviewed"), /not computed from the current/);
    await snapshot();
    await database.update(schema.payrollRuns).set({ status: "Stale" }).where(eq(schema.payrollRuns.id, payrollId));
    await assert.rejects(() => move("Reviewed"), /outdated/);
    await database.update(schema.payrollRuns).set({ status: "Draft" }).where(eq(schema.payrollRuns.id, payrollId));
    assert.equal((await move("Reviewed"))?.status, "Reviewed");
    // An unchanged repeat sync does not invalidate a computed snapshot.
    await sync();
    assert.equal((await move("Approved"))?.status, "Approved");
    // A same-identity save must not invalidate approval; a real mapping change must.
    await database.transaction(tx => saveAttendanceSourceMapping(tx as unknown as DbClient, actor, "10001", employee, "Verify unchanged"));
    assert.equal((await database.select().from(schema.payrollRuns))[0].status, "Approved");
    const rawBefore = await database.select().from(schema.attendanceRawLogs);
    await database.transaction(tx => saveAttendanceSourceMapping(tx as unknown as DbClient, actor, "10001", replacement, "Verified correction", true));
    const stale = (await database.select().from(schema.payrollRuns))[0];
    assert.equal(stale.status, "Stale"); assert.equal(stale.reviewedAt, null); assert.equal(stale.approvedAt, null);
    assert.deepEqual(await database.select().from(schema.attendanceRawLogs), rawBefore, "Mapping save cannot rewrite evidence before sync");
    await assert.rejects(() => assertAttendanceSourceReady(periodId, client), /mappings changed/);
    await assert.rejects(() => move("Posted"), /outdated/);
    await sync(); await refresh();
    await database.update(schema.payrollRuns).set({ status: "Draft" }).where(eq(schema.payrollRuns.id, payrollId));
    await assert.rejects(() => move("Reviewed"), /not computed from the current/);
    await snapshot();
    // New unresolved source flags block Review, Approve and Post even without a UI.
    const blocked = records.map(p => ({ ...p, clockFlag: true }));
    await sync(blocked); await refresh();
    for (const [status, next] of [["Draft", "Reviewed"], ["Reviewed", "Approved"], ["Approved", "Posted"]] as const) {
      await database.update(schema.payrollRuns).set({ status }).where(eq(schema.payrollRuns.id, payrollId));
      await assert.rejects(() => move(next), /unresolved exceptions/);
      assert.equal((await database.select().from(schema.payrollRuns))[0].status, status);
    }
    await sync(); await refresh(); await snapshot();
    // Failed and in-progress retries must not fall back to an older successful pull.
    const retry = randomUUID();
    await database.insert(runs).values({ id: retry, payrollPeriodId: periodId, state: "Fetching", actorUserId: actor, fromDate: "2026-08-31", throughDate: "2026-09-16" });
    await assert.rejects(() => assertAttendanceSourceReady(periodId, client), /latest attendance sync/);
    await database.update(runs).set({ state: "Failed" }).where(eq(runs.id, retry));
    await assert.rejects(() => move("Posted"), /latest attendance sync|outdated/);
    await sync(); await refresh(); await snapshot();
    await database.update(schema.payrollRuns).set({ status: "Draft" }).where(eq(schema.payrollRuns.id, payrollId));
    const loanId = randomUUID(), installmentId = randomUUID(), employeeRunId = randomUUID();
    await database.insert(schema.employeesLoans).values({ id: loanId, employeeId: replacement, loanReferenceNumber: "SYNTHETIC-GUARD", amountGranted: "1000", payrollDateDeduction: "2026-09-15", loanDate: "2026-09-01", paymentTerms: "Always", payableLoan: "1000", loanTotalCredit: "1000", amortization: "250", loanBalance: "1000", status: "Active" });
    await database.insert(schema.loanInstallments).values({ id: installmentId, loanId, payrollPeriodId: periodId, payrollCode: "GUARD-TEST", installmentNo: 1, dueDate: "2026-09-15", scheduledAmount: "250" });
    await database.insert(schema.payrollRunEmployees).values({ id: employeeRunId, payrollRunId: payrollId, employeeId: replacement, employeeNoSnapshot: "10002", employeeNameSnapshot: "Synthetic Two" });
    await database.insert(schema.payrollRunLines).values({ payrollRunEmployeeId: employeeRunId, lineType: "Deduction", code: "TEST-LOAN", description: "Synthetic loan deduction", amount: "250", sourceTable: "loan_installments", sourceId: installmentId });
    await move("Reviewed"); await move("Approved");
    assert.equal((await move("Posted"))?.status, "Posted");
    assert.equal((await move("Posted"))?.status, "Posted", "Post retry is idempotent");
    assert.equal((await database.select().from(schema.loanPayments)).length, 1);
    assert.equal((await database.select().from(schema.employeesLoans))[0].loanBalance, "750.00");
    assert.equal((await database.select().from(schema.loanInstallments))[0].status, "Paid");
    await assert.rejects(() => transitionPayrollRunStatus(payrollId, "Void", actor, "Forbidden posted void", engineDb), /cannot be voided/);
    const postedRaw = await database.select().from(schema.attendanceRawLogs);
    await database.transaction(tx => saveAttendanceSourceMapping(tx as unknown as DbClient, actor, "10001", employee, "After-post mapping review", true));
    assert.equal((await database.select().from(schema.payrollRuns))[0].status, "Posted");
    assert.deepEqual(await database.select().from(schema.attendanceRawLogs), postedRaw);
    assert.throws(() => assertFileAttendanceBatch("API"), /cannot be reverted/);
    assert.doesNotThrow(() => assertFileAttendanceBatch("CSV"));
    assert.deepEqual(await payrollActionResult(async () => { throw new PayrollValidationError("Resolve held DTR."); }), { ok: false, error: "Resolve held DTR." });
    const redacted = await payrollActionResult(async () => { throw Error("private-database-credential"); });
    assert.equal(redacted.ok, false); assert.ok(!JSON.stringify(redacted).includes("private-database"));
    console.log("Release guards passed: required first sync, disabled connection, legacy files, stale transitions, durable snapshots, repeat sync, mapping invalidation, exception checks at all transitions, failed/in-flight sync, posted preservation and safe action errors. In-memory SQL, no live payroll.");
  } finally {
    delete process.env.ATTENDANCE_API_REQUIRED_PERIOD_IDS; delete process.env.ATTENDANCE_SOURCE_ENABLED;
    await pg.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

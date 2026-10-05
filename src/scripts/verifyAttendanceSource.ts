import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { SQL, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { attendanceSourceRuns as runs, attendanceSourceMappings as mappings, attendanceSourceEvents as events } from "@/db/attendanceSourceSchema";
import { pullAttendanceSource, manilaWallTime, type SourcePunch } from "@/lib/payroll/attendanceSourceClient";
import { reconcileAttendanceSource } from "@/lib/payroll/attendanceSourceSync";
import { attendanceSchedulerAuthorized } from "@/lib/payroll/attendanceSourceScheduler";
import { attendanceSourceVersion, assertAttendanceSourceReady, confirmAttendanceSourceSummaryRefresh, confirmAttendanceSourcePayrollInput, attendanceSourceDateFilter } from "@/lib/payroll/attendanceSourceGuard";
import type { DbClient } from "@/db";

async function main() {
  const schedulerSecret = "synthetic-scheduler-secret-32-characters";
  assert.equal(attendanceSchedulerAuthorized(true, schedulerSecret, `Bearer ${schedulerSecret}`), true);
  assert.equal(attendanceSchedulerAuthorized(false, schedulerSecret, `Bearer ${schedulerSecret}`), false);
  assert.equal(attendanceSchedulerAuthorized(true, "short", "Bearer short"), false);
  assert.equal(attendanceSchedulerAuthorized(true, schedulerSecret, ""), false);
  assert.equal(attendanceSchedulerAuthorized(true, schedulerSecret, `Bearer ${schedulerSecret.slice(0, -1)}x`), false);
  assert.equal(attendanceSchedulerAuthorized(true, schedulerSecret, `Bearer ${"é".repeat(schedulerSecret.length)}`), false);
  const event: SourcePunch = { eventId: randomUUID(), employeeId: "0001", employeeName: "Synthetic employee", originalEmployeeId: "0001", originalEmployeeName: "Synthetic employee", branchId: "B2", type: "IN", capturedAt: "2026-09-10T16:30:00Z", receivedAt: "2026-09-12T01:00:00Z", updatedAt: "2026-09-12T01:00:00Z", status: "VALID", clockFlag: false, reviewFlags: [], reviewResolved: false };
  const page = (records: SourcePunch[], nextCursor: string | null = null) => Response.json({ schemaVersion: 2, timeZone: "Asia/Manila", from: "2026-09-01", through: "2026-09-15", records, nextCursor });
  const options = { origin: "https://attendance.example.test", token: "synthetic-test-key-only-".repeat(3), from: "2026-09-01", through: "2026-09-15" };
  assert.deepEqual(manilaWallTime(event.capturedAt), { date: "2026-09-11", time: "00:30:00.000", timestamp: "2026-09-11 00:30:00.000" });
  const pulled = await pullAttendanceSource({ ...options, fetcher: async (url, init) => { assert.equal(new URL(String(url)).searchParams.get("version"), "2"); assert.equal(init?.redirect, "error"); return page([event]); } });
  assert.equal(pulled[0].employeeId, "0001");
  await assert.rejects(() => pullAttendanceSource({ ...options, fetcher: async () => page([event, event]) }), /duplicated/);
  await assert.rejects(() => pullAttendanceSource({ ...options, fetcher: async () => page([event], randomUUID()) }), /cursor/);
  let requests = 0; await assert.rejects(() => pullAttendanceSource({ ...options, fetcher: async () => ++requests === 1 ? page([event], event.eventId) : new Response("offline", { status: 503 }) }), /503/);
  const pg = new PGlite(); const database = drizzle(pg, { schema }); const dialect = new PgDialect(); const enums = new Set<string>();
  // Build the relevant existing tables from the actual Drizzle columns, then apply the real additive migration.
  const existing = [schema.employees, schema.payrollPeriods, schema.payrollRuns, schema.attendanceImportBatches, schema.attendanceRawLogs, schema.attendanceDailySummaries, schema.adminAuditEvents, schema.payrollRunEvents];
  for (const table of existing) {
    const config = getTableConfig(table); const columns: string[] = [];
    for (const col of config.columns) {
      const type = col.getSQLType();
      if (col.enumValues?.length && !enums.has(type)) { await pg.exec(`CREATE TYPE "${type}" AS ENUM (${col.enumValues.filter(v => v !== "API").map(v => `'${v.replaceAll("'", "''")}'`).join(",")});`); enums.add(type); }
      let value = "";
      if (col.default instanceof SQL) value = " DEFAULT " + dialect.sqlToQuery(col.default).sql;
      else if (col.default !== undefined) value = " DEFAULT " + (typeof col.default === "string" ? `'${col.default.replaceAll("'", "''")}'` : String(col.default));
      columns.push(`"${col.name}" ${type}${value}${col.primary ? " PRIMARY KEY" : ""}`);
    }
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`);
  }
  await pg.exec(await readFile("src/db/migrations/0119_attendance_source.sql", "utf8"));
  await pg.exec(await readFile("src/db/migrations/0120_attendance_matching_workflow.sql", "utf8"));
  const person = randomUUID(), person2 = randomUUID(), periodId = randomUUID(), actor = randomUUID();
  await database.insert(schema.employees).values([{ id: person, employeeNo: "0001", firstName: "Test", lastName: "One" }, { id: person2, employeeNo: "0002", firstName: "Test", lastName: "Two" }]);
  await database.insert(schema.payrollPeriods).values({ id: periodId, code: "TEST-202609-A", payrollTerms: "Semi-Monthly", cycle: "A", year: 2026, month: 9, startDate: options.from, endDate: options.through, nominalPayDate: options.through, adjustedPayDate: options.through });
  await database.insert(mappings).values([{ sourceEmployeeId: "0001", employeeId: person, actorUserId: actor, reason: "Synthetic mapping" }, { sourceEmployeeId: "0002", employeeId: person2, actorUserId: actor, reason: "Synthetic mapping" }]);
  async function reconcile(records: SourcePunch[]) { const id = randomUUID(); await database.insert(runs).values({ id, payrollPeriodId: periodId, state: "Fetching", actorUserId: actor, fromDate: "2026-08-31", throughDate: "2026-09-16" }); return reconcileAttendanceSource(database as unknown as Parameters<typeof reconcileAttendanceSource>[0], periodId, id, actor, records); }
  assert.equal((await reconcile([event])).projected, 1);
  process.env.ATTENDANCE_SOURCE_ENABLED="true";
  const client=database as unknown as DbClient;
  await assert.rejects(()=>assertAttendanceSourceReady(periodId,client),/Refresh attendance summaries/);
  const sourceVersion=await attendanceSourceVersion(periodId,client);
  await database.transaction(tx=>confirmAttendanceSourceSummaryRefresh(tx as unknown as DbClient,periodId,sourceVersion,false));
  await assert.rejects(()=>assertAttendanceSourceReady(periodId,client),/Refresh attendance summaries/);
  await database.transaction(tx=>confirmAttendanceSourceSummaryRefresh(tx as unknown as DbClient,periodId,sourceVersion));
  assert.equal(await assertAttendanceSourceReady(periodId,client),sourceVersion);
  const repeated = await reconcile([event]); assert.equal(repeated.projected, 0); assert.equal(repeated.changed, 0); assert.equal((await database.select().from(schema.attendanceRawLogs)).length, 1);
  await assert.rejects(()=>database.transaction(tx=>confirmAttendanceSourcePayrollInput(tx as unknown as DbClient,periodId,sourceVersion)),/changed while payroll/);
  const raw = (await database.select().from(schema.attendanceRawLogs))[0]; assert.equal(raw.logDate, "2026-09-11"); assert.equal(raw.logTime, "00:30:00");
  await reconcile([{ ...event, status: "VOID" }]); assert.equal((await database.select().from(schema.attendanceRawLogs)).length, 0);
  await assert.rejects(()=>assertAttendanceSourceReady(periodId,client),/unresolved exceptions/);
  await reconcile([{ ...event, employeeId: "0002", employeeName: "Test Two" }]); assert.equal((await database.select().from(schema.attendanceRawLogs))[0].employeeId, person2);
  await assert.rejects(() => reconcile([]), /disappeared/); assert.equal((await database.select().from(schema.attendanceRawLogs)).length, 1);
  await database.update(schema.payrollPeriods).set({ status: "Closed" }).where(eq(schema.payrollPeriods.id, periodId));
  assert.equal((await reconcile([{ ...event, status: "VOID" }])).lateChanges, 1); assert.equal((await database.select().from(schema.attendanceRawLogs)).length, 1);
  const original = (await database.select().from(events))[0]; assert.deepEqual(original.firstPayload, event); assert.ok(original.revision >= 4);
  await database.update(schema.payrollPeriods).set({status:"Open"}).where(eq(schema.payrollPeriods.id,periodId));
  const postedId=randomUUID(); await database.insert(schema.payrollRuns).values({id:postedId,payrollPeriodId:periodId,runNumber:1,status:"Posted"});
  assert.equal((await reconcile([{...event,status:"VOID"}])).lateChanges,1);
  assert.equal((await database.select().from(schema.attendanceRawLogs)).length,1);
  assert.equal((await database.select().from(schema.payrollRuns))[0].status,"Posted");
  await database.delete(schema.payrollRuns).where(eq(schema.payrollRuns.id,postedId));
  const unknown={...event,eventId:randomUUID(),employeeId:"NOT-MAPPED"};
  const quarantined=await reconcile([{...event,employeeId:"0002"},unknown]);
  assert.equal(quarantined.unmatched,1);assert.equal(quarantined.withheld,1);
  await assert.rejects(()=>assertAttendanceSourceReady(periodId,client),/unresolved exceptions/);
  const outside={...event,eventId:randomUUID(),type:"IN" as const,capturedAt:"2026-08-31T14:00:00Z"};
  const overnight={...event,eventId:randomUUID(),type:"OUT" as const,capturedAt:"2026-08-31T22:00:00Z"};
  const existingPunches=[{...event,employeeId:"0002"}, {...unknown,status:"VOID" as const}];
  assert.equal((await reconcile([...existingPunches,outside,overnight])).boundaryReview,0);
  const summaryInput=await database.select().from(schema.attendanceRawLogs).innerJoin(schema.attendanceImportBatches,eq(schema.attendanceRawLogs.batchId,schema.attendanceImportBatches.id)).where(attendanceSourceDateFilter(options.from,options.through));
  assert.ok(summaryInput.some(r=>r.attendance_raw_logs.logDate==="2026-08-31"),"API summary input retains the preceding overnight IN");
  assert.equal((await reconcile([...existingPunches,{...outside,status:"VOID"},overnight])).boundaryReview,1);
  const [fileBatch]=await database.insert(schema.attendanceImportBatches).values({payrollPeriodId:periodId,sourceFileName:`attendance-api:${periodId}`,sourceFormat:"CSV",status:"Processed"}).returning();
  await database.insert(schema.attendanceRawLogs).values({batchId:fileBatch.id,employeeId:person,employeeNo:"0001",direction:"IN",loggedAt:new Date(event.capturedAt),logDate:"2026-09-11",logTime:"00:30:00",rawText:"test",normalizedHash:"test"});
  await assert.rejects(()=>reconcile([...existingPunches,outside,overnight,{...event,eventId:randomUUID()}]),/overlapping file imports/);
  await pg.close(); console.log("Attendance source checks passed: transport, UTC/Manila, migration, idempotency, void/restore, reattribution, missing-event rollback, closed/posted freeze, immutable history, stale-summary/payroll guards, quarantine, overnight boundaries and file-import overlap.");
}
main().catch(e => { console.error(e); process.exit(1); });

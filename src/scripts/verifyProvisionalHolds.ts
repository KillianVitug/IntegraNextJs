import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { attendanceImportBatches, attendanceRawLogs, employeeAttendanceDayStatusOverrides } from "@/db/schema";
import { loadProvisionalPayroll } from "@/lib/payroll/provisional";
import type { ProvisionalPayroll } from "@/lib/payroll/provisionalTypes";

async function fingerprint(database: DbClient) {
  return (await database.execute(sql`select json_object_agg(table_name, fingerprint) as value from (
    select table_name, (xpath('/row/value/text()', query_to_xml(format('select md5(coalesce(string_agg(to_jsonb(t)::text, '''' order by to_jsonb(t)::text),'''')) as value from %I t',table_name),false,true,'')))[1]::text as fingerprint
    from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
  ) x`)).rows;
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1", "Use only the restored loopback fixture");
  assert.match(url.pathname, /^\/payroll_provisional_\d+_gui$/);
  const fixture = JSON.parse(readFileSync(process.env.PROVISIONAL_FIXTURE_FILE!, "utf8"));
  assert.equal(fixture.fictional, true);
  const periodId: string = fixture.periodId, day: string = fixture.completeDay;
  const checks: string[] = [], before = await fingerprint(db), rollback = new Error("Rollback held-time fixture");
  try {
    await db.transaction(async tx => {
      const database = { transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as typeof db;
      const read = (employeeId: string, group: "Daily" | "Monthly") => loadProvisionalPayroll({ periodId, employeeId, group, asOfDate: "2026-10-07" }, database);
      const key = (employeeId: string) => and(eq(employeeAttendanceDayStatusOverrides.payrollPeriodId, periodId), eq(employeeAttendanceDayStatusOverrides.employeeId, employeeId), eq(employeeAttendanceDayStatusOverrides.attendanceDate, day));
      const heldDay = (view: ProvisionalPayroll) => {
        const value = view.rows[0].days.find(row => row.date === day)!;
        assert.equal(value.workedMinutes, 480, "A payroll hold does not erase recorded attendance");
        assert.equal(value.attendance?.complete, true, "The complete pair needs no punch correction");
        assert.equal(value.status, "Held time");
        assert.equal(value.payrollHold, true);
        assert(value.warnings.some(note => note.includes("held-time decisions")), "Explain the distinct held-time action");
        return value;
      };
      assert.equal((await tx.select().from(employeeAttendanceDayStatusOverrides).where(key(fixture.dailyEmployeeId))).length, 0, "Fixture starts without a saved daily status");
      const daily = await read(fixture.dailyEmployeeId, "Daily");
      assert.equal(daily.rows[0].recorded?.gross, 600);
      assert.equal(daily.rows[0].days.find(row => row.date === day)?.status, "Recorded");
      const [override] = await tx.insert(employeeAttendanceDayStatusOverrides).values({ payrollPeriodId: periodId, employeeId: fixture.dailyEmployeeId, attendanceDate: day, status: "Hold", remarks: "Fictional regression; rolled back" }).returning();
      const beforeRead = await fingerprint(tx);
      const held = await read(fixture.dailyEmployeeId, "Daily");
      assert.deepEqual(await fingerprint(tx), beforeRead, "Provisional read itself changes no table");
      heldDay(held);
      assert.equal(held.rows[0].recorded?.gross, 0, "Normal daily payroll rules withhold the held work");
      assert.equal(held.rows[0].recorded?.deductions, 0, "Zero payable earnings collect no deductions");
      assert.equal(held.rows[0].forecast?.gross, daily.rows[0].forecast!.gross - 600, "The same saved hold applies to forecast earnings");
      assert.notEqual(held.inputRevision, daily.inputRevision, "Hold changes estimate freshness");
      checks.push("Daily complete pair remains eight recorded hours, is explicitly Held time, and contributes no held earnings or deductions");

      await tx.update(employeeAttendanceDayStatusOverrides).set({ status: "Present" }).where(eq(employeeAttendanceDayStatusOverrides.id, override.id));
      const present = await read(fixture.dailyEmployeeId, "Daily");
      assert.equal(present.rows[0].days.find(row => row.date === day)?.payrollHold, false);
      assert.equal(present.rows[0].days.find(row => row.date === day)?.status, "Recorded");
      assert.deepEqual(present.rows[0].recorded, daily.rows[0].recorded, "Present restores the normal payable pair");
      await tx.delete(employeeAttendanceDayStatusOverrides).where(eq(employeeAttendanceDayStatusOverrides.id, override.id));
      const reset = await read(fixture.dailyEmployeeId, "Daily");
      assert.equal(reset.rows[0].days.find(row => row.date === day)?.payrollHold, false);
      assert.deepEqual(reset.rows[0].recorded, daily.rows[0].recorded);
      assert.equal(reset.inputRevision, daily.inputRevision, "Reset to unchanged inputs restores the same revision");
      checks.push("Present and reset restore payable earnings and remove Held time; unchanged reset inputs recover the original revision");

      const employeeId: string = fixture.firstHalfMonthlyEmployeeId;
      assert.equal((await tx.select().from(employeeAttendanceDayStatusOverrides).where(key(employeeId))).length, 0);
      const [batch] = await tx.insert(attendanceImportBatches).values({ payrollPeriodId: periodId, sourceFileName: `FICTIONAL-HOLD-${randomUUID()}.csv`, sourceFormat: "CSV", status: "Processed", totalRows: 2, matchedRows: 2 }).returning();
      await tx.insert(attendanceRawLogs).values(([ ["08:00:00", "IN"], ["17:00:00", "OUT"] ] as const).map(([time, direction]) => ({ employeeId, employeeNo: fixture.employeeNumbers[1], batchId: batch.id, logDate: day, logTime: time, loggedAt: sql`${day + " " + time}::timestamp`, direction, rawText: "FICTIONAL MONTHLY HOLD REGRESSION" })));
      const monthly = await read(employeeId, "Monthly");
      assert.equal(monthly.rows[0].recorded?.gross, 30000);
      await tx.insert(employeeAttendanceDayStatusOverrides).values({ payrollPeriodId: periodId, employeeId, attendanceDate: day, status: "Hold", remarks: "Fictional monthly regression; rolled back" });
      const monthlyHeld = await read(employeeId, "Monthly");
      heldDay(monthlyHeld);
      assert.deepEqual(monthlyHeld.rows[0].recorded, monthly.rows[0].recorded, "An attendance hold never reduces fixed monthly salary or changes its configured deductions");
      assert.deepEqual(monthlyHeld.rows[0].forecast, monthly.rows[0].forecast);
      checks.push("Monthly held day remains visible with eight recorded hours while full fixed salary and configured deductions stay unchanged");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.deepEqual(await fingerprint(db), before, "Every restored table is unchanged after rollback");
  checks.push("Actual provisional read is mutation-free and all restored tables are unchanged after fixture rollback");
  console.log(JSON.stringify({ passed: true, checks, productionAccess: false }));
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

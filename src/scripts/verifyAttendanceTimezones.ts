import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SourcePunch } from "@/lib/payroll/attendanceSourceClient";

const zones = ["UTC", "Asia/Manila", "America/New_York"];
const scenarios = [
  { name: "day", date: "2026-09-10", in: "08:00:00", out: "17:00:00", nextDay: false, breakMinutes: 60, expected: 480 },
  { name: "overnight", date: "2026-09-10", in: "22:00:00", out: "06:00:00", nextDay: true, breakMinutes: 0, expected: 480 },
  { name: "host DST spring transition", date: "2026-03-07", in: "22:00:00", out: "06:00:00", nextDay: true, breakMinutes: 0, expected: 480 },
  { name: "host DST fall transition", date: "2026-10-31", in: "22:00:00", out: "06:00:00", nextDay: true, breakMinutes: 0, expected: 480 },
  { name: "host nonexistent civil hour", date: "2026-03-08", in: "01:30:00", out: "03:30:00", nextDay: false, breakMinutes: 0, expected: 120 },
  { name: "explicit non-Manila source offset", date: "2026-09-10", in: "08:00:00", out: "17:00:00", nextDay: false, breakMinutes: 60, expected: 480, sourceIn: "2026-09-10T05:30:00+05:30", sourceOut: "2026-09-10T14:30:00+05:30" },
];

async function verify() {
  // Imports occur only after the child starts with the isolated environment below.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { PgDialect, getTableConfig } = await import("drizzle-orm/pg-core");
  const { SQL, is } = await import("drizzle-orm");
  const schema = await import("@/db/schema");
  const { attendanceSourceMappings: mappings, attendanceSourceRuns: runs } = await import("@/db/attendanceSourceSchema");
  const { reconcileAttendanceSource } = await import("@/lib/payroll/attendanceSourceSync");
  const { manilaWallTime, sourceDayOffset } = await import("@/lib/payroll/attendanceSourceClient");
  const { buildAttendanceSummaryComputations } = await import("@/lib/payroll/attendanceSync");
  const { summarizeEmployeeDay } = await import("@/lib/payroll/attendance");
  const { detectAttendanceCorrectionSuggestions, applyApprovedAttendanceCorrections } = await import("@/lib/payroll/attendanceCorrections");

  for (const scenario of scenarios) {
    const pg = new PGlite();
    try {
      const database = drizzle(pg, { schema }), dialect = new PgDialect(), enums = new Set<string>();
      // Same selected-column base fixture as verifyAttendanceSource; no persistent database.
      for (const table of [schema.employeesTimekeeping, schema.employeeShiftAssignments, schema.employeeWeeklyShiftPatterns, schema.employeeWeeklyShiftPatternDays, schema.employees, schema.payrollPeriods, schema.payrollRuns, schema.attendanceImportBatches, schema.attendanceRawLogs, schema.attendanceDailySummaries, schema.adminAuditEvents, schema.payrollRunEvents]) {
        const config = getTableConfig(table), columns: string[] = [];
        for (const col of config.columns) {
          const type = col.getSQLType();
          if (col.enumValues?.length && !enums.has(type)) {
            await pg.exec(`CREATE TYPE "${type}" AS ENUM (${col.enumValues.filter(v => v !== "API").map(v => `'${v.replaceAll("'", "''")}'`).join(",")});`);
            enums.add(type);
          }
          let value = "";
          if (is(col.default, SQL)) value = " DEFAULT " + dialect.sqlToQuery(col.default).sql;
          else if (col.default !== undefined) value = " DEFAULT " + (typeof col.default === "string" ? `'${col.default.replaceAll("'", "''")}'` : String(col.default));
          columns.push(`"${col.name}" ${type}${value}${col.primary ? " PRIMARY KEY" : ""}`);
        }
        await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`);
      }
      await pg.exec(await readFile("src/db/migrations/0119_attendance_source.sql", "utf8"));
      await pg.exec(await readFile("src/db/migrations/0120_attendance_matching_workflow.sql", "utf8"));
    await pg.exec(await readFile("src/db/migrations/0121_attendance_resolution.sql", "utf8"));
  await pg.exec(await readFile("src/db/migrations/0122_attendance_duplicates.sql", "utf8"));
      const employeeId = randomUUID(), periodId = randomUUID(), actor = randomUUID();
      const endDate = sourceDayOffset(scenario.date, 1);
      await database.insert(schema.employees).values({ id: employeeId, employeeNo: "0001", firstName: "Synthetic", lastName: "Timezone" });
      await database.insert(schema.payrollPeriods).values({ id: periodId, code: "SYNTHETIC-TIMEZONE", payrollTerms: "Semi-Monthly", cycle: "A", year: 2026, month: Number(scenario.date.slice(5, 7)), startDate: scenario.date, endDate, nominalPayDate: endDate, adjustedPayDate: endDate });
      await database.insert(mappings).values({ sourceEmployeeId: "0001", employeeId, actorUserId: actor, reason: "Synthetic test only" });
      const capture = (type: "IN" | "OUT", capturedAt: string): SourcePunch => ({ eventId: randomUUID(), employeeId: "0001", employeeName: "Synthetic", originalEmployeeId: "0001", originalEmployeeName: "Synthetic", branchId: type === "IN" ? "B1" : "B2", type, capturedAt, receivedAt: capturedAt, updatedAt: capturedAt, status: "VALID", clockFlag: false, reviewFlags: [], reviewResolved: false });
      const sourceIn = scenario.sourceIn ?? `${scenario.date}T${scenario.in}+08:00`;
      const sourceOut = scenario.sourceOut ?? `${scenario.nextDay ? endDate : scenario.date}T${scenario.out}+08:00`;
      const records = [capture("IN", sourceIn), capture("OUT", sourceOut)];
      let sequence = 0;
      const reconcile = async () => {
        const id = randomUUID();
        await database.insert(runs).values({ id, payrollPeriodId: periodId, state: "Fetching", actorUserId: actor, fromDate: sourceDayOffset(scenario.date, -1), throughDate: sourceDayOffset(endDate, 1), startedAt: new Date(Date.UTC(2026, 11, 1) + 1000 * ++sequence) });
        return reconcileAttendanceSource(database as unknown as Parameters<typeof reconcileAttendanceSource>[0], periodId, id, actor, records);
      };
      assert.equal((await reconcile()).projected, 2);
      const originalRows = await database.select().from(schema.attendanceRawLogs);
      assert.deepEqual(originalRows.map(r => r.siteCode), ["B1", "B2"]);
      assert.equal(originalRows[0].loggedAt.toISOString(), manilaWallTime(sourceIn).timestamp.replace(" ", "T") + "Z");
      assert.equal(originalRows[1].loggedAt.toISOString(), manilaWallTime(sourceOut).timestamp.replace(" ", "T") + "Z");
      // An unchanged repeat reads existing imported rows; no timestamp repair/rewrite is needed.
      assert.equal((await reconcile()).projected, 0);
      const rows = await database.select().from(schema.attendanceRawLogs);
      assert.deepEqual(rows, originalRows);
      const logs = rows.map(row => ({ ...row, rawLogId: row.id, sourceLine: row.sourceLine ?? 0, rawText: row.rawText ?? "" }));
      const shift = { checkInTime: scenario.in, checkOutTime: scenario.out, breakMinutes: scenario.breakMinutes, graceMinutes: 0, hoursPerDay: scenario.expected / 60, restDay: null };
      const computations = buildAttendanceSummaryComputations({ employees: [{ id: employeeId, employeeNo: "0001", timekeeping: null }], logs, approvedLeaves: [], shiftAssignments: [{ id: 1, employeeId, shiftTableId: null, shiftName: "Synthetic clock regression", shiftCode: "FIXED", shiftSchedule: "Morning", effectiveFrom: "2026-01-01", effectiveTo: null, ...shift, hoursPerDay: String(shift.hoursPerDay), paidBreakMinutes: 0, isFlexible: false, createdAt: new Date(), updatedAt: new Date() }], weeklyPatterns: [], shiftTableBreaksByShiftTableId: new Map(), allowedAttendanceDateRange: { startDate: scenario.date, endDate: scenario.date } });
      assert.equal(computations.length, 1);
      const summary = computations[0];
      assert.equal(summary.workedMinutes, scenario.expected, `${scenario.name}: worked minutes`);
      assert.equal(summary.regularMinutes, scenario.expected);
      assert.equal(summary.lateMinutes, 0);
      assert.equal(summary.undertimeMinutes, 0);
      assert.equal(summary.firstInAt?.toISOString(), originalRows[0].loggedAt.toISOString());
      assert.equal(summary.lastOutAt?.toISOString(), originalRows[1].loggedAt.toISOString());
      if (scenario.nextDay) assert.equal(summary.nightMinutes, 480);
      if (scenario.name === "host nonexistent civil hour") {
        const gapShift = { ...shift, checkOutTime: "02:30:00", hoursPerDay: 1 };
        const incomplete = summarizeEmployeeDay(scenario.date, logs.slice(0, 1), gapShift);
        const suggestion = detectAttendanceCorrectionSuggestions({ attendanceDate: scenario.date, logs: logs.slice(0, 1), shift: gapShift, summary: incomplete }).find(r => r.correctionType === "Missing Out");
        assert.ok(suggestion);
        assert.equal(suggestion.payload.syntheticPunches[0].logTime, "02:30:00");
        const corrected = applyApprovedAttendanceCorrections(logs.slice(0, 1), [suggestion]);
        assert.equal(summarizeEmployeeDay(scenario.date, corrected, gapShift).workedMinutes, 60);
      }
      console.log(`PASS ${process.env.TZ}: ${scenario.name} (${summary.workedMinutes} minutes)`);
    } finally { await pg.close(); }
  }
}

async function main() {
  if (process.argv.includes("--isolated-timezone-child")) { await verify(); return; }
  for (const zone of zones) {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", TZ: zone, TSX_DISABLE_CACHE: "1", PATH: path.dirname(process.execPath) };
    for (const key of ["SystemRoot", "WINDIR", "ComSpec", "SystemDrive", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"]) if (process.env[key] !== undefined) env[key] = process.env[key];
    const result = spawnSync(process.execPath, [...process.execArgv, path.resolve(process.argv[1]), "--isolated-timezone-child"], { env, encoding: "utf8", timeout: 120_000, windowsHide: true });
    process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? "");
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Timezone regression failed in ${zone}`);
  }
  console.log(`Attendance timezone checks passed: ${scenarios.length * zones.length} scenarios across ${zones.length} host timezones.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

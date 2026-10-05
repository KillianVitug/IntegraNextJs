import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { SQL, is } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import * as schema from "@/db/schema";
import type { DbClient } from "@/db";

/** In-memory SQL only. Never reads DATABASE_URL or connects to a server. */
export async function matchingDatabase() {
  const pg = new PGlite(), database = drizzle(pg, { schema }), dialect = new PgDialect(), enums = new Set<string>();
  for (const table of [schema.employees, schema.payrollPeriods, schema.payrollRuns, schema.attendanceImportBatches, schema.attendanceRawLogs, schema.attendanceDailySummaries, schema.adminAuditEvents, schema.payrollRunEvents, schema.employeesGeneralInfo, schema.employeesTimekeeping, schema.employeeShiftAssignments, schema.employeeWeeklyShiftPatterns, schema.employeeWeeklyShiftPatternDays, schema.shiftTableBreaks, schema.attendanceDtrCorrections, schema.employeeAttendancePeriodOverrides, schema.employeeAttendanceDayStatusOverrides, schema.employeeAttendanceDayMetricOverrides, schema.employeesLeaveRecords]) {
    const config = getTableConfig(table), columns: string[] = [];
    for (const col of config.columns) {
      const type = col.getSQLType();
      if (col.enumValues?.length && !enums.has(type)) {
        await pg.exec(`CREATE TYPE "${type}" AS ENUM (${col.enumValues.filter(v => v !== "API").map(v => `'${v.replaceAll("'", "''")}'`).join(",")})`); enums.add(type);
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
  return { pg, database, client: database as unknown as DbClient };
}

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { reconcileAttendanceSource, saveAttendanceSourceMapping } from "@/lib/payroll/attendanceSourceSync";
import { manilaWallTime, sourceDayOffset, type SourcePunch } from "@/lib/payroll/attendanceSourceClient";
import { groupLogsByEmployeeAndAttendanceDate, summarizeEmployeeDay, type ParsedAttendanceLog } from "@/lib/payroll/attendance";
import { getAppRoleForGroups, getDefaultGroupForConfidentialityLevel } from "@/lib/auth/permissions";
import { need, parseArgs, validateScope, type TestConfig } from "./guard";

export type Database = Parameters<typeof reconcileAttendanceSource>[0];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Row = Record<string, unknown>;
export type Query = (statement: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
export function queryWith(database: Database | Transaction): Query {
  return async (statement, params = []) => {
    const query = sql.empty();
    for (const part of statement.split(/(\$\d+)/)) {
      query.append(/^\$\d+$/.test(part) ? sql`${params[Number(part.slice(1)) - 1]}` : sql.raw(part));
    }
    return await database.execute(query) as unknown as { rows: Row[] };
  };
}

export const requiredTables = [schema.employees, schema.employeesGeneralInfo, schema.authAccounts, schema.authPermissionGroups, schema.authAccountPermissionGroups, schema.payrollPeriods, schema.payrollRuns, schema.attendanceImportBatches, schema.attendanceRawLogs, schema.attendanceDailySummaries, schema.adminAuditEvents, schema.payrollRunEvents, schema.attendanceSourceMappings, schema.attendanceSourceRuns, schema.attendanceSourceEvents, schema.attendanceSourceRevisions, schema.attendanceSourceProjections, schema.attendanceSourcePeriods, schema.attendanceSourceIdentities, schema.attendanceMatchBatches, schema.attendanceMatchChanges];
const normalizeType = (t: string) => t.toLowerCase().replace(/^serial$/, "integer").replace(/^bigserial$/, "bigint").replace(/^varchar/, "character varying").replace(/^decimal/, "numeric").replace(/^timestamp$/, "timestamp without time zone").replace(/^time$/, "time without time zone").replaceAll(/\s+/g, "");

export async function inspectSchema(query: Query) {
  const { rows } = await query("SELECT c.relname AS table_name, a.attname AS column_name, format_type(a.atttypid,a.atttypmod) AS data_type, a.attnotnull AS not_null FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped");
  const differences: { table: string; column?: string; issue: string }[] = [];
  for (const table of requiredTables) {
    const config = getTableConfig(table), actual = rows.filter(r => r.table_name === config.name);
    if (!actual.length) { differences.push({ table: config.name, issue: "missing_table" }); continue; }
    for (const col of config.columns) {
      const found = actual.find(r => r.column_name === col.name);
      if (!found) differences.push({ table: config.name, column: col.name, issue: "missing_column" });
      else if (normalizeType(String(found.data_type)) !== normalizeType(col.getSQLType())) differences.push({ table: config.name, column: col.name, issue: "different_type" });
      else if (Boolean(found.not_null) !== col.notNull) differences.push({ table: config.name, column: col.name, issue: "different_nullability" });
    }
  }
  const enums = await query("SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid JOIN pg_namespace n ON t.typnamespace=n.oid WHERE n.nspname='public' AND t.typname='attendance_import_format'");
  if (!enums.rows.some(r => r.enumlabel === "API")) differences.push({ table: "attendance_import_format", issue: "missing_API_enum_value" });
  const constraints = await query("SELECT c.relname AS table_name, pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relname LIKE 'attendance_source_%' OR c.relname LIKE 'attendance_match_%')");
  const needed: Record<string, string[]> = {
    attendance_source_identities: ["PRIMARY KEY (source_employee_id)"],
    attendance_match_batches: ["PRIMARY KEY (id)"],
    attendance_match_changes: ["PRIMARY KEY (id)", "FOREIGN KEY (batch_id) REFERENCES attendance_match_batches(id)", "UNIQUE (batch_id, source_employee_id)"],
    attendance_source_mappings: ["PRIMARY KEY (source_employee_id)", "FOREIGN KEY (employee_id) REFERENCES employees(id)"],
    attendance_source_runs: ["PRIMARY KEY (id)", "FOREIGN KEY (payroll_period_id) REFERENCES payroll_periods(id)"],
    attendance_source_events: ["PRIMARY KEY (event_id)"],
    attendance_source_revisions: ["PRIMARY KEY (id)", "FOREIGN KEY (event_id) REFERENCES attendance_source_events(event_id)", "FOREIGN KEY (run_id) REFERENCES attendance_source_runs(id)"],
    attendance_source_projections: ["PRIMARY KEY (payroll_period_id, event_id)", "FOREIGN KEY (payroll_period_id) REFERENCES payroll_periods(id)", "FOREIGN KEY (event_id) REFERENCES attendance_source_events(event_id)", "FOREIGN KEY (raw_log_id) REFERENCES attendance_raw_logs(id) ON DELETE RESTRICT", "FOREIGN KEY (employee_id) REFERENCES employees(id)"],
    attendance_source_periods: ["PRIMARY KEY (payroll_period_id)", "FOREIGN KEY (payroll_period_id) REFERENCES payroll_periods(id)", "FOREIGN KEY (input_run_id) REFERENCES attendance_source_runs(id)", "FOREIGN KEY (summaries_run_id) REFERENCES attendance_source_runs(id)"],
  };
  for (const [table, definitions] of Object.entries(needed)) for (const definition of definitions) {
    if (!constraints.rows.some(r => r.table_name === table && r.definition === definition)) differences.push({ table, issue: `missing_constraint:${definition}` });
  }
  return { compatible: differences.length === 0, differences, coverage: "Required columns/types/nullability, API enum, and 0119/0120 matching primary/foreign/unique keys. Not a complete production-schema or migration-history certification." };
}

export async function readOnly<T>(database: Database, fn: (query: Query) => Promise<T>) {
  return database.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    await tx.execute(sql`SET LOCAL search_path = public, pg_catalog`);
    return fn(queryWith(tx));
  }, { accessMode: "read only", isolationLevel: "repeatable read" });
}

export async function checkScope(query: Query, c: TestConfig, lock = false) {
  const blockers: string[] = [];
  const periods = await query(`SELECT id,status,start_date,end_date FROM payroll_periods WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [c.periodId]);
  const p = periods.rows[0];
  if (!p || p.status !== "Open" || p.start_date !== c.periodStart || p.end_date !== c.periodEnd) blockers.push("period_not_matching_open_scope");
  if ((await query(`SELECT id FROM payroll_runs WHERE payroll_period_id=$1${lock ? " FOR UPDATE" : ""}`, [c.periodId])).rows.length) blockers.push("test_period_has_payroll_runs");
  if ((await query("SELECT id FROM attendance_import_batches WHERE payroll_period_id=$1 AND source_format<>'API' LIMIT 1", [c.periodId])).rows.length) blockers.push("test_period_has_file_imports");
  const actors = await query("SELECT a.status,e.deleted_at,g.confidentiality_level FROM auth_accounts a JOIN employees e ON e.id=a.employee_id LEFT JOIN employees_general_info g ON g.employee_id=e.id WHERE a.id=$1", [c.actorUserId]);
  const actor = actors.rows[0];
  const groups = await query("SELECT g.key FROM auth_account_permission_groups m JOIN auth_permission_groups g ON g.id=m.group_id WHERE m.account_id=$1", [c.actorUserId]);
  const fallback = getDefaultGroupForConfidentialityLevel(actor?.confidentiality_level as Parameters<typeof getDefaultGroupForConfidentialityLevel>[0]);
  const keys = groups.rows.length ? groups.rows.map(r => String(r.key)) : fallback ? [fallback] : [];
  if (!actor || actor.status !== "Active" || actor.deleted_at || getAppRoleForGroups(keys) !== "ADMIN") blockers.push("active_admin_audit_actor_required");
  const mappings = await query("SELECT source_employee_id,employee_id FROM attendance_source_mappings");
  for (const m of c.mappings) {
    if ((await query("SELECT source_employee_id FROM attendance_source_identities WHERE source_employee_id=$1 AND classification='TestOnly'", [m.sourceEmployeeId])).rows.length) blockers.push("test_only_identity_requires_restoration");
    const employee = (await query("SELECT id,employee_no,deleted_at FROM employees WHERE id=$1", [m.employeeId])).rows[0];
    if (!employee || employee.deleted_at || !employee.employee_no) blockers.push("mapped_employee_not_active");
    if (mappings.rows.some(r => (r.source_employee_id === m.sourceEmployeeId && r.employee_id !== m.employeeId) || (r.employee_id === m.employeeId && r.source_employee_id !== m.sourceEmployeeId))) blockers.push("mapping_conflicts_with_existing_identity");
    if ((await query("SELECT id FROM attendance_daily_summaries WHERE employee_id=$1 AND attendance_date BETWEEN $2 AND $3 LIMIT 1", [m.employeeId, c.periodStart, c.periodEnd])).rows.length) blockers.push("test_scope_has_existing_summaries");
  }
  const previous = await query("SELECT e.source_employee_id FROM attendance_source_projections p JOIN attendance_source_events e ON e.event_id=p.event_id WHERE p.payroll_period_id=$1", [c.periodId]);
  if (previous.rows.some(r => !c.mappings.some(m => m.sourceEmployeeId === r.source_employee_id))) blockers.push("previous_import_outside_employee_scope");
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)] };
}

export function sourceScope(c: TestConfig, records: SourcePunch[]) {
  const unscoped = [...new Set(records.filter(r => !c.mappings.some(m => m.sourceEmployeeId === r.employeeId)).map(r => r.employeeId))].sort();
  return { ready: records.length > 0 && unscoped.length === 0, sourceEmployeeIds: [...new Set(records.map(r => r.employeeId))].sort(), unscopedEmployeeIds: unscoped, records: records.length };
}

export async function compare(query: Query, c: TestConfig, records: SourcePunch[]) {
  need(records.length <= 2000, "source_exceeds_small_test_limit");
  const imported = await query("SELECT p.event_id,p.employee_id,p.raw_log_id,r.log_date,r.log_time,r.direction,r.employee_no,r.site_code,r.normalized_hash,r.logged_at FROM attendance_source_projections p LEFT JOIN attendance_raw_logs r ON r.id=p.raw_log_id WHERE p.payroll_period_id=$1", [c.periodId]);
  need(imported.rows.length <= 2000, "existing_import_exceeds_small_test_limit");
  const duplicates = (values: string[]) => values.length - new Set(values).size;
  const raw = imported.rows.filter(r => r.raw_log_id != null);
  const duplicateRows = await query("SELECT count(*) AS n FROM (SELECT r.normalized_hash FROM attendance_raw_logs r JOIN attendance_import_batches b ON b.id=r.batch_id WHERE b.payroll_period_id=$1 AND b.source_format='API' GROUP BY r.normalized_hash HAVING count(*)>1) d", [c.periodId]);
  const orphanRows = await query("SELECT count(*) AS n FROM attendance_raw_logs r JOIN attendance_import_batches b ON b.id=r.batch_id LEFT JOIN attendance_source_projections p ON p.raw_log_id=r.id AND p.payroll_period_id=b.payroll_period_id WHERE b.payroll_period_id=$1 AND b.source_format='API' AND p.raw_log_id IS NULL", [c.periodId]);
  const totalRaw = await query("SELECT count(*) AS n FROM attendance_raw_logs r JOIN attendance_import_batches b ON b.id=r.batch_id WHERE b.payroll_period_id=$1 AND b.source_format='API'", [c.periodId]);
  const eligible = records.filter(r => r.status === "VALID" && !r.clockFlag && (r.reviewResolved || r.reviewFlags.length === 0));
  let mismatches = 0;
  for (const r of eligible) {
    const found = raw.filter(i => i.event_id === r.eventId), wall = manilaWallTime(r.capturedAt), mapping = c.mappings.find(m => m.sourceEmployeeId === r.employeeId);
    if (found.length !== 1 || found[0].employee_id !== mapping?.employeeId || found[0].log_date !== wall.date || String(found[0].log_time).slice(0, 8) !== wall.time.slice(0, 8) || found[0].direction !== r.type || found[0].site_code !== r.branchId) mismatches++;
  }
  const unexpected = raw.filter(r => !eligible.some(e => e.eventId === r.event_id)).length;
  const cases = c.comparisons.map(test => {
    const mapping = c.mappings.find(m => m.sourceEmployeeId === test.sourceEmployeeId)!;
    const shift = { checkInTime: test.checkInTime, checkOutTime: test.checkOutTime, breakMinutes: test.breakMinutes, graceMinutes: 0, hoursPerDay: test.expectedWorkedMinutes / 60, restDay: null };
    const sourceLogs: ParsedAttendanceLog[] = eligible.filter(r => r.employeeId === test.sourceEmployeeId).map(r => { const w = manilaWallTime(r.capturedAt); return { employeeId: mapping.employeeId, employeeNo: test.sourceEmployeeId, loggedAt: new Date(r.capturedAt), logDate: w.date, logTime: w.time, direction: r.type, sourceLine: 0, rawText: "" }; });
    const rawLogs: ParsedAttendanceLog[] = raw.filter(r => r.employee_id === mapping.employeeId).map(r => ({ employeeId: mapping.employeeId, employeeNo: test.sourceEmployeeId, loggedAt: new Date(String(r.log_date) + "T" + String(r.log_time) + "Z"), logDate: String(r.log_date), logTime: String(r.log_time), direction: r.direction as ParsedAttendanceLog["direction"], sourceLine: 0, rawText: "" }));
    const summary = (logs: ParsedAttendanceLog[]) => {
      const groups = groupLogsByEmployeeAndAttendanceDate(logs, () => shift);
      return summarizeEmployeeDay(test.attendanceDate, groups.get(`${mapping.employeeId}|${test.attendanceDate}`) ?? [], shift);
    };
    const a = summary(sourceLogs), b = summary(rawLogs);
    return { sourceEmployeeId: test.sourceEmployeeId, attendanceDate: test.attendanceDate, expectedMinutes: test.expectedWorkedMinutes, sourceMinutes: a.workedMinutes, importedMinutes: b.workedMinutes, sourceHours: a.workedMinutes / 60, importedHours: b.workedMinutes / 60, sourceAnomalies: a.anomalyFlags, importedAnomalies: b.anomalyFlags, matches: a.workedMinutes === test.expectedWorkedMinutes && b.workedMinutes === test.expectedWorkedMinutes };
  });
  const counts = { source: records.length, eligibleSource: eligible.length, imported: raw.length, totalApiRawRows: Number(totalRaw.rows[0]?.n ?? 0), withheldOrVoidSource: records.length - eligible.length, sourceDuplicateIds: duplicates(records.map(r => r.eventId)), duplicateImportedEventIds: duplicates(raw.map(r => String(r.event_id))), duplicateRawIdReferences: duplicates(raw.map(r => String(r.raw_log_id))), duplicateRawHashGroups: Number(duplicateRows.rows[0]?.n ?? 0), orphanApiRows: Number(orphanRows.rows[0]?.n ?? 0), mismatchedSourceEvents: mismatches, unexpectedImportedEvents: unexpected };
  const punchSamples = records.slice(0, 50).map(r => {
    const wall = manilaWallTime(r.capturedAt), found = raw.find(i => i.event_id === r.eventId);
    return { eventId: r.eventId, sourceEmployeeId: r.employeeId, source: { date: wall.date, time: wall.time, direction: r.type, branch: r.branchId, status: r.status }, imported: found ? { rawLogId: Number(found.raw_log_id), date: String(found.log_date), time: String(found.log_time), direction: String(found.direction), branch: String(found.site_code) } : null };
  });
  return { counts, cases, punchSamples, punchSamplesTruncated: records.length > 50, matches: counts.eligibleSource === counts.imported && counts.totalApiRawRows === counts.imported && !counts.sourceDuplicateIds && !counts.duplicateImportedEventIds && !counts.duplicateRawIdReferences && !counts.duplicateRawHashGroups && !counts.orphanApiRows && !mismatches && !unexpected && cases.every(r => r.matches), hoursBasis: "Configured comparison shifts using the production attendance calculator; no persisted summary refresh, leave/holiday override or net-pay calculation." };
}

export async function writeOnce(database: Database, c: TestConfig, records: SourcePunch[], command: string[]) {
  const intent = parseArgs(command);
  need(intent.mode === "sync", "explicit_scoped_write_required");
  validateScope(c, intent);
  need(records.length <= 2000, "source_exceeds_small_test_limit");
  need(sourceScope(c, records).ready, "source_outside_explicit_scope_or_empty");
  return database.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SET LOCAL search_path = public, pg_catalog`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73612849)`);
    const query = queryWith(tx);
    need((await checkScope(query, c, true)).ready, "write_scope_changed_or_not_ready");
    for (const record of records) need(!(await query("SELECT event_id FROM attendance_source_projections WHERE event_id=$1 AND payroll_period_id<>$2 LIMIT 1", [record.eventId, c.periodId])).rows.length, "source_event_used_by_another_period");
    // Load first-time identities before the verified mapping workflow reads them.
    // This initial pull and the subsequent mappings/final pull remain inside the
    // same outer transaction; a failed comparison rolls everything back.
    const missingIdentity = await query("SELECT source_employee_id FROM attendance_source_events");
    if (c.mappings.some(m => !missingIdentity.rows.some(r => r.source_employee_id === m.sourceEmployeeId))) {
      const seedId = randomUUID();
      await tx.insert(schema.attendanceSourceRuns).values({ id: seedId, payrollPeriodId: c.periodId, state: "Fetching", startedAt: sql`clock_timestamp()`, actorUserId: c.actorUserId, fromDate: sourceDayOffset(c.periodStart, -1), throughDate: sourceDayOffset(c.periodEnd, 1) });
      await reconcileAttendanceSource(tx as unknown as Database, c.periodId, seedId, c.actorUserId, records);
    }
    for (const m of c.mappings) {
      const existing = await query("SELECT source_employee_id FROM attendance_source_mappings WHERE source_employee_id=$1", [m.sourceEmployeeId]);
      if (!existing.rows.length) await saveAttendanceSourceMapping(tx, c.actorUserId, m.sourceEmployeeId, m.employeeId, m.reason);
    }
    const id = randomUUID();
    await tx.insert(schema.attendanceSourceRuns).values({ id, payrollPeriodId: c.periodId, state: "Fetching", startedAt: sql`clock_timestamp()`, actorUserId: c.actorUserId, fromDate: sourceDayOffset(c.periodStart, -1), throughDate: sourceDayOffset(c.periodEnd, 1) });
    // Nested Drizzle transaction uses a savepoint; all guards, mappings and reconciliation
    // commit atomically only after the in-transaction comparison passes.
    const result = await reconcileAttendanceSource(tx as unknown as Database, c.periodId, id, c.actorUserId, records);
    need(!result.unmatched && !result.withheld && !result.lateChanges && !result.boundaryReview && !result.clearedEmployees, "source_exceptions_require_review");
    const report = await compare(query, c, records);
    need(report.matches, "comparison_failed_transaction_rolled_back");
    return { runId: id, reconciliation: result, comparison: report };
  });
}

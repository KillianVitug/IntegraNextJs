// Operator-only runner. Employee-level evidence is written only to the private operator directory.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { previewUnifiedRuleTransition, applyUnifiedRuleTransition, type UnifiedRuleTransitionInput } from "@/lib/scheduling/unified-rule-transition";
import { loadProvisionalPayroll, provisionalToday } from "@/lib/payroll/provisional";
import type { ProvisionalPayroll } from "@/lib/payroll/provisionalTypes";
import { GENERATED_DTR_OVERRIDE_SOURCES } from "@/lib/payroll/generatedDtrCalculation";
import { createAttendanceRefreshableManualLinePredicate } from "@/lib/payroll/manualPayroll";
import { lockAttendancePayrollInput } from "@/lib/payroll/attendanceSourceGuard";

export const unifiedRuleOperatorActor = { userId: "system:unified-shift-rule-2026-10-01", role: "ADMIN" as const };
type Plan = Awaited<ReturnType<typeof previewUnifiedRuleTransition>>;
type Receipt = Awaited<ReturnType<typeof applyUnifiedRuleTransition>>;
type Check = { name: string; digest: string };
type Retention = { rowIds: Record<string, string[]>; generatedExceptionIds: string[]; convertedCatalogIds: number[] };
export type UnifiedRuleOperatorPreview = { requestId: string; plan: Plan; before: ProvisionalPayroll[] };
type Proof = {
  version: 1; requestId: string; commandDigest: string; plan: Plan; retention: Retention;
  before: ProvisionalPayroll[]; protectedBefore: Check[];
  after?: ProvisionalPayroll[]; protectedAfter?: Check[]; receipt?: Receipt;
};
export type UnifiedRuleOperatorEvidence = { read(requestId: string): Proof | null; write(proof: Proof): void };
const retainedTables = ["shift_tables", "shift_table_breaks", "employee_weekly_shift_patterns", "employee_weekly_shift_pattern_days", "admin_audit_events", "shift_catalog_receipts", "schedule_decision_revisions", "schedule_request_receipts", "payroll_run_events"];
const mutable = new Set([...retainedTables, "employee_shift_assignments", "attendance_daily_summaries", "employee_payroll_exception_rows", "manual_payroll_entries", "manual_payroll_entry_lines", "payroll_runs"]);
const quote = (value: string) => { if (!/^[A-Za-z_0-9]+$/.test(value)) throw Error("Invalid table identifier"); return `"${value}"`; };
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const jsonDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const generatedSources = GENERATED_DTR_OVERRIDE_SOURCES.map(literal).join(",");
const rowKey = (table: string) => table === "shift_catalog_receipts" || table === "schedule_request_receipts" ? "request_id" : "id";
const idsWhere = (ids: string[], key = "id") => ids.length ? `${quote(key)}::text in (${ids.map(literal).join(",")})` : "false";

export async function captureUnifiedRuleRetention(tx: DbClient, plan: Pick<Plan, "catalog">): Promise<Retention> {
  const rowIds: Record<string, string[]> = {};
  for (const table of retainedTables) {
    const rows = await tx.execute<{ id: string }>(sql.raw(`select ${quote(rowKey(table))}::text as id from ${quote(table)} order by 1`));
    rowIds[table] = rows.rows.map(row => row.id);
  }
  const generated = await tx.execute<{ id: string }>(sql.raw(`select id::text as id from employee_payroll_exception_rows where dtr_override_source in (${generatedSources}) order by id::text`));
  return { rowIds, generatedExceptionIds: generated.rows.map(row => row.id), convertedCatalogIds: plan.catalog.map(row => row.id) };
}

/** Allow append-only revisions and attendance derivatives, while comparing all original business values. */
export async function unifiedRuleInvariants(tx: DbClient, retained: Retention): Promise<Check[]> {
  const tables = await tx.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname='public' order by tablename`);
  const queries: Record<string, string> = Object.fromEntries(tables.rows.filter(row => !mutable.has(row.tablename)).map(row => [row.tablename, `select to_jsonb(t) as value from public.${quote(row.tablename)} t`]));
  for (const table of retainedTables) {
    // Archiving a catalog version also advances its Drizzle updated_at timestamp.
    const expression = table === "shift_tables" ? "to_jsonb(t)-'archived_at'-'updated_at'" : "to_jsonb(t)";
    queries[`original_${table}`] = `select ${expression} as value from ${quote(table)} t where ${idsWhere(retained.rowIds[table], rowKey(table))}`;
  }
  queries.unconverted_catalog = `select to_jsonb(t) as value from shift_tables t where ${idsWhere(retained.rowIds.shift_tables.filter(id => !retained.convertedCatalogIds.includes(Number(id))))}`;
  const ordinary: Record<string, string> = {
    historical_assignments: "select * from employee_shift_assignments where effective_from < '2026-10-01'",
    historical_summaries: "select * from attendance_daily_summaries where attendance_date < '2026-10-01'",
    protected_runs: "select r.* from payroll_runs r join payroll_periods p on p.id=r.payroll_period_id where p.end_date < '2026-10-01' or p.status='Closed' or r.status in ('Approved','Posted')",
    historical_exception_rows: "select e.* from employee_payroll_exception_rows e join payroll_periods p on p.id=e.payroll_period_id where p.end_date < '2026-10-01'",
    explicit_exception_rows: `select * from employee_payroll_exception_rows where dtr_override_source is null or dtr_override_source not in (${generatedSources})`,
    historical_manual_entries: "select e.* from manual_payroll_entries e join payroll_periods p on p.id=e.payroll_period_id where p.end_date < '2026-10-01'",
    historical_manual_lines: "select l.* from manual_payroll_entry_lines l join manual_payroll_entries e on e.id=l.manual_payroll_entry_id join payroll_periods p on p.id=e.payroll_period_id where p.end_date < '2026-10-01'",
  };
  for (const [name, query] of Object.entries(ordinary)) queries[name] = `select to_jsonb(t) as value from (${query}) t`;
  // Saved contributions, tax, remarks, identity and author remain explicit. Only attendance-derived totals/baseline may refresh.
  queries.manual_entry_explicit_fields = `select to_jsonb(t)-ARRAY['pay_computation_mode','baseline_snapshot','regular_pay','gross_pay','taxable_pay','non_taxable_pay','total_deductions','employee_contributions','employer_contributions','net_pay','updated_by_user_id','updated_at']::text[] as value from manual_payroll_entries t`;
  queries.run_financial_fields = `select to_jsonb(t)-ARRAY['status','reviewed_at','reviewed_by_user_id','approved_at','approved_by_user_id','updated_at']::text[] as value from payroll_runs t`;
  const checks = Object.entries(queries).map(([name, query]) => `select ${literal(name)} as name,md5(coalesce(string_agg(value::text,E'\\n' order by value::text),'')) as digest from (${query}) q`);
  const result = (await tx.execute<Check>(sql.raw(`select * from (${checks.join(" union all ")}) checks order by name`))).rows;
  const generated = await tx.execute<{ id: string }>(sql.raw(`select id::text as id from employee_payroll_exception_rows where dtr_override_source in (${generatedSources})`));
  const refreshable = createAttendanceRefreshableManualLinePredicate({ refreshableExceptionRowIds: [...retained.generatedExceptionIds, ...generated.rows.map(row => row.id)] });
  const lines = await tx.execute<{ value: Record<string, unknown> }>(sql`select to_jsonb(l)-ARRAY['id','created_at','updated_at','sort_order']::text[] as value from manual_payroll_entry_lines l`);
  const explicitLines = lines.rows.filter(({ value }) => !refreshable({ accountCodeId: value.account_code_id as number | null, code: String(value.code), description: String(value.description), sourceTable: value.source_table as string | null, sourceId: value.source_id as string | null })).map(({ value }) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))))).sort();
  result.push({ name: "explicit_manual_lines", digest: jsonDigest(explicitLines) });
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function financial(tx: DbClient): Promise<ProvisionalPayroll[]> {
  const periods = await tx.execute<{ id: string }>(sql`select id from payroll_periods where end_date >= '2026-10-01' and start_date <= ${provisionalToday()} and status='Open' order by start_date,id`);
  const result = [];
  for (const period of periods.rows) for (const group of ["Daily", "Monthly"] as const) result.push(await loadProvisionalPayroll({ periodId: period.id, group }, tx as typeof db));
  return result;
}
export function assertUnifiedRuleFinancialReady(rows: ProvisionalPayroll[]) {
  if (rows.some(row => row.totals.unavailable !== 0 || row.rows.some(employee => employee.status === "Unavailable" || employee.recorded === null || employee.forecast === null) || [...Object.values(row.totals.recorded), ...Object.values(row.totals.forecast)].some(value => !Number.isFinite(value)))) throw Error("Financial preview contains unavailable or invalid results; transition cannot be accepted.");
}
function financialRevision(rows: ProvisionalPayroll[]) {
  return jsonDigest(rows.map(row => ({ periodId: row.period.id, group: row.group, inputRevision: row.inputRevision, asOfDate: row.asOfDate })).sort((a, b) => `${a.periodId}|${a.group}`.localeCompare(`${b.periodId}|${b.group}`)));
}

export async function runUnifiedRuleOperator(database: DbClient, options: {
  mode: "preview" | "rehearse" | "apply"; input: UnifiedRuleTransitionInput; requestId: string;
  expected?: UnifiedRuleOperatorPreview; evidence: UnifiedRuleOperatorEvidence;
}) {
  const { mode, input, requestId, expected, evidence } = options;
  if (mode === "apply" && (!expected || expected.requestId !== requestId)) throw Error("Apply requires its original reviewed preview and request ID.");
  return database.transaction(async tx => {
    if (mode === "preview") await tx.execute(sql`set transaction read only`);
    else await lockAttendancePayrollInput(tx);
    const commandDigest = jsonDigest({ input, requestId, expectedSourceDigest: expected?.plan.sourceDigest ?? null });
    // A committed request must be recovered before checking the now-converted catalog.
    const prior = mode === "apply" ? await tx.execute(sql`select id from admin_audit_events where action='unified_shift_rule.completed' and entity_id=${requestId}`) : null;
    if (prior?.rows.length) {
      const receipt = await applyUnifiedRuleTransition(tx, unifiedRuleOperatorActor, { ...input, requestId, expectedSourceDigest: expected!.plan.sourceDigest });
      const proof = evidence.read(requestId);
      if (!proof || proof.version !== 1 || proof.requestId !== requestId || proof.commandDigest !== commandDigest || proof.plan.sourceDigest !== expected!.plan.sourceDigest || jsonDigest(proof.receipt) !== jsonDigest(receipt) || !proof.after || !proof.protectedAfter || jsonDigest(proof.protectedBefore) !== jsonDigest(proof.protectedAfter)) throw Error("Transition is already committed. Matching pre-commit preservation evidence is missing or incomplete; recover the saved receipt and review evidence before accepting. No conversion was repeated.");
      assertUnifiedRuleFinancialReady(proof.before); assertUnifiedRuleFinancialReady(proof.after);
      const after = await financial(tx);
      try { assertUnifiedRuleFinancialReady(after); } catch { throw Error("Transition is already committed and preservation evidence is retained, but current financial results need review. No conversion was repeated."); }
      return { requestId, plan: expected!.plan, before: proof.before, after, atCommitAfter: proof.after, receipt, preservedChecks: proof.protectedBefore.length, preservationVerifiedAtCommit: true, recoveredCommitted: true, productionWrites: false };
    }
    const plan = await previewUnifiedRuleTransition(tx, unifiedRuleOperatorActor, input);
    if (expected && expected.plan.sourceDigest !== plan.sourceDigest) throw Error("Source changed since reviewed production preview");
    const before = await financial(tx);
    assertUnifiedRuleFinancialReady(before);
    if (expected && financialRevision(expected.before) !== financialRevision(before)) throw Error("Attendance or payroll calculation inputs changed since the reviewed financial preview; review a fresh preview before applying.");
    if (mode === "preview") return { requestId, plan, before, productionWrites: false };
    const retention = await captureUnifiedRuleRetention(tx, plan), protectedBefore = await unifiedRuleInvariants(tx, retention);
    const proof: Proof = { version: 1, requestId, commandDigest, plan, retention, before, protectedBefore };
    evidence.write(proof); // Persist the baseline before any mutation. Failure prevents the conversion.
    const receipt = await applyUnifiedRuleTransition(tx, unifiedRuleOperatorActor, { ...input, requestId, expectedSourceDigest: plan.sourceDigest });
    const after = await financial(tx), protectedAfter = await unifiedRuleInvariants(tx, retention);
    assertUnifiedRuleFinancialReady(after);
    if (jsonDigest(protectedBefore) !== jsonDigest(protectedAfter)) {
      const changed = protectedBefore.filter(check => protectedAfter.find(afterCheck => afterCheck.name === check.name)?.digest !== check.digest).map(check => check.name);
      throw Error(`Protected historical, explicit or unrelated records changed (${changed.join(", ")}); transition rolled back`);
    }
    // This evidence is only accepted once the matching durable receipt proves the outer transaction committed.
    evidence.write({ ...proof, after, protectedAfter, receipt });
    return { requestId, plan, before, after, receipt, preservedChecks: protectedBefore.length, preservationVerifiedAtCommit: true, recoveredCommitted: false, productionWrites: mode === "apply" };
  });
}

const mode = process.argv[2], output = process.env.UNIFIED_RULE_PRIVATE_OUTPUT;
async function main() {
  if (!output || !path.isAbsolute(output) || !["preview", "rehearse", "apply"].includes(mode)) throw Error("Explicit operator mode and private output are required");
  const input = JSON.parse(readFileSync(path.join(output, "reviewed-templates.json"), "utf8")) as UnifiedRuleTransitionInput;
  const target = new URL(process.env.DATABASE_URL ?? "");
  if (mode === "rehearse" && target.hostname !== "127.0.0.1") throw Error("Rehearsal requires a restored loopback database");
  if (mode === "apply" && process.env.UNIFIED_RULE_APPLY_AUTHORIZED !== "2026-10-01-actual-minutes") throw Error("Explicit approved rule and date required");
  const expected = mode === "apply" ? JSON.parse(readFileSync(path.join(output, "preview.json"), "utf8")) as UnifiedRuleOperatorPreview : undefined;
  const requestId = expected?.requestId ?? randomUUID();
  const proofPath = (id: string) => { if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error("Invalid proof request ID"); return path.join(output, `attempt-${id}.json`); };
  const evidence: UnifiedRuleOperatorEvidence = {
    read(id) { const file = proofPath(id); return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Proof : null; },
    write(proof) { writeFileSync(proofPath(proof.requestId), JSON.stringify(proof)); },
  };
  const result = await runUnifiedRuleOperator(db, { mode: mode as "preview" | "rehearse" | "apply", input, requestId, expected, evidence });
  writeFileSync(path.join(output, `${mode}.json`), JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2));
  console.log(`PASS ${mode}; ${JSON.stringify(result.plan.counts)}; employee-level financial evidence saved privately`);
}
// Importing the verification helpers never starts a database operation.
if (path.basename(process.argv[1] ?? "") === "runUnifiedRuleTransition.ts") main().then(() => process.exit(0)).catch(error => {
  if (output) writeFileSync(path.join(output, `${mode}-error.txt`), String(error?.stack ?? error));
  console.error(`FAIL ${mode}; details retained privately`); process.exit(1);
});


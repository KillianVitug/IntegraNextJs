import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { destination } from "./destination";
import { need, ORIGIN, parseArgs, parseConfig, safeJson, TestStop, validateDestination, validatePin, validateScope, type TestConfig } from "./guard";

async function main() {
  let config: TestConfig | undefined;
  let stage = "configuration";
  let close: (() => Promise<void>) | undefined;
  let writesCommitted: boolean | null = false;
  try {
    need(process.env.ATTENDANCE_TEST_ISOLATED === "1" && process.env.NODE_ENV === "test", "use_isolated_launcher");
    const args = parseArgs(process.argv.slice(2));
    // Validate the source-controlled trust anchor even before opening the private file.
    validatePin(destination);
    config = parseConfig(JSON.parse(await readFile(path.resolve(".attendance-test/config.local.json"), "utf8")));
    const verifiedDestination = validateDestination(config.databaseUrl, destination);
    if (args.mode !== "preflight") validateScope(config, args);
    // No inherited DB or dotenv fallback. The launcher removes ALL original application env.
    process.env.DATABASE_URL = config.databaseUrl;
    process.env.ATTENDANCE_SOURCE_ENABLED = "true";
    stage = "database_connection";
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const { default: ws } = await import("ws");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    const schema = await import("@/db/schema");
    neonConfig.webSocketConstructor = ws;
    const pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 10000, max: 1, idleTimeoutMillis: 1000 });
    pool.on("error", () => { /* Driver details can include credentials. Never print them. */ });
    close = () => pool.end();
    const database = drizzle(pool, { schema });
    const workflow = await import("./workflow");
    stage = "read_only_schema_preflight";
    const preflight = await workflow.readOnly(database, workflow.inspectSchema);
    const report: Record<string, unknown> = { tool: "attendance-test", status: "complete", mode: args.mode, destination: verifiedDestination, schema: preflight, writesCommitted: false };
    if (!preflight.compatible) { report.status = "blocked"; report.code = "schema_differences_no_migration_applied"; process.exitCode = 1; }
    else if (args.mode !== "preflight") {
      stage = "read_only_scope_preflight";
      const scope = await workflow.readOnly(database, query => workflow.checkScope(query, config!));
      report.scope = scope;
      if (!scope.ready) { report.status = "blocked"; report.code = "scope_not_ready"; process.exitCode = 1; }
      else {
        need(config.sourceToken.length >= 32, "source_credential_required");
        stage = "read_only_source_pull";
        const { pullAttendanceSource, sourceDayOffset } = await import("@/lib/payroll/attendanceSourceClient");
        const records = await pullAttendanceSource({ origin: ORIGIN, token: config.sourceToken, from: sourceDayOffset(config.periodStart, -1), through: sourceDayOffset(config.periodEnd, 1), fetcher: (url, init) => {
          const headers = new Headers(init?.headers); headers.set("User-Agent", "WecareAttendancePayroll/1.0");
          return fetch(url, { ...init, method: "GET", headers });
        } });
        report.sourceScope = workflow.sourceScope(config, records);
        stage = "read_only_comparison";
        report.before = await workflow.readOnly(database, query => workflow.compare(query, config!, records));
        if (args.mode === "sync") {
          stage = "guarded_test_transaction";
          writesCommitted = null; // A connection failure during COMMIT has an uncertain outcome.
          const after = await workflow.writeOnce(database, config, records, process.argv.slice(2));
          writesCommitted = true; report.writesCommitted = true; report.after = after;
        }
      }
    }
    stage = "private_report";
    const output = safeJson(report, config);
    // Fixed ignored directory; no user-controlled report path. Exclusive create prevents overwrite.
    const filename = `report-${args.mode}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.json`;
    await writeFile(path.resolve(".attendance-test", filename), output + "\n", { flag: "wx", mode: 0o600 });
    process.stdout.write(output + "\n");
  } catch (error) {
    process.exitCode = 1;
    process.stdout.write(safeJson({ tool: "attendance-test", status: "blocked", stage, code: error instanceof TestStop ? error.code : "operation_failed_details_suppressed", writesCommitted }, config) + "\n");
  } finally {
    delete process.env.DATABASE_URL;
    delete process.env.ATTENDANCE_SOURCE_ENABLED;
    if (close) { try { await close(); } catch { /* Do not disclose driver errors. */ } }
  }
}
void main();

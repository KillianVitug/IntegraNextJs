import type { destination } from "./destination";

export const PROJECT = "quiet-wildflower-71375304";
export const BRANCH = "br-dark-field-a1zdusec";
export const ORIGIN = "https://attendance-pilot.wecaredrug.workers.dev";
export type Destination = typeof destination;
export type Mode = "preflight" | "compare" | "sync";
export type TestConfig = {
  databaseUrl: string; sourceToken: string; periodId: string; periodStart: string; periodEnd: string; actorUserId: string;
  mappings: { sourceEmployeeId: string; employeeId: string; reason: string }[];
  comparisons: { sourceEmployeeId: string; attendanceDate: string; checkInTime: string; checkOutTime: string; breakMinutes: number; expectedWorkedMinutes: number }[];
};
export class TestStop extends Error {
  constructor(public readonly code: string) { super(code); }
}
export function need(condition: unknown, code: string): asserts condition { if (!condition) throw new TestStop(code); }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sourceId = /^[A-Za-z0-9_-]{1,64}$/;
const date = (value: string) => /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const time = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

export function parseArgs(args: string[]) {
  const mode = (args[0] ?? "preflight") as Mode;
  need(["preflight", "compare", "sync"].includes(mode), "invalid_command");
  const rest = args.slice(1);
  need(mode !== "preflight" || rest.length === 0, "preflight_accepts_no_scope_or_write_arguments");
  need(new Set(rest).size === rest.length && rest.every(a => a.startsWith("--period=") || a === `--write-test=${BRANCH}`), "invalid_arguments");
  need(rest.filter(a => a.startsWith("--period=")).length <= 1, "ambiguous_period");
  const periodId = rest.find(a => a.startsWith("--period="))?.slice(9) ?? "";
  const write = rest.includes(`--write-test=${BRANCH}`);
  need(mode === "sync" ? write && uuid.test(periodId) : !write, "explicit_scoped_write_required");
  return { mode, periodId };
}

export function parseConfig(value: unknown): TestConfig {
  need(!!value && typeof value === "object" && !Array.isArray(value), "invalid_config");
  const c = value as TestConfig;
  need([c.databaseUrl, c.sourceToken, c.periodId, c.periodStart, c.periodEnd, c.actorUserId].every(v => typeof v === "string"), "invalid_config_fields");
  need(Array.isArray(c.mappings) && Array.isArray(c.comparisons) && c.mappings.length <= 100 && c.comparisons.length <= 100, "invalid_config_scope");
  return c;
}

export function validatePin(pin: Destination) {
  need(pin.projectId === PROJECT && pin.branchId === BRANCH && pin.branchName === "attendance-test", "wrong_destination_pin");
  need(/^ep-[a-z0-9-]+$/.test(pin.endpointId) && pin.hosts.length > 0 && pin.hosts.length <= 2 && new Set(pin.hosts).size === pin.hosts.length && /^[A-Za-z0-9_-]+$/.test(pin.database) && /^\d{4}-\d\d-\d\dT.*Z$/.test(pin.verifiedFromDashboardAt) && Number.isFinite(Date.parse(pin.verifiedFromDashboardAt)), "endpoint_not_independently_verified");
  for (const host of pin.hosts) {
    const first = host.split('.')[0];
    need((first === pin.endpointId || first === `${pin.endpointId}-pooler`) && /^[a-z0-9.-]+\.neon\.tech$/.test(host), "ambiguous_endpoint_pin");
  }
}

export function validateDestination(databaseUrl: string, pin: Destination) {
  validatePin(pin);
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new TestStop("missing_or_invalid_test_database_url"); }
  need(["postgres:", "postgresql:"].includes(url.protocol) && !!url.username && !!url.password && !url.hash && (!url.port || url.port === "5432"), "invalid_database_url");
  need(pin.hosts.includes(url.hostname) && decodeURIComponent(url.pathname) === `/${pin.database}`, "database_destination_mismatch");
  const keys = [...url.searchParams.keys()];
  need(new Set(keys).size === keys.length && keys.every(k => ["sslmode", "channel_binding"].includes(k)) && ["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "") && (!url.searchParams.has("channel_binding") || url.searchParams.get("channel_binding") === "require"), "ambiguous_or_insecure_database_options");
  return { projectId: PROJECT, branchId: BRANCH, endpointId: pin.endpointId, host: url.hostname };
}

export function validateScope(c: TestConfig, args: ReturnType<typeof parseArgs>) {
  need(uuid.test(c.periodId) && (!args.periodId || args.periodId === c.periodId), "chosen_period_required");
  need(date(c.periodStart) && date(c.periodEnd) && c.periodStart <= c.periodEnd && Date.parse(c.periodEnd) - Date.parse(c.periodStart) <= 31 * 86400000, "explicit_period_dates_required");
  need(uuid.test(c.actorUserId) && c.mappings.length > 0 && c.comparisons.length > 0, "mapping_actor_and_comparison_required");
  const sources = new Set<string>(), employees = new Set<string>(), cases = new Set<string>();
  for (const m of c.mappings) {
    need(m && sourceId.test(m.sourceEmployeeId) && uuid.test(m.employeeId) && typeof m.reason === "string" && m.reason.trim().length >= 3 && m.reason.length <= 500 && !sources.has(m.sourceEmployeeId) && !employees.has(m.employeeId), "ambiguous_employee_mapping");
    sources.add(m.sourceEmployeeId); employees.add(m.employeeId);
  }
  for (const row of c.comparisons) {
    const key = `${row.sourceEmployeeId}|${row.attendanceDate}`;
    need(row && sources.has(row.sourceEmployeeId) && date(row.attendanceDate) && row.attendanceDate >= c.periodStart && row.attendanceDate <= c.periodEnd && time(row.checkInTime) && time(row.checkOutTime) && Number.isInteger(row.breakMinutes) && row.breakMinutes >= 0 && row.breakMinutes <= 720 && Number.isInteger(row.expectedWorkedMinutes) && row.expectedWorkedMinutes > 0 && row.expectedWorkedMinutes <= 1440 && !cases.has(key), "invalid_comparison_case");
    cases.add(key);
  }
}

// Reports never contain raw errors, payloads, names, mapping reasons, connection strings or headers.
// Scrubbing known credentials is an additional safeguard for any accidental string collision.
export function safeJson(value: unknown, config?: TestConfig) {
  const secrets = [config?.databaseUrl, config?.sourceToken].filter((s): s is string => !!s);
  try { const u = new URL(config?.databaseUrl ?? ""); secrets.push(u.username, u.password, decodeURIComponent(u.username), decodeURIComponent(u.password)); } catch { /* no credential URL */ }
  const scrub = (v: unknown): unknown => {
    if (typeof v === "string") return secrets.filter(Boolean).sort((a, b) => b.length - a.length).reduce((s, secret) => s.split(secret).join("[REDACTED]"), v);
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, scrub(item)]));
    return v;
  };
  return JSON.stringify(scrub(value), null, 2);
}

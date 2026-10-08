import { runPayrollGroup, type PayrollGroup } from "./payrollGroupModel";

/** Carry review context, never an open editor or a nested return URL, across workspaces. */
export function payrollContextHref(path: string, search: string, context: Record<string, string | undefined> = {}) {
  const values = new URLSearchParams(search);
  for (const [key, value] of Object.entries(context)) if (value !== undefined) values.set(key, value);
  const keys = ["year", "periodId", "group", "runId", "departmentId", "employeeId", "day", "q"];
  if (path === "/payroll/provisional") keys.push("asOfDate");
  const query = new URLSearchParams([...values.entries()].filter(([key, value]) => keys.includes(key) && value !== ""));
  return query.size ? `${path}?${query}` : path;
}

type RunContext = { id: string; payrollPeriodId: string; inputSnapshot: Record<string, unknown> | null };
export function runMatchesPayrollContext(run: RunContext, periodId: string, group: PayrollGroup, explicitLegacy = false) {
  const actual = runPayrollGroup(run.inputSnapshot);
  return run.payrollPeriodId === periodId && (actual === group || explicitLegacy && actual === "Legacy");
}

/** Rows arrive newest first. Explicit legacy runs remain readable; group-specific runs cannot cross groups. */
export function selectWorkspaceRun<T extends RunContext>(runs: T[], periodId: string, group: PayrollGroup, runId?: string) {
  return runs.find(run => run.id === runId && runMatchesPayrollContext(run, periodId, group, true))
    ?? runs.find(run => runMatchesPayrollContext(run, periodId, group)) ?? null;
}

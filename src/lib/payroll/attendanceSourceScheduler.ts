import { timingSafeEqual } from "node:crypto";

export function attendanceSchedulerAuthorized(enabled: boolean, configured: string, provided: string) {
  if (!enabled || configured.length < 32) return false;
  const expected = Buffer.from(`Bearer ${configured}`);
  const actual = Buffer.from(provided);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

type ScheduleOptions = {
  enabled: boolean;
  secret: string;
  actorId: string | undefined;
  actorIsAuthorized: (id: string) => Promise<boolean>;
  periodIds: () => Promise<string[]>;
  syncPeriod: (periodId: string, actorId: string) => Promise<unknown>;
};

/** Shared by the private POST trigger and the separately opted-in Vercel GET. */
export async function runAttendanceSchedule(request: Request, options: ScheduleOptions) {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!attendanceSchedulerAuthorized(options.enabled, options.secret, request.headers.get("authorization") ?? "")) {
    return respond({ error: "Unauthorized" }, 401);
  }
  const actor = options.actorId;
  if (!actor || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(actor)) {
    return respond({ error: "Scheduler requires an active administrator audit account" }, 503);
  }
  try {
    if (!(await options.actorIsAuthorized(actor))) return respond({ error: "Scheduler requires an active administrator audit account" }, 503);
    const periods = await options.periodIds();
    if (periods.length > 24) return respond({ error: "Too many recent periods for one scheduled reconciliation; partition the schedule" }, 503);
    const results = [];
    for (const periodId of periods) results.push(await options.syncPeriod(periodId, actor));
    return respond({ completed: results.length, results });
  } catch {
    // Prior periods may have committed. The reconciler safely handles a later retry.
    return respond({ error: "Reconciliation failed; inspect sync history" }, 503);
  }
}

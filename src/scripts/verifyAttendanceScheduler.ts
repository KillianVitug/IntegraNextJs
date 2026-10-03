import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runAttendanceSchedule } from "@/lib/payroll/attendanceSourceScheduler";
import { GET, POST } from "@/app/api/attendance-source/reconcile/route";

async function main() {
  const secret = "synthetic-cron-secret-at-least-32-characters";
  const actorId = randomUUID();
  let calls: string[] = [];
  const request = (header = `Bearer ${secret}`) => new Request("https://example.test/api/attendance-source/reconcile", { headers: { authorization: header } });
  const options = {
    enabled: true, secret, actorId,
    actorIsAuthorized: async (id: string) => { assert.equal(id, actorId); calls.push("actor"); return true; },
    periodIds: async () => { calls.push("periods"); return ["period-1", "period-2"]; },
    syncPeriod: async (period: string, actor: string) => { assert.equal(actor, actorId); calls.push(period); return { projected: 0 }; },
  };
  for (const opts of [{ ...options, enabled: false }, { ...options, secret: "" }, { ...options, secret: "short" }]) {
    assert.equal((await runAttendanceSchedule(request(), opts)).status, 401);
  }
  for (const header of ["", "Bearer wrong", `Bearer ${"é".repeat(secret.length)}`]) assert.equal((await runAttendanceSchedule(request(header), options)).status, 401);
  assert.deepEqual(calls, [], "Unauthorized requests must not read the database");
  for (const actor of [undefined, "not-a-uuid"]) assert.equal((await runAttendanceSchedule(request(), { ...options, actorId: actor })).status, 503);
  assert.deepEqual(calls, []);
  assert.equal((await runAttendanceSchedule(request(), { ...options, actorIsAuthorized: async () => false })).status, 503);
  assert.deepEqual(calls, [], "Rejected actors must not start reconciliation");
  const success = await runAttendanceSchedule(request(), options);
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("cache-control"), "no-store");
  assert.equal((await success.json()).completed, 2);
  assert.deepEqual(calls, ["actor", "periods", "period-1", "period-2"]);
  calls = [];
  assert.equal((await runAttendanceSchedule(request(), { ...options, periodIds: async () => Array.from({ length: 25 }, (_, i) => String(i)) })).status, 503);
  assert.deepEqual(calls, ["actor"], "Overflow must not silently reconcile a subset");
  const failed = await runAttendanceSchedule(request(), { ...options, syncPeriod: async () => { throw Error("synthetic-private-diagnostic"); } });
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes("synthetic-private-diagnostic"));

  // Exercise the real route adapters on their no-database rejection paths.
  process.env.ATTENDANCE_SOURCE_ENABLED = "true";
  process.env.CRON_SECRET = secret;
  process.env.ATTENDANCE_SYNC_SECRET = "different-synthetic-post-secret-32-characters";
  delete process.env.ATTENDANCE_SYNC_ACTOR_ID;
  delete process.env.ATTENDANCE_VERCEL_CRON_ENABLED;
  assert.equal((await GET(request())).status, 401, "GET stays disabled by default");
  process.env.ATTENDANCE_VERCEL_CRON_ENABLED = "true";
  assert.equal((await GET(request(`Bearer ${process.env.ATTENDANCE_SYNC_SECRET}`))).status, 401);
  assert.equal((await POST(request())).status, 401, "GET and POST credentials are distinct");
  assert.equal((await GET(request())).status, 503, "Authorized GET requires an audit actor");
  assert.equal((await POST(request(`Bearer ${process.env.ATTENDANCE_SYNC_SECRET}`))).status, 503);
  process.env.ATTENDANCE_SOURCE_ENABLED = "false";
  assert.equal((await GET(request())).status, 401);
  assert.equal((await POST(request(`Bearer ${process.env.ATTENDANCE_SYNC_SECRET}`))).status, 401);
  console.log("Attendance scheduler checks passed: GET/POST isolation, explicit opt-in, disabled mode, malformed secrets, actor validation, bounded periods, no-store and redacted failures.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });

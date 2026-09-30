import { timingSafeEqual } from "node:crypto";
import { and, gte, lte, asc } from "drizzle-orm";
import { db } from "@/db";
import { payrollPeriods } from "@/db/schema";
import { attendanceSourceEnabled, syncAttendanceSourcePeriod } from "@/lib/payroll/attendanceSourceSync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Call from a private scheduler every 15 minutes. Deliberately no public GET trigger.
export async function POST(request: Request) {
  const configured = process.env.ATTENDANCE_SYNC_SECRET ?? "", provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${configured}`;
  if (!attendanceSourceEnabled() || configured.length < 32 || provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const actor = process.env.ATTENDANCE_SYNC_ACTOR_ID; if (!actor) return Response.json({ error: "Scheduler actor is not configured" }, { status: 503 });
  const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const periods = await db.select({ id: payrollPeriods.id }).from(payrollPeriods).where(and(gte(payrollPeriods.endDate, since), lte(payrollPeriods.startDate, new Date().toISOString().slice(0,10)))).orderBy(asc(payrollPeriods.startDate));
  if(periods.length>24) return Response.json({error:"Too many recent periods for one scheduled reconciliation; partition the schedule"},{status:503});
  const results = [];
  for (const period of periods) {
    try { results.push(await syncAttendanceSourcePeriod(period.id, actor)); }
    catch { return Response.json({ error: "Reconciliation failed; inspect sync history" }, { status: 503 }); }
  }
  return Response.json({ completed: results.length, results });
}

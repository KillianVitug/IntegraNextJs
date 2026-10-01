import { and, gte, lte, asc } from "drizzle-orm";
import { db } from "@/db";
import { payrollPeriods } from "@/db/schema";
import { attendanceSourceEnabled, syncAttendanceSourcePeriod } from "@/lib/payroll/attendanceSourceSync";
import { attendanceSchedulerAuthorized } from "@/lib/payroll/attendanceSourceScheduler";
import { manilaWallTime, sourceDayOffset } from "@/lib/payroll/attendanceSourceClient";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Start with an hourly private scheduler. Deliberately no public GET trigger.
export async function POST(request: Request) {
  const configured = process.env.ATTENDANCE_SYNC_SECRET ?? "", provided = request.headers.get("authorization") ?? "";
  if (!attendanceSchedulerAuthorized(attendanceSourceEnabled(), configured, provided)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const actor = process.env.ATTENDANCE_SYNC_ACTOR_ID; if (!actor) return Response.json({ error: "Scheduler actor is not configured" }, { status: 503 });
  const today = manilaWallTime(new Date().toISOString()).date;
  const since = sourceDayOffset(today, -45);
  const periods = await db.select({ id: payrollPeriods.id }).from(payrollPeriods).where(and(gte(payrollPeriods.endDate, since), lte(payrollPeriods.startDate, today))).orderBy(asc(payrollPeriods.startDate));
  if(periods.length>24) return Response.json({error:"Too many recent periods for one scheduled reconciliation; partition the schedule"},{status:503});
  const results = [];
  for (const period of periods) {
    try { results.push(await syncAttendanceSourcePeriod(period.id, actor)); }
    catch { return Response.json({ error: "Reconciliation failed; inspect sync history" }, { status: 503 }); }
  }
  return Response.json({ completed: results.length, results });
}

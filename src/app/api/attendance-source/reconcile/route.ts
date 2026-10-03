import { and, gte, lte, asc } from "drizzle-orm";
import { db } from "@/db";
import { payrollPeriods } from "@/db/schema";
import { attendanceSourceEnabled, syncAttendanceSourcePeriod } from "@/lib/payroll/attendanceSourceSync";
import { runAttendanceSchedule } from "@/lib/payroll/attendanceSourceScheduler";
import { attendanceSchedulerActorAuthorized } from "@/lib/payroll/attendanceSourceActor";
import { manilaWallTime, sourceDayOffset } from "@/lib/payroll/attendanceSourceClient";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function run(request: Request, secret: string, enabled: boolean) {
  return runAttendanceSchedule(request, {
    enabled: attendanceSourceEnabled() && enabled,
    secret,
    actorId: process.env.ATTENDANCE_SYNC_ACTOR_ID,
    actorIsAuthorized: id => attendanceSchedulerActorAuthorized(db, id),
    periodIds: async () => {
      const today = manilaWallTime(new Date().toISOString()).date;
      const since = sourceDayOffset(today, -45);
      const periods = await db.select({ id: payrollPeriods.id }).from(payrollPeriods)
        .where(and(gte(payrollPeriods.endDate, since), lte(payrollPeriods.startDate, today)))
        .orderBy(asc(payrollPeriods.startDate)).limit(25);
      return periods.map(period => period.id);
    },
    syncPeriod: syncAttendanceSourcePeriod,
  });
}
export async function POST(request: Request) {
  return run(request, process.env.ATTENDANCE_SYNC_SECRET ?? "", true);
}
// Vercel Cron uses GET and supplies CRON_SECRET in the Authorization header.
// No cron configuration is installed; GET requires its own explicit opt-in.
export async function GET(request: Request) {
  return run(request, process.env.CRON_SECRET ?? "", process.env.ATTENDANCE_VERCEL_CRON_ENABLED === "true");
}

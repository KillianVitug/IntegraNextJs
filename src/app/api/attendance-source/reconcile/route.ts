import { and, gte, lte, asc } from "drizzle-orm";
import { db } from "@/db";
import { payrollPeriods } from "@/db/schema";
import { attendanceSourceEnabled, syncAttendanceSourcePeriod } from "@/lib/payroll/attendanceSourceSync";
import { runAttendanceSchedule } from "@/lib/payroll/attendanceSourceScheduler";
import { attendanceSchedulerActorAuthorized } from "@/lib/payroll/attendanceSourceActor";
import { manilaWallTime, sourceDayOffset } from "@/lib/payroll/attendanceSourceClient";
import { attendanceSourceStartDate } from "@/lib/payroll/attendanceSourceRollout";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
function run(request: Request, secret: string, enabled: boolean) {
  return runAttendanceSchedule(request, {
    enabled: attendanceSourceEnabled() && enabled,
    secret,
    actorId: process.env.ATTENDANCE_SYNC_ACTOR_ID,
    actorIsAuthorized: id => attendanceSchedulerActorAuthorized(db, id),
    periodIds: async () => {
      if(process.env.ATTENDANCE_WORKBENCH_ENABLED==="true")await (await import("@/lib/payroll/attendanceWorkbenchDelivery")).processWorkDelivery(process.env.ATTENDANCE_SYNC_ACTOR_ID!,{budgetMs:35000});
      const today = manilaWallTime(new Date().toISOString()).date;
      const since = sourceDayOffset(today, -45);
      const startDate = attendanceSourceStartDate();
      const periods = await db.select({ id: payrollPeriods.id }).from(payrollPeriods)
        .where(and(gte(payrollPeriods.endDate, since), lte(payrollPeriods.startDate, today), startDate ? gte(payrollPeriods.startDate, startDate) : undefined))
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
// GET requires its own explicit opt-in, in addition to the production cron configuration.
export async function GET(request: Request) {
  return run(request, process.env.CRON_SECRET ?? "", process.env.ATTENDANCE_VERCEL_CRON_ENABLED === "true");
}

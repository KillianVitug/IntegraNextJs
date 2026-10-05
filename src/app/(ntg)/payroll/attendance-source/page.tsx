import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { payrollPeriods } from "@/db/schema";
import { attendanceSourceRuns, attendanceSourceEvents } from "@/db/attendanceSourceSchema";
import { requireAdminActor } from "@/lib/admin";
import { attendanceSourceEnabled } from "@/lib/payroll/attendanceSourceSync";
import { AttendanceSourcePanel } from "./panel";
import { selectAttendanceSourcePeriod } from "@/lib/payroll/attendanceSourcePeriods";
import { loadMatchBoard } from "@/lib/payroll/attendanceIdentityWorkflow";
export default async function AttendanceSourcePage({ searchParams }: { searchParams: Promise<{ year?: string; periodId?: string }> }) {
  await requireAdminActor(); if (!attendanceSourceEnabled()) notFound();
  const params = await searchParams;
  const [periods, runs, sourceEvents, matching] = await Promise.all([
    db.select({ id: payrollPeriods.id, code: payrollPeriods.code, year: payrollPeriods.year, startDate: payrollPeriods.startDate, endDate: payrollPeriods.endDate }).from(payrollPeriods),
    db.select().from(attendanceSourceRuns).orderBy(desc(attendanceSourceRuns.startedAt)).limit(30),
    db.select({payload:attendanceSourceEvents.payload}).from(attendanceSourceEvents).orderBy(desc(attendanceSourceEvents.capturedAt)).limit(500),
    loadMatchBoard(db),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const selection = selectAttendanceSourcePeriod(periods, params, today);
  return <AttendanceSourcePanel
    key={`${selection.year}:${selection.periodId}`} initialYear={selection.year} initialPeriodId={selection.periodId} today={today}
    matching={matching} inbox={sourceEvents.map(e => e.payload as import("@/lib/payroll/attendanceSourceClient").SourcePunch)} periods={periods}
    runs={runs.map(r => ({ id: r.id, state: r.state, startedAt: r.startedAt.toISOString(), counts: JSON.stringify(r.counts), error: r.error }))}
  />;
}

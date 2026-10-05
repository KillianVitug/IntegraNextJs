import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollPeriods } from "@/db/schema";
import { attendanceSourceRuns } from "@/db/attendanceSourceSchema";
import { requireAdminActor } from "@/lib/admin";
import { attendanceSourceEnabled } from "@/lib/payroll/attendanceSourceSync";
import { AttendanceSourcePanel } from "./panel";
import { selectAttendanceSourcePeriod } from "@/lib/payroll/attendanceSourcePeriods";
import { loadAttendanceReadiness } from "@/lib/payroll/attendanceResolution";
import { loadMatchBoard } from "@/lib/payroll/attendanceIdentityWorkflow";
import { loadDuplicateBoard } from "@/lib/payroll/attendanceDuplicates";
export const maxDuration = 60;
export default async function AttendanceSourcePage({ searchParams }: { searchParams: Promise<{ year?: string; periodId?: string }> }) {
  await requireAdminActor(); if (!attendanceSourceEnabled()) notFound();
  const params = await searchParams;
  const [periods, matching] = await Promise.all([
    db.select({ id: payrollPeriods.id, code: payrollPeriods.code, year: payrollPeriods.year, startDate: payrollPeriods.startDate, endDate: payrollPeriods.endDate }).from(payrollPeriods),
    loadMatchBoard(db),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const selection = selectAttendanceSourcePeriod(periods, params, today);
  const readiness = selection.periodId ? await loadAttendanceReadiness(selection.periodId) : null;
  const duplicates = selection.periodId ? await loadDuplicateBoard(selection.periodId) : null;
  const runs = selection.periodId ? await db.select().from(attendanceSourceRuns).where(eq(attendanceSourceRuns.payrollPeriodId, selection.periodId)).orderBy(desc(attendanceSourceRuns.startedAt)).limit(30) : [];
  return <AttendanceSourcePanel
    key={`${selection.year}:${selection.periodId}`} initialYear={selection.year} initialPeriodId={selection.periodId} today={today}
    matching={matching} readiness={readiness} duplicates={duplicates} inbox={readiness?.people.flatMap(p => p.records) ?? []} periods={periods}
    runs={runs.map(r => ({ id: r.id, state: r.state, startedAt: r.startedAt.toISOString(), counts: JSON.stringify(r.counts), error: r.error }))}
  />;
}

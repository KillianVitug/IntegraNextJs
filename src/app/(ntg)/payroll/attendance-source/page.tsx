import { notFound } from "next/navigation";
import { desc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollPeriods } from "@/db/schema";
import { attendanceSourceMappings, attendanceSourceRuns, attendanceSourceEvents } from "@/db/attendanceSourceSchema";
import { requireAdminActor } from "@/lib/admin";
import { attendanceSourceEnabled } from "@/lib/payroll/attendanceSourceSync";
import { AttendanceSourcePanel } from "./panel";
import { selectAttendanceSourcePeriod } from "@/lib/payroll/attendanceSourcePeriods";
import { attendanceMatchingInbox } from "@/lib/payroll/attendanceMatchingInbox";
export default async function AttendanceSourcePage({ searchParams }: { searchParams: Promise<{ year?: string; periodId?: string }> }) {
  await requireAdminActor(); if (!attendanceSourceEnabled()) notFound();
  const params = await searchParams;
  const [periods, people, mappings, runs, sourceEvents, matchingPeople] = await Promise.all([
    db.select({ id: payrollPeriods.id, code: payrollPeriods.code, year: payrollPeriods.year, startDate: payrollPeriods.startDate, endDate: payrollPeriods.endDate }).from(payrollPeriods),
    db.select({ id: employees.id, employeeNo: employees.employeeNo, firstName: employees.firstName, middleName: employees.middleName, lastName: employees.lastName }).from(employees).where(isNull(employees.deletedAt)),
    db.select().from(attendanceSourceMappings), db.select().from(attendanceSourceRuns).orderBy(desc(attendanceSourceRuns.startedAt)).limit(30),
    db.select({payload:attendanceSourceEvents.payload}).from(attendanceSourceEvents).orderBy(desc(attendanceSourceEvents.capturedAt)).limit(500),
    attendanceMatchingInbox(db),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const selection = selectAttendanceSourcePeriod(periods, params, today);
  return <AttendanceSourcePanel
    key={`${selection.year}:${selection.periodId}`} initialYear={selection.year} initialPeriodId={selection.periodId} today={today}
    people={matchingPeople} inbox={sourceEvents.map(e => e.payload as import("@/lib/payroll/attendanceSourceClient").SourcePunch)} periods={periods}
    employees={people.map(e => ({ id: e.id, employeeNo: e.employeeNo, name: [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" ") })).sort((a, b) => a.name.localeCompare(b.name))}
    mappings={mappings.map(m => ({ sourceId: m.sourceEmployeeId, employeeId: m.employeeId }))}
    runs={runs.map(r => ({ id: r.id, state: r.state, startedAt: r.startedAt.toISOString(), counts: JSON.stringify(r.counts), error: r.error }))}
  />;
}

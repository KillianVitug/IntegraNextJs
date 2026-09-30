import { notFound } from "next/navigation";
import { desc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollPeriods } from "@/db/schema";
import { attendanceSourceMappings, attendanceSourceRuns, attendanceSourceEvents } from "@/db/attendanceSourceSchema";
import { requireAdminActor } from "@/lib/admin";
import { attendanceSourceEnabled } from "@/lib/payroll/attendanceSourceSync";
import { AttendanceSourcePanel } from "./panel";
export default async function AttendanceSourcePage() {
  await requireAdminActor(); if (!attendanceSourceEnabled()) notFound();
  const [periods, people, mappings, runs, sourceEvents] = await Promise.all([
    db.select({ id: payrollPeriods.id, code: payrollPeriods.code }).from(payrollPeriods).orderBy(desc(payrollPeriods.startDate)).limit(120),
    db.select({ id: employees.id, employeeNo: employees.employeeNo, firstName: employees.firstName, lastName: employees.lastName }).from(employees).where(isNull(employees.deletedAt)),
    db.select().from(attendanceSourceMappings), db.select().from(attendanceSourceRuns).orderBy(desc(attendanceSourceRuns.startedAt)).limit(30),
    db.select({payload:attendanceSourceEvents.payload}).from(attendanceSourceEvents).orderBy(desc(attendanceSourceEvents.capturedAt)).limit(500),
  ]);
  return <AttendanceSourcePanel inbox={sourceEvents.map(e=>e.payload as import("@/lib/payroll/attendanceSourceClient").SourcePunch)} periods={periods} employees={people.map(e => ({ id: e.id, label: `${e.employeeNo} · ${e.lastName}, ${e.firstName}` }))} mappings={mappings.map(m => ({ sourceId: m.sourceEmployeeId, employeeId: m.employeeId }))} runs={runs.map(r => ({ id: r.id, state: r.state, startedAt: r.startedAt.toISOString(), counts: JSON.stringify(r.counts), error: r.error }))}/>;
}

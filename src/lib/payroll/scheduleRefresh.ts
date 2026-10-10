import "server-only";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import { employeePayrollExceptionRows, employeesSalary, manualPayrollEntries, payrollPeriods } from "@/db/schema";
import { calculateGeneratedDtrRows, GENERATED_DTR_OVERRIDE_SOURCES } from "./generatedDtrCalculation";
import { computeManualPayrollLatestBaseline } from "./engine";
import { refreshManualPayrollAttendanceLinesFromBaseline } from "./manualPayroll";

/** Called inside the schedule mutation transaction, after its scope/payroll guards
 * and summary rebuild. Only generated attendance lines are replaced. Explicit
 * monthly adjustments, source captures and official payroll runs are retained. */
export async function refreshSchedulePayrollDerivatives(args: {
  tx: DbClient; actorUserId: string; employeeId: string; startDate: string; endDate: string;
}) {
  const periods = await args.tx.select().from(payrollPeriods).where(and(
    gte(payrollPeriods.endDate, args.startDate), lte(payrollPeriods.startDate, args.endDate),
  ));
  const monthly = await args.tx.select({ id: employeesSalary.employeeId }).from(employeesSalary)
    .where(and(eq(employeesSalary.employeeId, args.employeeId), sql`${employeesSalary.monthlyRate} > 0`));
  const cutoff = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  for (const period of periods) {
    if (period.status !== "Open") throw new Error("A closed payroll period is affected by this schedule. Use the adjustment workflow.");
    if (period.startDate > cutoff) continue;
    const generated = await calculateGeneratedDtrRows({ tx: args.tx, payrollPeriod: period, employeeIds: [args.employeeId], cutoff });
    const removed = await args.tx.delete(employeePayrollExceptionRows).where(and(
      eq(employeePayrollExceptionRows.payrollPeriodId, period.id), eq(employeePayrollExceptionRows.employeeId, args.employeeId),
      inArray(employeePayrollExceptionRows.dtrOverrideSource, GENERATED_DTR_OVERRIDE_SOURCES),
    )).returning({ id: employeePayrollExceptionRows.id });
    const inserted = generated.length ? await args.tx.insert(employeePayrollExceptionRows).values(generated).returning({ id: employeePayrollExceptionRows.id }) : [];
    const entries = !monthly.length ? await args.tx.select({ id: manualPayrollEntries.id }).from(manualPayrollEntries)
      .where(and(eq(manualPayrollEntries.payrollPeriodId, period.id), eq(manualPayrollEntries.employeeId, args.employeeId))).limit(1) : [];
    if (entries.length) {
      const latestBaseline = await computeManualPayrollLatestBaseline(period.id, args.employeeId, args.tx);
      await refreshManualPayrollAttendanceLinesFromBaseline({
        database: args.tx, actorUserId: args.actorUserId, payrollPeriodId: period.id, employeeId: args.employeeId,
        latestBaseline, refreshableExceptionRowIds: [...removed, ...inserted].map(row => row.id),
      });
    }
  }
}

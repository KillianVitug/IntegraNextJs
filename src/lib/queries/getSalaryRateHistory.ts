import { db } from "@/db";
import {
  employeeSalaryChanges,
  employeesSalaryAdjustments,
  payrollPeriods,
} from "@/db/schema";
import {
  salaryChangeAfterSnapshot,
  salaryChangeBeforeSnapshot,
} from "@/lib/payroll/salaryResolver";
import {
  employeeSalaryHistoryRowSchema,
  type EmployeeSalaryHistoryRow,
} from "@/zod-schemas/employeeSalary";
import type { SalarySnapshotNullable } from "@/zod-schemas/salaryChange";
import { and, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

function normalizeNullableMoney(value: unknown) {
  if (value == null || value === "") return null;

  if (typeof value === "number") {
    return value.toFixed(2);
  }

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (normalized === "") return null;

    const numericValue = Number(normalized);
    return Number.isFinite(numericValue) ? numericValue.toFixed(2) : normalized;
  }

  return null;
}

function normalizeNullableSnapshot(
  snapshot: SalarySnapshotNullable
): SalarySnapshotNullable {
  return {
    dailyRate: normalizeNullableMoney(snapshot.dailyRate),
    monthlyRate: normalizeNullableMoney(snapshot.monthlyRate),
    monthlyAllowance: normalizeNullableMoney(snapshot.monthlyAllowance),
    dailyAllowance: normalizeNullableMoney(snapshot.dailyAllowance),
    cola: normalizeNullableMoney(snapshot.cola),
    rateDivisor: normalizeNullableMoney(snapshot.rateDivisor),
    billingRate: normalizeNullableMoney(snapshot.billingRate),
  };
}

export async function getSalaryRateHistory(
  employeeId: string
): Promise<EmployeeSalaryHistoryRow[]> {
  const endPayrollPeriods = alias(payrollPeriods, "salary_history_end_periods");
  const [legacyRows, salaryChangeRows] = await Promise.all([
    db
      .select({
        id: employeesSalaryAdjustments.id,
        payrollCode: employeesSalaryAdjustments.payrollCode,
        adjustmentDate: employeesSalaryAdjustments.adjustmentDate,
        oldDailyRate: employeesSalaryAdjustments.oldDailyRate,
        oldMonthlyRate: employeesSalaryAdjustments.oldMonthlyRate,
        oldMonthlyAllowance: employeesSalaryAdjustments.oldMonthlyAllowance,
        oldDailyAllowance: employeesSalaryAdjustments.oldDailyAllowance,
        oldRateDivisor: employeesSalaryAdjustments.oldRateDivisor,
        oldBillingRate: employeesSalaryAdjustments.oldBillingRate,
        newDailyRate: employeesSalaryAdjustments.newDailyRate,
        newMonthlyRate: employeesSalaryAdjustments.newMonthlyRate,
        newMonthlyAllowance: employeesSalaryAdjustments.newMonthlyAllowance,
        newDailyAllowance: employeesSalaryAdjustments.newDailyAllowance,
        newRateDivisor: employeesSalaryAdjustments.newRateDivisor,
        newBillingRate: employeesSalaryAdjustments.newBillingRate,
      })
      .from(employeesSalaryAdjustments)
      .where(
        and(
          eq(employeesSalaryAdjustments.employeeId, employeeId),
          isNull(employeesSalaryAdjustments.deletedAt)
        )
      ),
    db
      .select({
        id: employeeSalaryChanges.id,
        mode: employeeSalaryChanges.mode,
        status: employeeSalaryChanges.status,
        reason: employeeSalaryChanges.reason,
        notes: employeeSalaryChanges.notes,
        createdAt: employeeSalaryChanges.createdAt,
        appliedPermanentAt: employeeSalaryChanges.appliedPermanentAt,
        beforeDailyRate: employeeSalaryChanges.beforeDailyRate,
        beforeMonthlyRate: employeeSalaryChanges.beforeMonthlyRate,
        beforeMonthlyAllowance: employeeSalaryChanges.beforeMonthlyAllowance,
        beforeDailyAllowance: employeeSalaryChanges.beforeDailyAllowance,
        beforeCola: employeeSalaryChanges.beforeCola,
        beforeRateDivisor: employeeSalaryChanges.beforeRateDivisor,
        beforeBillingRate: employeeSalaryChanges.beforeBillingRate,
        afterDailyRate: employeeSalaryChanges.afterDailyRate,
        afterMonthlyRate: employeeSalaryChanges.afterMonthlyRate,
        afterMonthlyAllowance: employeeSalaryChanges.afterMonthlyAllowance,
        afterDailyAllowance: employeeSalaryChanges.afterDailyAllowance,
        afterCola: employeeSalaryChanges.afterCola,
        afterRateDivisor: employeeSalaryChanges.afterRateDivisor,
        afterBillingRate: employeeSalaryChanges.afterBillingRate,
        payrollCode: payrollPeriods.code,
        periodStartDate: payrollPeriods.startDate,
        periodEndDate: payrollPeriods.endDate,
        endPayrollCode: endPayrollPeriods.code,
        endPeriodStartDate: endPayrollPeriods.startDate,
        endPeriodEndDate: endPayrollPeriods.endDate,
      })
      .from(employeeSalaryChanges)
      .innerJoin(
        payrollPeriods,
        eq(employeeSalaryChanges.payrollPeriodId, payrollPeriods.id)
      )
      .leftJoin(
        endPayrollPeriods,
        eq(employeeSalaryChanges.endPayrollPeriodId, endPayrollPeriods.id)
      )
      .where(eq(employeeSalaryChanges.employeeId, employeeId)),
  ]);

  const rowsWithSort = [
    ...legacyRows.map((row) => ({
      sortId: row.id,
      row: employeeSalaryHistoryRowSchema.parse({
        historyId: `legacy-${row.id}`,
        sourceId: row.id,
        source: "LegacyAdjustment",
        eventDate: row.adjustmentDate.toISOString(),
        payrollCode: row.payrollCode,
        periodStartDate: null,
        periodEndDate: null,
        endPayrollCode: null,
        endPeriodStartDate: null,
        endPeriodEndDate: null,
        mode: "Legacy",
        status: "Applied",
        reason: null,
        notes: null,
        appliedPermanentAt: null,
        before: normalizeNullableSnapshot({
          dailyRate: row.oldDailyRate,
          monthlyRate: row.oldMonthlyRate,
          monthlyAllowance: row.oldMonthlyAllowance,
          dailyAllowance: row.oldDailyAllowance,
          cola: null,
          rateDivisor: row.oldRateDivisor,
          billingRate: row.oldBillingRate,
        }),
        after: normalizeNullableSnapshot({
          dailyRate: row.newDailyRate,
          monthlyRate: row.newMonthlyRate,
          monthlyAllowance: row.newMonthlyAllowance,
          dailyAllowance: row.newDailyAllowance,
          cola: null,
          rateDivisor: row.newRateDivisor,
          billingRate: row.newBillingRate,
        }),
      }),
    })),
    ...salaryChangeRows.map((row) => ({
      sortId: row.id,
      row: employeeSalaryHistoryRowSchema.parse({
        historyId: `change-${row.id}`,
        sourceId: row.id,
        source: "SalaryChange",
        eventDate: row.createdAt.toISOString(),
        payrollCode: row.payrollCode,
        periodStartDate: row.periodStartDate,
        periodEndDate: row.periodEndDate,
        endPayrollCode: row.endPayrollCode,
        endPeriodStartDate: row.endPeriodStartDate,
        endPeriodEndDate: row.endPeriodEndDate,
        mode: row.mode,
        status: row.status,
        reason: row.reason,
        notes: row.notes ?? null,
        appliedPermanentAt: row.appliedPermanentAt?.toISOString() ?? null,
        before: normalizeNullableSnapshot(
          salaryChangeBeforeSnapshot({
            beforeDailyRate: row.beforeDailyRate,
            beforeMonthlyRate: row.beforeMonthlyRate,
            beforeMonthlyAllowance: row.beforeMonthlyAllowance,
            beforeDailyAllowance: row.beforeDailyAllowance,
            beforeCola: row.beforeCola,
            beforeRateDivisor: row.beforeRateDivisor,
            beforeBillingRate: row.beforeBillingRate,
          })
        ),
        after: normalizeNullableSnapshot(
          salaryChangeAfterSnapshot({
            afterDailyRate: row.afterDailyRate,
            afterMonthlyRate: row.afterMonthlyRate,
            afterMonthlyAllowance: row.afterMonthlyAllowance,
            afterDailyAllowance: row.afterDailyAllowance,
            afterCola: row.afterCola,
            afterRateDivisor: row.afterRateDivisor,
            afterBillingRate: row.afterBillingRate,
          })
        ),
      }),
    })),
  ];

  rowsWithSort.sort((left, right) => {
    const eventDateDiff =
      new Date(right.row.eventDate).getTime() - new Date(left.row.eventDate).getTime();

    if (eventDateDiff !== 0) return eventDateDiff;
    return right.sortId - left.sortId;
  });

  return rowsWithSort.map((entry) => entry.row);
}

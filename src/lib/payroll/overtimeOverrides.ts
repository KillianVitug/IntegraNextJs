import { db, type DbClient } from "@/db";
import { payrollInputPeriodScope } from "./payrollGroups";
import {
  attendanceDailySummaries,
  employeeAttendanceDayTypeOverrides,
  employeeDailyOvertimeOverrides,
  employees,
  overtimeRules,
  payrollPeriods,
  payrollRuns,
} from "@/db/schema";
import { recordAdminAuditEvent, recordPayrollRunEvent } from "@/lib/admin";
import { fetchConfirmedHolidayRowsForRange } from "@/lib/holidays";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { isPayrollEligibleEmploymentStatus } from "@/lib/employmentStatus";
import { format } from "date-fns";
import {
  getDailyRate,
  getHoursPerDay,
} from "./engine";
import {
  buildResolvedSalaryByEmployeeId,
  type ResolvedSalaryRecord,
} from "./salaryResolver";
import {
  getAttendanceDtrDayTypeFromHolidayType,
  getHolidayTypeFromAttendanceDtrDayType,
  type AttendanceDtrDayType,
} from "./dtrOverrides";
import {
  buildHolidayTypeByDate,
  computeOvertimeCompensation,
  findMatchingOvertimeRule,
  getOvertimeCategoryLabel,
  resolveApprovedOvertimeMinutes,
  resolveDetectedOvertimeMinutes,
  resolveOvertimeCategory,
} from "./overtime";

function splitManualMinutes(totalMinutes: number | null | undefined) {
  if (totalMinutes == null || totalMinutes <= 0) {
    return {
      manualHours: null,
      manualMinutes: null,
    };
  }

  return {
    manualHours: Math.floor(totalMinutes / 60),
    manualMinutes: totalMinutes % 60,
  };
}

async function markLatestEditableRunStale(args: {
  tx: DbClient;
  payrollPeriodId: string;
  actorUserId: string;
  notes: string;
}) {
  const affectedRuns = await args.tx
    .select()
    .from(payrollRuns)
    .where(payrollInputPeriodScope(args.payrollPeriodId))
    .orderBy(desc(payrollRuns.createdAt))
;

  let count=0;
  for(const latestRun of affectedRuns){
  if (!["Draft","Reviewed","Approved"].includes(latestRun.status)) {
    continue;
  }

  await args.tx
    .update(payrollRuns)
    .set({
      status: "Stale",
      reviewedAt: null,
      reviewedByUserId: null,
      approvedAt: null,
      approvedByUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(payrollRuns.id, latestRun.id));

  await recordPayrollRunEvent({
    payrollRunId: latestRun.id,
    actorUserId: args.actorUserId,
    eventType: "MarkedStale",
    fromStatus: latestRun.status,
    toStatus: "Stale",
    notes: args.notes,
    database: args.tx,
  });

  count++;
  }
  return count;
}

export async function getEmployeePayrollAdjustmentRows(args: {
  payrollPeriodId: string;
  employeeId: string;
}) {
  const payrollPeriod = await db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, args.payrollPeriodId),
  });

  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  const employee = await db.query.employees.findFirst({
    where: eq(employees.id, args.employeeId),
    with: {
      generalInfo: true,
      salary: true,
      timekeeping: true,
    },
  });

  if (
    !employee ||
    !isPayrollEligibleEmploymentStatus(employee.generalInfo?.employmentStatus)
  ) {
    throw new Error("Employee not found.");
  }

  const [
    summaryRows,
    overrideRows,
    dayTypeOverrideRows,
    holidayRows,
    overtimeRuleRows,
    resolvedSalaryByEmployeeId,
  ] = await Promise.all([
      db
        .select()
        .from(attendanceDailySummaries)
        .where(
          and(
            eq(attendanceDailySummaries.employeeId, args.employeeId),
            gte(attendanceDailySummaries.attendanceDate, payrollPeriod.startDate),
            lte(attendanceDailySummaries.attendanceDate, payrollPeriod.endDate)
          )
        )
        .orderBy(attendanceDailySummaries.attendanceDate),
      db
        .select()
        .from(employeeDailyOvertimeOverrides)
        .where(
          and(
            eq(employeeDailyOvertimeOverrides.employeeId, args.employeeId),
            gte(employeeDailyOvertimeOverrides.attendanceDate, payrollPeriod.startDate),
            lte(employeeDailyOvertimeOverrides.attendanceDate, payrollPeriod.endDate)
          )
        ),
      db
        .select()
        .from(employeeAttendanceDayTypeOverrides)
        .where(
          and(
            eq(employeeAttendanceDayTypeOverrides.payrollPeriodId, args.payrollPeriodId),
            eq(employeeAttendanceDayTypeOverrides.employeeId, args.employeeId),
            gte(employeeAttendanceDayTypeOverrides.attendanceDate, payrollPeriod.startDate),
            lte(employeeAttendanceDayTypeOverrides.attendanceDate, payrollPeriod.endDate)
          )
        ),
      fetchConfirmedHolidayRowsForRange(
        payrollPeriod.startDate,
        payrollPeriod.endDate
      ),
      db.select().from(overtimeRules),
      buildResolvedSalaryByEmployeeId({
        employees: [
          {
            id: employee.id,
            salary: employee.salary,
          },
        ],
        period: payrollPeriod,
      }),
    ]);

  const resolvedSalary =
    resolvedSalaryByEmployeeId.get(employee.id)?.salary ??
    ((employee.salary ?? {}) as ResolvedSalaryRecord);
  const dailyRate = getDailyRate(resolvedSalary);
  const fallbackHoursPerDay = getHoursPerDay({
    timekeeping: employee.timekeeping,
  });
  const overridesByDate = new Map(
    overrideRows.map((row) => [row.attendanceDate, row] as const)
  );
  const holidayTypeByDate = buildHolidayTypeByDate(holidayRows);
  const calendarDayTypeByDate = new Map(
    [...holidayTypeByDate.entries()].map(([attendanceDate, holidayType]) => [
      attendanceDate,
      getAttendanceDtrDayTypeFromHolidayType(holidayType),
    ])
  );
  const dayTypeOverrideByDate = new Map(
    dayTypeOverrideRows.map((row) => [
      row.attendanceDate,
      row.dayType as AttendanceDtrDayType,
    ])
  );

  return summaryRows.map((row) => {
    const override = overridesByDate.get(row.attendanceDate) ?? null;
    const effectiveDayType =
      dayTypeOverrideByDate.get(row.attendanceDate) ??
      calendarDayTypeByDate.get(row.attendanceDate) ??
      "Regular Day";
    const holidayType = getHolidayTypeFromAttendanceDtrDayType(effectiveDayType);
    const overtimeApproved = override?.isApproved ?? false;
    const overtimeCategory =
      override?.category ??
      resolveOvertimeCategory({
        isRestDay: row.isRestDay,
        holidayType,
      });
    const workedMinutesOverride = override?.workedMinutesOverride ?? null;
    const effectiveWorkedMinutes = workedMinutesOverride ?? row.workedMinutes;
    const computedOvertimeMinutes = resolveDetectedOvertimeMinutes({
      scheduleOvertimeMinutes: row.overtimeMinutes,
      effectiveWorkedMinutes,
    });
    const approvedOvertimeMinutes = resolveApprovedOvertimeMinutes({
      isApproved: overtimeApproved,
      manualMinutes: override?.manualMinutes,
      computedMinutes: computedOvertimeMinutes,
    });
    const matchedRule =
      approvedOvertimeMinutes > 0
        ? findMatchingOvertimeRule(
            overtimeRuleRows,
            overtimeCategory,
            approvedOvertimeMinutes
          )
        : null;
    const overtimePreview =
      matchedRule && approvedOvertimeMinutes > 0
        ? computeOvertimeCompensation({
            approvedMinutes: approvedOvertimeMinutes,
            dailyRate,
            scheduledMinutes: row.scheduledMinutes,
            fallbackHoursPerDay,
            rateMultiplier: matchedRule.rateMultiplier,
          })
        : null;
    const { manualHours, manualMinutes } = splitManualMinutes(override?.manualMinutes);

    return {
      attendanceDate: row.attendanceDate,
      dayName: format(new Date(`${row.attendanceDate}T00:00:00`), "EEE"),
      isRestDay: row.isRestDay,
      holidayType,
      workedMinutes: row.workedMinutes,
      workedMinutesOverride,
      effectiveWorkedMinutes,
      scheduledMinutes: row.scheduledMinutes,
      paidLeaveMinutes: row.paidLeaveMinutes,
      unpaidLeaveMinutes: row.unpaidLeaveMinutes,
      scheduleOvertimeMinutes: row.overtimeMinutes,
      computedOvertimeMinutes,
      approvedOvertimeMinutes,
      overtimeApproved,
      overtimeCategory,
      manualHours,
      manualMinutes,
      otPayPreview: overtimePreview ? overtimePreview.amount.toFixed(2) : null,
      otPayPreviewError:
        approvedOvertimeMinutes > 0 && !matchedRule
          ? `No ${getOvertimeCategoryLabel(overtimeCategory)} OT rule for ${approvedOvertimeMinutes} minute(s).`
          : null,
    };
  });
}

export async function saveEmployeePayrollOvertimeOverride(args: {
  actorUserId: string;
  payrollPeriodId: string;
  employeeId: string;
  attendanceDate: string;
  isApproved: boolean;
  category: typeof employeeDailyOvertimeOverrides.$inferInsert.category;
  manualHours: number;
  manualMinutes: number;
  workedHours?: number | null;
  workedMinutes?: number | null;
  remarks?: string | null;
}) {
  const [payrollPeriod, employee] = await Promise.all([
    db.query.payrollPeriods.findFirst({
      where: eq(payrollPeriods.id, args.payrollPeriodId),
    }),
    db.query.employees.findFirst({
      where: eq(employees.id, args.employeeId),
      with: {
        generalInfo: true,
      },
    }),
  ]);

  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }
  if (
    !employee ||
    employee.deletedAt ||
    !isPayrollEligibleEmploymentStatus(employee.generalInfo?.employmentStatus)
  ) {
    throw new Error("Employee not found.");
  }

  if (
    args.attendanceDate < payrollPeriod.startDate ||
    args.attendanceDate > payrollPeriod.endDate
  ) {
    throw new Error("Attendance date is outside the selected payroll period.");
  }

  return db.transaction(async (tx) => {
    const summaryRow = await tx.query.attendanceDailySummaries.findFirst({
      where: and(
        eq(attendanceDailySummaries.employeeId, args.employeeId),
        eq(attendanceDailySummaries.attendanceDate, args.attendanceDate)
      ),
    });

    if (!summaryRow) {
      throw new Error("Attendance row not found for this employee and work date.");
    }

    const manualMinutesTotal = args.manualHours * 60 + args.manualMinutes;
    const persistedManualMinutes = manualMinutesTotal > 0 ? manualMinutesTotal : null;
    const persistedWorkedMinutesOverride =
      args.workedHours == null && args.workedMinutes == null
        ? null
        : (args.workedHours ?? 0) * 60 + (args.workedMinutes ?? 0);
    const remarks = args.remarks?.trim() ? args.remarks.trim() : null;
    const existingOverride = await tx.query.employeeDailyOvertimeOverrides.findFirst({
      where: and(
        eq(employeeDailyOvertimeOverrides.employeeId, args.employeeId),
        eq(employeeDailyOvertimeOverrides.attendanceDate, args.attendanceDate)
      ),
    });

    const payload = {
      employeeId: args.employeeId,
      attendanceDate: args.attendanceDate,
      isApproved: args.isApproved,
      manualMinutes: persistedManualMinutes,
      workedMinutesOverride: persistedWorkedMinutesOverride,
      category: args.category,
      remarks,
      updatedAt: new Date(),
    };

    if (existingOverride) {
      await tx
        .update(employeeDailyOvertimeOverrides)
        .set(payload)
        .where(eq(employeeDailyOvertimeOverrides.id, existingOverride.id));
    } else {
      await tx.insert(employeeDailyOvertimeOverrides).values(payload);
    }

    const staleRunCount = await markLatestEditableRunStale({
      tx,
      payrollPeriodId: args.payrollPeriodId,
      actorUserId: args.actorUserId,
      notes: "Marked stale because employee overtime approval changed.",
    });

    await recordAdminAuditEvent({
      actorUserId: args.actorUserId,
      entityType: "employee_daily_overtime_override",
      entityId: `${args.employeeId}:${args.attendanceDate}`,
      action: existingOverride
        ? "payroll.overtime_override.updated"
        : "payroll.overtime_override.created",
      details: {
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: args.attendanceDate,
        isApproved: args.isApproved,
        category: args.category,
        manualMinutes: persistedManualMinutes,
        workedMinutesOverride: persistedWorkedMinutesOverride,
        remarks,
        staleRunCount,
      },
      database: tx,
    });

    return {
      staleRunCount,
    };
  });
}

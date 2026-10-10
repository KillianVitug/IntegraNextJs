import "server-only";
import type { AttendanceDtrTotalsView } from "@/app/(ntg)/payroll/types";
import { db, type DbClient } from "@/db";
import { accountCode, attendanceDailySummaries, branchCalendarAccountCodeOverrides, employeeAttendanceDayStatusOverrides, employeeAttendanceDayMetricOverrides, employeeAttendanceDayTypeOverrides, employeeAttendancePeriodOverrides, employeeDailyOvertimeOverrides, overtimeRules, employeePayrollExceptionRows, employeesGeneralInfo, holidayTypeAccountCodes, holidayYearCalendar, payrollPeriods } from "@/db/schema";
import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { applyAttendanceDtrEffectiveStatus, computeAccumulatedLatePenaltyMinutes, computeNetDtrWorkedMinutes, computePayrollTardinessMinutes, getAttendanceDtrDayTypeFromHolidayType, getHolidayTypeFromAttendanceDtrDayType, normalizeAttendanceDtrPeriodOverride, type AttendanceDtrDayType, type AttendanceDtrManualStatus } from "@/lib/payroll/dtrOverrides";
import { buildHolidayTypeByDate, resolveOvertimeCategory, type OvertimeCategory, type OvertimeHolidayType } from "@/lib/payroll/overtime";
import { computeGeneratedDtrLwopMinutes } from "@/lib/payroll/dtrLwop";
import { isGeneratedDtrHolidayCheckRequirementSatisfied, getGeneratedDtrHolidayOvertimeCapacityMinutes, getGeneratedDtrHolidayWorkedMinutes, type GeneratedDtrHolidayCheckDateAttendance, type GeneratedDtrHolidayCheckDateRequirement } from "@/lib/payroll/generatedDtrHolidays";
import { buildBranchCalendarOverrideRowsForGeneratedDtr, buildBranchCalendarOverrideScopeMaps } from "@/lib/payroll/branchCalendarAccountCodes";
import type { PayrollExceptionDtrOverrideSource } from "@/lib/payroll/payrollExceptions";
import { computePolicyAttendancePay } from "./dtrOverrides";
import { findMatchingOvertimeRule, resolveApprovedOvertimeMinutes, resolveDetectedOvertimeMinutes } from "./overtime";

export type AttendanceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function roundDays(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildAttendanceDtrTotals(
  rows: Array<{
    calculationPolicy?: string | null;
    anomalyFlags?: string | string[] | null;
    scheduledMinutes: number;
    workedMinutes: number;
    regularMinutes: number;
    lateMinutes: number;
    undertimeMinutes: number;
    overtimeMinutes: number;
    paidLeaveMinutes: number;
    unpaidLeaveMinutes: number;
    absentMinutes: number;
    isRestDay: boolean;
  }>,
  periodOverride?: typeof employeeAttendancePeriodOverrides.$inferSelect | null
) {
  const totals = {
    workedMinutes: 0,
    lateMinutes: 0,
    undertimeMinutes: 0,
    overtimeMinutes: 0,
    paidLeaveMinutes: 0,
    unpaidLeaveMinutes: 0,
    absentMinutes: 0,
    presentDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
  };

  for (const row of rows) {
    const scheduledMinutes = row.scheduledMinutes > 0 ? row.scheduledMinutes : 480;

    totals.workedMinutes += row.workedMinutes;
    totals.lateMinutes += row.lateMinutes;
    totals.undertimeMinutes += row.undertimeMinutes;
    totals.overtimeMinutes += row.overtimeMinutes;
    totals.paidLeaveMinutes += row.paidLeaveMinutes;
    totals.unpaidLeaveMinutes += row.unpaidLeaveMinutes;
    totals.absentMinutes += row.absentMinutes;

    if (!row.isRestDay && (row.workedMinutes > 0 || row.regularMinutes > 0)) {
      totals.presentDays += Math.max(1, roundDays(row.regularMinutes / scheduledMinutes));
    }

    if (row.paidLeaveMinutes > 0) {
      totals.paidLeaveDays += roundDays(row.paidLeaveMinutes / scheduledMinutes);
    }

    if (row.unpaidLeaveMinutes > 0) {
      totals.unpaidLeaveDays += roundDays(row.unpaidLeaveMinutes / scheduledMinutes);
    }

    if (row.absentMinutes > 0) {
      totals.absentDays += roundDays(row.absentMinutes / scheduledMinutes);
    }
  }

  const computedPresentDays = roundDays(totals.presentDays);
  const hasExplicitPolicy = rows.some(row=>row.calculationPolicy==="eight_hour_day");
  const policyMinutes = hasExplicitPolicy ? computePolicyAttendancePay(rows,0).minutes : null;
  const biometricWorkedMinutes = totals.workedMinutes;
  const computed = {
    presentDays: computedPresentDays,
    workedMinutes: policyMinutes ?? computeNetDtrWorkedMinutes({
      presentDays: computedPresentDays,
      lateMinutes: totals.lateMinutes,
      undertimeMinutes: totals.undertimeMinutes,
    }),
    lateMinutes: totals.lateMinutes,
    latePenaltyMinutes: computeAccumulatedLatePenaltyMinutes(totals.lateMinutes),
    undertimeMinutes: totals.undertimeMinutes,
    overtimeMinutes: totals.overtimeMinutes,
  };
  const overrides = normalizeAttendanceDtrPeriodOverride(periodOverride);
  const rawEffectiveLateMinutes = overrides.lateMinutes ?? computed.lateMinutes;
  const effectiveLatePenaltyMinutes = computeAccumulatedLatePenaltyMinutes(
    rawEffectiveLateMinutes
  );
  const effectiveLateMinutes = computePayrollTardinessMinutes(
    rawEffectiveLateMinutes
  );
  const effectiveUndertimeMinutes =
    overrides.undertimeMinutes ?? computed.undertimeMinutes;

  return {
    ...totals,
    presentDays: overrides.presentDays ?? computed.presentDays,
    workedMinutes: hasExplicitPolicy ? Math.max(0,overrides.workedMinutes ?? computed.workedMinutes + computed.lateMinutes + computed.undertimeMinutes - rawEffectiveLateMinutes - effectiveUndertimeMinutes) : computeNetDtrWorkedMinutes({
      presentDays: computed.presentDays,
      lateMinutes: rawEffectiveLateMinutes,
      undertimeMinutes: effectiveUndertimeMinutes,
      workedMinutesOverride: overrides.workedMinutes,
    }),
    lateMinutes: effectiveLateMinutes,
    latePenaltyMinutes: effectiveLatePenaltyMinutes,
    undertimeMinutes: effectiveUndertimeMinutes,
    overtimeMinutes: overrides.overtimeMinutes ?? computed.overtimeMinutes,
    biometricWorkedMinutes,
    paidLeaveDays: roundDays(totals.paidLeaveDays),
    unpaidLeaveDays: roundDays(totals.unpaidLeaveDays),
    absentDays: roundDays(totals.absentDays),
    computed,
    overrides,
  } satisfies AttendanceDtrTotalsView;
}

export type AttendanceDtrMetricOverrideRecord = Pick<
  typeof employeeAttendanceDayMetricOverrides.$inferSelect,
  "lateMinutes" | "undertimeMinutes" | "overtimeMinutes"
>;

export function getDtrMetricOverrideBaselineWorkedMinutes(row: {
  scheduledMinutes?: number | null;
  workedMinutes?: number | null;
}) {
  const scheduledMinutes = Math.max(0, Math.round(row.scheduledMinutes ?? 0));
  if (scheduledMinutes > 0) return scheduledMinutes;

  const workedMinutes = Math.max(0, Math.round(row.workedMinutes ?? 0));
  return workedMinutes > 0 ? workedMinutes : 8 * 60;
}

export function applyAttendanceDtrMetricOverride<
  T extends {
    calculationPolicy?: string | null;
    scheduledMinutes: number;
    workedMinutes: number;
    regularMinutes: number;
    lateMinutes: number;
    undertimeMinutes: number;
    overtimeMinutes: number;
    isRestDay: boolean;
  },
>(row: T, override: AttendanceDtrMetricOverrideRecord | null | undefined): T {
  if (!override) return row;

  const lateMinutes =
    override.lateMinutes == null
      ? row.lateMinutes
      : Math.max(0, Math.round(override.lateMinutes));
  const undertimeMinutes =
    override.undertimeMinutes == null
      ? row.undertimeMinutes
      : Math.max(0, Math.round(override.undertimeMinutes));
  const overtimeMinutes =
    override.overtimeMinutes == null
      ? row.overtimeMinutes
      : Math.max(0, Math.round(override.overtimeMinutes));
  if(row.calculationPolicy==="eight_hour_day") {
    const delta=row.lateMinutes+row.undertimeMinutes-lateMinutes-undertimeMinutes;
    return {...row,workedMinutes:Math.max(0,row.workedMinutes+delta),regularMinutes:row.isRestDay?0:Math.min(480,Math.max(0,row.regularMinutes+delta)),lateMinutes,undertimeMinutes,overtimeMinutes};
  }
  const workedMinutes = Math.max(
    0,
    getDtrMetricOverrideBaselineWorkedMinutes(row) - lateMinutes - undertimeMinutes
  );
  const regularBaseline = row.isRestDay
    ? Math.max(0, Math.round(row.regularMinutes))
    : getDtrMetricOverrideBaselineWorkedMinutes(row);

  return {
    ...row,
    workedMinutes,
    regularMinutes: Math.min(workedMinutes, regularBaseline),
    lateMinutes,
    undertimeMinutes,
    overtimeMinutes,
  };
}

export function buildDtrMetricOverrideByEmployeeDate(
  rows: Array<typeof employeeAttendanceDayMetricOverrides.$inferSelect>
) {
  return new Map(rows.map((row) => [`${row.employeeId}|${row.attendanceDate}`, row]));
}

export const GENERATED_DTR_OVERRIDE_SOURCES: PayrollExceptionDtrOverrideSource[] = [
  "DTR_WORKED",
  "DTR_TARDINESS",
  "DTR_UNDERTIME",
  "DTR_REGULAR_OVERTIME",
];

export type DtrPeriodOverrideValues = {
  presentDays: number | null;
  workedMinutes: number | null;
  lateMinutes: number | null;
  undertimeMinutes: number | null;
  overtimeMinutes: number | null;
};

export type GeneratedDtrAccountCodeRow = typeof accountCode.$inferSelect;

export type GeneratedDtrExceptionRowInsert =
  typeof employeePayrollExceptionRows.$inferInsert;

export type GeneratedDtrHolidayCalendarRow = {
  holidayDate: string;
  holidayDate2: string | null;
  holidayType: OvertimeHolidayType;
  checkDate1: string | null;
  checkDate2: string | null;
  requireCheckDate1: boolean;
  requireCheckDate2: boolean;
};

export type GeneratedDtrHolidayCheckRequirementWithPriority =
  GeneratedDtrHolidayCheckDateRequirement & {
    holidayType: OvertimeHolidayType;
  };

export type GeneratedDtrHolidayWorkedRow = {
  attendanceDate: string;
  holidayType: OvertimeHolidayType;
  dayType: AttendanceDtrDayType;
  isRestDay: boolean;
  account: GeneratedDtrAccountCodeRow;
  quantityMinutes: number;
  checkRequirement: GeneratedDtrHolidayCheckDateRequirement;
};

export type GeneratedDtrHolidayOvertimeRow = {
  attendanceDate: string;
  holidayType: OvertimeHolidayType;
  dayType: AttendanceDtrDayType;
  account: GeneratedDtrAccountCodeRow | null;
  dailyOvertimeMinutes: number;
  overrideCapacityMinutes: number;
  overtimeCategory: OvertimeCategory;
  checkRequirement: GeneratedDtrHolidayCheckDateRequirement;
};

export type GeneratedDtrBranchCalendarOverrideRow = {
  attendanceDate: string;
  regularAccount: GeneratedDtrAccountCodeRow;
  overtimeAccount: GeneratedDtrAccountCodeRow;
  regularMinutes: number;
  overtimeMinutes: number;
};

export type GeneratedDtrExceptionRowSyncResult = {
  generatedAccountCodeRowCount: number;
  refreshableExceptionRowIds: string[];
};

export const EMPTY_GENERATED_DTR_EXCEPTION_ROW_SYNC: GeneratedDtrExceptionRowSyncResult = {
  generatedAccountCodeRowCount: 0,
  refreshableExceptionRowIds: [],
};

export function normalizeGeneratedDtrAccountText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function getGeneratedDtrAccountCode(args: {
  source: PayrollExceptionDtrOverrideSource;
  accountRows: GeneratedDtrAccountCodeRow[];
}) {
  if (args.source === "DTR_WORKED") {
    return (
      args.accountRows.find((row) => row.accountType === "Regular Hours") ??
      null
    );
  }

  if (args.source === "DTR_TARDINESS") {
    return (
      args.accountRows.find((row) =>
        normalizeGeneratedDtrAccountText(row.description).includes("tardiness")
      ) ?? null
    );
  }

  if (args.source === "DTR_UNDERTIME") {
    return (
      args.accountRows.find((row) => {
        if (row.accountType !== "Unpaid Leaves/Absences") return false;
        const code = normalizeGeneratedDtrAccountText(row.accountCode);
        const description = normalizeGeneratedDtrAccountText(row.description);
        return (
          code.includes("leave without pay") ||
          code.includes("lwop") ||
          description.includes("leave without pay") ||
          description.includes("lwop")
        );
      }) ?? null
    );
  }

  return (
    args.accountRows.find((row) => {
      if (row.accountType !== "Overtime") return false;
      const code = normalizeGeneratedDtrAccountText(row.accountCode);
      const description = normalizeGeneratedDtrAccountText(row.description);
      return (
        code.includes("regular overtime") ||
        description.includes("regular overtime")
      );
    }) ?? null
  );
}

export function createGeneratedDtrExceptionRow(args: {
  payrollPeriodId: string;
  employeeId: string;
  attendanceDate: string;
  source: PayrollExceptionDtrOverrideSource;
  account: GeneratedDtrAccountCodeRow;
  quantityMinutes: number;
  amountOverride?: string | null;
  generatedFrom?: "override" | "computed";
  sourceLabel?: string;
  dayType?: AttendanceDtrDayType | null;
  overtimeCategory?: OvertimeCategory | null;
}) {
  const defaultSourceLabel =
    args.source === "DTR_WORKED"
      ? "Worked"
      : args.source === "DTR_TARDINESS"
        ? "Late"
        : args.source === "DTR_UNDERTIME"
          ? "Undertime"
          : "Regular Overtime";
  const sourceLabel = args.sourceLabel ?? defaultSourceLabel;
  const sourceDescription =
    args.source === "DTR_WORKED" && args.generatedFrom === "computed"
      ? "imported Semimonthly DTR Worked hours"
      : args.generatedFrom === "computed"
        ? `imported Semimonthly DTR ${sourceLabel} hours`
      : `Semimonthly DTR ${sourceLabel} override`;

  return {
    payrollPeriodId: args.payrollPeriodId,
    employeeId: args.employeeId,
    attendanceDate: args.attendanceDate,
    exceptionType: null,
    workedStatus: null,
    dayType: args.dayType ?? null,
    customPayrollCodeId: null,
    accountCodeId: args.account.id,
    accountCodeSnapshot: args.account.accountCode,
    accountTypeSnapshot: args.account.accountType,
    accountDescriptionSnapshot: args.account.description,
    accountMonth13thPaySnapshot: args.account.month13thPay,
    accountNonTaxableSnapshot: args.account.nonTaxable,
    overtimeCategory:
      args.source === "DTR_REGULAR_OVERTIME"
        ? args.overtimeCategory ?? "REGULAR_DAY"
        : null,
    quantityMinutes: args.quantityMinutes,
    quantityDays: null,
    amountOverride: args.amountOverride ?? null,
    remarks: `Generated from ${sourceDescription}.`,
    dtrOverrideSource: args.source,
    updatedAt: new Date(),
  } satisfies typeof employeePayrollExceptionRows.$inferInsert;
}

export function getEffectiveHolidayTypeForDate(args: {
  attendanceDate: string;
  manualDayTypeByDate: Map<string, AttendanceDtrDayType>;
  calendarHolidayTypeByDate: Map<string, OvertimeHolidayType>;
}) {
  const manualDayType = args.manualDayTypeByDate.get(args.attendanceDate);

  if (manualDayType) {
    return getHolidayTypeFromAttendanceDtrDayType(manualDayType);
  }

  return args.calendarHolidayTypeByDate.get(args.attendanceDate) ?? null;
}

export function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatDateOnly(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getHolidayPriority(holidayType: OvertimeHolidayType) {
  if (holidayType === "Regular") return 4;
  if (holidayType === "Special Non-Working") return 3;
  if (holidayType === "Company") return 2;
  return 1;
}

export function buildHolidayCheckRequirementByDate(
  holidays: GeneratedDtrHolidayCalendarRow[]
) {
  const requirementByDate = new Map<
    string,
    GeneratedDtrHolidayCheckDateRequirement & { holidayType: OvertimeHolidayType }
  >();

  for (const holiday of holidays) {
    const start = parseDateOnly(holiday.holidayDate);
    const end = parseDateOnly(holiday.holidayDate2 ?? holiday.holidayDate);
    const cursor = new Date(start.getTime());

    while (cursor <= end) {
      const dateKey = formatDateOnly(cursor);
      const existing = requirementByDate.get(dateKey);

      if (
        !existing ||
        getHolidayPriority(holiday.holidayType) >
          getHolidayPriority(existing.holidayType)
      ) {
        requirementByDate.set(dateKey, {
          holidayType: holiday.holidayType,
          checkDate1: holiday.checkDate1,
          checkDate2: holiday.checkDate2,
          requireCheckDate1: holiday.requireCheckDate1,
          requireCheckDate2: holiday.requireCheckDate2,
        });
      }

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return requirementByDate;
}

export function getRequiredHolidayCheckDates(holidays: GeneratedDtrHolidayCalendarRow[]) {
  return [
    ...new Set(
      holidays.flatMap((holiday) => [
        holiday.requireCheckDate1 && holiday.checkDate1 ? holiday.checkDate1 : null,
        holiday.requireCheckDate2 && holiday.checkDate2 ? holiday.checkDate2 : null,
      ])
    ),
  ].filter((date): date is string => Boolean(date));
}

export function buildCheckDateAttendanceByDate(
  rows: Array<{
    attendanceDate: string;
    workedMinutes: number;
    regularMinutes: number;
    lateMinutes: number;
    undertimeMinutes: number;
  }>
) {
  return new Map(
    rows.map((row) => [
      row.attendanceDate,
      {
        attendanceDate: row.attendanceDate,
        workedMinutes: row.workedMinutes,
        regularMinutes: row.regularMinutes,
        lateMinutes: row.lateMinutes,
        undertimeMinutes: row.undertimeMinutes,
      } satisfies GeneratedDtrHolidayCheckDateAttendance,
    ])
  );
}

export function buildHolidayWorkedRowsForGeneratedDtr(args: {
  rows: Array<{
    attendanceDate: string;
    scheduledMinutes: number;
    workedMinutes: number;
    regularMinutes: number;
    lateMinutes: number;
    undertimeMinutes: number;
    isRestDay: boolean;
  }>;
  manualDayTypeByDate: Map<string, AttendanceDtrDayType>;
  calendarHolidayTypeByDate: Map<string, OvertimeHolidayType>;
  holidayCheckRequirementByDate: Map<
    string,
    GeneratedDtrHolidayCheckRequirementWithPriority
  >;
  checkDateAttendanceByDate: Map<string, GeneratedDtrHolidayCheckDateAttendance>;
  holidayAccountByType: Map<OvertimeHolidayType, GeneratedDtrAccountCodeRow>;
  restDayHolidayAccountByType: Map<
    OvertimeHolidayType,
    GeneratedDtrAccountCodeRow
  >;
}) {
  return args.rows.flatMap((row): GeneratedDtrHolidayWorkedRow[] => {
    const holidayType = getEffectiveHolidayTypeForDate({
      attendanceDate: row.attendanceDate,
      manualDayTypeByDate: args.manualDayTypeByDate,
      calendarHolidayTypeByDate: args.calendarHolidayTypeByDate,
    });
    if (!holidayType) return [];

    const checkRequirement =
      args.holidayCheckRequirementByDate.get(row.attendanceDate) ?? null;
    if (
      !isGeneratedDtrHolidayCheckRequirementSatisfied({
        requirement: checkRequirement,
        attendanceByDate: args.checkDateAttendanceByDate,
      })
    ) {
      return [];
    }

    const account = row.isRestDay
      ? args.restDayHolidayAccountByType.get(holidayType) ??
        args.holidayAccountByType.get(holidayType)
      : args.holidayAccountByType.get(holidayType);
    if (!account) return [];

    const quantityMinutes = getGeneratedDtrHolidayWorkedMinutes(row);
    if (quantityMinutes <= 0) return [];

    return [
      {
        attendanceDate: row.attendanceDate,
        holidayType,
        dayType: getAttendanceDtrDayTypeFromHolidayType(holidayType),
        isRestDay: row.isRestDay,
        account,
        quantityMinutes,
        checkRequirement: checkRequirement ?? {},
      },
    ];
  });
}

export function buildHolidayOvertimeRowsForGeneratedDtr(args: {
  rows: Array<{
    attendanceDate: string;
    scheduledMinutes: number;
    workedMinutes: number;
    regularMinutes: number;
    lateMinutes: number;
    undertimeMinutes: number;
    overtimeMinutes: number;
    isRestDay: boolean;
  }>;
  manualDayTypeByDate: Map<string, AttendanceDtrDayType>;
  calendarHolidayTypeByDate: Map<string, OvertimeHolidayType>;
  holidayCheckRequirementByDate: Map<
    string,
    GeneratedDtrHolidayCheckRequirementWithPriority
  >;
  checkDateAttendanceByDate: Map<string, GeneratedDtrHolidayCheckDateAttendance>;
  holidayOvertimeAccountByType: Map<
    OvertimeHolidayType,
    GeneratedDtrAccountCodeRow
  >;
  restDayHolidayOvertimeAccountByType: Map<
    OvertimeHolidayType,
    GeneratedDtrAccountCodeRow
  >;
}) {
  return args.rows.flatMap((row): GeneratedDtrHolidayOvertimeRow[] => {
    const holidayType = getEffectiveHolidayTypeForDate({
      attendanceDate: row.attendanceDate,
      manualDayTypeByDate: args.manualDayTypeByDate,
      calendarHolidayTypeByDate: args.calendarHolidayTypeByDate,
    });
    if (!holidayType) return [];

    const checkRequirement =
      args.holidayCheckRequirementByDate.get(row.attendanceDate) ?? null;
    if (
      !isGeneratedDtrHolidayCheckRequirementSatisfied({
        requirement: checkRequirement,
        attendanceByDate: args.checkDateAttendanceByDate,
      })
    ) {
      return [];
    }

    const fallbackOvertimeCapacityMinutes =
      getGeneratedDtrHolidayOvertimeCapacityMinutes(row);
    const dailyOvertimeMinutes =
      row.overtimeMinutes > 0
        ? Math.max(0, Math.round(row.overtimeMinutes))
        : row.isRestDay
          ? fallbackOvertimeCapacityMinutes
          : 0;
    const overrideCapacityMinutes =
      dailyOvertimeMinutes > 0
        ? dailyOvertimeMinutes
        : fallbackOvertimeCapacityMinutes;
    if (dailyOvertimeMinutes <= 0 && overrideCapacityMinutes <= 0) return [];
    const account = row.isRestDay
      ? args.restDayHolidayOvertimeAccountByType.get(holidayType) ??
        args.holidayOvertimeAccountByType.get(holidayType) ??
        null
      : args.holidayOvertimeAccountByType.get(holidayType) ?? null;

    return [
      {
        attendanceDate: row.attendanceDate,
        holidayType,
        dayType: getAttendanceDtrDayTypeFromHolidayType(holidayType),
        account,
        dailyOvertimeMinutes,
        overrideCapacityMinutes,
        overtimeCategory: resolveOvertimeCategory({
          isRestDay: row.isRestDay,
          holidayType,
        }),
        checkRequirement: checkRequirement ?? {},
      },
    ];
  });
}

export function buildHolidayAccountByType(args: {
  accountRows: GeneratedDtrAccountCodeRow[];
  mappingRows: Array<typeof holidayTypeAccountCodes.$inferSelect>;
  accountCodeField:
    | "accountCodeId"
    | "overtimeAccountCodeId"
    | "restDayAccountCodeId"
    | "restDayOvertimeAccountCodeId";
  accountType: "Sunday/Holiday" | "Overtime";
}) {
  const accountById = new Map(args.accountRows.map((row) => [row.id, row]));
  const holidayAccountByType = new Map<
    OvertimeHolidayType,
    GeneratedDtrAccountCodeRow
  >();

  for (const mapping of args.mappingRows) {
    const accountCodeId = mapping[args.accountCodeField];
    if (!accountCodeId) continue;
    const account = accountById.get(accountCodeId);
    if (!account || account.accountType !== args.accountType) continue;
    holidayAccountByType.set(mapping.holidayType as OvertimeHolidayType, account);
  }

  return holidayAccountByType;
}

export async function fetchHolidayRowsForGeneratedDtr(args: {
  tx: DbClient;
  startDate: string;
  endDate: string;
}) {
  const rows = await args.tx
    .select({
      holidayDate: holidayYearCalendar.holidayDate,
      holidayDate2: holidayYearCalendar.holidayDate2,
      checkDate1: holidayYearCalendar.checkDate1,
      checkDate2: holidayYearCalendar.checkDate2,
      requireCheckDate1: holidayYearCalendar.requireCheckDate1,
      requireCheckDate2: holidayYearCalendar.requireCheckDate2,
      holidayType: holidayYearCalendar.holidayType,
    })
    .from(holidayYearCalendar)
    .where(
      and(
        eq(holidayYearCalendar.status, "Confirmed"),
        isNotNull(holidayYearCalendar.holidayDate),
        lte(holidayYearCalendar.holidayDate, args.endDate),
        sql`coalesce(${holidayYearCalendar.holidayDate2}, ${holidayYearCalendar.holidayDate}) >= ${args.startDate}`
      )
    )
    .orderBy(asc(holidayYearCalendar.holidayDate));

  return rows.filter(
    (
      row
    ): row is {
      holidayDate: string;
      holidayDate2: string | null;
      checkDate1: string | null;
      checkDate2: string | null;
      requireCheckDate1: boolean;
      requireCheckDate2: boolean;
      holidayType: OvertimeHolidayType;
    } => row.holidayDate != null
  );
}

export function buildGeneratedDtrWorkedExceptionRow(args: {
  policyWorkedMinutes?: number;
  payrollPeriodId: string;
  employeeId: string;
  attendanceDate: string;
  overrides: Pick<
    DtrPeriodOverrideValues,
    "workedMinutes" | "lateMinutes" | "undertimeMinutes"
  >;
  computed: Pick<
    AttendanceDtrTotalsView["computed"],
    "presentDays" | "workedMinutes" | "lateMinutes" | "undertimeMinutes"
  >;
  accountRows: GeneratedDtrAccountCodeRow[];
  holidayWorkedRows?: GeneratedDtrHolidayWorkedRow[];
  branchCalendarOverrideRows?: GeneratedDtrBranchCalendarOverrideRow[];
}): GeneratedDtrExceptionRowInsert[] {
  const effectiveWorkedMinutes = args.overrides.workedMinutes ?? args.policyWorkedMinutes ?? computeNetDtrWorkedMinutes({
    presentDays: args.computed.presentDays,
    lateMinutes: args.overrides.lateMinutes ?? args.computed.lateMinutes,
    undertimeMinutes:
      args.overrides.undertimeMinutes ?? args.computed.undertimeMinutes,
    workedMinutesOverride: args.overrides.workedMinutes,
  });
  const additionalRestDayHolidayWorkedMinutes = (args.holidayWorkedRows ?? [])
    .filter((row) => row.isRestDay)
    .reduce((total, row) => total + Math.max(0, row.quantityMinutes), 0);
  let remainingWorkedMinutes = Math.max(
    0,
    effectiveWorkedMinutes + additionalRestDayHolidayWorkedMinutes
  );
  if (remainingWorkedMinutes <= 0) return [];

  const rows: GeneratedDtrExceptionRowInsert[] = [];
  const sortedHolidayRows = [...(args.holidayWorkedRows ?? [])].sort((left, right) =>
    left.attendanceDate.localeCompare(right.attendanceDate)
  );

  for (const holidayRow of sortedHolidayRows) {
    const quantityMinutes = Math.min(
      remainingWorkedMinutes,
      Math.max(0, holidayRow.quantityMinutes)
    );
    if (quantityMinutes <= 0) continue;

    rows.push(
      createGeneratedDtrExceptionRow({
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: holidayRow.attendanceDate,
        source: "DTR_WORKED",
        account: holidayRow.account,
        quantityMinutes,
        generatedFrom:
          args.overrides.workedMinutes != null ||
          args.overrides.lateMinutes != null ||
          args.overrides.undertimeMinutes != null
            ? "override"
            : "computed",
        sourceLabel: `${holidayRow.holidayType} Holiday Worked`,
        dayType: holidayRow.dayType,
      })
    );
    remainingWorkedMinutes -= quantityMinutes;
  }

  if (remainingWorkedMinutes <= 0) return rows;

  const sortedBranchCalendarRows = [
    ...(args.branchCalendarOverrideRows ?? []),
  ].sort((left, right) => left.attendanceDate.localeCompare(right.attendanceDate));

  for (const overrideRow of sortedBranchCalendarRows) {
    const quantityMinutes = Math.min(
      remainingWorkedMinutes,
      Math.max(0, overrideRow.regularMinutes)
    );
    if (quantityMinutes <= 0) continue;

    rows.push(
      createGeneratedDtrExceptionRow({
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: overrideRow.attendanceDate,
        source: "DTR_WORKED",
        account: overrideRow.regularAccount,
        quantityMinutes,
        generatedFrom:
          args.overrides.workedMinutes != null ||
          args.overrides.lateMinutes != null ||
          args.overrides.undertimeMinutes != null
            ? "override"
            : "computed",
        sourceLabel: "Branch Calendar Regular Hours",
      })
    );
    remainingWorkedMinutes -= quantityMinutes;
  }

  if (remainingWorkedMinutes <= 0) return rows;

  const account = getGeneratedDtrAccountCode({
    source: "DTR_WORKED",
    accountRows: args.accountRows,
  });
  if (!account) {
    throw new Error(
      "Create a Regular Hours account code before syncing DTR Worked hours."
    );
  }

  rows.push(
    createGeneratedDtrExceptionRow({
      payrollPeriodId: args.payrollPeriodId,
      employeeId: args.employeeId,
      attendanceDate: args.attendanceDate,
      source: "DTR_WORKED",
      account,
      quantityMinutes: remainingWorkedMinutes,
      generatedFrom:
        args.overrides.workedMinutes != null ||
        args.overrides.lateMinutes != null ||
        args.overrides.undertimeMinutes != null
          ? "override"
          : "computed",
    })
  );

  return rows;
}

export function buildGeneratedDtrOvertimeExceptionRows(args: {
  payrollPeriodId: string;
  employeeId: string;
  attendanceDate: string;
  overrides: Pick<DtrPeriodOverrideValues, "overtimeMinutes">;
  computed: Pick<AttendanceDtrTotalsView["computed"], "overtimeMinutes">;
  accountRows: GeneratedDtrAccountCodeRow[];
  holidayOvertimeRows?: GeneratedDtrHolidayOvertimeRow[];
  branchCalendarOverrideRows?: GeneratedDtrBranchCalendarOverrideRow[];
}): GeneratedDtrExceptionRowInsert[] {
  const isOverride = args.overrides.overtimeMinutes != null;
  const effectiveOvertimeMinutes = Math.max(
    0,
    Math.round(args.overrides.overtimeMinutes ?? args.computed.overtimeMinutes)
  );
  if (effectiveOvertimeMinutes <= 0) return [];

  let remainingOvertimeMinutes = effectiveOvertimeMinutes;
  const rows: GeneratedDtrExceptionRowInsert[] = [];
  const sortedHolidayRows = [...(args.holidayOvertimeRows ?? [])].sort(
    (left, right) => left.attendanceDate.localeCompare(right.attendanceDate)
  );

  for (const holidayRow of sortedHolidayRows) {
    const holidayCapacityMinutes = isOverride
      ? holidayRow.overrideCapacityMinutes
      : holidayRow.dailyOvertimeMinutes;
    const quantityMinutes = Math.min(
      remainingOvertimeMinutes,
      Math.max(0, holidayCapacityMinutes)
    );
    if (quantityMinutes <= 0) continue;

    if (holidayRow.account) {
      rows.push(
        createGeneratedDtrExceptionRow({
          payrollPeriodId: args.payrollPeriodId,
          employeeId: args.employeeId,
          attendanceDate: holidayRow.attendanceDate,
          source: "DTR_REGULAR_OVERTIME",
          account: holidayRow.account,
          quantityMinutes,
          generatedFrom: isOverride ? "override" : "computed",
          sourceLabel: `${holidayRow.holidayType} Holiday Overtime`,
          dayType: holidayRow.dayType,
          overtimeCategory: holidayRow.overtimeCategory,
        })
      );
    }

    remainingOvertimeMinutes -= quantityMinutes;
  }

  if (remainingOvertimeMinutes <= 0) return rows;

  const sortedBranchCalendarRows = [
    ...(args.branchCalendarOverrideRows ?? []),
  ].sort((left, right) => left.attendanceDate.localeCompare(right.attendanceDate));

  for (const overrideRow of sortedBranchCalendarRows) {
    const quantityMinutes = Math.min(
      remainingOvertimeMinutes,
      Math.max(0, overrideRow.overtimeMinutes)
    );
    if (quantityMinutes <= 0) continue;

    rows.push(
      createGeneratedDtrExceptionRow({
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: overrideRow.attendanceDate,
        source: "DTR_REGULAR_OVERTIME",
        account: overrideRow.overtimeAccount,
        quantityMinutes,
        generatedFrom: isOverride ? "override" : "computed",
        sourceLabel: "Branch Calendar Regular Overtime",
        overtimeCategory: "REGULAR_DAY",
      })
    );
    remainingOvertimeMinutes -= quantityMinutes;
  }

  if (remainingOvertimeMinutes <= 0) return rows;

  const account = getGeneratedDtrAccountCode({
    source: "DTR_REGULAR_OVERTIME",
    accountRows: args.accountRows,
  });
  if (!account) {
    throw new Error(
      "Create an Overtime account code with Regular Overtime in the code or description before saving a Regular Overtime DTR override."
    );
  }

  rows.push(
    createGeneratedDtrExceptionRow({
      payrollPeriodId: args.payrollPeriodId,
      employeeId: args.employeeId,
      attendanceDate: args.attendanceDate,
      source: "DTR_REGULAR_OVERTIME",
      account,
      quantityMinutes: remainingOvertimeMinutes,
      generatedFrom: isOverride ? "override" : "computed",
    })
  );

  return rows;
}

export function buildGeneratedDtrExceptionRows(args: {
  policyWorkedMinutes?: number;
  policyTardinessMinutes?: number;
  payrollPeriodId: string;
  employeeId: string;
  attendanceDate: string;
  overrides: DtrPeriodOverrideValues;
  computed: AttendanceDtrTotalsView["computed"];
  absentDays: number;
  accountRows: GeneratedDtrAccountCodeRow[];
  holidayWorkedRows?: GeneratedDtrHolidayWorkedRow[];
  holidayOvertimeRows?: GeneratedDtrHolidayOvertimeRow[];
  branchCalendarOverrideRows?: GeneratedDtrBranchCalendarOverrideRow[];
}) {
  const rows: GeneratedDtrExceptionRowInsert[] = [];
  rows.push(...buildGeneratedDtrWorkedExceptionRow(args));

  const lateMinutes = Math.max(
    0,
    args.policyTardinessMinutes ?? computePayrollTardinessMinutes(
      args.overrides.lateMinutes ?? args.computed.lateMinutes
    )
  );
  if (lateMinutes > 0) {
    const account = getGeneratedDtrAccountCode({
      source: "DTR_TARDINESS",
      accountRows: args.accountRows,
    });
    if (!account) {
      throw new Error(
        "Create a Tardiness account code before syncing DTR Late hours."
      );
    }
    rows.push(
      createGeneratedDtrExceptionRow({
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: args.attendanceDate,
        source: "DTR_TARDINESS",
        account,
        quantityMinutes: lateMinutes,
        amountOverride: "0.00",
        generatedFrom: args.overrides.lateMinutes != null ? "override" : "computed",
      })
    );
  }

  const dtrUndertimeMinutes = Math.max(
    0,
    Math.round(args.overrides.undertimeMinutes ?? args.computed.undertimeMinutes)
  );
  const lwopMinutes = computeGeneratedDtrLwopMinutes({
    undertimeMinutes: dtrUndertimeMinutes,
    absentDays: args.absentDays,
  });
  if (lwopMinutes > 0) {
    const account = getGeneratedDtrAccountCode({
      source: "DTR_UNDERTIME",
      accountRows: args.accountRows,
    });
    if (!account) {
      throw new Error(
        "Create a Leave Without Pay account code before syncing DTR Undertime / Absence hours."
      );
    }
    const hasAbsenceMinutes = lwopMinutes > dtrUndertimeMinutes;
    rows.push(
      createGeneratedDtrExceptionRow({
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        attendanceDate: args.attendanceDate,
        source: "DTR_UNDERTIME",
        account,
        quantityMinutes: lwopMinutes,
        amountOverride: "0.00",
        generatedFrom:
          args.overrides.undertimeMinutes != null ? "override" : "computed",
        sourceLabel: hasAbsenceMinutes
          ? dtrUndertimeMinutes > 0
            ? "Undertime / Absences"
            : "Absences"
          : "Undertime",
      })
    );
  }

  rows.push(...buildGeneratedDtrOvertimeExceptionRows(args));

  return rows;
}

export async function calculateGeneratedDtrRows(args: {
  tx: DbClient;
  payrollPeriod: Pick<typeof payrollPeriods.$inferSelect, "id" | "startDate" | "endDate">;
  employeeIds: string[];
  summaryRows?: Array<typeof attendanceDailySummaries.$inferSelect>;
  checkDateSummaryRows?: Array<typeof attendanceDailySummaries.$inferSelect>;
  cutoff?: string;
  onInputs?: (inputs: unknown) => void;
}) {
  const employeeIds = [...new Set(args.employeeIds)];
  if (employeeIds.length === 0) return [];

  const summaryRows = args.summaryRows ?? await args.tx
    .select()
    .from(attendanceDailySummaries)
    .where(
      and(
        inArray(attendanceDailySummaries.employeeId, employeeIds),
        gte(attendanceDailySummaries.attendanceDate, args.payrollPeriod.startDate),
        lte(attendanceDailySummaries.attendanceDate, args.payrollPeriod.endDate)
      )
    );
  const hasExplicitDefinitions = summaryRows.some(row=>row.calculationPolicy==="eight_hour_day");
  const overtimeApprovalRows = hasExplicitDefinitions ? await args.tx.select().from(employeeDailyOvertimeOverrides).where(and(inArray(employeeDailyOvertimeOverrides.employeeId,employeeIds),gte(employeeDailyOvertimeOverrides.attendanceDate,args.payrollPeriod.startDate),lte(employeeDailyOvertimeOverrides.attendanceDate,args.payrollPeriod.endDate))) : [];
  const policyOvertimeRules = hasExplicitDefinitions ? await args.tx.select().from(overtimeRules) : [];
  const periodOverrideRows = await args.tx
    .select()
    .from(employeeAttendancePeriodOverrides)
    .where(
      and(
        eq(employeeAttendancePeriodOverrides.payrollPeriodId, args.payrollPeriod.id),
        inArray(employeeAttendancePeriodOverrides.employeeId, employeeIds)
      )
    );
  const dayStatusOverrideRows = await args.tx
    .select()
    .from(employeeAttendanceDayStatusOverrides)
    .where(
      and(
        eq(employeeAttendanceDayStatusOverrides.payrollPeriodId, args.payrollPeriod.id),
        inArray(employeeAttendanceDayStatusOverrides.employeeId, employeeIds),
        gte(
          employeeAttendanceDayStatusOverrides.attendanceDate,
          args.payrollPeriod.startDate
        ),
        lte(
          employeeAttendanceDayStatusOverrides.attendanceDate,
          args.payrollPeriod.endDate
        )
      )
    );
  const dayTypeOverrideRows = await args.tx
    .select()
    .from(employeeAttendanceDayTypeOverrides)
    .where(
      and(
        eq(employeeAttendanceDayTypeOverrides.payrollPeriodId, args.payrollPeriod.id),
        inArray(employeeAttendanceDayTypeOverrides.employeeId, employeeIds),
        gte(
          employeeAttendanceDayTypeOverrides.attendanceDate,
          args.payrollPeriod.startDate
        ),
        lte(
          employeeAttendanceDayTypeOverrides.attendanceDate,
          args.payrollPeriod.endDate
        )
      )
    );
  const dayMetricOverrideRows = await args.tx
    .select()
    .from(employeeAttendanceDayMetricOverrides)
    .where(
      and(
        eq(employeeAttendanceDayMetricOverrides.payrollPeriodId, args.payrollPeriod.id),
        inArray(employeeAttendanceDayMetricOverrides.employeeId, employeeIds),
        gte(
          employeeAttendanceDayMetricOverrides.attendanceDate,
          args.payrollPeriod.startDate
        ),
        lte(
          employeeAttendanceDayMetricOverrides.attendanceDate,
          args.payrollPeriod.endDate
        )
      )
    );
  const accountRows = await args.tx
    .select()
    .from(accountCode)
    .orderBy(asc(accountCode.accountCode), asc(accountCode.id));
  const holidayMappingRows = await args.tx.select().from(holidayTypeAccountCodes);
  const holidayRows = await fetchHolidayRowsForGeneratedDtr({
    tx: args.tx,
    startDate: args.payrollPeriod.startDate,
    endDate: args.payrollPeriod.endDate,
  });
  const branchOverrideRows = await args.tx
    .select()
    .from(branchCalendarAccountCodeOverrides)
    .where(
      and(
        gte(branchCalendarAccountCodeOverrides.attendanceDate, args.payrollPeriod.startDate),
        lte(branchCalendarAccountCodeOverrides.attendanceDate, args.payrollPeriod.endDate)
      )
    );
  const employeeDepartmentRows = await args.tx
    .select({
      employeeId: employeesGeneralInfo.employeeId,
      departmentId: employeesGeneralInfo.departmentId,
    })
    .from(employeesGeneralInfo)
    .where(inArray(employeesGeneralInfo.employeeId, employeeIds));
  const requiredHolidayCheckDates = getRequiredHolidayCheckDates(holidayRows);
  const checkDateSummaryRows =
    args.checkDateSummaryRows ?? (requiredHolidayCheckDates.length === 0
      ? []
      : await args.tx
          .select()
          .from(attendanceDailySummaries)
          .where(
            and(
              inArray(attendanceDailySummaries.employeeId, employeeIds),
              inArray(
                attendanceDailySummaries.attendanceDate,
                requiredHolidayCheckDates
              )
            )
          ));
  const holidayAccountByType = buildHolidayAccountByType({
    accountRows,
    mappingRows: holidayMappingRows,
    accountCodeField: "accountCodeId",
    accountType: "Sunday/Holiday",
  });
  const holidayOvertimeAccountByType = buildHolidayAccountByType({
    accountRows,
    mappingRows: holidayMappingRows,
    accountCodeField: "overtimeAccountCodeId",
    accountType: "Overtime",
  });
  const restDayHolidayAccountByType = buildHolidayAccountByType({
    accountRows,
    mappingRows: holidayMappingRows,
    accountCodeField: "restDayAccountCodeId",
    accountType: "Sunday/Holiday",
  });
  const restDayHolidayOvertimeAccountByType = buildHolidayAccountByType({
    accountRows,
    mappingRows: holidayMappingRows,
    accountCodeField: "restDayOvertimeAccountCodeId",
    accountType: "Overtime",
  });
  const calendarHolidayTypeByDate = buildHolidayTypeByDate(holidayRows);
  const holidayCheckRequirementByDate =
    buildHolidayCheckRequirementByDate(holidayRows);
  const summaryRowsByEmployeeId = new Map<
    string,
    Array<typeof attendanceDailySummaries.$inferSelect>
  >();
  for (const row of summaryRows) {
    const rows = summaryRowsByEmployeeId.get(row.employeeId) ?? [];
    rows.push(row);
    summaryRowsByEmployeeId.set(row.employeeId, rows);
  }
  const checkDateSummaryRowsByEmployeeId = new Map<
    string,
    Array<typeof attendanceDailySummaries.$inferSelect>
  >();
  for (const row of checkDateSummaryRows) {
    const rows = checkDateSummaryRowsByEmployeeId.get(row.employeeId) ?? [];
    rows.push(row);
    checkDateSummaryRowsByEmployeeId.set(row.employeeId, rows);
  }
  const periodOverrideByEmployeeId = new Map(
    periodOverrideRows.map((row) => [row.employeeId, row])
  );
  const departmentIdByEmployeeId = new Map(
    employeeDepartmentRows.map((row) => [row.employeeId, row.departmentId] as const)
  );
  const accountById = new Map(accountRows.map((row) => [row.id, row] as const));
  const branchOverrideMaps =
    buildBranchCalendarOverrideScopeMaps(branchOverrideRows);
  const statusOverrideByEmployeeDate = new Map(
    dayStatusOverrideRows.map((override) => [
      `${override.employeeId}|${override.attendanceDate}`,
      override.status as AttendanceDtrManualStatus,
    ])
  );
  const dayTypeOverrideByEmployeeDate = new Map(
    dayTypeOverrideRows.map((override) => [
      `${override.employeeId}|${override.attendanceDate}`,
      override.dayType as AttendanceDtrDayType,
    ])
  );
  const metricOverrideByEmployeeDate = buildDtrMetricOverrideByEmployeeDate(
    dayMetricOverrideRows
  );
  args.onInputs?.({periodOverrideRows,dayStatusOverrideRows,dayTypeOverrideRows,dayMetricOverrideRows,accountRows,holidayMappingRows,holidayRows,branchOverrideRows,employeeDepartmentRows,checkDateSummaryRows,overtimeApprovalRows,policyOvertimeRules});
  const generatedRows = employeeIds.flatMap((employeeId) => {
    const periodOverride = periodOverrideByEmployeeId.get(employeeId) ?? null;
    const effectiveRows = (summaryRowsByEmployeeId.get(employeeId) ?? []).filter(row => !args.cutoff || row.attendanceDate <= args.cutoff).map(
      (row) =>
        applyAttendanceDtrEffectiveStatus(
          applyAttendanceDtrMetricOverride(
            row,
            metricOverrideByEmployeeDate.get(
              `${employeeId}|${row.attendanceDate}`
            ) ?? null
          ),
          statusOverrideByEmployeeDate.get(`${employeeId}|${row.attendanceDate}`) ??
            null
        )
    );
    for (const [index,row] of effectiveRows.entries()) {
      if (row.calculationPolicy!=="eight_hour_day") continue;
      const approval=overtimeApprovalRows.find(item=>item.employeeId===employeeId&&item.attendanceDate===row.attendanceDate);
      const category=approval?.category??resolveOvertimeCategory({isRestDay:row.isRestDay,holidayType:getHolidayTypeFromAttendanceDtrDayType(dayTypeOverrideByEmployeeDate.get(`${employeeId}|${row.attendanceDate}`)??getAttendanceDtrDayTypeFromHolidayType(calendarHolidayTypeByDate.get(row.attendanceDate)??null))});
      const approved=resolveApprovedOvertimeMinutes({isApproved:approval?.isApproved===true,manualMinutes:approval?.manualMinutes,computedMinutes:resolveDetectedOvertimeMinutes({scheduleOvertimeMinutes:row.overtimeMinutes,effectiveWorkedMinutes:approval?.workedMinutesOverride??row.workedMinutes,calculationPolicy:row.calculationPolicy})});
      effectiveRows[index]={...row,overtimeMinutes:row.workedMinutes>0&&findMatchingOvertimeRule(policyOvertimeRules,category,approved)?approved:0};
    }
    const checkDateAttendanceByDate = buildCheckDateAttendanceByDate(
      checkDateSummaryRowsByEmployeeId.get(employeeId) ?? []
    );
    for (const row of effectiveRows) {
      if (requiredHolidayCheckDates.includes(row.attendanceDate)) {
        checkDateAttendanceByDate.set(row.attendanceDate, {
          attendanceDate: row.attendanceDate,
          workedMinutes: row.workedMinutes,
          regularMinutes: row.regularMinutes,
          lateMinutes: row.lateMinutes,
          undertimeMinutes: row.undertimeMinutes,
        });
      }
    }
    const totals = buildAttendanceDtrTotals(effectiveRows, periodOverride);
    const manualDayTypeByDate = new Map<string, AttendanceDtrDayType>();
    for (const row of effectiveRows) {
      const dayType = dayTypeOverrideByEmployeeDate.get(
        `${employeeId}|${row.attendanceDate}`
      );
      if (dayType) manualDayTypeByDate.set(row.attendanceDate, dayType);
    }
    const holidayWorkedRows = buildHolidayWorkedRowsForGeneratedDtr({
      rows: effectiveRows,
      manualDayTypeByDate,
      calendarHolidayTypeByDate,
      holidayCheckRequirementByDate,
      checkDateAttendanceByDate,
      holidayAccountByType,
      restDayHolidayAccountByType,
    });
    const holidayOvertimeRows = buildHolidayOvertimeRowsForGeneratedDtr({
      rows: effectiveRows,
      manualDayTypeByDate,
      calendarHolidayTypeByDate,
      holidayCheckRequirementByDate,
      checkDateAttendanceByDate,
      holidayOvertimeAccountByType,
      restDayHolidayOvertimeAccountByType,
    });
    const branchCalendarOverrideRows =
      buildBranchCalendarOverrideRowsForGeneratedDtr({
        rows: effectiveRows,
        departmentId: departmentIdByEmployeeId.get(employeeId) ?? null,
        overrideMaps: branchOverrideMaps,
        accountById,
        isBranchCalendarDateEligible: (row) =>
          !getEffectiveHolidayTypeForDate({
            attendanceDate: row.attendanceDate,
            manualDayTypeByDate,
            calendarHolidayTypeByDate,
          }),
      });

    const explicitPeriod=effectiveRows.some(row=>row.calculationPolicy==="eight_hour_day");
    if(explicitPeriod && [totals.overrides.workedMinutes,totals.overrides.lateMinutes,totals.overrides.undertimeMinutes,totals.overrides.overtimeMinutes].some(value=>value!=null)) throw new Error("This period uses explicit shift definitions. Clear whole-period time overrides and review the affected employee-days; an aggregate override cannot safely allocate normal pay and approved overtime between schedule policies.");
    if (explicitPeriod) {
      const perDay=computePolicyAttendancePay(effectiveRows,0);
      return perDay.days.flatMap(({row,minutes,penaltyMinutes})=>{
        const day=effectiveRows.find(item=>item===row)!;
        const dayTotals=buildAttendanceDtrTotals([day]);
        return buildGeneratedDtrExceptionRows({payrollPeriodId:args.payrollPeriod.id,employeeId,attendanceDate:day.attendanceDate,overrides:dayTotals.overrides,computed:dayTotals.computed,policyWorkedMinutes:minutes,policyTardinessMinutes:day.lateMinutes+penaltyMinutes,absentDays:dayTotals.absentDays,accountRows,
          holidayWorkedRows:holidayWorkedRows.filter(item=>item.attendanceDate===day.attendanceDate),holidayOvertimeRows:holidayOvertimeRows.filter(item=>item.attendanceDate===day.attendanceDate),branchCalendarOverrideRows:branchCalendarOverrideRows.filter(item=>item.attendanceDate===day.attendanceDate)}).map(item=>({...item,remarks:`${item.remarks} Explicit shift day.`}));
      });
    }
    return buildGeneratedDtrExceptionRows({
      payrollPeriodId: args.payrollPeriod.id,
      employeeId,
      attendanceDate: args.payrollPeriod.startDate,
      overrides: totals.overrides,
      computed: totals.computed,
      policyWorkedMinutes: explicitPeriod?totals.workedMinutes:undefined,
      absentDays: totals.absentDays,
      accountRows,
      holidayWorkedRows,
      holidayOvertimeRows,
      branchCalendarOverrideRows,
    });
  });

  return generatedRows;
}

import { db } from "@/db";
import {
  accountCode,
  attendanceDailySummaries,
  employeeAttendanceDayStatusOverrides,
  employeeAttendanceDayTypeOverrides,
  employeePayrollExceptionRows,
  employeesRecurringEntries,
  employeeShiftAssignments,
  employeeWeeklyShiftPatterns,
  employees,
  overtimeRules,
  payrollPeriods,
  payrollRuns,
} from "@/db/schema";
import { recordAdminAuditEvent, recordPayrollRunEvent } from "@/lib/admin";
import { fetchConfirmedHolidayRowsForRange } from "@/lib/holidays";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { getDailyRate, getHoursPerDay } from "./engine";
import {
  applyAttendanceDtrEffectiveStatus,
  getAttendanceDtrDayTypeFromHolidayType,
  type AttendanceDtrDayType,
  type AttendanceDtrManualStatus,
} from "./dtrOverrides";
import { buildHolidayTypeByDate, type OvertimeHolidayType } from "./overtime";
import {
  computePayrollExceptionPreview,
  isPayrollExceptionDtrOverrideSource,
  isPayrollExceptionDtrQuantityOnlyDeductionSource,
  isPayrollExceptionAccountType,
  type PayrollExceptionAccountType,
} from "./payrollExceptions";
import { isManualPayrollHourBasedAccountType } from "./manualPayrollRate";
import {
  buildResolvedSalaryByEmployeeId,
  type ResolvedSalaryRecord,
} from "./salaryResolver";
import { getPrimaryResolvedScheduleForPeriod } from "./scheduleResolver";
import type { SavePayrollExceptionRowsSchemaType } from "@/zod-schemas/payrollExceptionRows";

type PayrollExceptionInputRow = SavePayrollExceptionRowsSchemaType["rows"][number];
type PayrollExceptionTransaction = Pick<typeof db, "insert" | "select" | "update">;

const DEFAULT_PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPE: AttendanceDtrDayType =
  "Legal/Regular Holiday";
const RECURRING_ENTRY_SOURCE_LABEL = "Employee Master recurring entry";
const PAYROLL_ACCOUNT_CODE_RECURRING_TYPES = new Set<PayrollExceptionAccountType>([
  "Other Income",
  "Other Deduction",
]);

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundMoney(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function splitMinutes(totalMinutes: number | null | undefined) {
  const minutes = Math.max(0, Math.round(totalMinutes ?? 0));

  return {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  };
}

function getQuantityMinutes(row: PayrollExceptionInputRow) {
  const hours = Math.max(0, Math.floor(row.hours ?? 0));
  const minutes = Math.max(0, Math.floor(row.minutes ?? 0));
  return hours * 60 + minutes;
}

function normalizeAmountOverride(row: PayrollExceptionInputRow) {
  return row.amountOverride == null ? null : Math.max(0, toAmount(row.amountOverride));
}

function normalizeRemarks(row: PayrollExceptionInputRow) {
  return row.remarks?.trim() ? row.remarks.trim() : null;
}

function resolvePayrollExceptionPreviewDayType(args: {
  accountType: PayrollExceptionAccountType | null;
  savedDayType: AttendanceDtrDayType | null | undefined;
  fallbackDayType: AttendanceDtrDayType | null | undefined;
  isRestDay: boolean;
}) {
  if (args.savedDayType) return args.savedDayType;
  if (args.accountType !== "Sunday/Holiday") return args.fallbackDayType ?? null;
  if (
    args.fallbackDayType &&
    (args.fallbackDayType !== "Regular Day" || args.isRestDay)
  ) {
    return args.fallbackDayType;
  }

  return DEFAULT_PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPE;
}

function getLegacyAccountType(
  row: Pick<
    typeof employeePayrollExceptionRows.$inferSelect,
    "accountTypeSnapshot" | "exceptionType"
  >
): PayrollExceptionAccountType | null {
  if (isPayrollExceptionAccountType(row.accountTypeSnapshot)) {
    return row.accountTypeSnapshot;
  }

  if (row.exceptionType === "OVERTIME") return "Overtime";
  if (row.exceptionType === "WORKED_DAY_PREMIUM") return "Sunday/Holiday";
  if (row.exceptionType === "NON_WORKED_HOLIDAY") return "Regular Hours";

  return null;
}

async function markLatestEditableRunStale(args: {
  tx: PayrollExceptionTransaction;
  payrollPeriodId: string;
  actorUserId: string;
  notes: string;
}) {
  const [latestRun] = await args.tx
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.payrollPeriodId, args.payrollPeriodId))
    .orderBy(desc(payrollRuns.createdAt))
    .limit(1);

  if (!latestRun) return 0;
  if (latestRun.status !== "Draft" && latestRun.status !== "Reviewed") {
    return 0;
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

  return 1;
}

export async function getPayrollExceptionAccountCodeOptions() {
  return db
    .select({
      id: accountCode.id,
      code: accountCode.accountCode,
      accountType: accountCode.accountType,
      description: accountCode.description,
      month13thPay: accountCode.month13thPay,
      nonTaxable: accountCode.nonTaxable,
      dailyRate: accountCode.dailyRate,
      monthlyRate: accountCode.monthlyRate,
    })
    .from(accountCode)
    .orderBy(asc(accountCode.accountCode), asc(accountCode.accountType));
}

export async function getEmployeePayrollRecurringEntryRows(args: {
  payrollPeriodId: string;
  employeeId: string;
}) {
  const payrollPeriod = await db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, args.payrollPeriodId),
  });

  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  const [recurringEntries, accountCodeOptionRows] = await Promise.all([
    db
      .select({
        id: employeesRecurringEntries.id,
        accountCode: employeesRecurringEntries.accountCode,
        description: employeesRecurringEntries.description,
        amount: employeesRecurringEntries.amount,
      })
      .from(employeesRecurringEntries)
      .where(
        and(
          eq(employeesRecurringEntries.employeeId, args.employeeId),
          eq(employeesRecurringEntries.status, "Active"),
          isNull(employeesRecurringEntries.deletedAt),
          or(
            isNull(employeesRecurringEntries.startDate),
            lte(employeesRecurringEntries.startDate, payrollPeriod.endDate)
          ),
          or(
            isNull(employeesRecurringEntries.endDate),
            gte(employeesRecurringEntries.endDate, payrollPeriod.startDate)
          )
        )
      )
      .orderBy(asc(employeesRecurringEntries.id)),
    getPayrollExceptionAccountCodeOptions(),
  ]);

  const accountCodeByCode = new Map(
    accountCodeOptionRows.map((row) => [row.code, row] as const)
  );

  return recurringEntries.flatMap((entry) => {
    const mappedAccount = entry.accountCode
      ? accountCodeByCode.get(entry.accountCode) ?? null
      : null;
    if (
      !mappedAccount ||
      !mappedAccount.accountType ||
      !PAYROLL_ACCOUNT_CODE_RECURRING_TYPES.has(mappedAccount.accountType)
    ) {
      return [];
    }

    const accountType = mappedAccount.accountType;
    const amount = roundMoney(toAmount(entry.amount));
    if (amount <= 0) return [];

    const description = entry.description?.trim() || null;

    return [
      {
        id: `recurring:${entry.id}`,
        recurringEntryId: entry.id,
        accountCodeId: mappedAccount.id,
        accountCodeSnapshot: mappedAccount.code,
        accountTypeSnapshot: accountType,
        accountDescriptionSnapshot: mappedAccount.description,
        accountMonth13thPaySnapshot: mappedAccount.month13thPay,
        accountNonTaxableSnapshot: mappedAccount.nonTaxable,
        amount: amount.toFixed(2),
        description,
        sourceLabel: RECURRING_ENTRY_SOURCE_LABEL,
        sourceRemark: description
          ? `${RECURRING_ENTRY_SOURCE_LABEL}: ${description}`
          : RECURRING_ENTRY_SOURCE_LABEL,
      },
    ];
  });
}

export async function getEmployeePayrollExceptionRows(args: {
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
      salary: true,
      timekeeping: true,
    },
  });

  if (!employee) {
    throw new Error("Employee not found.");
  }

  const [
    exceptionRows,
    summaryRows,
    overtimeRuleRows,
    resolvedSalaryByEmployeeId,
    dayStatusOverrideRows,
    dayTypeOverrideRows,
    holidayRows,
    accountCodeOptionRows,
    shiftAssignmentRows,
    weeklyPatternRows,
  ] = await Promise.all([
    db
      .select()
      .from(employeePayrollExceptionRows)
      .where(
        and(
          eq(employeePayrollExceptionRows.payrollPeriodId, args.payrollPeriodId),
          eq(employeePayrollExceptionRows.employeeId, args.employeeId)
        )
      )
      .orderBy(
        asc(employeePayrollExceptionRows.attendanceDate),
        asc(employeePayrollExceptionRows.accountCodeSnapshot),
        asc(employeePayrollExceptionRows.overtimeCategory)
      ),
    db
      .select()
      .from(attendanceDailySummaries)
      .where(
        and(
          eq(attendanceDailySummaries.employeeId, args.employeeId),
          gte(attendanceDailySummaries.attendanceDate, payrollPeriod.startDate),
          lte(attendanceDailySummaries.attendanceDate, payrollPeriod.endDate)
        )
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
    db
      .select()
      .from(employeeAttendanceDayStatusOverrides)
      .where(
        and(
          eq(employeeAttendanceDayStatusOverrides.payrollPeriodId, args.payrollPeriodId),
          eq(employeeAttendanceDayStatusOverrides.employeeId, args.employeeId),
          gte(employeeAttendanceDayStatusOverrides.attendanceDate, payrollPeriod.startDate),
          lte(employeeAttendanceDayStatusOverrides.attendanceDate, payrollPeriod.endDate)
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
    fetchConfirmedHolidayRowsForRange(payrollPeriod.startDate, payrollPeriod.endDate),
    getPayrollExceptionAccountCodeOptions(),
    db
      .select()
      .from(employeeShiftAssignments)
      .where(
        and(
          eq(employeeShiftAssignments.employeeId, args.employeeId),
          lte(employeeShiftAssignments.effectiveFrom, payrollPeriod.endDate)
        )
      ),
    db.query.employeeWeeklyShiftPatterns.findMany({
      where: and(
        eq(employeeWeeklyShiftPatterns.employeeId, args.employeeId),
        lte(employeeWeeklyShiftPatterns.effectiveFrom, payrollPeriod.endDate)
      ),
      with: {
        days: true,
      },
    }),
  ]);

  const resolvedSalary =
    resolvedSalaryByEmployeeId.get(employee.id)?.salary ??
    ((employee.salary ?? {}) as ResolvedSalaryRecord);
  const dailyRate = getDailyRate(resolvedSalary);
  const monthlyRate = toAmount(resolvedSalary.monthlyRate);
  const primarySchedule = getPrimaryResolvedScheduleForPeriod({
    assignments: shiftAssignmentRows.filter(
      (row) => !row.effectiveTo || row.effectiveTo >= payrollPeriod.startDate
    ),
    weeklyPatterns: weeklyPatternRows.filter(
      (row) => !row.effectiveTo || row.effectiveTo >= payrollPeriod.startDate
    ),
    legacyTimekeeping: employee.timekeeping ?? null,
    startDate: payrollPeriod.startDate,
    endDate: payrollPeriod.endDate,
  });
  const fallbackHoursPerDay =
    toAmount(primarySchedule.hoursPerDay) ||
    getHoursPerDay({
      timekeeping: employee.timekeeping,
    });
  const hourlyRate = fallbackHoursPerDay > 0 ? dailyRate / fallbackHoursPerDay : 0;
  const fallbackMinutesPerDay = Math.round(fallbackHoursPerDay * 60);
  const accountCodeById = new Map(accountCodeOptionRows.map((row) => [row.id, row]));
  const accountCodeByCode = new Map(
    accountCodeOptionRows.map((row) => [row.code, row])
  );
  const statusOverrideByDate = new Map(
    dayStatusOverrideRows.map((row) => [
      row.attendanceDate,
      row.status as AttendanceDtrManualStatus,
    ])
  );
  const dayTypeOverrideByDate = new Map(
    dayTypeOverrideRows.map((row) => [
      row.attendanceDate,
      row.dayType as AttendanceDtrDayType,
    ])
  );
  const calendarDayTypeByDate = new Map(
    [
      ...buildHolidayTypeByDate(
        holidayRows as Array<{ holidayDate: string; holidayDate2?: string | null; holidayType: OvertimeHolidayType }>
      ).entries(),
    ].map(([attendanceDate, holidayType]) => [
      attendanceDate,
      getAttendanceDtrDayTypeFromHolidayType(holidayType),
    ])
  );
  const summaryByDate = new Map(
    summaryRows.map(
      (row) =>
        [
          row.attendanceDate,
          applyAttendanceDtrEffectiveStatus(
            row,
            statusOverrideByDate.get(row.attendanceDate) ?? null
          ),
        ] as const
    )
  );

  return exceptionRows.map((row) => {
    const summary = summaryByDate.get(row.attendanceDate);
    const manualStatus = statusOverrideByDate.get(row.attendanceDate) ?? null;
    const quantity = splitMinutes(row.quantityMinutes);
    const accountType = getLegacyAccountType(row);
    const mappedAccount =
      (row.accountCodeId != null ? accountCodeById.get(row.accountCodeId) : null) ??
      accountCodeByCode.get(row.accountCodeSnapshot) ??
      null;
    const accountDescription =
      row.accountDescriptionSnapshot ??
      (accountType === "Overtime" ? "Overtime" : null);
    const isRestDay =
      summary?.isRestDay ??
      (manualStatus === "Rest Day" || manualStatus === "Rest Day Work");
    const fallbackDayType =
      dayTypeOverrideByDate.get(row.attendanceDate) ??
      calendarDayTypeByDate.get(row.attendanceDate) ??
      "Regular Day";
    const previewDayType = resolvePayrollExceptionPreviewDayType({
      accountType,
      savedDayType: row.dayType as AttendanceDtrDayType | null,
      fallbackDayType,
      isRestDay,
    });
    const preview = computePayrollExceptionPreview({
      attendanceDate: row.attendanceDate,
      accountCode: row.accountCodeSnapshot,
      accountType,
      accountDescription,
      overtimeCategory: row.overtimeCategory,
      quantityMinutes: row.quantityMinutes,
      amountOverride: row.amountOverride,
      scheduledMinutes: summary?.scheduledMinutes ?? fallbackMinutesPerDay,
      dailyRate,
      payComputationMode: monthlyRate > 0 ? "Monthly Rate" : "Daily Rate",
      hourlyRate,
      accountDailyRate: mappedAccount?.dailyRate ?? null,
      accountMonthlyRate: mappedAccount?.monthlyRate ?? null,
      fallbackHoursPerDay,
      fallbackMinutesPerDay,
      overtimeRules: overtimeRuleRows,
      nonTaxable: row.accountNonTaxableSnapshot,
      month13thPay: row.accountMonth13thPaySnapshot,
      dayType: previewDayType,
      isRestDay,
      dtrOverrideSource: isPayrollExceptionDtrOverrideSource(
        row.dtrOverrideSource
      )
        ? row.dtrOverrideSource
        : null,
    });

    return {
      id: row.id,
      attendanceDate: row.attendanceDate,
      accountCodeId: row.accountCodeId,
      accountCodeSnapshot: row.accountCodeSnapshot,
      accountTypeSnapshot: accountType,
      accountDescriptionSnapshot: accountDescription,
      accountMonth13thPaySnapshot: row.accountMonth13thPaySnapshot,
      accountNonTaxableSnapshot: row.accountNonTaxableSnapshot,
      dayType:
        accountType === "Sunday/Holiday"
          ? previewDayType
          : ((row.dayType as AttendanceDtrDayType | null) ?? null),
      overtimeCategory: row.overtimeCategory,
      hours: quantity.hours,
      minutes: quantity.minutes,
      amountOverride: row.amountOverride,
      remarks: row.remarks,
      dtrOverrideSource: isPayrollExceptionDtrOverrideSource(
        row.dtrOverrideSource
      )
        ? row.dtrOverrideSource
        : null,
      computedAmount: preview.amount.toFixed(2),
      computedDescription: preview.description,
      computedError: preview.error,
      computedLineType: preview.lineType,
      isLegacy: row.legacyOvertimeOverrideId != null,
    };
  });
}

export async function saveEmployeePayrollExceptionRows(args: {
  actorUserId: string;
  payrollPeriodId: string;
  employeeId: string;
  rows: PayrollExceptionInputRow[];
}) {
  const payrollPeriod = await db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, args.payrollPeriodId),
  });

  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  const existingExceptionRows = await db
    .select()
    .from(employeePayrollExceptionRows)
    .where(
      and(
        eq(employeePayrollExceptionRows.payrollPeriodId, args.payrollPeriodId),
        eq(employeePayrollExceptionRows.employeeId, args.employeeId)
      )
    );
  const existingRowsById = new Map(
    existingExceptionRows.map((row) => [row.id, row] as const)
  );

  const accountCodeIds = [
    ...new Set(
      args.rows
        .map((row) => row.accountCodeId)
        .filter((value): value is number => value != null)
    ),
  ];
  const accountCodeRows =
    accountCodeIds.length === 0
      ? []
      : await db
          .select({
            id: accountCode.id,
            code: accountCode.accountCode,
            accountType: accountCode.accountType,
            description: accountCode.description,
            month13thPay: accountCode.month13thPay,
            nonTaxable: accountCode.nonTaxable,
            dailyRate: accountCode.dailyRate,
            monthlyRate: accountCode.monthlyRate,
          })
          .from(accountCode)
          .where(inArray(accountCode.id, accountCodeIds));
  const accountCodeById = new Map(accountCodeRows.map((row) => [row.id, row]));

  for (const id of accountCodeIds) {
    if (!accountCodeById.has(id)) {
      throw new Error("One or more selected account codes no longer exist.");
    }
  }

  const duplicateKeys = new Set<string>();

  const insertRows = args.rows.map((row) => {
    const selectedAccount =
      row.accountCodeId != null ? accountCodeById.get(row.accountCodeId) : null;
    const existingRow = row.id ? existingRowsById.get(row.id) : null;
    const dtrOverrideSource = isPayrollExceptionDtrOverrideSource(
      row.dtrOverrideSource
    )
      ? row.dtrOverrideSource
      : existingRow &&
          isPayrollExceptionDtrOverrideSource(existingRow.dtrOverrideSource)
        ? existingRow.dtrOverrideSource
        : null;
    const accountCodeSnapshot =
      selectedAccount?.code ??
      row.accountCodeSnapshot?.trim() ??
      existingRow?.accountCodeSnapshot;
    const accountTypeSnapshot =
      selectedAccount?.accountType ??
      (isPayrollExceptionAccountType(row.accountTypeSnapshot)
        ? row.accountTypeSnapshot
        : null) ??
      (existingRow ? getLegacyAccountType(existingRow) : null);
    const accountDescriptionSnapshot =
      selectedAccount?.description ??
      row.accountDescriptionSnapshot?.trim() ??
      existingRow?.accountDescriptionSnapshot ??
      null;

    if (!selectedAccount && (!existingRow || !accountCodeSnapshot)) {
      throw new Error("Select an account code for every new exception row.");
    }

    if (!accountCodeSnapshot) {
      throw new Error("Select an account code for every exception row.");
    }

    if (accountTypeSnapshot === "Overtime" && !row.overtimeCategory) {
      throw new Error("OT account-code exception rows require an OT category.");
    }

    const isOtherIncomeAccount = accountTypeSnapshot === "Other Income";
    const isGeneratedQuantityOnlyDeduction =
      isPayrollExceptionDtrQuantityOnlyDeductionSource(dtrOverrideSource);
    const overtimeCategory =
      accountTypeSnapshot === "Overtime" ? row.overtimeCategory ?? null : null;
    const dayType =
      accountTypeSnapshot === "Sunday/Holiday"
        ? row.dayType ??
          (existingRow?.dayType as AttendanceDtrDayType | null) ??
          DEFAULT_PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPE
        : null;
    const duplicateKey = `${
      selectedAccount?.id ?? accountCodeSnapshot
    }:${overtimeCategory ?? "__none__"}`;

    if (duplicateKeys.has(duplicateKey)) {
      throw new Error(
        isOtherIncomeAccount
          ? "Only one Other Income row per payroll period and account code is allowed."
          : "Only one account-code row per payroll period, account code, and OT category is allowed."
      );
    }
    duplicateKeys.add(duplicateKey);

    const amountOverride = normalizeAmountOverride(row);
    const quantityMinutes = getQuantityMinutes(row);

    if (
      (accountTypeSnapshot === "Loan" || accountTypeSnapshot === "Other Deduction") &&
      !isGeneratedQuantityOnlyDeduction &&
      (amountOverride == null || amountOverride <= 0)
    ) {
      throw new Error("Enter a deduction amount for every amount-only deduction row.");
    }

    if (
      isOtherIncomeAccount &&
      (amountOverride == null || amountOverride <= 0)
    ) {
      throw new Error("Enter an Other Income amount for every Other Income row.");
    }

    if (
      !isOtherIncomeAccount &&
      amountOverride == null &&
      (isManualPayrollHourBasedAccountType(accountTypeSnapshot) ||
        isGeneratedQuantityOnlyDeduction) &&
      quantityMinutes <= 0
    ) {
      throw new Error(
        "Enter hours/minutes or an amount override for every hour-based account-code row."
      );
    }

    return {
      ...(row.id ? { id: row.id } : {}),
      payrollPeriodId: args.payrollPeriodId,
      employeeId: args.employeeId,
      attendanceDate: payrollPeriod.startDate,
      exceptionType: null,
      workedStatus: null,
      dayType,
      customPayrollCodeId: null,
      accountCodeId: selectedAccount?.id ?? existingRow?.accountCodeId ?? null,
      accountCodeSnapshot,
      accountTypeSnapshot,
      accountDescriptionSnapshot,
      accountMonth13thPaySnapshot:
        selectedAccount?.month13thPay ??
        existingRow?.accountMonth13thPaySnapshot ??
        false,
      accountNonTaxableSnapshot:
        selectedAccount?.nonTaxable ??
        existingRow?.accountNonTaxableSnapshot ??
        false,
      overtimeCategory,
      quantityMinutes,
      quantityDays: null,
      amountOverride: amountOverride == null ? null : amountOverride.toFixed(2),
      remarks: normalizeRemarks(row),
      dtrOverrideSource,
      updatedAt: new Date(),
    };
  });

  const result = await db.transaction(async (tx) => {
    await tx
      .delete(employeePayrollExceptionRows)
      .where(
        and(
          eq(employeePayrollExceptionRows.payrollPeriodId, args.payrollPeriodId),
          eq(employeePayrollExceptionRows.employeeId, args.employeeId)
        )
      );

    if (insertRows.length > 0) {
      await tx.insert(employeePayrollExceptionRows).values(insertRows);
    }

    const staleRunCount = await markLatestEditableRunStale({
      tx,
      payrollPeriodId: args.payrollPeriodId,
      actorUserId: args.actorUserId,
      notes: "Marked stale because payroll exception rows changed.",
    });

    await recordAdminAuditEvent({
      actorUserId: args.actorUserId,
      entityType: "employee_payroll_exception_rows",
      entityId: `${args.payrollPeriodId}:${args.employeeId}`,
      action: "payroll.exception_rows.bulk_saved",
      details: {
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        rowCount: args.rows.length,
        staleRunCount,
      },
      database: tx,
    });

    return {
      staleRunCount,
    };
  });

  return {
    ...result,
    rows: await getEmployeePayrollExceptionRows({
      payrollPeriodId: args.payrollPeriodId,
      employeeId: args.employeeId,
    }),
  };
}

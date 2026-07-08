import { db, type DbClient } from "@/db";
import {
  employeeLeaveRecordDays,
  employeeShiftAssignments,
  employeeWeeklyShiftPatterns,
  employeesLeaveRecords,
  employeesSalary,
  employeesTimekeeping,
  holidayYearCalendar,
  leaveBalanceLedger,
  leavePolicies,
  leaveTypes,
  slvlGroup,
} from "@/db/schema";
import { and, asc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { eachDayOfInterval, format } from "date-fns";
import {
  getAttendanceDtrDayTypeFromHolidayType,
  isAttendanceDtrNonWorkingDayType,
} from "./dtrOverrides";
import { buildHolidayTypeByDate, type OvertimeHolidayType } from "./overtime";
import {
  isResolvedScheduleRestDay,
  resolveEmployeeScheduleForDate,
} from "./scheduleResolver";
export {
  getMappedLeavePayrollAccountCode,
  LEAVE_PAYROLL_ACCOUNT_CODES,
  normalizeLeavePayrollAccountKey,
} from "./leaveAccountCodes";

const DEFAULT_LEAVE_TYPES = [
  {
    code: "SL",
    name: "Sick Leave",
    isPaid: true,
    requiresBalance: true,
    annualEntitlement: "0.00",
  },
  {
    code: "VL",
    name: "Vacation Leave",
    isPaid: true,
    requiresBalance: true,
    annualEntitlement: "0.00",
  },
] as const;

const LEAVE_RECORD_SOURCE_TABLE = "employees_leave_records";

type DatabaseLike = DbClient;
type LeaveTypeRecord = typeof leaveTypes.$inferSelect;
type LeavePolicyRecord = typeof leavePolicies.$inferSelect;
export type LeaveDayPart = typeof employeeLeaveRecordDays.$inferSelect["dayPart"];

type LeaveTypeResolutionInput = {
  leaveType: string | null | undefined;
  leaveTypeLookup?: LeaveTypeRecord | null;
};

export type LeaveDayDetailDraft = {
  leaveDate: string;
  dayPart: LeaveDayPart;
  quantity: number;
  isRestDay: boolean;
  holidayType: OvertimeHolidayType | null;
  exclusionReason: string | null;
};

export type LeaveBalanceSummaryItem = {
  leaveTypeId: number;
  code: string;
  name: string;
  entitled: number;
  used: number;
  encashed: number;
  expired: number;
  adjustments: number;
  balance: number;
  requiresBalance: boolean;
};

type SlvlEntitlementRow = {
  defaultSickLeave: string | null;
  defaultVacationLeave: string | null;
} | null;

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function toDecimalString(value: number) {
  return value.toFixed(2);
}

function getYear(dateKey: string) {
  return Number(dateKey.slice(0, 4));
}

function normalizeLeaveEndDate(value: string | null | undefined) {
  return value && value !== "" ? value : null;
}

function assertDateRange(startDate: string, endDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("Leave start date must use YYYY-MM-DD format.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("Leave end date must use YYYY-MM-DD format.");
  }

  if (endDate < startDate) {
    throw new Error("Leave end date cannot be before the start date.");
  }
}

export function getLeaveQuantityForDayPart(dayPart: LeaveDayPart) {
  return dayPart === "FullDay" ? 1 : 0.5;
}

export function getAnnualLeaveGrantQuantity(args: {
  leaveCode: string;
  leaveTypeAnnualEntitlement?: string | number | null;
  slvlGroupEntitlement?: SlvlEntitlementRow;
}) {
  if (args.leaveCode === "SL") {
    return toAmount(args.slvlGroupEntitlement?.defaultSickLeave);
  }

  if (args.leaveCode === "VL") {
    return toAmount(args.slvlGroupEntitlement?.defaultVacationLeave);
  }

  return toAmount(args.leaveTypeAnnualEntitlement);
}

function isLedgerYearCondition(year: number) {
  return sql`(${leaveBalanceLedger.periodYear} = ${year} or (${leaveBalanceLedger.periodYear} is null and extract(year from ${leaveBalanceLedger.entryDate}) = ${year}))`;
}

async function ensureDefaultLeavePolicies(database: DatabaseLike = db) {
  const types: LeaveTypeRecord[] = await database.select().from(leaveTypes);
  if (types.length === 0) return;

  await database
    .insert(leavePolicies)
    .values(
      types.map((leaveType) => ({
        leaveTypeId: leaveType.id,
        grantModel: "Annual" as const,
      }))
    )
    .onConflictDoNothing({ target: leavePolicies.leaveTypeId });
}

export async function ensureDefaultLeaveTypes() {
  const existing = await db.select().from(leaveTypes).limit(1);
  if (existing.length === 0) {
    await db.insert(leaveTypes).values([...DEFAULT_LEAVE_TYPES]);
  }

  await ensureDefaultLeavePolicies();
  return db.select().from(leaveTypes);
}

export async function getLeaveTypeByCode(
  code: string,
  database: DatabaseLike = db
) {
  await ensureDefaultLeaveTypes();

  return database.query.leaveTypes.findFirst({
    where: eq(leaveTypes.code, code.trim()),
  }) as Promise<LeaveTypeRecord | undefined>;
}

export async function buildLeaveTypeMapByCode(
  codes: Array<string | null | undefined>,
  database: DatabaseLike = db
): Promise<Map<string, LeaveTypeRecord>> {
  const normalizedCodes = [
    ...new Set(
      codes
        .map((code) => code?.trim())
        .filter((code): code is string => Boolean(code))
    ),
  ];

  if (normalizedCodes.length === 0) {
    return new Map<string, LeaveTypeRecord>();
  }

  await ensureDefaultLeaveTypes();

  const records: LeaveTypeRecord[] = await database
    .select()
    .from(leaveTypes)
    .where(inArray(leaveTypes.code, normalizedCodes));

  return new Map<string, LeaveTypeRecord>(
    records.map((record: LeaveTypeRecord) => [record.code, record])
  );
}

export function resolveLeaveTypeForPayroll(
  record: LeaveTypeResolutionInput,
  leaveTypesByCode?: Map<string, LeaveTypeRecord>
) {
  if (record.leaveTypeLookup) {
    return record.leaveTypeLookup;
  }

  const normalizedCode = record.leaveType?.trim();
  if (!normalizedCode) {
    return null;
  }

  return leaveTypesByCode?.get(normalizedCode) ?? null;
}

export function resolveLeavePayStatus(
  record: LeaveTypeResolutionInput,
  leaveTypesByCode?: Map<string, LeaveTypeRecord>
) {
  const leaveType = resolveLeaveTypeForPayroll(record, leaveTypesByCode);

  return {
    leaveType,
    isPaid: leaveType?.isPaid === true,
    unresolved: leaveType == null && Boolean(record.leaveType?.trim()),
  };
}

export async function getLeavePolicyForType(
  leaveTypeId: number,
  database: DatabaseLike = db
): Promise<LeavePolicyRecord> {
  await ensureDefaultLeaveTypes();

  let policy = await database.query.leavePolicies.findFirst({
    where: eq(leavePolicies.leaveTypeId, leaveTypeId),
  });

  if (!policy) {
    const [createdPolicy] = await database
      .insert(leavePolicies)
      .values({ leaveTypeId, grantModel: "Annual" })
      .onConflictDoNothing({ target: leavePolicies.leaveTypeId })
      .returning();

    policy =
      createdPolicy ??
      (await database.query.leavePolicies.findFirst({
        where: eq(leavePolicies.leaveTypeId, leaveTypeId),
      }));
  }

  if (!policy) {
    throw new Error("Leave policy could not be created.");
  }

  return policy;
}

export async function getLeaveBalance(
  employeeId: string,
  leaveTypeId: number,
  year?: number | null,
  database: DatabaseLike = db
) {
  const conditions = [
    eq(leaveBalanceLedger.employeeId, employeeId),
    eq(leaveBalanceLedger.leaveTypeId, leaveTypeId),
  ];

  const [result] = await database
    .select({
      total: sql<string>`COALESCE(SUM(${leaveBalanceLedger.quantity}), 0)`,
    })
    .from(leaveBalanceLedger)
    .where(
      year == null
        ? and(...conditions)
        : and(...conditions, isLedgerYearCondition(year))
    );

  return toAmount(result?.total);
}

export async function lockLeaveBalance(args: {
  employeeId: string;
  leaveTypeId: number;
  year: number;
  database: DatabaseLike;
}) {
  const key = `leave-balance:${args.employeeId}:${args.leaveTypeId}:${args.year}`;
  await args.database.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

async function loadSlvlEntitlements(
  employeeId: string,
  database: DatabaseLike = db
): Promise<SlvlEntitlementRow> {
  const [row] = await database
    .select({
      defaultSickLeave: slvlGroup.defaultSickLeave,
      defaultVacationLeave: slvlGroup.defaultVacationLeave,
    })
    .from(employeesSalary)
    .leftJoin(slvlGroup, eq(employeesSalary.slvlGroupId, slvlGroup.id))
    .where(eq(employeesSalary.employeeId, employeeId))
    .limit(1);

  return row ?? null;
}

export async function getEmployeeLeaveBalanceSummary(
  employeeId: string,
  year: number,
  database: DatabaseLike = db
): Promise<LeaveBalanceSummaryItem[]> {
  await ensureDefaultLeaveTypes();

  const [typeRows, ledgerRows, slvlEntitlements] = await Promise.all([
    database.select().from(leaveTypes).orderBy(asc(leaveTypes.code)),
    database
      .select({
        leaveTypeId: leaveBalanceLedger.leaveTypeId,
        transactionType: leaveBalanceLedger.transactionType,
        total: sql<string>`COALESCE(SUM(${leaveBalanceLedger.quantity}), 0)`,
      })
      .from(leaveBalanceLedger)
      .where(and(eq(leaveBalanceLedger.employeeId, employeeId), isLedgerYearCondition(year)))
      .groupBy(
        leaveBalanceLedger.leaveTypeId,
        leaveBalanceLedger.transactionType
      ),
    loadSlvlEntitlements(employeeId, database),
  ]);

  const totals = new Map<number, Map<string, number>>();
  for (const row of ledgerRows) {
    const byType = totals.get(row.leaveTypeId) ?? new Map<string, number>();
    byType.set(row.transactionType, toAmount(row.total));
    totals.set(row.leaveTypeId, byType);
  }

  return typeRows.map((leaveType: LeaveTypeRecord) => {
    const byType = totals.get(leaveType.id) ?? new Map<string, number>();
    const grants = Math.max(0, toAmount(byType.get("Grant")));
    const carryover = Math.max(0, toAmount(byType.get("Carryover")));
    const adjustments = toAmount(byType.get("Adjustment"));
    const used = Math.abs(Math.min(0, toAmount(byType.get("Used"))));
    const encashed = Math.abs(Math.min(0, toAmount(byType.get("Encashment"))));
    const expired = Math.abs(Math.min(0, toAmount(byType.get("Expiry"))));
    const ledgerEntitlement = grants + carryover + Math.max(0, adjustments);
    const fallbackEntitlement = getAnnualLeaveGrantQuantity({
      leaveCode: leaveType.code,
      leaveTypeAnnualEntitlement: leaveType.annualEntitlement,
      slvlGroupEntitlement: slvlEntitlements,
    });
    const entitled = ledgerEntitlement > 0 ? ledgerEntitlement : fallbackEntitlement;
    const rawBalance = [...byType.values()].reduce((total, value) => total + value, 0);
    const balance =
      ledgerEntitlement > 0 || rawBalance !== 0
        ? rawBalance
        : entitled - used - encashed - expired;

    return {
      leaveTypeId: leaveType.id,
      code: leaveType.code,
      name: leaveType.name,
      entitled,
      used,
      encashed,
      expired,
      adjustments,
      balance,
      requiresBalance: leaveType.requiresBalance,
    } satisfies LeaveBalanceSummaryItem;
  });
}

async function loadLeaveDurationContext(args: {
  employeeId: string;
  startDate: string;
  endDate: string;
  database: DatabaseLike;
}) {
  const [legacyTimekeeping, assignments, weeklyPatterns, holidays] =
    await Promise.all([
      args.database.query.employeesTimekeeping.findFirst({
        where: eq(employeesTimekeeping.employeeId, args.employeeId),
      }),
      args.database
        .select()
        .from(employeeShiftAssignments)
        .where(
          and(
            eq(employeeShiftAssignments.employeeId, args.employeeId),
            lte(employeeShiftAssignments.effectiveFrom, args.endDate),
            sql`(${employeeShiftAssignments.effectiveTo} is null or ${employeeShiftAssignments.effectiveTo} >= ${args.startDate})`
          )
        ),
      args.database.query.employeeWeeklyShiftPatterns.findMany({
        where: and(
          eq(employeeWeeklyShiftPatterns.employeeId, args.employeeId),
          lte(employeeWeeklyShiftPatterns.effectiveFrom, args.endDate),
          or(
            sql`${employeeWeeklyShiftPatterns.effectiveTo} is null`,
            gte(employeeWeeklyShiftPatterns.effectiveTo, args.startDate)
          )
        ),
        with: { days: true },
      }),
      args.database
        .select({
          holidayDate: holidayYearCalendar.holidayDate,
          holidayDate2: holidayYearCalendar.holidayDate2,
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
        ),
    ]);

  return {
    legacyTimekeeping: legacyTimekeeping ?? null,
    assignments,
    weeklyPatterns,
    holidayTypeByDate: buildHolidayTypeByDate(
      holidays as Array<{
        holidayDate: string;
        holidayDate2?: string | null;
        holidayType: OvertimeHolidayType;
      }>
    ),
  };
}

export async function buildLeaveDayDetails(args: {
  employeeId: string;
  startDate: string;
  endDate?: string | null;
  dayPart?: LeaveDayPart | null;
  policy?: LeavePolicyRecord | null;
  database?: DatabaseLike;
}) {
  const database = args.database ?? db;
  const dayPart = args.dayPart ?? "FullDay";
  const endDate = normalizeLeaveEndDate(args.endDate) ?? args.startDate;
  const policy =
    args.policy ??
    ({
      halfDayAllowed: true,
      excludeRestDaysAndHolidays: true,
    } as Pick<LeavePolicyRecord, "halfDayAllowed" | "excludeRestDaysAndHolidays">);

  assertDateRange(args.startDate, endDate);

  if (dayPart !== "FullDay" && !policy.halfDayAllowed) {
    throw new Error("Half-day leaves are not enabled for this leave type.");
  }

  if (dayPart !== "FullDay" && args.startDate !== endDate) {
    throw new Error("Half-day leave can only be filed for a single date.");
  }

  const context = await loadLeaveDurationContext({
    employeeId: args.employeeId,
    startDate: args.startDate,
    endDate,
    database,
  });

  return eachDayOfInterval({
    start: new Date(`${args.startDate}T00:00:00`),
    end: new Date(`${endDate}T00:00:00`),
  }).map((currentDate): LeaveDayDetailDraft => {
    const leaveDate = format(currentDate, "yyyy-MM-dd");
    const holidayType = context.holidayTypeByDate.get(leaveDate) ?? null;
    const dayType = holidayType
      ? getAttendanceDtrDayTypeFromHolidayType(holidayType)
      : "Regular Day";
    const resolvedSchedule = resolveEmployeeScheduleForDate({
      attendanceDate: leaveDate,
      assignments: context.assignments,
      weeklyPatterns: context.weeklyPatterns,
      legacyTimekeeping: context.legacyTimekeeping,
    });
    const isRestDay =
      isResolvedScheduleRestDay(resolvedSchedule) ||
      resolvedSchedule.hoursPerDay <= 0;
    const isNonWorkingHoliday = isAttendanceDtrNonWorkingDayType(dayType);
    let exclusionReason: string | null = null;

    if (policy.excludeRestDaysAndHolidays && isNonWorkingHoliday) {
      exclusionReason = "NonWorkingHoliday";
    } else if (policy.excludeRestDaysAndHolidays && isRestDay) {
      exclusionReason =
        resolvedSchedule.hoursPerDay <= 0 ? "NoScheduledHours" : "RestDay";
    }

    return {
      leaveDate,
      dayPart,
      quantity: exclusionReason ? 0 : getLeaveQuantityForDayPart(dayPart),
      isRestDay,
      holidayType,
      exclusionReason,
    };
  });
}

export function summarizeLeaveDayDetails(details: LeaveDayDetailDraft[]) {
  return details.reduce((total, detail) => total + detail.quantity, 0);
}

export async function replaceLeaveRecordDayDetails(args: {
  leaveRecordId: number;
  employeeId: string;
  startDate: string;
  endDate?: string | null;
  dayPart?: LeaveDayPart | null;
  leaveTypeId?: number | null;
  database?: DatabaseLike;
}) {
  const database = args.database ?? db;
  const policy = args.leaveTypeId
    ? await getLeavePolicyForType(args.leaveTypeId, database)
    : null;
  const details = await buildLeaveDayDetails({
    employeeId: args.employeeId,
    startDate: args.startDate,
    endDate: args.endDate,
    dayPart: args.dayPart,
    policy,
    database,
  });
  const totalDays = summarizeLeaveDayDetails(details);

  if (totalDays <= 0) {
    throw new Error(
      "This leave request has no chargeable working day after rest days and non-working holidays are excluded."
    );
  }

  await database
    .delete(employeeLeaveRecordDays)
    .where(eq(employeeLeaveRecordDays.leaveRecordId, args.leaveRecordId));

  await database.insert(employeeLeaveRecordDays).values(
    details.map((detail) => ({
      leaveRecordId: args.leaveRecordId,
      leaveDate: detail.leaveDate,
      dayPart: detail.dayPart,
      quantity: toDecimalString(detail.quantity),
      isRestDay: detail.isRestDay,
      holidayType: detail.holidayType,
      exclusionReason: detail.exclusionReason,
    }))
  );

  await database
    .update(employeesLeaveRecords)
    .set({
      noOfDays: toDecimalString(totalDays),
      updatedAt: new Date(),
    })
    .where(eq(employeesLeaveRecords.id, args.leaveRecordId));

  return {
    details,
    totalDays,
  };
}

export async function getPrimaryLeaveDayPart(
  leaveRecordId: number,
  database: DatabaseLike = db
): Promise<LeaveDayPart> {
  const [detail] = await database
    .select({
      dayPart: employeeLeaveRecordDays.dayPart,
    })
    .from(employeeLeaveRecordDays)
    .where(eq(employeeLeaveRecordDays.leaveRecordId, leaveRecordId))
    .orderBy(asc(employeeLeaveRecordDays.leaveDate))
    .limit(1);

  return detail?.dayPart ?? "FullDay";
}

async function loadLeaveRecordDayDetails(
  leaveRecordId: number,
  database: DatabaseLike = db
) {
  return database
    .select({
      leaveDate: employeeLeaveRecordDays.leaveDate,
      quantity: employeeLeaveRecordDays.quantity,
    })
    .from(employeeLeaveRecordDays)
    .where(eq(employeeLeaveRecordDays.leaveRecordId, leaveRecordId))
    .orderBy(asc(employeeLeaveRecordDays.leaveDate));
}

function groupDetailsByYear(
  record: typeof employeesLeaveRecords.$inferSelect,
  details: Array<{ leaveDate: string; quantity: string | number }>
) {
  const grouped = new Map<number, { quantity: number; entryDate: string }>();

  if (details.length === 0) {
    const entryDate = record.leaveStartDate ?? record.dateFiled;
    const year = getYear(entryDate);
    grouped.set(year, {
      entryDate,
      quantity: toAmount(record.noOfDays),
    });
    return grouped;
  }

  for (const detail of details) {
    const quantity = toAmount(detail.quantity);
    if (quantity <= 0) continue;

    const year = getYear(detail.leaveDate);
    const current = grouped.get(year);
    grouped.set(year, {
      entryDate: current?.entryDate ?? detail.leaveDate,
      quantity: (current?.quantity ?? 0) + quantity,
    });
  }

  return grouped;
}

export async function syncLeaveLedgerForRecord(
  recordId: number,
  database: DatabaseLike = db
) {
  const record = await database.query.employeesLeaveRecords.findFirst({
    where: eq(employeesLeaveRecords.id, recordId),
    with: {
      leaveTypeLookup: true,
    },
  });

  if (!record) return null;

  await database
    .delete(leaveBalanceLedger)
    .where(
      and(
        eq(leaveBalanceLedger.sourceTable, LEAVE_RECORD_SOURCE_TABLE),
        eq(leaveBalanceLedger.sourceId, String(record.id))
      )
    );

  if (record.leaveStatus !== "Approved") {
    return null;
  }

  const leaveType =
    record.leaveTypeLookup ?? (await getLeaveTypeByCode(record.leaveType, database));

  if (!leaveType || !leaveType.requiresBalance) {
    return null;
  }

  const details = await loadLeaveRecordDayDetails(record.id, database);
  const byYear = groupDetailsByYear(record, details);
  const entries: Array<typeof leaveBalanceLedger.$inferSelect> = [];

  for (const [year, summary] of [...byYear.entries()].sort(([left], [right]) => left - right)) {
    if (summary.quantity <= 0) continue;

    const currentBalance = await getLeaveBalance(
      record.employeeId,
      leaveType.id,
      year,
      database
    );
    const quantity = -summary.quantity;
    const balanceAfter = currentBalance + quantity;
    const [entry] = await database
      .insert(leaveBalanceLedger)
      .values({
        employeeId: record.employeeId,
        leaveTypeId: leaveType.id,
        entryDate: summary.entryDate,
        transactionType: "Used",
        quantity: toDecimalString(quantity),
        balanceAfter: toDecimalString(balanceAfter),
        periodYear: year,
        idempotencyKey: `leave-used:${record.id}:${year}`,
        sourceTable: LEAVE_RECORD_SOURCE_TABLE,
        sourceId: String(record.id),
        remarks: record.reason,
      })
      .onConflictDoNothing()
      .returning();

    if (entry) entries.push(entry);
  }

  return entries;
}

export const LEAVE_RECORD_LEDGER_SOURCE_TABLE = LEAVE_RECORD_SOURCE_TABLE;

"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  accountCode,
  branchCalendarAccountCodeOverrides,
  holidayYearCalendar,
  payrollPeriods,
  payrollRuns,
} from "@/db/schema";
import { recordAdminAuditEvent, requireAdminActor } from "@/lib/admin";
import {
  refreshGeneratedDtrRowsForBranchCalendarAccountCodeOverride,
  refreshGeneratedDtrRowsForHolidayCalendarChange,
} from "@/app/actions/attendanceImportAction";
import {
  clearBranchCalendarAccountCodeOverrideSchema,
  saveBranchCalendarHolidayCheckDatesSchema,
  saveBranchCalendarAccountCodeOverrideSchema,
} from "@/zod-schemas/branchCalendarAccountCodeOverride";

const BRANCH_CALENDAR_ACCOUNT_CODE_TYPES = [
  "Regular Hours",
  "Overtime",
  "Night Premium",
  "Sunday/Holiday",
] as const;

function scopeLabel(departmentId: number | null) {
  return departmentId == null ? "All Departments" : `department ${departmentId}`;
}

function buildOverrideWhere(args: {
  attendanceDate: string;
  departmentId: number | null;
}) {
  return and(
    eq(branchCalendarAccountCodeOverrides.attendanceDate, args.attendanceDate),
    args.departmentId == null
      ? isNull(branchCalendarAccountCodeOverrides.departmentId)
      : eq(branchCalendarAccountCodeOverrides.departmentId, args.departmentId)
  );
}

async function assertAccountCodeTypes(args: {
  regularAccountCodeId: number;
  overtimeAccountCodeId: number;
}) {
  if (args.regularAccountCodeId === args.overtimeAccountCodeId) {
    throw new Error("Select separate account codes for regular hours and overtime.");
  }

  const rows = await db
    .select({
      id: accountCode.id,
      accountCode: accountCode.accountCode,
      accountType: accountCode.accountType,
    })
    .from(accountCode)
    .where(
      inArray(accountCode.id, [
        args.regularAccountCodeId,
        args.overtimeAccountCodeId,
      ])
    );

  const accountById = new Map(rows.map((row) => [row.id, row] as const));
  const regularAccount = accountById.get(args.regularAccountCodeId);
  const overtimeAccount = accountById.get(args.overtimeAccountCodeId);

  if (!regularAccount) {
    throw new Error("Selected regular-hours account code no longer exists.");
  }
  if (!overtimeAccount) {
    throw new Error("Selected overtime account code no longer exists.");
  }
  if (
    !BRANCH_CALENDAR_ACCOUNT_CODE_TYPES.includes(
      regularAccount.accountType as (typeof BRANCH_CALENDAR_ACCOUNT_CODE_TYPES)[number]
    )
  ) {
    throw new Error(
      "Regular-hours account code must be Regular Hours, Overtime, Night Premium, or Sunday/Holiday."
    );
  }
  if (
    !BRANCH_CALENDAR_ACCOUNT_CODE_TYPES.includes(
      overtimeAccount.accountType as (typeof BRANCH_CALENDAR_ACCOUNT_CODE_TYPES)[number]
    )
  ) {
    throw new Error(
      "Overtime account code must be Regular Hours, Overtime, Night Premium, or Sunday/Holiday."
    );
  }
}

async function assertAffectedPayrollRunsAreEditable(attendanceDate: string) {
  const affectedPeriods = await db
    .select({
      id: payrollPeriods.id,
      code: payrollPeriods.code,
    })
    .from(payrollPeriods)
    .where(
      and(
        eq(payrollPeriods.status, "Open"),
        lte(payrollPeriods.startDate, attendanceDate),
        gte(payrollPeriods.endDate, attendanceDate)
      )
    );

  if (affectedPeriods.length === 0) return;

  const blockingRuns = await db
    .select({
      periodCode: payrollPeriods.code,
      status: payrollRuns.status,
    })
    .from(payrollRuns)
    .innerJoin(payrollPeriods, eq(payrollRuns.payrollPeriodId, payrollPeriods.id))
    .where(
      and(
        inArray(
          payrollRuns.payrollPeriodId,
          affectedPeriods.map((period) => period.id)
        ),
        inArray(payrollRuns.status, ["Approved", "Posted"])
      )
    )
    .orderBy(desc(payrollRuns.createdAt));

  const blockingRun = blockingRuns[0];
  if (blockingRun) {
    throw new Error(
      `Branch Calendar account-code changes are blocked because payroll period ${blockingRun.periodCode} already has a ${blockingRun.status} run.`
    );
  }
}

export async function saveBranchCalendarAccountCodeOverrideAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = saveBranchCalendarAccountCodeOverrideSchema.parse(input);
  const departmentId = parsed.departmentId ?? null;

  await assertAccountCodeTypes(parsed);
  await assertAffectedPayrollRunsAreEditable(parsed.attendanceDate);

  const saved = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: branchCalendarAccountCodeOverrides.id })
      .from(branchCalendarAccountCodeOverrides)
      .where(
        buildOverrideWhere({
          attendanceDate: parsed.attendanceDate,
          departmentId,
        })
      )
      .limit(1);

    if (existing) {
      await tx
        .update(branchCalendarAccountCodeOverrides)
        .set({
          regularAccountCodeId: parsed.regularAccountCodeId,
          overtimeAccountCodeId: parsed.overtimeAccountCodeId,
          updatedByUserId: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(branchCalendarAccountCodeOverrides.id, existing.id));

      return { id: existing.id, created: false };
    }

    const [created] = await tx
      .insert(branchCalendarAccountCodeOverrides)
      .values({
        attendanceDate: parsed.attendanceDate,
        departmentId,
        regularAccountCodeId: parsed.regularAccountCodeId,
        overtimeAccountCodeId: parsed.overtimeAccountCodeId,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      })
      .returning({ id: branchCalendarAccountCodeOverrides.id });

    return { id: created.id, created: true };
  });

  const refreshResult =
    await refreshGeneratedDtrRowsForBranchCalendarAccountCodeOverride({
      actorUserId: actor.userId,
      attendanceDate: parsed.attendanceDate,
      departmentId,
    });

  await recordAdminAuditEvent({
    actorUserId: actor.userId,
    entityType: "branch_calendar_account_code_override",
    entityId: saved.id,
    action: saved.created
      ? "branch_calendar_account_code.created"
      : "branch_calendar_account_code.updated",
    details: {
      attendanceDate: parsed.attendanceDate,
      departmentId,
      regularAccountCodeId: parsed.regularAccountCodeId,
      overtimeAccountCodeId: parsed.overtimeAccountCodeId,
      refreshResult,
    },
  });

  revalidatePath("/branchCalendar");
  revalidatePath("/payroll");

  return {
    message: `Account codes saved for ${parsed.attendanceDate} (${scopeLabel(
      departmentId
    )}).`,
    ...refreshResult,
  };
}

export async function clearBranchCalendarAccountCodeOverrideAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = clearBranchCalendarAccountCodeOverrideSchema.parse(input);
  const departmentId = parsed.departmentId ?? null;

  await assertAffectedPayrollRunsAreEditable(parsed.attendanceDate);

  const deletedRows = await db
    .delete(branchCalendarAccountCodeOverrides)
    .where(
      buildOverrideWhere({
        attendanceDate: parsed.attendanceDate,
        departmentId,
      })
    )
    .returning({ id: branchCalendarAccountCodeOverrides.id });

  const refreshResult =
    await refreshGeneratedDtrRowsForBranchCalendarAccountCodeOverride({
      actorUserId: actor.userId,
      attendanceDate: parsed.attendanceDate,
      departmentId,
    });

  await recordAdminAuditEvent({
    actorUserId: actor.userId,
    entityType: "branch_calendar_account_code_override",
    entityId:
      deletedRows.length > 0
        ? deletedRows.map((row) => row.id).join(",")
        : `${parsed.attendanceDate}:${departmentId ?? "all"}`,
    action: "branch_calendar_account_code.cleared",
    details: {
      attendanceDate: parsed.attendanceDate,
      departmentId,
      deletedCount: deletedRows.length,
      refreshResult,
    },
  });

  revalidatePath("/branchCalendar");
  revalidatePath("/payroll");

  return {
    message: `Account codes cleared for ${parsed.attendanceDate} (${scopeLabel(
      departmentId
    )}).`,
    ...refreshResult,
  };
}

export async function saveBranchCalendarHolidayCheckDatesAction(input: unknown) {
  const actor = await requireAdminActor();
  const parsed = saveBranchCalendarHolidayCheckDatesSchema.parse(input);

  const existingHoliday = await db.query.holidayYearCalendar.findFirst({
    where: eq(holidayYearCalendar.id, parsed.id),
  });

  if (!existingHoliday) {
    throw new Error("Selected holiday no longer exists.");
  }

  await db
    .update(holidayYearCalendar)
    .set({
      checkDate1: parsed.checkDate1,
      checkDate2: parsed.checkDate2,
      requireCheckDate1: parsed.requireCheckDate1,
      requireCheckDate2: parsed.requireCheckDate2,
      updatedAt: new Date(),
    })
    .where(eq(holidayYearCalendar.id, parsed.id));

  const refreshResult = existingHoliday.holidayDate
    ? await refreshGeneratedDtrRowsForHolidayCalendarChange({
        actorUserId: actor.userId,
        startDate: existingHoliday.holidayDate,
        endDate: existingHoliday.holidayDate2 ?? existingHoliday.holidayDate,
      })
    : {
        affectedPayrollPeriodCount: 0,
        affectedEmployeeCount: 0,
        generatedAccountCodeRowCount: 0,
        staleRunCount: 0,
        refreshedEntryCount: 0,
      };

  await recordAdminAuditEvent({
    actorUserId: actor.userId,
    entityType: "holiday_year_calendar",
    entityId: parsed.id,
    action: "holiday.check_dates.updated",
    details: {
      name: existingHoliday.name,
      holidayDate: existingHoliday.holidayDate,
      holidayDate2: existingHoliday.holidayDate2,
      checkDate1: parsed.checkDate1,
      checkDate2: parsed.checkDate2,
      requireCheckDate1: parsed.requireCheckDate1,
      requireCheckDate2: parsed.requireCheckDate2,
      refreshResult,
    },
  });

  revalidatePath("/branchCalendar");
  revalidatePath("/constants/holidayCode/form");
  revalidatePath("/payroll");

  return {
    message: `${existingHoliday.name} check dates saved.`,
    ...refreshResult,
  };
}

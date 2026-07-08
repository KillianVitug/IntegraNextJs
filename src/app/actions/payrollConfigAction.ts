"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/db";
import {
  accountCode,
  holidayTypeAccountCodes,
  holidayTemplates,
  holidayYearCalendar,
  leavePolicies,
  leaveTypes,
  employeeShiftAssignments,
  employeeWeeklyShiftPatternDays,
  employeesLeaveRecords,
  overtimeRules,
  shiftTableBreaks,
  shiftTables,
  tardinessRules,
  undertimeRules,
} from "@/db/schema";
import { recordAdminAuditEvent, requireAdminActor } from "@/lib/admin";
import {
  SHIFT_BREAK_SLOT_DEFINITIONS,
  buildShiftAssignmentSnapshotFromTable,
} from "@/lib/shifts";
import { actionClient } from "@/lib/safe-action";
import { flattenValidationErrors } from "next-safe-action";
import { and, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import {
  deleteHolidayCalendarSchema,
  deleteHolidayTemplateSchema,
  generateHolidayYearSchema,
  insertHolidayCalendarSchema,
  insertHolidayTemplateSchema,
  type InsertHolidayTemplateSchemaType,
  type InsertHolidayCalendarSchemaType,
} from "@/zod-schemas/holidayCalendar";
import {
  saveHolidayTypeAccountCodeSchema,
  type SaveHolidayTypeAccountCodeSchemaType,
} from "@/zod-schemas/holidayTypeAccountCode";
import {
  generateHolidayYearFromTemplates,
  refreshOpenPayrollPeriodsForHolidayYear,
} from "@/lib/holidays";
import { refreshGeneratedDtrRowsForHolidayCalendarChange } from "@/app/actions/attendanceImportAction";
import {
  deleteLeaveTypeSchema,
  insertLeaveTypeSchema,
  type InsertLeaveTypeSchemaType,
} from "@/zod-schemas/leaveType";
import {
  deleteOvertimeRuleSchema,
  insertOvertimeRuleSchema,
  type InsertOvertimeRuleSchemaType,
} from "@/zod-schemas/overtimeRule";
import {
  deleteTardinessRuleSchema,
  insertTardinessRuleSchema,
  type InsertTardinessRuleSchemaType,
} from "@/zod-schemas/tardinessRule";
import {
  deleteUndertimeRuleSchema,
  insertUndertimeRuleSchema,
  type InsertUndertimeRuleSchemaType,
} from "@/zod-schemas/undertimeRule";
import {
  deleteShiftTableSchema,
  insertShiftTableSchema,
  type InsertShiftTableSchemaType,
} from "@/zod-schemas/shiftTable";

type TimeRuleTable =
  | typeof undertimeRules
  | typeof overtimeRules
  | typeof tardinessRules;

type TimeRuleRow = {
  id: number;
  minutesFrom: number;
  minutesTo: number | null;
  category?: string | null;
};

function rangesOverlap(
  firstFrom: number,
  firstTo: number | null,
  secondFrom: number,
  secondTo: number | null
) {
  const firstEnd = firstTo ?? Number.MAX_SAFE_INTEGER;
  const secondEnd = secondTo ?? Number.MAX_SAFE_INTEGER;

  return firstFrom <= secondEnd && secondFrom <= firstEnd;
}

async function ensureNoTimeRuleOverlap(args: {
  table: TimeRuleTable;
  id?: number;
  minutesFrom: number;
  minutesTo: number | null;
  category?: string;
  label: string;
}) {
  const existingRows = args.id
    ? await db.select().from(args.table).where(ne(args.table.id, args.id))
    : await db.select().from(args.table);

  const overlappingRow = (existingRows as TimeRuleRow[]).find((row) => {
    if (
      args.category &&
      "category" in row &&
      typeof row.category === "string" &&
      row.category !== args.category
    ) {
      return false;
    }

    return rangesOverlap(
      args.minutesFrom,
      args.minutesTo,
      row.minutesFrom,
      row.minutesTo ?? null
    );
  });

  if (overlappingRow) {
    const existingRange = `${overlappingRow.minutesFrom}-${overlappingRow.minutesTo ?? "open"}`;
    const categoryLabel =
      args.category && overlappingRow.category
        ? ` for category ${overlappingRow.category}`
        : "";
    throw new Error(
      `${args.label} range overlaps with existing range ${existingRange}${categoryLabel}.`
    );
  }
}

async function saveTimeRule(args: {
  actorUserId: string;
  table: TimeRuleTable;
  parsedInput:
    | InsertUndertimeRuleSchemaType
    | InsertOvertimeRuleSchemaType
    | InsertTardinessRuleSchemaType;
  entityType: string;
  auditPrefix: string;
  label: string;
}) {
  await ensureNoTimeRuleOverlap({
    table: args.table,
    id: args.parsedInput.id,
    minutesFrom: args.parsedInput.minutesFrom,
    minutesTo: args.parsedInput.minutesTo,
    category: "category" in args.parsedInput ? args.parsedInput.category : undefined,
    label: args.label,
  });

  const payload = {
    ...("category" in args.parsedInput
      ? { category: args.parsedInput.category }
      : {}),
    minutesFrom: args.parsedInput.minutesFrom,
    minutesTo: args.parsedInput.minutesTo,
    rateMultiplier: args.parsedInput.rateMultiplier.toFixed(4),
  };

  if (args.parsedInput.id) {
    await db
      .update(args.table)
      .set({
        ...payload,
        updatedAt: new Date(),
      })
      .where(eq(args.table.id, args.parsedInput.id));

    await recordAdminAuditEvent({
      actorUserId: args.actorUserId,
      entityType: args.entityType,
      entityId: args.parsedInput.id,
      action: `${args.auditPrefix}.updated`,
      details: payload,
    });

    return { message: `${args.label} updated.` };
  }

  const [created] = await db
    .insert(args.table)
    .values(payload)
    .returning({ id: args.table.id });

  await recordAdminAuditEvent({
    actorUserId: args.actorUserId,
    entityType: args.entityType,
    entityId: created.id,
    action: `${args.auditPrefix}.created`,
    details: payload,
  });

  return { message: `${args.label} created.` };
}

async function deleteTimeRule(args: {
  actorUserId: string;
  table: TimeRuleTable;
  id: number;
  entityType: string;
  auditPrefix: string;
  label: string;
}) {
  await db.delete(args.table).where(eq(args.table.id, args.id));

  await recordAdminAuditEvent({
    actorUserId: args.actorUserId,
    entityType: args.entityType,
    entityId: args.id,
    action: `${args.auditPrefix}.deleted`,
  });

  return { message: `${args.label} deleted.` };
}

async function ensureUniqueShiftTableCode(id: number | undefined, code: string) {
  const existing = await db.query.shiftTables.findFirst({
    where: id
      ? and(eq(shiftTables.code, code), ne(shiftTables.id, id))
      : eq(shiftTables.code, code),
  });

  if (existing) {
    throw new Error(`Shift table code ${code} already exists.`);
  }
}

function buildPersistedShiftBreakRows(
  shiftTableId: number,
  breaks: InsertShiftTableSchemaType["breaks"]
) {
  return SHIFT_BREAK_SLOT_DEFINITIONS.flatMap((definition, index) => {
    const breakRow = breaks[index];
    if (!breakRow?.fromTime || !breakRow?.toTime) return [];

    return [
      {
        shiftTableId,
        slotKey: definition.slotKey,
        label: definition.label,
        fromTime: breakRow.fromTime,
        toTime: breakRow.toTime,
        deduct: breakRow.deduct,
        deductHours: breakRow.deduct ? breakRow.deductHours : 0,
        deductMinutes: breakRow.deduct ? breakRow.deductMinutes : 0,
        sortOrder: definition.sortOrder,
      } satisfies typeof shiftTableBreaks.$inferInsert,
    ];
  });
}

async function syncLinkedShiftAssignments(
  shiftTableId: number,
  payload: Pick<
    InsertShiftTableSchemaType,
    "code" | "description" | "regularStartTime" | "regularEndTime" | "breaks"
  >
) {
  const snapshot = buildShiftAssignmentSnapshotFromTable(payload);

  await db
    .update(employeeShiftAssignments)
    .set({
      shiftName: snapshot.shiftName,
      shiftCode: snapshot.shiftCode,
      checkInTime: snapshot.checkInTime ?? payload.regularStartTime,
      checkOutTime: snapshot.checkOutTime ?? payload.regularEndTime,
      breakMinutes: snapshot.breakMinutes,
      paidBreakMinutes: snapshot.paidBreakMinutes,
      hoursPerDay: snapshot.hoursPerDay.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(employeeShiftAssignments.shiftTableId, shiftTableId));
}

async function syncLinkedWeeklyPatternDays(
  shiftTableId: number,
  payload: Pick<
    InsertShiftTableSchemaType,
    "code" | "description" | "regularStartTime" | "regularEndTime" | "breaks"
  >
) {
  const snapshot = buildShiftAssignmentSnapshotFromTable(payload);

  await db
    .update(employeeWeeklyShiftPatternDays)
    .set({
      shiftName: snapshot.shiftName,
      shiftCode: snapshot.shiftCode,
      checkInTime: snapshot.checkInTime ?? payload.regularStartTime,
      checkOutTime: snapshot.checkOutTime ?? payload.regularEndTime,
      breakMinutes: snapshot.breakMinutes,
      paidBreakMinutes: snapshot.paidBreakMinutes,
      hoursPerDay: snapshot.hoursPerDay.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(employeeWeeklyShiftPatternDays.shiftTableId, shiftTableId));
}

export const saveLeaveTypeAction = actionClient
  .metadata({ actionName: "saveLeaveTypeAction" })
  .schema(insertLeaveTypeSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: InsertLeaveTypeSchemaType }) => {
      const actor = await requireAdminActor();
      const payload: typeof leaveTypes.$inferInsert = {
        code: parsedInput.code,
        name: parsedInput.name,
        accountCodeId: parsedInput.accountCodeId,
        isPaid: parsedInput.isPaid,
        requiresBalance: parsedInput.requiresBalance,
        annualEntitlement: parsedInput.annualEntitlement.toFixed(2),
        colorHex: parsedInput.colorHex?.trim() ? parsedInput.colorHex : null,
      };
      const policyPayload: Omit<
        typeof leavePolicies.$inferInsert,
        "leaveTypeId"
      > = {
        grantModel: "Annual",
        carryoverLimit: parsedInput.carryoverLimit.toFixed(2),
        expiryMonth: parsedInput.expiryMonth,
        expiryDay: parsedInput.expiryDay,
        encashmentEnabled: parsedInput.encashmentEnabled,
        encashmentTaxable: parsedInput.encashmentTaxable,
        encashmentMonth13thEligible: parsedInput.encashmentMonth13thEligible,
        encashmentAccountCodeId: parsedInput.encashmentAccountCodeId ?? null,
        halfDayAllowed: parsedInput.halfDayAllowed,
        excludeRestDaysAndHolidays: parsedInput.excludeRestDaysAndHolidays,
      };

      if (parsedInput.id) {
        const leaveTypeId = parsedInput.id;
        await db.transaction(async (tx) => {
          await tx
            .update(leaveTypes)
            .set({
              ...payload,
              updatedAt: new Date(),
            })
            .where(eq(leaveTypes.id, leaveTypeId));
          await tx
            .insert(leavePolicies)
            .values({
              leaveTypeId,
              ...policyPayload,
            })
            .onConflictDoUpdate({
              target: leavePolicies.leaveTypeId,
              set: {
                ...policyPayload,
                updatedAt: new Date(),
              },
            });
        });
        await recordAdminAuditEvent({
          actorUserId: actor.userId,
          entityType: "leave_type",
          entityId: parsedInput.id,
          action: "leave_type.updated",
          details: {
            code: parsedInput.code,
            accountCodeId: parsedInput.accountCodeId,
          },
        });
        revalidateTag("leave-types");
        return { message: `Leave type ${parsedInput.code} updated.` };
      }

      const [created] = await db.transaction(async (tx) => {
        const [createdLeaveType] = await tx
          .insert(leaveTypes)
          .values(payload)
          .returning({ id: leaveTypes.id });
        await tx.insert(leavePolicies).values({
          leaveTypeId: createdLeaveType.id,
          ...policyPayload,
        });

        return [createdLeaveType];
      });
      await recordAdminAuditEvent({
        actorUserId: actor.userId,
        entityType: "leave_type",
        entityId: created.id,
        action: "leave_type.created",
        details: {
          code: parsedInput.code,
          accountCodeId: parsedInput.accountCodeId,
        },
      });
      revalidateTag("leave-types");
      return { message: `Leave type ${parsedInput.code} created.` };
    }
  );

export const deleteLeaveTypeAction = actionClient
  .metadata({ actionName: "deleteLeaveTypeAction" })
  .schema(deleteLeaveTypeSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const existingLeaveType = await db.query.leaveTypes.findFirst({
      where: eq(leaveTypes.id, parsedInput.id),
    });

    if (!existingLeaveType) {
      throw new Error("Leave Type not found.");
    }

    const existingUsage = await db.query.employeesLeaveRecords.findFirst({
      where: or(
        eq(employeesLeaveRecords.leaveTypeId, parsedInput.id),
        eq(employeesLeaveRecords.leaveType, existingLeaveType.code)
      ),
    });

    if (existingUsage) {
      throw new Error(
        "This Leave Type is already used by leave records and cannot be deleted."
      );
    }

    await db.delete(leaveTypes).where(eq(leaveTypes.id, parsedInput.id));
    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "leave_type",
      entityId: parsedInput.id,
      action: "leave_type.deleted",
    });
    revalidateTag("leave-types");
    return { message: "Leave type deleted." };
  });

export const saveHolidayTypeAccountCodeAction = actionClient
  .metadata({ actionName: "saveHolidayTypeAccountCodeAction" })
  .schema(saveHolidayTypeAccountCodeSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({
      parsedInput,
    }: {
      parsedInput: SaveHolidayTypeAccountCodeSchemaType;
    }) => {
      const actor = await requireAdminActor();

      if (
        parsedInput.accountCodeId == null &&
        parsedInput.overtimeAccountCodeId == null &&
        parsedInput.restDayAccountCodeId == null &&
        parsedInput.restDayOvertimeAccountCodeId == null
      ) {
        await db
          .delete(holidayTypeAccountCodes)
          .where(eq(holidayTypeAccountCodes.holidayType, parsedInput.holidayType));
        await recordAdminAuditEvent({
          actorUserId: actor.userId,
          entityType: "holiday_type_account_code",
          entityId: parsedInput.holidayType,
          action: "holiday_type_account_code.cleared",
          details: { holidayType: parsedInput.holidayType },
        });
        revalidateTag("holiday-type-account-codes");
        return { message: `${parsedInput.holidayType} account code cleared.` };
      }

      const selectedAccountIds = [
        parsedInput.accountCodeId,
        parsedInput.overtimeAccountCodeId,
        parsedInput.restDayAccountCodeId,
        parsedInput.restDayOvertimeAccountCodeId,
      ].filter((id): id is number => id != null);
      const selectedAccounts =
        selectedAccountIds.length === 0
          ? []
          : await db
              .select()
              .from(accountCode)
              .where(inArray(accountCode.id, selectedAccountIds));
      const selectedAccountById = new Map(
        selectedAccounts.map((row) => [row.id, row])
      );

      const accountChecks = [
        {
          id: parsedInput.accountCodeId,
          expectedType: "Sunday/Holiday",
          missingMessage: "Selected regular account code no longer exists.",
          typeMessage:
            "Holiday Type account code must be a Sunday/Holiday account.",
        },
        {
          id: parsedInput.overtimeAccountCodeId,
          expectedType: "Overtime",
          missingMessage: "Selected overtime account code no longer exists.",
          typeMessage:
            "Holiday overtime account code must be an Overtime account.",
        },
        {
          id: parsedInput.restDayAccountCodeId,
          expectedType: "Sunday/Holiday",
          missingMessage:
            "Selected rest day holiday account code no longer exists.",
          typeMessage:
            "Rest day holiday account code must be a Sunday/Holiday account.",
        },
        {
          id: parsedInput.restDayOvertimeAccountCodeId,
          expectedType: "Overtime",
          missingMessage:
            "Selected rest day holiday overtime account code no longer exists.",
          typeMessage:
            "Rest day holiday overtime account code must be an Overtime account.",
        },
      ] as const;

      for (const check of accountChecks) {
        if (check.id == null) continue;
        const selectedAccount = selectedAccountById.get(check.id);
        if (!selectedAccount) {
          throw new Error(check.missingMessage);
        }
        if (selectedAccount.accountType !== check.expectedType) {
          throw new Error(check.typeMessage);
        }
      }

      const [saved] = await db
        .insert(holidayTypeAccountCodes)
        .values({
          holidayType: parsedInput.holidayType,
          accountCodeId: parsedInput.accountCodeId,
          overtimeAccountCodeId: parsedInput.overtimeAccountCodeId,
          restDayAccountCodeId: parsedInput.restDayAccountCodeId,
          restDayOvertimeAccountCodeId:
            parsedInput.restDayOvertimeAccountCodeId,
        })
        .onConflictDoUpdate({
          target: holidayTypeAccountCodes.holidayType,
          set: {
            accountCodeId: parsedInput.accountCodeId,
            overtimeAccountCodeId: parsedInput.overtimeAccountCodeId,
            restDayAccountCodeId: parsedInput.restDayAccountCodeId,
            restDayOvertimeAccountCodeId:
              parsedInput.restDayOvertimeAccountCodeId,
            updatedAt: new Date(),
          },
        })
        .returning({ id: holidayTypeAccountCodes.id });

      await recordAdminAuditEvent({
        actorUserId: actor.userId,
        entityType: "holiday_type_account_code",
        entityId: saved.id,
        action: "holiday_type_account_code.saved",
        details: {
          holidayType: parsedInput.holidayType,
          accountCodeId: parsedInput.accountCodeId,
          overtimeAccountCodeId: parsedInput.overtimeAccountCodeId,
          restDayAccountCodeId: parsedInput.restDayAccountCodeId,
          restDayOvertimeAccountCodeId:
            parsedInput.restDayOvertimeAccountCodeId,
        },
      });
      revalidateTag("holiday-type-account-codes");
      return { message: `${parsedInput.holidayType} account code saved.` };
    }
  );

async function refreshGeneratedDtrRowsForHolidayRanges(
  actorUserId: string,
  rows: Array<{ holidayDate: string | null; holidayDate2?: string | null }>
) {
  const ranges = new Map<string, { startDate: string; endDate: string }>();

  for (const row of rows) {
    if (!row.holidayDate) continue;
    const startDate = row.holidayDate;
    const endDate = row.holidayDate2 ?? row.holidayDate;
    ranges.set(`${startDate}:${endDate}`, { startDate, endDate });
  }

  const results = [];
  for (const range of ranges.values()) {
    results.push(
      await refreshGeneratedDtrRowsForHolidayCalendarChange({
        actorUserId,
        startDate: range.startDate,
        endDate: range.endDate,
      })
    );
  }

  return results;
}

export const saveHolidayCalendarAction = actionClient
  .metadata({ actionName: "saveHolidayCalendarAction" })
  .schema(insertHolidayCalendarSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: InsertHolidayCalendarSchemaType }) => {
      const actor = await requireAdminActor();
      const payload: typeof holidayYearCalendar.$inferInsert = {
        year: parsedInput.year,
        templateId: parsedInput.templateId ?? null,
        source: parsedInput.source,
        name: parsedInput.name,
        holidayDate: parsedInput.holidayDate?.trim()
          ? parsedInput.holidayDate
          : null,
        holidayType: parsedInput.holidayType as
          | "Regular"
          | "Special Non-Working"
          | "Special Working"
          | "Company",
        holidayDate2: parsedInput.holidayDate2?.trim()
          ? parsedInput.holidayDate2
          : null,
        checkDate1: parsedInput.checkDate1?.trim()
          ? parsedInput.checkDate1
          : null,
        checkDate2: parsedInput.checkDate2?.trim()
          ? parsedInput.checkDate2
          : null,
        requireCheckDate1: parsedInput.requireCheckDate1,
        requireCheckDate2: parsedInput.requireCheckDate2,
        isPaid: parsedInput.isPaid,
        status: parsedInput.status,
        notes: parsedInput.notes?.trim() ? parsedInput.notes : null,
      };

      if (parsedInput.id) {
        const existingHoliday = await db.query.holidayYearCalendar.findFirst({
          where: eq(holidayYearCalendar.id, parsedInput.id),
        });

        await db
          .update(holidayYearCalendar)
          .set({
            ...payload,
            updatedAt: new Date(),
          })
          .where(eq(holidayYearCalendar.id, parsedInput.id));

        const refreshResult = await refreshOpenPayrollPeriodsForHolidayYear(
          parsedInput.year
        );
        if (existingHoliday && existingHoliday.year !== parsedInput.year) {
          await refreshOpenPayrollPeriodsForHolidayYear(existingHoliday.year);
        }
        const holidayDtrRefresh = await refreshGeneratedDtrRowsForHolidayRanges(
          actor.userId,
          [
            {
              holidayDate: existingHoliday?.holidayDate ?? null,
              holidayDate2: existingHoliday?.holidayDate2 ?? null,
            },
            {
              holidayDate: payload.holidayDate ?? null,
              holidayDate2: payload.holidayDate2 ?? null,
            },
          ]
        );

        await recordAdminAuditEvent({
          actorUserId: actor.userId,
          entityType: "holiday_year_calendar",
          entityId: parsedInput.id,
          action: "holiday.updated",
          details: {
            name: parsedInput.name,
            year: parsedInput.year,
            holidayDate: parsedInput.holidayDate,
            holidayDate2: parsedInput.holidayDate2 ?? null,
            checkDate1: parsedInput.checkDate1 ?? null,
            checkDate2: parsedInput.checkDate2 ?? null,
            requireCheckDate1: parsedInput.requireCheckDate1,
            requireCheckDate2: parsedInput.requireCheckDate2,
            status: parsedInput.status,
            holidayDtrRefresh,
          },
        });
        revalidateTag("holiday-calendar");
        revalidatePath("/branchCalendar");
        revalidatePath("/payroll");
        return {
          message: `${parsedInput.name} updated.`,
          ...refreshResult,
        };
      }

      const [created] = await db
        .insert(holidayYearCalendar)
        .values(payload)
        .returning({ id: holidayYearCalendar.id });
      const refreshResult = await refreshOpenPayrollPeriodsForHolidayYear(
        parsedInput.year
      );
      const holidayDtrRefresh = await refreshGeneratedDtrRowsForHolidayRanges(
        actor.userId,
        [{ holidayDate: payload.holidayDate ?? null, holidayDate2: payload.holidayDate2 ?? null }]
      );
      await recordAdminAuditEvent({
        actorUserId: actor.userId,
        entityType: "holiday_year_calendar",
        entityId: created.id,
        action: "holiday.created",
        details: {
          name: parsedInput.name,
          year: parsedInput.year,
          holidayDate: parsedInput.holidayDate,
          holidayDate2: parsedInput.holidayDate2 ?? null,
          checkDate1: parsedInput.checkDate1 ?? null,
          checkDate2: parsedInput.checkDate2 ?? null,
          requireCheckDate1: parsedInput.requireCheckDate1,
          requireCheckDate2: parsedInput.requireCheckDate2,
          status: parsedInput.status,
          holidayDtrRefresh,
        },
      });
      revalidateTag("holiday-calendar");
      revalidatePath("/branchCalendar");
      revalidatePath("/payroll");
      return {
        message: `${parsedInput.name} created.`,
        ...refreshResult,
      };
    }
  );

export const deleteHolidayCalendarAction = actionClient
  .metadata({ actionName: "deleteHolidayCalendarAction" })
  .schema(deleteHolidayCalendarSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const existingHoliday = await db.query.holidayYearCalendar.findFirst({
      where: eq(holidayYearCalendar.id, parsedInput.id),
    });

    await db
      .delete(holidayYearCalendar)
      .where(eq(holidayYearCalendar.id, parsedInput.id));
    const refreshResult = existingHoliday
      ? await refreshOpenPayrollPeriodsForHolidayYear(existingHoliday.year)
      : { updatedPayrollPeriods: 0, skippedPayrollPeriods: 0 };
    const holidayDtrRefresh = await refreshGeneratedDtrRowsForHolidayRanges(
      actor.userId,
      [
        {
          holidayDate: existingHoliday?.holidayDate ?? null,
          holidayDate2: existingHoliday?.holidayDate2 ?? null,
        },
      ]
    );
    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "holiday_year_calendar",
      entityId: parsedInput.id,
      action: "holiday.deleted",
      details: { holidayDtrRefresh },
    });
    revalidateTag("holiday-calendar");
    revalidatePath("/branchCalendar");
    revalidatePath("/payroll");
    return { message: "Holiday deleted.", ...refreshResult };
  });

export const saveHolidayTemplateAction = actionClient
  .metadata({ actionName: "saveHolidayTemplateAction" })
  .schema(insertHolidayTemplateSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: InsertHolidayTemplateSchemaType }) => {
      const actor = await requireAdminActor();
      const payload: typeof holidayTemplates.$inferInsert = {
        name: parsedInput.name,
        holidayType: parsedInput.holidayType as
          | "Regular"
          | "Special Non-Working"
          | "Special Working"
          | "Company",
        isPaid: parsedInput.isPaid,
        isActive: parsedInput.isActive,
        recurrenceType: parsedInput.recurrenceType,
        fixedMonth:
          parsedInput.recurrenceType === "FixedDate"
            ? parsedInput.fixedMonth
            : null,
        fixedDay:
          parsedInput.recurrenceType === "FixedDate" ? parsedInput.fixedDay : null,
        nthMonth:
          parsedInput.recurrenceType === "NthWeekday"
            ? parsedInput.nthMonth
            : null,
        nthWeekday:
          parsedInput.recurrenceType === "NthWeekday"
            ? parsedInput.nthWeekday
            : null,
        nthOccurrence:
          parsedInput.recurrenceType === "NthWeekday"
            ? parsedInput.nthOccurrence
            : null,
        durationDays: parsedInput.durationDays,
        notes: parsedInput.notes?.trim() ? parsedInput.notes : null,
      };

      if (parsedInput.id) {
        await db
          .update(holidayTemplates)
          .set({ ...payload, updatedAt: new Date() })
          .where(eq(holidayTemplates.id, parsedInput.id));
        await recordAdminAuditEvent({
          actorUserId: actor.userId,
          entityType: "holiday_template",
          entityId: parsedInput.id,
          action: "holiday_template.updated",
          details: {
            name: parsedInput.name,
            recurrenceType: parsedInput.recurrenceType,
          },
        });
        return { message: `${parsedInput.name} template updated.` };
      }

      const [created] = await db
        .insert(holidayTemplates)
        .values(payload)
        .returning({ id: holidayTemplates.id });
      await recordAdminAuditEvent({
        actorUserId: actor.userId,
        entityType: "holiday_template",
        entityId: created.id,
        action: "holiday_template.created",
        details: {
          name: parsedInput.name,
          recurrenceType: parsedInput.recurrenceType,
        },
      });
      return { message: `${parsedInput.name} template created.` };
    }
  );

export const deleteHolidayTemplateAction = actionClient
  .metadata({ actionName: "deleteHolidayTemplateAction" })
  .schema(deleteHolidayTemplateSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const existingYearRow = await db.query.holidayYearCalendar.findFirst({
      where: eq(holidayYearCalendar.templateId, parsedInput.id),
    });

    if (existingYearRow) {
      throw new Error(
        "This template already generated holiday rows. Deactivate it instead of deleting it."
      );
    }

    await db.delete(holidayTemplates).where(eq(holidayTemplates.id, parsedInput.id));
    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "holiday_template",
      entityId: parsedInput.id,
      action: "holiday_template.deleted",
    });
    return { message: "Holiday template deleted." };
  });

export const generateHolidayYearAction = actionClient
  .metadata({ actionName: "generateHolidayYearAction" })
  .schema(generateHolidayYearSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const result = await generateHolidayYearFromTemplates(parsedInput.year);
    const confirmedHolidayRows = await db
      .select({
        holidayDate: holidayYearCalendar.holidayDate,
        holidayDate2: holidayYearCalendar.holidayDate2,
      })
      .from(holidayYearCalendar)
      .where(
        and(
          eq(holidayYearCalendar.year, parsedInput.year),
          eq(holidayYearCalendar.status, "Confirmed"),
          isNotNull(holidayYearCalendar.holidayDate)
        )
      );
    const holidayDtrRefresh = await refreshGeneratedDtrRowsForHolidayRanges(
      actor.userId,
      confirmedHolidayRows
    );
    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "holiday_year_calendar",
      entityId: parsedInput.year,
      action: "holiday_year.generated",
      details: { ...result, holidayDtrRefresh },
    });
    revalidateTag("holiday-calendar");
    revalidatePath("/branchCalendar");
    revalidatePath("/payroll");
    return {
      message:
        `Generated ${result.created} holiday rows for ${parsedInput.year}: ` +
        `${result.templateCreated} from templates and ${result.packageCreated} from date-holidays. ` +
        `Skipped ${result.templateSkipped} template rows and ${result.packageSkipped} package rows already present. ` +
        `Backfilled check dates on ${result.checkDateBackfilled} holiday rows.`,
      ...result,
    };
  });

export const saveShiftTableAction = actionClient
  .metadata({ actionName: "saveShiftTableAction" })
  .schema(insertShiftTableSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(async ({ parsedInput }: { parsedInput: InsertShiftTableSchemaType }) => {
    const actor = await requireAdminActor();
    await ensureUniqueShiftTableCode(parsedInput.id, parsedInput.code);

    const basePayload: typeof shiftTables.$inferInsert = {
      code: parsedInput.code,
      description: parsedInput.description,
      regularStartTime: parsedInput.regularStartTime,
      regularEndTime: parsedInput.regularEndTime,
    };

    if (parsedInput.id) {
      await db.transaction(async (tx) => {
        await tx
          .update(shiftTables)
          .set({
            ...basePayload,
            updatedAt: new Date(),
          })
          .where(eq(shiftTables.id, parsedInput.id!));

        await tx
          .delete(shiftTableBreaks)
          .where(eq(shiftTableBreaks.shiftTableId, parsedInput.id!));

        const breakRows = buildPersistedShiftBreakRows(parsedInput.id!, parsedInput.breaks);
        if (breakRows.length > 0) {
          await tx.insert(shiftTableBreaks).values(breakRows);
        }
      });

      await syncLinkedShiftAssignments(parsedInput.id, parsedInput);
      await syncLinkedWeeklyPatternDays(parsedInput.id, parsedInput);

      await recordAdminAuditEvent({
        actorUserId: actor.userId,
        entityType: "shift_table",
        entityId: parsedInput.id,
        action: "shift_table.updated",
        details: {
          code: parsedInput.code,
          description: parsedInput.description,
        },
      });

      revalidateTag("shift-tables");
      return { message: `Shift table ${parsedInput.code} updated.` };
    }

    const created = await db.transaction(async (tx) => {
      const [createdShiftTable] = await tx
        .insert(shiftTables)
        .values(basePayload)
        .returning({ id: shiftTables.id });

      const breakRows = buildPersistedShiftBreakRows(createdShiftTable.id, parsedInput.breaks);
      if (breakRows.length > 0) {
        await tx.insert(shiftTableBreaks).values(breakRows);
      }

      return createdShiftTable;
    });

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "shift_table",
      entityId: created.id,
      action: "shift_table.created",
      details: {
        code: parsedInput.code,
        description: parsedInput.description,
      },
    });

    revalidateTag("shift-tables");
    return { message: `Shift table ${parsedInput.code} created.` };
  });

export const deleteShiftTableAction = actionClient
  .metadata({ actionName: "deleteShiftTableAction" })
  .schema(deleteShiftTableSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();

    await db.delete(shiftTables).where(eq(shiftTables.id, parsedInput.id));

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "shift_table",
      entityId: parsedInput.id,
      action: "shift_table.deleted",
    });

    revalidateTag("shift-tables");
    return { message: "Shift table deleted." };
  });

export const saveUndertimeRuleAction = actionClient
  .metadata({ actionName: "saveUndertimeRuleAction" })
  .schema(insertUndertimeRuleSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(async ({ parsedInput }: { parsedInput: InsertUndertimeRuleSchemaType }) => {
    const actor = await requireAdminActor();
    const result = await saveTimeRule({
      actorUserId: actor.userId,
      table: undertimeRules,
      parsedInput,
      entityType: "undertime_rule",
      auditPrefix: "undertime_rule",
      label: "Undertime rule",
    });
    revalidateTag("undertime-rules");
    return result;
  });

export const deleteUndertimeRuleAction = actionClient
  .metadata({ actionName: "deleteUndertimeRuleAction" })
  .schema(deleteUndertimeRuleSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const result = await deleteTimeRule({
      actorUserId: actor.userId,
      table: undertimeRules,
      id: parsedInput.id,
      entityType: "undertime_rule",
      auditPrefix: "undertime_rule",
      label: "Undertime rule",
    });
    revalidateTag("undertime-rules");
    return result;
  });

export const saveOvertimeRuleAction = actionClient
  .metadata({ actionName: "saveOvertimeRuleAction" })
  .schema(insertOvertimeRuleSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(async ({ parsedInput }: { parsedInput: InsertOvertimeRuleSchemaType }) => {
    const actor = await requireAdminActor();
    const result = await saveTimeRule({
      actorUserId: actor.userId,
      table: overtimeRules,
      parsedInput,
      entityType: "overtime_rule",
      auditPrefix: "overtime_rule",
      label: "Overtime rule",
    });
    revalidateTag("overtime-rules");
    return result;
  });

export const deleteOvertimeRuleAction = actionClient
  .metadata({ actionName: "deleteOvertimeRuleAction" })
  .schema(deleteOvertimeRuleSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const result = await deleteTimeRule({
      actorUserId: actor.userId,
      table: overtimeRules,
      id: parsedInput.id,
      entityType: "overtime_rule",
      auditPrefix: "overtime_rule",
      label: "Overtime rule",
    });
    revalidateTag("overtime-rules");
    return result;
  });

export const saveTardinessRuleAction = actionClient
  .metadata({ actionName: "saveTardinessRuleAction" })
  .schema(insertTardinessRuleSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(async ({ parsedInput }: { parsedInput: InsertTardinessRuleSchemaType }) => {
    const actor = await requireAdminActor();
    const result = await saveTimeRule({
      actorUserId: actor.userId,
      table: tardinessRules,
      parsedInput,
      entityType: "tardiness_rule",
      auditPrefix: "tardiness_rule",
      label: "Tardiness rule",
    });
    revalidateTag("tardiness-rules");
    return result;
  });

export const deleteTardinessRuleAction = actionClient
  .metadata({ actionName: "deleteTardinessRuleAction" })
  .schema(deleteTardinessRuleSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const result = await deleteTimeRule({
      actorUserId: actor.userId,
      table: tardinessRules,
      id: parsedInput.id,
      entityType: "tardiness_rule",
      auditPrefix: "tardiness_rule",
      label: "Tardiness rule",
    });
    revalidateTag("tardiness-rules");
    return result;
  });

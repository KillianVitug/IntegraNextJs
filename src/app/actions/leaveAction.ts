"use server";

import { db, type DbClient } from "@/db";
import {
  employeeLeaveApprovalEvents,
  employeeLeaveRecordDays,
  employees,
  employeesGeneralInfo,
  employeesSalary,
  leaveBalanceLedger,
  employeesLeaveRecords,
  department,
  payrollPeriods,
  payrollRunEmployees,
  payrollRuns,
  slvlGroup,
  leaveTypes,
  leaveStatusEnum,
  leaveEncashments,
  manualPayrollEntries,
  manualPayrollEntryLines,
} from "@/db/schema";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordPayrollRunEvent, requireAdminActor } from "@/lib/admin";
import { requireEmployee } from "@/lib/auth/server";
import { getEmployeeForUser } from "@/lib/queries/getEmployeeForUser";
import {
  buildLeaveTypeMapByCode,
  ensureDefaultLeaveTypes,
  getEmployeeLeaveBalanceSummary,
  getLeaveBalance,
  getLeavePolicyForType,
  getLeaveTypeByCode,
  getPrimaryLeaveDayPart,
  lockLeaveBalance,
  replaceLeaveRecordDayDetails,
  resolveLeavePayStatus,
  syncLeaveLedgerForRecord,
  type LeaveBalanceSummaryItem,
  type LeaveDayPart,
} from "@/lib/payroll/leave";
import { formatEmployeeCode } from "@/utils/employeeCode";

type LeaveStatus = (typeof leaveStatusEnum.enumValues)[number];

export type LeaveRecordWithEmployeeInfo = {
  id: number;
  employeeId: string;
  dateFiled: string;
  leaveType: string;
  leaveTypeName?: string | null;
  noOfDays: string;
  reason: string | null;
  leaveStatus: LeaveStatus;
  employeeNo: string | null;
  employeeType: string | null;
  firstName: string | null;
  lastName: string | null;
};

export type EmployeeLeaveUsageSummary = {
  entitledSickLeave: number;
  entitledVacationLeave: number;
  usedSickLeave: number;
  usedVacationLeave: number;
};

export type EmployeeServiceSummary = {
  employeeNo: string;
  fullName: string;
  dateHired: string | null;
  department: string | null;
  sickLeave: number;
  vacationLeave: number;
};

type LeaveRecordForPayrollImpact = typeof employeesLeaveRecords.$inferSelect & {
  leaveTypeLookup: typeof leaveTypes.$inferSelect | null;
};

type LeavePayrollImpact = {
  employeeId: string;
  startDate: string;
  endDate: string;
  isPaid: boolean;
};

type LeaveMutationPayload = {
  employeeId: string;
  dateFiled: string;
  leaveStartDate: string;
  leaveEndDate?: string | null;
  leaveType: string;
  noOfDays?: number;
  dayPart?: LeaveDayPart | null;
  reason: string;
  leaveStatus?: LeaveStatus;
  approvalDecisionNote?: string | null;
  overrideInsufficientBalance?: boolean;
  overrideReason?: string | null;
};

function normalizeLeaveEndDate(value: string | null | undefined) {
  return value && value !== "" ? value : null;
}

function money(value: number) {
  return value.toFixed(2);
}

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function getYear(dateKey: string) {
  return Number(dateKey.slice(0, 4));
}

async function getEmployeeFromSession() {
  const auth = await requireEmployee();

  return getEmployeeForUser({
    employeeId: auth.employeeId,
  });
}

async function requireExistingLeaveType(code: string, database: DbClient = db) {
  const normalizedCode = code.trim();

  await ensureDefaultLeaveTypes();

  const leaveType = await getLeaveTypeByCode(normalizedCode, database);
  if (!leaveType) {
    throw new Error("Selected leave type was not found.");
  }

  return leaveType;
}

function getLeaveImpactRange(record: {
  dateFiled: string;
  leaveStartDate: string | null;
  leaveEndDate: string | null;
}) {
  const startDate = record.leaveStartDate ?? record.dateFiled;
  const endDate = record.leaveEndDate ?? record.leaveStartDate ?? record.dateFiled;

  return {
    startDate,
    endDate,
  };
}

function buildApprovedLeaveImpact(
  record: {
    employeeId: string;
    dateFiled: string;
    leaveStartDate: string | null;
    leaveEndDate: string | null;
    leaveStatus: LeaveStatus;
  },
  isPaid: boolean
) {
  if (record.leaveStatus !== "Approved") {
    return null;
  }

  return {
    employeeId: record.employeeId,
    ...getLeaveImpactRange(record),
    isPaid,
  } satisfies LeavePayrollImpact;
}

function serializeLeaveImpact(impact: LeavePayrollImpact) {
  return [
    impact.employeeId,
    impact.startDate,
    impact.endDate,
    impact.isPaid ? "paid" : "unpaid",
  ].join("|");
}

function collectChangedLeavePayrollImpacts(
  ...impacts: Array<LeavePayrollImpact | null | undefined>
) {
  return [
    ...new Map(
      impacts
        .filter((impact): impact is LeavePayrollImpact => Boolean(impact))
        .map((impact) => [serializeLeaveImpact(impact), impact])
    ).values(),
  ];
}

async function markAffectedLeaveRunsStale(args: {
  tx: DbClient;
  impacts: LeavePayrollImpact[];
  actorUserId: string;
}) {
  if (args.impacts.length === 0) {
    return 0;
  }

  const staleRunIds = new Set<string>();

  for (const impact of args.impacts) {
    const affectedRuns = await args.tx
      .select({
        id: payrollRuns.id,
        status: payrollRuns.status,
        periodCode: payrollPeriods.code,
      })
      .from(payrollRuns)
      .innerJoin(payrollPeriods, eq(payrollRuns.payrollPeriodId, payrollPeriods.id))
      .innerJoin(payrollRunEmployees, eq(payrollRunEmployees.payrollRunId, payrollRuns.id))
      .where(
        and(
          eq(payrollRunEmployees.employeeId, impact.employeeId),
          lte(payrollPeriods.startDate, impact.endDate),
          gte(payrollPeriods.endDate, impact.startDate)
        )
      )
      .orderBy(desc(payrollRuns.createdAt));

    const blockingRun = affectedRuns.find(
      (run: { status: string }) => run.status === "Approved" || run.status === "Posted"
    );

    if (blockingRun) {
      throw new Error(
        `Leave changes are blocked because payroll period ${blockingRun.periodCode} already has a ${blockingRun.status} run for this employee.`
      );
    }

    for (const run of affectedRuns) {
      if (run.status === "Draft" || run.status === "Reviewed") {
        staleRunIds.add(run.id);
      }
    }
  }

  if (staleRunIds.size === 0) {
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
    .where(inArray(payrollRuns.id, [...staleRunIds]));

  for (const runId of staleRunIds) {
    await recordPayrollRunEvent({
      payrollRunId: runId,
      actorUserId: args.actorUserId,
      eventType: "MarkedStale",
      toStatus: "Stale",
      database: args.tx,
      notes: "Marked stale because approved leave changed.",
    });
  }

  return staleRunIds.size;
}

async function markPayrollPeriodRunStale(args: {
  tx: DbClient;
  payrollPeriodId: string;
  actorUserId: string;
  notes: string;
}) {
  const latestRun = await args.tx.query.payrollRuns.findFirst({
    where: eq(payrollRuns.payrollPeriodId, args.payrollPeriodId),
    orderBy: [desc(payrollRuns.createdAt)],
  });

  if (!latestRun || latestRun.status === "Stale" || latestRun.status === "Void") {
    return;
  }

  if (latestRun.status === "Approved" || latestRun.status === "Posted") {
    throw new Error(
      `Payroll changes are blocked because payroll run ${latestRun.id} is already ${latestRun.status}.`
    );
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
    fromStatus: latestRun.status as "Draft" | "Reviewed",
    toStatus: "Stale",
    notes: args.notes,
    database: args.tx,
  });
}

async function loadLeaveRecordForMutation(tx: DbClient, id: number) {
  return tx.query.employeesLeaveRecords.findFirst({
    where: eq(employeesLeaveRecords.id, id),
    with: {
      leaveTypeLookup: true,
    },
  }) as Promise<LeaveRecordForPayrollImpact | null>;
}

async function recordLeaveEvent(args: {
  tx: DbClient;
  leaveRecordId: number;
  actorUserId: string;
  action: typeof employeeLeaveApprovalEvents.$inferInsert["action"];
  oldStatus?: LeaveStatus | null;
  newStatus?: LeaveStatus | null;
  decisionNote?: string | null;
  overrideReason?: string | null;
  balanceBefore?: number | null;
  projectedBalance?: number | null;
}) {
  await args.tx.insert(employeeLeaveApprovalEvents).values({
    leaveRecordId: args.leaveRecordId,
    actorUserId: args.actorUserId,
    action: args.action,
    oldStatus: args.oldStatus ?? null,
    newStatus: args.newStatus ?? null,
    decisionNote: args.decisionNote?.trim() || null,
    overrideReason: args.overrideReason?.trim() || null,
    balanceBefore:
      args.balanceBefore == null ? null : money(args.balanceBefore),
    projectedBalance:
      args.projectedBalance == null ? null : money(args.projectedBalance),
  });
}

function groupRequestedDaysByYear(
  details: Awaited<ReturnType<typeof replaceLeaveRecordDayDetails>>["details"]
) {
  const byYear = new Map<number, number>();

  for (const detail of details) {
    if (detail.quantity <= 0) continue;
    const year = getYear(detail.leaveDate);
    byYear.set(year, (byYear.get(year) ?? 0) + detail.quantity);
  }

  return byYear;
}

async function recomputeRecordDays(args: {
  tx: DbClient;
  record: {
    id: number;
    employeeId: string;
    leaveStartDate: string | null;
    leaveEndDate: string | null;
    dateFiled: string;
    leaveTypeId: number | null;
  };
  dayPart?: LeaveDayPart | null;
}) {
  const dayPart =
    args.dayPart ?? (await getPrimaryLeaveDayPart(args.record.id, args.tx));

  return replaceLeaveRecordDayDetails({
    leaveRecordId: args.record.id,
    employeeId: args.record.employeeId,
    startDate: args.record.leaveStartDate ?? args.record.dateFiled,
    endDate: args.record.leaveEndDate,
    leaveTypeId: args.record.leaveTypeId,
    dayPart,
    database: args.tx,
  });
}

function getLeaveRecordDayPartSql() {
  return sql<LeaveDayPart>`COALESCE((
    SELECT ${employeeLeaveRecordDays.dayPart}
    FROM ${employeeLeaveRecordDays}
    WHERE ${employeeLeaveRecordDays.leaveRecordId} = ${employeesLeaveRecords.id}
    ORDER BY ${employeeLeaveRecordDays.leaveDate} ASC
    LIMIT 1
  ), 'FullDay')`;
}

async function approvePendingLeaveRecordTx(args: {
  tx: DbClient;
  actorUserId: string;
  leaveId: number;
  decisionNote?: string | null;
  overrideInsufficientBalance?: boolean;
  overrideReason?: string | null;
}) {
  await args.tx.execute(
    sql`select id from employees_leave_records where id = ${args.leaveId} for update`
  );

  const existingRecord = await loadLeaveRecordForMutation(args.tx, args.leaveId);
  if (!existingRecord) {
    throw new Error("Leave record not found.");
  }

  if (existingRecord.leaveStatus !== "Pending") {
    throw new Error("Only pending leave requests can be approved.");
  }

  const leaveType =
    existingRecord.leaveTypeLookup ??
    (await requireExistingLeaveType(existingRecord.leaveType, args.tx));
  const recomputed = await recomputeRecordDays({
    tx: args.tx,
    record: existingRecord,
  });
  const requestedByYear = groupRequestedDaysByYear(recomputed.details);
  let firstBalanceBefore: number | null = null;
  let firstProjectedBalance: number | null = null;

  if (leaveType.requiresBalance) {
    for (const [year, requestedDays] of requestedByYear) {
      await lockLeaveBalance({
        employeeId: existingRecord.employeeId,
        leaveTypeId: leaveType.id,
        year,
        database: args.tx,
      });
      const balanceBefore = await getLeaveBalance(
        existingRecord.employeeId,
        leaveType.id,
        year,
        args.tx
      );
      const projectedBalance = balanceBefore - requestedDays;
      firstBalanceBefore ??= balanceBefore;
      firstProjectedBalance ??= projectedBalance;

      if (projectedBalance < -0.0001 && !args.overrideInsufficientBalance) {
        throw new Error(
          `Insufficient ${leaveType.code} balance for ${year}. Available: ${balanceBefore.toFixed(
            2
          )}, requested: ${requestedDays.toFixed(2)}. Use approval override with a reason to continue.`
        );
      }
    }

    if (
      args.overrideInsufficientBalance &&
      firstProjectedBalance != null &&
      firstProjectedBalance < -0.0001 &&
      !args.overrideReason?.trim()
    ) {
      throw new Error("Approval override requires a reason.");
    }
  }

  const beforeImpact = buildApprovedLeaveImpact(existingRecord, leaveType.isPaid);
  const [updatedRecord] = await args.tx
    .update(employeesLeaveRecords)
    .set({
      leaveStatus: "Approved",
      updatedAt: new Date(),
    })
    .where(eq(employeesLeaveRecords.id, existingRecord.id))
    .returning();
  const afterImpact = buildApprovedLeaveImpact(updatedRecord, leaveType.isPaid);

  await syncLeaveLedgerForRecord(updatedRecord.id, args.tx);
  await recordLeaveEvent({
    tx: args.tx,
    leaveRecordId: updatedRecord.id,
    actorUserId: args.actorUserId,
    action: args.overrideInsufficientBalance
      ? "ApprovedWithOverride"
      : "Approved",
    oldStatus: existingRecord.leaveStatus,
    newStatus: updatedRecord.leaveStatus,
    decisionNote: args.decisionNote,
    overrideReason: args.overrideReason,
    balanceBefore: firstBalanceBefore,
    projectedBalance: firstProjectedBalance,
  });
  await markAffectedLeaveRunsStale({
    tx: args.tx,
    impacts:
      beforeImpact &&
      afterImpact &&
      serializeLeaveImpact(beforeImpact) === serializeLeaveImpact(afterImpact)
        ? []
        : collectChangedLeavePayrollImpacts(beforeImpact, afterImpact),
    actorUserId: args.actorUserId,
  });

  return updatedRecord;
}

export async function createLeaveRecord(data: LeaveMutationPayload) {
  try {
    const actor = await requireAdminActor();
    const record = await db.transaction(async (tx) => {
      if (
        data.leaveStatus &&
        data.leaveStatus !== "Pending" &&
        data.leaveStatus !== "Approved"
      ) {
        throw new Error("New leave requests can only be created as Pending or Approved.");
      }

      const leaveType = await requireExistingLeaveType(data.leaveType, tx);
      const leaveEndDate = normalizeLeaveEndDate(data.leaveEndDate);
      const [createdRecord] = await tx
        .insert(employeesLeaveRecords)
        .values({
          employeeId: data.employeeId,
          leaveTypeId: leaveType.id,
          dateFiled: data.dateFiled,
          leaveStartDate: data.leaveStartDate,
          leaveEndDate,
          leaveType: leaveType.code,
          noOfDays: "0.00",
          reason: data.reason,
          leaveStatus: "Pending",
        })
        .returning();

      await replaceLeaveRecordDayDetails({
        leaveRecordId: createdRecord.id,
        employeeId: createdRecord.employeeId,
        startDate: createdRecord.leaveStartDate ?? createdRecord.dateFiled,
        endDate: createdRecord.leaveEndDate,
        leaveTypeId: leaveType.id,
        dayPart: data.dayPart ?? "FullDay",
        database: tx,
      });

      await recordLeaveEvent({
        tx,
        leaveRecordId: createdRecord.id,
        actorUserId: actor.userId,
        action: "Submitted",
        oldStatus: null,
        newStatus: "Pending",
      });

      if (data.leaveStatus === "Approved") {
        await approvePendingLeaveRecordTx({
          tx,
          actorUserId: actor.userId,
          leaveId: createdRecord.id,
          decisionNote: data.approvalDecisionNote,
          overrideInsufficientBalance: data.overrideInsufficientBalance,
          overrideReason: data.overrideReason,
        });
      }

      return tx.query.employeesLeaveRecords.findFirst({
        where: eq(employeesLeaveRecords.id, createdRecord.id),
      });
    });

    revalidatePath("/leaves/form");
    revalidatePath("/employeeLeaves");
    revalidatePath("/payroll");
    return { data: record, error: null };
  } catch (error) {
    console.error("Error creating leave record:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to create leave record",
    };
  }
}

export async function getLeaveRecordsByYear(year: number) {
  try {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const records = await db
      .select({
        id: employeesLeaveRecords.id,
        employeeId: employeesLeaveRecords.employeeId,
        dateFiled: employeesLeaveRecords.dateFiled,
        leaveStartDate: employeesLeaveRecords.leaveStartDate,
        leaveEndDate: employeesLeaveRecords.leaveEndDate,
        leaveType: employeesLeaveRecords.leaveType,
        leaveTypeName: leaveTypes.name,
        noOfDays: employeesLeaveRecords.noOfDays,
        dayPart: getLeaveRecordDayPartSql(),
        reason: employeesLeaveRecords.reason,
        leaveStatus: employeesLeaveRecords.leaveStatus,
        employeeNo: employees.employeeNo,
        employeeType: employees.employeeType,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employeesLeaveRecords)
      .leftJoin(employees, eq(employeesLeaveRecords.employeeId, employees.id))
      .leftJoin(leaveTypes, eq(employeesLeaveRecords.leaveTypeId, leaveTypes.id))
      .where(
        and(
          gte(employeesLeaveRecords.dateFiled, startDate),
          lte(employeesLeaveRecords.dateFiled, endDate)
        )
      )
      .orderBy(employeesLeaveRecords.dateFiled);

    const normalized = records.map((record) => ({
      ...record,
      leaveStartDate: record.leaveStartDate ?? record.dateFiled,
      leaveEndDate: record.leaveEndDate ?? null,
      noOfDays: Number(record.noOfDays),
      reason: record.reason ?? "",
    }));

    return {
      data: normalized,
      error: null,
    };
  } catch (error) {
    console.error("Error fetching leave records:", error);
    return { data: null, error: "Failed to fetch leave records" };
  }
}

export async function updateLeaveRecord(data: LeaveMutationPayload & { id: number }) {
  try {
    const actor = await requireAdminActor();
    const record = await db.transaction(async (tx) => {
      const existingRecord = await loadLeaveRecordForMutation(tx, data.id);

      if (!existingRecord) {
        throw new Error("Leave record not found.");
      }

      if (existingRecord.leaveStatus !== "Pending") {
        throw new Error("Only pending leave requests can be edited. Void approved leaves first.");
      }

      const leaveType = await requireExistingLeaveType(data.leaveType, tx);
      const leaveEndDate = normalizeLeaveEndDate(data.leaveEndDate);
      const [updatedRecord] = await tx
        .update(employeesLeaveRecords)
        .set({
          employeeId: data.employeeId,
          leaveTypeId: leaveType.id,
          dateFiled: data.dateFiled,
          leaveStartDate: data.leaveStartDate,
          leaveEndDate,
          leaveType: leaveType.code,
          reason: data.reason,
          leaveStatus: "Pending",
        })
        .where(eq(employeesLeaveRecords.id, data.id))
        .returning();

      await replaceLeaveRecordDayDetails({
        leaveRecordId: updatedRecord.id,
        employeeId: updatedRecord.employeeId,
        startDate: updatedRecord.leaveStartDate ?? updatedRecord.dateFiled,
        endDate: updatedRecord.leaveEndDate,
        leaveTypeId: leaveType.id,
        dayPart: data.dayPart ?? "FullDay",
        database: tx,
      });

      await recordLeaveEvent({
        tx,
        leaveRecordId: updatedRecord.id,
        actorUserId: actor.userId,
        action: "Updated",
        oldStatus: existingRecord.leaveStatus,
        newStatus: updatedRecord.leaveStatus,
      });

      return tx.query.employeesLeaveRecords.findFirst({
        where: eq(employeesLeaveRecords.id, updatedRecord.id),
      });
    });

    revalidatePath("/leaves/form");
    return { data: record, error: null };
  } catch (error) {
    console.error("Error updating leave record:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to update leave record",
    };
  }
}

export async function approveLeaveRequest(args: {
  leaveId: number;
  decisionNote?: string | null;
  overrideInsufficientBalance?: boolean;
  overrideReason?: string | null;
}) {
  try {
    const actor = await requireAdminActor();
    const record = await db.transaction(async (tx) => {
      return approvePendingLeaveRecordTx({
        tx,
        actorUserId: actor.userId,
        leaveId: args.leaveId,
        decisionNote: args.decisionNote,
        overrideInsufficientBalance: args.overrideInsufficientBalance,
        overrideReason: args.overrideReason,
      });
    });

    revalidatePath("/leaves/form");
    revalidatePath("/employeeLeaves");
    revalidatePath("/payroll");
    return { data: record, error: null };
  } catch (error) {
    console.error("Error approving leave request:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to approve leave request",
    };
  }
}

export async function denyLeaveRequest(args: {
  leaveId: number;
  decisionNote?: string | null;
}) {
  try {
    const actor = await requireAdminActor();
    const record = await db.transaction(async (tx) => {
      const existingRecord = await loadLeaveRecordForMutation(tx, args.leaveId);
      if (!existingRecord) {
        throw new Error("Leave record not found.");
      }

      if (existingRecord.leaveStatus !== "Pending") {
        throw new Error("Only pending leave requests can be denied.");
      }

      const [updatedRecord] = await tx
        .update(employeesLeaveRecords)
        .set({ leaveStatus: "Denied", updatedAt: new Date() })
        .where(eq(employeesLeaveRecords.id, args.leaveId))
        .returning();

      await syncLeaveLedgerForRecord(updatedRecord.id, tx);
      await recordLeaveEvent({
        tx,
        leaveRecordId: updatedRecord.id,
        actorUserId: actor.userId,
        action: "Denied",
        oldStatus: existingRecord.leaveStatus,
        newStatus: updatedRecord.leaveStatus,
        decisionNote: args.decisionNote,
      });

      return updatedRecord;
    });

    revalidatePath("/leaves/form");
    return { data: record, error: null };
  } catch (error) {
    console.error("Error denying leave request:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to deny leave request",
    };
  }
}

export async function cancelLeaveRequest(args: {
  leaveId: number;
  reason?: string | null;
}) {
  try {
    const actor = await requireAdminActor();
    const record = await db.transaction(async (tx) => {
      const existingRecord = await loadLeaveRecordForMutation(tx, args.leaveId);
      if (!existingRecord) {
        throw new Error("Leave record not found.");
      }

      if (existingRecord.leaveStatus !== "Pending") {
        throw new Error("Only pending leave requests can be cancelled.");
      }

      const [updatedRecord] = await tx
        .update(employeesLeaveRecords)
        .set({ leaveStatus: "Cancelled", updatedAt: new Date() })
        .where(eq(employeesLeaveRecords.id, args.leaveId))
        .returning();

      await recordLeaveEvent({
        tx,
        leaveRecordId: updatedRecord.id,
        actorUserId: actor.userId,
        action: "Cancelled",
        oldStatus: existingRecord.leaveStatus,
        newStatus: updatedRecord.leaveStatus,
        decisionNote: args.reason,
      });

      return updatedRecord;
    });

    revalidatePath("/leaves/form");
    revalidatePath("/employeeLeaves");
    return { data: record, error: null };
  } catch (error) {
    console.error("Error cancelling leave request:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to cancel leave request",
    };
  }
}

export async function voidApprovedLeaveRequest(args: {
  leaveId: number;
  reason: string;
}) {
  try {
    const actor = await requireAdminActor();
    const record = await db.transaction(async (tx) => {
      const existingRecord = await loadLeaveRecordForMutation(tx, args.leaveId);
      if (!existingRecord) {
        throw new Error("Leave record not found.");
      }

      if (existingRecord.leaveStatus !== "Approved") {
        throw new Error("Only approved leave requests can be voided.");
      }

      const leaveTypesByCode = await buildLeaveTypeMapByCode(
        [existingRecord.leaveType],
        tx
      );
      const leavePayStatus = resolveLeavePayStatus(existingRecord, leaveTypesByCode);
      const beforeImpact = buildApprovedLeaveImpact(
        existingRecord,
        leavePayStatus.isPaid
      );

      const [updatedRecord] = await tx
        .update(employeesLeaveRecords)
        .set({ leaveStatus: "Voided", updatedAt: new Date() })
        .where(eq(employeesLeaveRecords.id, args.leaveId))
        .returning();

      await syncLeaveLedgerForRecord(updatedRecord.id, tx);
      await recordLeaveEvent({
        tx,
        leaveRecordId: updatedRecord.id,
        actorUserId: actor.userId,
        action: "Voided",
        oldStatus: existingRecord.leaveStatus,
        newStatus: updatedRecord.leaveStatus,
        decisionNote: args.reason,
      });
      await markAffectedLeaveRunsStale({
        tx,
        impacts: collectChangedLeavePayrollImpacts(beforeImpact),
        actorUserId: actor.userId,
      });

      return updatedRecord;
    });

    revalidatePath("/leaves/form");
    revalidatePath("/employeeLeaves");
    revalidatePath("/payroll");
    return { data: record, error: null };
  } catch (error) {
    console.error("Error voiding leave request:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to void leave request",
    };
  }
}

export async function updateLeaveRecordStatus(
  id: number,
  leaveStatus: LeaveStatus
) {
  if (leaveStatus === "Approved") {
    return approveLeaveRequest({ leaveId: id });
  }

  if (leaveStatus === "Denied") {
    return denyLeaveRequest({ leaveId: id });
  }

  if (leaveStatus === "Cancelled") {
    return cancelLeaveRequest({ leaveId: id });
  }

  if (leaveStatus === "Voided") {
    return voidApprovedLeaveRequest({
      leaveId: id,
      reason: "Voided from status update.",
    });
  }

  return {
    data: null,
    error: "Use the explicit approval, denial, cancellation, or void action.",
  };
}

export async function deleteLeaveRecord(id: number) {
  try {
    await requireAdminActor();
    await db.transaction(async (tx) => {
      const existingRecord = await loadLeaveRecordForMutation(tx, id);

      if (!existingRecord) {
        throw new Error("Leave record not found.");
      }

      if (existingRecord.leaveStatus === "Approved") {
        throw new Error("Approved leave requests must be voided, not deleted.");
      }

      await tx
        .delete(leaveBalanceLedger)
        .where(
          and(
            eq(leaveBalanceLedger.sourceTable, "employees_leave_records"),
            eq(leaveBalanceLedger.sourceId, String(id))
          )
        );
      await tx.delete(employeesLeaveRecords).where(eq(employeesLeaveRecords.id, id));
    });
    revalidatePath("/leaves/form");
    revalidatePath("/payroll");
    return { error: null };
  } catch (error) {
    console.error("Error deleting leave record:", error);
    return {
      error: error instanceof Error ? error.message : "Failed to delete leave record",
    };
  }
}

function getUsageFromSummary(summary: LeaveBalanceSummaryItem[], code: string) {
  return summary.find((item) => item.code === code);
}

export async function getLeaveBalanceSummary(employeeId: string, year: number) {
  try {
    const summary = await getEmployeeLeaveBalanceSummary(employeeId, year);
    return { data: summary, error: null };
  } catch (error) {
    console.error("Error fetching leave balance summary:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to fetch leave balance summary",
    };
  }
}

export async function getEmployeeLeaveUsageByYear(year: number) {
  try {
    const employee = await getEmployeeFromSession();
    if (!employee) {
      return { data: null, error: "Employee record not found" };
    }

    const summary = await getEmployeeLeaveBalanceSummary(employee.id, year);
    const sickLeave = getUsageFromSummary(summary, "SL");
    const vacationLeave = getUsageFromSummary(summary, "VL");

    return {
      data: {
        entitledSickLeave: sickLeave?.entitled ?? 0,
        entitledVacationLeave: vacationLeave?.entitled ?? 0,
        usedSickLeave: sickLeave?.used ?? 0,
        usedVacationLeave: vacationLeave?.used ?? 0,
      } satisfies EmployeeLeaveUsageSummary,
      error: null,
    };
  } catch (error) {
    console.error("Error fetching employee leave usage:", error);
    return { data: null, error: "Failed to fetch leave usage" };
  }
}

export async function getEmployeeServiceSummary() {
  try {
    const employee = await getEmployeeFromSession();
    if (!employee) {
      return { data: null, error: "Employee record not found" };
    }

    const [result, balanceSummary] = await Promise.all([
      db
        .select({
          employeeNo: employees.employeeNo,
          firstName: employees.firstName,
          middleName: employees.middleName,
          lastName: employees.lastName,
          dateHired: employeesGeneralInfo.dateHired,
          department: department.name,
          sickLeave: slvlGroup.defaultSickLeave,
          vacationLeave: slvlGroup.defaultVacationLeave,
        })
        .from(employees)
        .leftJoin(
          employeesGeneralInfo,
          eq(employees.id, employeesGeneralInfo.employeeId)
        )
        .leftJoin(employeesSalary, eq(employees.id, employeesSalary.employeeId))
        .leftJoin(slvlGroup, eq(employeesSalary.slvlGroupId, slvlGroup.id))
        .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
        .where(eq(employees.id, employee.id))
        .limit(1),
      getEmployeeLeaveBalanceSummary(employee.id, new Date().getFullYear()),
    ]);

    const row = result[0];
    if (!row) {
      return { data: null, error: "Employee record not found" };
    }

    const sickLeave = getUsageFromSummary(balanceSummary, "SL");
    const vacationLeave = getUsageFromSummary(balanceSummary, "VL");
    const summary: EmployeeServiceSummary = {
      employeeNo: row.employeeNo,
      fullName: `${row.lastName}, ${row.firstName} ${row.middleName ?? ""}`.trim(),
      dateHired: row.dateHired ?? null,
      department: row.department ?? null,
      sickLeave: sickLeave?.entitled ?? Number(row.sickLeave ?? 0),
      vacationLeave: vacationLeave?.entitled ?? Number(row.vacationLeave ?? 0),
    };

    return { data: summary, error: null };
  } catch (error) {
    console.error("Error fetching employee service summary:", error);
    return { data: null, error: "Failed to fetch employee service summary" };
  }
}

export async function getEmployeeLeaveRecordsByYear(year: number) {
  try {
    const employee = await getEmployeeFromSession();
    if (!employee) {
      return { data: null, error: "Employee record not found" };
    }

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const records = await db
      .select({
        id: employeesLeaveRecords.id,
        employeeId: employeesLeaveRecords.employeeId,
        dateFiled: employeesLeaveRecords.dateFiled,
        leaveStartDate: employeesLeaveRecords.leaveStartDate,
        leaveEndDate: employeesLeaveRecords.leaveEndDate,
        leaveType: employeesLeaveRecords.leaveType,
        leaveTypeName: leaveTypes.name,
        noOfDays: employeesLeaveRecords.noOfDays,
        dayPart: getLeaveRecordDayPartSql(),
        reason: employeesLeaveRecords.reason,
        leaveStatus: employeesLeaveRecords.leaveStatus,
        employeeNo: employees.employeeNo,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employeesLeaveRecords)
      .leftJoin(employees, eq(employeesLeaveRecords.employeeId, employees.id))
      .leftJoin(leaveTypes, eq(employeesLeaveRecords.leaveTypeId, leaveTypes.id))
      .where(
        and(
          eq(employeesLeaveRecords.employeeId, employee.id),
          gte(employeesLeaveRecords.dateFiled, startDate),
          lte(employeesLeaveRecords.dateFiled, endDate)
        )
      )
      .orderBy(employeesLeaveRecords.dateFiled);

    const normalized = records.map((record) => ({
      ...record,
      noOfDays: Number(record.noOfDays),
      reason: record.reason ?? "",
    }));

    return {
      data: normalized,
      error: null,
    };
  } catch (error) {
    console.error("Error fetching employee leave records:", error);
    return { data: null, error: "Failed to fetch leave records" };
  }
}

export async function createEmployeeLeaveRecord(data: Omit<LeaveMutationPayload, "employeeId" | "leaveStatus">) {
  try {
    const employee = await getEmployeeFromSession();
    if (!employee) {
      return { data: null, error: "Employee record not found" };
    }

    const record = await db.transaction(async (tx) => {
      const leaveType = await requireExistingLeaveType(data.leaveType, tx);
      const [createdRecord] = await tx
        .insert(employeesLeaveRecords)
        .values({
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          dateFiled: data.dateFiled,
          leaveStartDate: data.leaveStartDate,
          leaveEndDate: normalizeLeaveEndDate(data.leaveEndDate),
          leaveType: leaveType.code,
          noOfDays: "0.00",
          reason: data.reason,
          leaveStatus: "Pending",
        })
        .returning();

      await replaceLeaveRecordDayDetails({
        leaveRecordId: createdRecord.id,
        employeeId: employee.id,
        startDate: createdRecord.leaveStartDate ?? createdRecord.dateFiled,
        endDate: createdRecord.leaveEndDate,
        leaveTypeId: leaveType.id,
        dayPart: data.dayPart ?? "FullDay",
        database: tx,
      });

      return tx.query.employeesLeaveRecords.findFirst({
        where: eq(employeesLeaveRecords.id, createdRecord.id),
      });
    });

    revalidatePath("/employeeLeaves");
    revalidatePath("/employeeLeaves/form");
    return { data: record, error: null };
  } catch (error) {
    console.error("Error creating employee leave record:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to create leave record",
    };
  }
}

export async function updateEmployeeLeaveRecord(
  data: Omit<LeaveMutationPayload, "employeeId" | "leaveStatus"> & { id: number }
) {
  try {
    const employee = await getEmployeeFromSession();
    if (!employee) {
      return { data: null, error: "Employee record not found" };
    }

    const record = await db.transaction(async (tx) => {
      const leaveType = await requireExistingLeaveType(data.leaveType, tx);
      const [updatedRecord] = await tx
        .update(employeesLeaveRecords)
        .set({
          leaveTypeId: leaveType.id,
          dateFiled: data.dateFiled,
          leaveStartDate: data.leaveStartDate,
          leaveEndDate: normalizeLeaveEndDate(data.leaveEndDate),
          leaveType: leaveType.code,
          reason: data.reason,
          leaveStatus: "Pending",
        })
        .where(
          and(
            eq(employeesLeaveRecords.id, data.id),
            eq(employeesLeaveRecords.employeeId, employee.id),
            eq(employeesLeaveRecords.leaveStatus, "Pending")
          )
        )
        .returning();

      if (!updatedRecord) {
        throw new Error("Only pending requests can be updated.");
      }

      await replaceLeaveRecordDayDetails({
        leaveRecordId: updatedRecord.id,
        employeeId: employee.id,
        startDate: updatedRecord.leaveStartDate ?? updatedRecord.dateFiled,
        endDate: updatedRecord.leaveEndDate,
        leaveTypeId: leaveType.id,
        dayPart: data.dayPart ?? "FullDay",
        database: tx,
      });

      return tx.query.employeesLeaveRecords.findFirst({
        where: eq(employeesLeaveRecords.id, updatedRecord.id),
      });
    });

    revalidatePath("/employeeLeaves");
    revalidatePath("/employeeLeaves/form");
    return { data: record, error: null };
  } catch (error) {
    console.error("Error updating employee leave record:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to update leave record",
    };
  }
}

export async function deleteEmployeeLeaveRecord(id: number) {
  try {
    const employee = await getEmployeeFromSession();
    if (!employee) {
      return { error: "Employee record not found" };
    }

    const cancelled = await db
      .update(employeesLeaveRecords)
      .set({ leaveStatus: "Cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(employeesLeaveRecords.id, id),
          eq(employeesLeaveRecords.employeeId, employee.id),
          eq(employeesLeaveRecords.leaveStatus, "Pending")
        )
      )
      .returning({ id: employeesLeaveRecords.id });

    if (cancelled.length === 0) {
      return { error: "Only pending requests can be cancelled" };
    }

    revalidatePath("/employeeLeaves");
    revalidatePath("/employeeLeaves/form");
    return { error: null };
  } catch (error) {
    console.error("Error cancelling employee leave record:", error);
    return { error: "Failed to cancel leave record" };
  }
}

async function appendEncashmentManualPayrollLine(args: {
  tx: DbClient;
  actorUserId: string;
  employeeId: string;
  payrollPeriodId: string;
  encashmentId: string;
  leaveCode: string;
  quantity: number;
  amount: number;
  rate: number;
  taxable: boolean;
  month13thEligible: boolean;
  accountCodeId?: number | null;
}) {
  const [employee] = await args.tx
    .select({
      id: employees.id,
      employeeType: employees.employeeType,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(employees)
    .where(eq(employees.id, args.employeeId))
    .limit(1);

  if (!employee) {
    throw new Error("Employee not found.");
  }

  const existingEntry = await args.tx.query.manualPayrollEntries.findFirst({
    where: and(
      eq(manualPayrollEntries.payrollPeriodId, args.payrollPeriodId),
      eq(manualPayrollEntries.employeeId, args.employeeId)
    ),
  });
  const taxableAmount = args.taxable ? args.amount : 0;
  const nonTaxableAmount = args.taxable ? 0 : args.amount;
  let entryId = existingEntry?.id ?? null;

  if (existingEntry) {
    await args.tx
      .update(manualPayrollEntries)
      .set({
        grossPay: money(toAmount(existingEntry.grossPay) + args.amount),
        taxablePay: money(toAmount(existingEntry.taxablePay) + taxableAmount),
        nonTaxablePay: money(toAmount(existingEntry.nonTaxablePay) + nonTaxableAmount),
        netPay: money(toAmount(existingEntry.netPay) + args.amount),
        updatedByUserId: args.actorUserId,
        updatedAt: new Date(),
      })
      .where(eq(manualPayrollEntries.id, existingEntry.id));
  } else {
    const [createdEntry] = await args.tx
      .insert(manualPayrollEntries)
      .values({
        payrollPeriodId: args.payrollPeriodId,
        employeeId: args.employeeId,
        employeeNoSnapshot: formatEmployeeCode({
          employeeType: employee.employeeType,
          employeeNo: employee.employeeNo,
        }),
        employeeNameSnapshot: `${employee.lastName}, ${employee.firstName}`.trim(),
        regularPay: "0.00",
        grossPay: money(args.amount),
        taxablePay: money(taxableAmount),
        nonTaxablePay: money(nonTaxableAmount),
        totalDeductions: "0.00",
        employeeContributions: "0.00",
        employerContributions: "0.00",
        netPay: money(args.amount),
        createdByUserId: args.actorUserId,
        updatedByUserId: args.actorUserId,
        remarks: "Created from leave encashment.",
      })
      .returning({ id: manualPayrollEntries.id });
    entryId = createdEntry.id;
  }

  await args.tx.insert(manualPayrollEntryLines).values({
    manualPayrollEntryId: entryId!,
    accountCodeId: args.accountCodeId ?? null,
    lineType: "Earning",
    summaryBucket: "otPaidLeaves",
    code: "LEAVE-ENCASH",
    description: `${args.leaveCode} Leave Encashment`,
    hours: 0,
    minutes: 0,
    amount: money(args.amount),
    taxable: args.taxable,
    month13thEligible: args.month13thEligible,
    nonTaxable: !args.taxable,
    deminimis: false,
    sourceTable: "leave_encashments",
    sourceId: args.encashmentId,
    sortOrder: 9000,
  });

  return entryId!;
}

export async function createLeaveEncashment(data: {
  employeeId: string;
  leaveType: string;
  payrollPeriodId: string;
  quantity: number;
  rate: number;
  decisionNote?: string | null;
}) {
  try {
    const actor = await requireAdminActor();
    const encashment = await db.transaction(async (tx) => {
      const leaveType = await requireExistingLeaveType(data.leaveType, tx);
      const policy = await getLeavePolicyForType(leaveType.id, tx);
      const payrollPeriod = await tx.query.payrollPeriods.findFirst({
        where: eq(payrollPeriods.id, data.payrollPeriodId),
      });

      if (!payrollPeriod) {
        throw new Error("Payroll period not found.");
      }

      if (!policy.encashmentEnabled) {
        throw new Error("Leave encashment is not enabled for this leave type.");
      }

      if (data.quantity <= 0 || data.rate <= 0) {
        throw new Error("Encashment quantity and rate must be greater than zero.");
      }

      const year = getYear(payrollPeriod.startDate);
      await lockLeaveBalance({
        employeeId: data.employeeId,
        leaveTypeId: leaveType.id,
        year,
        database: tx,
      });
      const balanceBefore = await getLeaveBalance(
        data.employeeId,
        leaveType.id,
        year,
        tx
      );
      const projectedBalance = balanceBefore - data.quantity;

      if (projectedBalance < -0.0001) {
        throw new Error(
          `Insufficient ${leaveType.code} balance for encashment. Available: ${balanceBefore.toFixed(
            2
          )}, requested: ${data.quantity.toFixed(2)}.`
        );
      }

      const amount = data.quantity * data.rate;
      const [createdEncashment] = await tx
        .insert(leaveEncashments)
        .values({
          employeeId: data.employeeId,
          leaveTypeId: leaveType.id,
          payrollPeriodId: data.payrollPeriodId,
          quantity: money(data.quantity),
          rate: money(data.rate),
          amount: money(amount),
          status: "Approved",
          taxable: policy.encashmentTaxable,
          month13thEligible: policy.encashmentMonth13thEligible,
          accountCodeId: policy.encashmentAccountCodeId ?? leaveType.accountCodeId,
          requestedByUserId: actor.userId,
          approvedByUserId: actor.userId,
          approvedAt: new Date(),
          decisionNote: data.decisionNote,
          balanceBefore: money(balanceBefore),
          projectedBalance: money(projectedBalance),
        })
        .returning();

      await tx.insert(leaveBalanceLedger).values({
        employeeId: data.employeeId,
        leaveTypeId: leaveType.id,
        entryDate: payrollPeriod.endDate,
        transactionType: "Encashment",
        quantity: money(-data.quantity),
        balanceAfter: money(projectedBalance),
        periodYear: year,
        idempotencyKey: `leave-encashment:${createdEncashment.id}`,
        sourceTable: "leave_encashments",
        sourceId: createdEncashment.id,
        remarks: data.decisionNote ?? null,
      });

      const manualPayrollEntryId = await appendEncashmentManualPayrollLine({
        tx,
        actorUserId: actor.userId,
        employeeId: data.employeeId,
        payrollPeriodId: data.payrollPeriodId,
        encashmentId: createdEncashment.id,
        leaveCode: leaveType.code,
        quantity: data.quantity,
        amount,
        rate: data.rate,
        taxable: policy.encashmentTaxable,
        month13thEligible: policy.encashmentMonth13thEligible,
        accountCodeId: policy.encashmentAccountCodeId ?? leaveType.accountCodeId,
      });

      await tx
        .update(leaveEncashments)
        .set({ manualPayrollEntryId })
        .where(eq(leaveEncashments.id, createdEncashment.id));

      await markPayrollPeriodRunStale({
        tx,
        payrollPeriodId: data.payrollPeriodId,
        actorUserId: actor.userId,
        notes: "Marked stale because leave encashment changed manual payroll.",
      });

      return { ...createdEncashment, manualPayrollEntryId };
    });

    revalidatePath("/payroll");
    revalidatePath("/leaves");
    return { data: encashment, error: null };
  } catch (error) {
    console.error("Error creating leave encashment:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to create leave encashment",
    };
  }
}

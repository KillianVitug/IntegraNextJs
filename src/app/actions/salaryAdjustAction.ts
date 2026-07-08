"use server";

import { revalidatePath } from "next/cache";
import { db, type DbClient } from "@/db";
import { recordPayrollRunEvent } from "@/lib/admin";
import {
  employeeSalaryChangeEvents,
  employeeSalaryChanges,
  employees,
  employeesSalary,
  payrollPeriods,
  payrollRuns,
} from "@/db/schema";
import {
  buildResolvedSalaryByEmployeeId,
  resolveEmployeeSalaryForPeriod,
  salaryRecordToSnapshot,
} from "@/lib/payroll/salaryResolver";
import {
  cancelSalaryChangeSchema,
  createSalaryChangeSchema,
  makeBaseSalarySchema,
  resolvedSalaryReadSchema,
  salaryChangePeriodLookupSchema,
  salaryChangeFilterSchema,
  salaryChangeHistoryReadSchema,
  type SalaryChangeFilter,
  type SalaryChangeMode,
  type SalarySnapshot,
  type SalarySnapshotNullable,
} from "@/zod-schemas/salaryChange";
import { requireAdminActor } from "@/lib/admin";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

type PayrollPeriodSummary = Pick<
  typeof payrollPeriods.$inferSelect,
  "id" | "code" | "payrollTerms" | "year" | "startDate" | "endDate"
>;

type PayrollRunStatusSummary = {
  id: string;
  status: string;
  periodCode: string;
};
type PayrollRunStaleCandidate = Pick<PayrollRunStatusSummary, "id" | "status">;

function normalizeDecimalValue(value: string, maxDecimalPlaces: number) {
  const normalized = value.replace(/,/g, "").trim();
  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue)) {
    throw new Error("Invalid salary value.");
  }

  if ((normalized.split(".")[1]?.length ?? 0) > maxDecimalPlaces) {
    throw new Error(`Expected at most ${maxDecimalPlaces} decimal places.`);
  }

  return normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
}

function normalizeMoneyValue(value: string) {
  return normalizeDecimalValue(value, 2);
}

function normalizeRateValue(value: string) {
  return normalizeDecimalValue(value, 4);
}

function normalizeSnapshot(snapshot: SalarySnapshot): SalarySnapshot {
  return {
    dailyRate: normalizeRateValue(snapshot.dailyRate),
    monthlyRate: normalizeRateValue(snapshot.monthlyRate),
    monthlyAllowance: normalizeMoneyValue(snapshot.monthlyAllowance),
    dailyAllowance: normalizeMoneyValue(snapshot.dailyAllowance),
    cola: normalizeMoneyValue(snapshot.cola),
    rateDivisor: normalizeMoneyValue(snapshot.rateDivisor),
    billingRate: normalizeMoneyValue(snapshot.billingRate),
  };
}

function nullableSnapshotToNormalized(snapshot: SalarySnapshotNullable): SalarySnapshotNullable {
  return {
    dailyRate: snapshot.dailyRate == null ? null : normalizeRateValue(snapshot.dailyRate),
    monthlyRate:
      snapshot.monthlyRate == null ? null : normalizeRateValue(snapshot.monthlyRate),
    monthlyAllowance:
      snapshot.monthlyAllowance == null
        ? null
        : normalizeMoneyValue(snapshot.monthlyAllowance),
    dailyAllowance:
      snapshot.dailyAllowance == null ? null : normalizeMoneyValue(snapshot.dailyAllowance),
    cola: snapshot.cola == null ? null : normalizeMoneyValue(snapshot.cola),
    rateDivisor:
      snapshot.rateDivisor == null ? null : normalizeMoneyValue(snapshot.rateDivisor),
    billingRate:
      snapshot.billingRate == null ? null : normalizeMoneyValue(snapshot.billingRate),
  };
}

function snapshotsEqual(left: SalarySnapshot, right: SalarySnapshot) {
  return (
    left.dailyRate === right.dailyRate &&
    left.monthlyRate === right.monthlyRate &&
    left.monthlyAllowance === right.monthlyAllowance &&
    left.dailyAllowance === right.dailyAllowance &&
    left.cola === right.cola &&
    left.rateDivisor === right.rateDivisor &&
    left.billingRate === right.billingRate
  );
}

function buildBaseSalaryUpdate(
  change: Pick<
    typeof employeeSalaryChanges.$inferSelect,
    | "afterDailyRate"
    | "afterMonthlyRate"
    | "afterMonthlyAllowance"
    | "afterDailyAllowance"
    | "afterCola"
    | "afterRateDivisor"
    | "afterBillingRate"
  >
) {
  const salaryUpdate: Partial<typeof employeesSalary.$inferInsert> = {};

  if (change.afterDailyRate != null) {
    salaryUpdate.dailyRate = normalizeRateValue(change.afterDailyRate);
  }
  if (change.afterMonthlyRate != null) {
    salaryUpdate.monthlyRate = normalizeRateValue(change.afterMonthlyRate);
  }
  if (change.afterMonthlyAllowance != null) {
    salaryUpdate.monthlyAllowance = normalizeMoneyValue(change.afterMonthlyAllowance);
  }
  if (change.afterDailyAllowance != null) {
    salaryUpdate.dailyAllowance = normalizeMoneyValue(change.afterDailyAllowance);
  }
  if (change.afterCola != null) {
    salaryUpdate.cola = normalizeMoneyValue(change.afterCola);
  }
  if (change.afterRateDivisor != null) {
    salaryUpdate.rateDivisor = normalizeMoneyValue(change.afterRateDivisor);
  }
  if (change.afterBillingRate != null) {
    salaryUpdate.billingRate = normalizeMoneyValue(change.afterBillingRate);
  }

  return salaryUpdate;
}

function buildFullName(args: {
  firstName: string;
  lastName: string;
  middleName?: string | null;
}) {
  return `${args.lastName}, ${args.firstName}${args.middleName ? ` ${args.middleName}` : ""}`.trim();
}

async function requireActorUserId() {
  const actor = await requireAdminActor();
  return actor.userId;
}

async function listAffectedPeriods(
  tx: DbClient,
  payrollPeriodId: string,
  mode: SalaryChangeMode,
  endPayrollPeriodId?: string | null
): Promise<PayrollPeriodSummary[]> {
  const selectedPeriod = await tx.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, payrollPeriodId),
  });

  if (!selectedPeriod) {
    throw new Error("Payroll period not found.");
  }

  if (mode === "OnePeriodOverride") {
    return [selectedPeriod];
  }

  if (mode === "MultiPeriodOverride") {
    if (!endPayrollPeriodId) {
      throw new Error("To Payroll Period is required.");
    }

    const endPeriod = await tx.query.payrollPeriods.findFirst({
      where: eq(payrollPeriods.id, endPayrollPeriodId),
    });

    if (!endPeriod) {
      throw new Error("To Payroll Period not found.");
    }

    if (
      endPeriod.payrollTerms !== selectedPeriod.payrollTerms ||
      endPeriod.year !== selectedPeriod.year
    ) {
      throw new Error("To Payroll Period must be in the same payroll terms and year.");
    }

    if (endPeriod.startDate <= selectedPeriod.startDate) {
      throw new Error("To Payroll Period must be later than the From period.");
    }

    return tx
      .select({
        id: payrollPeriods.id,
        code: payrollPeriods.code,
        payrollTerms: payrollPeriods.payrollTerms,
        year: payrollPeriods.year,
        startDate: payrollPeriods.startDate,
        endDate: payrollPeriods.endDate,
      })
      .from(payrollPeriods)
      .where(
        and(
          eq(payrollPeriods.payrollTerms, selectedPeriod.payrollTerms),
          eq(payrollPeriods.year, selectedPeriod.year),
          gte(payrollPeriods.startDate, selectedPeriod.startDate),
          lte(payrollPeriods.startDate, endPeriod.startDate)
        )
      )
      .orderBy(payrollPeriods.startDate);
  }

  return tx
    .select({
      id: payrollPeriods.id,
      code: payrollPeriods.code,
      payrollTerms: payrollPeriods.payrollTerms,
      year: payrollPeriods.year,
      startDate: payrollPeriods.startDate,
      endDate: payrollPeriods.endDate,
    })
    .from(payrollPeriods)
    .where(
      and(
        eq(payrollPeriods.payrollTerms, selectedPeriod.payrollTerms),
        gte(payrollPeriods.startDate, selectedPeriod.startDate)
      )
    )
    .orderBy(payrollPeriods.startDate);
}

async function markAffectedRunsStale(
  tx: DbClient,
  affectedPeriods: PayrollPeriodSummary[],
  actorUserId: string
) {
  const affectedPeriodIds = affectedPeriods.map((period) => period.id);
  if (affectedPeriodIds.length === 0) return;

  const affectedRuns = await tx
    .select({
      id: payrollRuns.id,
      status: payrollRuns.status,
      periodCode: payrollPeriods.code,
    })
    .from(payrollRuns)
    .innerJoin(payrollPeriods, eq(payrollRuns.payrollPeriodId, payrollPeriods.id))
    .where(inArray(payrollRuns.payrollPeriodId, affectedPeriodIds))
    .orderBy(desc(payrollRuns.createdAt));

  const blockingRun = affectedRuns.find(
    (run: PayrollRunStatusSummary) => run.status === "Posted"
  );

  if (blockingRun) {
    throw new Error(
      `Salary changes are blocked because payroll period ${blockingRun.periodCode} already has a ${blockingRun.status} run.`
    );
  }

  const staleRunIds = affectedRuns
    .filter(
      (run: PayrollRunStaleCandidate) =>
        run.status === "Draft" ||
        run.status === "Reviewed" ||
        run.status === "Approved"
    )
    .map((run: PayrollRunStaleCandidate) => run.id);

  if (staleRunIds.length === 0) return;

  await tx
    .update(payrollRuns)
    .set({
      status: "Stale",
      reviewedAt: null,
      reviewedByUserId: null,
      approvedAt: null,
      approvedByUserId: null,
      updatedAt: new Date(),
    })
    .where(inArray(payrollRuns.id, staleRunIds));

  for (const runId of staleRunIds) {
    await recordPayrollRunEvent({
      payrollRunId: runId,
      actorUserId,
      eventType: "MarkedStale",
      toStatus: "Stale",
      database: tx,
      notes: "Marked stale because salary setup changed.",
    });
  }
}

async function markAffectedRunsStaleForBaseSalary(
  tx: DbClient,
  affectedPeriods: PayrollPeriodSummary[],
  actorUserId: string
) {
  const affectedPeriodIds = affectedPeriods.map((period) => period.id);
  if (affectedPeriodIds.length === 0) return;

  const affectedRuns = await tx
    .select({
      id: payrollRuns.id,
      status: payrollRuns.status,
    })
    .from(payrollRuns)
    .where(inArray(payrollRuns.payrollPeriodId, affectedPeriodIds))
    .orderBy(desc(payrollRuns.createdAt));

  const staleRunIds = affectedRuns
    .filter(
      (run: PayrollRunStaleCandidate) =>
        run.status === "Draft" ||
        run.status === "Reviewed" ||
        run.status === "Approved"
    )
    .map((run: PayrollRunStaleCandidate) => run.id);

  if (staleRunIds.length === 0) return;

  await tx
    .update(payrollRuns)
    .set({
      status: "Stale",
      reviewedAt: null,
      reviewedByUserId: null,
      approvedAt: null,
      approvedByUserId: null,
      updatedAt: new Date(),
    })
    .where(inArray(payrollRuns.id, staleRunIds));

  for (const runId of staleRunIds) {
    await recordPayrollRunEvent({
      payrollRunId: runId,
      actorUserId,
      eventType: "MarkedStale",
      toStatus: "Stale",
      database: tx,
      notes: "Marked stale because salary adjustment was made base salary.",
    });
  }
}

async function lockSalaryContext(
  tx: DbClient,
  employeeId: string,
  payrollPeriodId: string,
  mode: SalaryChangeMode
) {
  await tx.execute(
    sql`select id from employees_salary where employee_id = ${employeeId} for update`
  );
  await tx.execute(
    sql`
      select id
      from employee_salary_changes
      where employee_id = ${employeeId}
        and status = 'Active'
        and (
          (payroll_period_id = ${payrollPeriodId} and mode = ${mode})
          or mode = 'ForwardEffective'
          or mode = 'MultiPeriodOverride'
        )
      for update
    `
  );
}

async function listOverlappingActiveMultiPeriodChanges(
  tx: DbClient,
  employeeId: string,
  startPeriod: PayrollPeriodSummary,
  endPeriod: PayrollPeriodSummary
) {
  const rangeStartPeriod = alias(payrollPeriods, "multi_range_start_period");
  const rangeEndPeriod = alias(payrollPeriods, "multi_range_end_period");

  return tx
    .select({ id: employeeSalaryChanges.id })
    .from(employeeSalaryChanges)
    .innerJoin(
      rangeStartPeriod,
      eq(employeeSalaryChanges.payrollPeriodId, rangeStartPeriod.id)
    )
    .innerJoin(
      rangeEndPeriod,
      eq(employeeSalaryChanges.endPayrollPeriodId, rangeEndPeriod.id)
    )
    .where(
      and(
        eq(employeeSalaryChanges.employeeId, employeeId),
        eq(employeeSalaryChanges.mode, "MultiPeriodOverride"),
        eq(employeeSalaryChanges.status, "Active"),
        lte(rangeStartPeriod.startDate, endPeriod.startDate),
        gte(rangeEndPeriod.startDate, startPeriod.startDate)
      )
    );
}

async function getLatestRunStatus(payrollPeriodId: string) {
  const latestRun = await db.query.payrollRuns.findFirst({
    where: and(
      eq(payrollRuns.payrollPeriodId, payrollPeriodId),
      sql`${payrollRuns.status} <> 'Void'`
    ),
    orderBy: [desc(payrollRuns.createdAt)],
  });

  return latestRun?.status ?? null;
}

function historyRowToReadModel(row: {
  id: number;
  employeeId: string;
  payrollPeriodId: string;
  endPayrollPeriodId: string | null;
  payrollCode: string;
  periodStartDate: string;
  periodEndDate: string;
  endPayrollCode: string | null;
  endPeriodStartDate: string | null;
  endPeriodEndDate: string | null;
  mode: SalaryChangeMode;
  status: "Active" | "Superseded" | "Canceled" | "AppliedPermanent";
  reason: string;
  notes: string | null;
  createdByUserId: string;
  createdAt: Date;
  supersededAt: Date | null;
  canceledAt: Date | null;
  appliedPermanentAt: Date | null;
  employeeNo: string;
  employeeType: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  before: SalarySnapshotNullable;
  after: SalarySnapshotNullable;
}) {
  return salaryChangeHistoryReadSchema.parse({
    id: row.id,
    employeeId: row.employeeId,
    employeeNo: row.employeeNo,
    employeeType: row.employeeType,
    fullName: buildFullName({
      firstName: row.firstName,
      lastName: row.lastName,
      middleName: row.middleName,
    }),
    payrollPeriodId: row.payrollPeriodId,
    endPayrollPeriodId: row.endPayrollPeriodId,
    payrollCode: row.payrollCode,
    periodStartDate: row.periodStartDate,
    periodEndDate: row.periodEndDate,
    endPayrollCode: row.endPayrollCode,
    endPeriodStartDate: row.endPeriodStartDate,
    endPeriodEndDate: row.endPeriodEndDate,
    mode: row.mode,
    status: row.status,
    reason: row.reason,
    notes: row.notes,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    supersededAt: row.supersededAt,
    canceledAt: row.canceledAt,
    appliedPermanentAt: row.appliedPermanentAt,
    before: nullableSnapshotToNormalized(row.before),
    after: nullableSnapshotToNormalized(row.after),
  });
}

export async function createSalaryChange(input: unknown): Promise<{ changeId: number; affectedPeriodCount: number }> {
  const actorUserId = await requireActorUserId();
  const payload = createSalaryChangeSchema.parse(input);
  const afterSnapshot = normalizeSnapshot({
    dailyRate: payload.dailyRate,
    monthlyRate: payload.monthlyRate,
    monthlyAllowance: payload.monthlyAllowance,
    dailyAllowance: payload.dailyAllowance,
    cola: payload.cola,
    rateDivisor: payload.rateDivisor,
    billingRate: payload.billingRate,
  });

  const result = await db.transaction(async (tx) => {
    const affectedPeriods = await listAffectedPeriods(
      tx,
      payload.payrollPeriodId,
      payload.mode,
      payload.endPayrollPeriodId
    );
    await lockSalaryContext(tx, payload.employeeId, payload.payrollPeriodId, payload.mode);
    await markAffectedRunsStale(tx, affectedPeriods, actorUserId);

    const resolvedBefore = await resolveEmployeeSalaryForPeriod(
      payload.employeeId,
      payload.payrollPeriodId,
      tx
    );
    const beforeSnapshot = normalizeSnapshot(salaryRecordToSnapshot(resolvedBefore.salary));

    if (snapshotsEqual(beforeSnapshot, afterSnapshot)) {
      throw new Error("No salary values changed.");
    }

    const activeSameMode =
      payload.mode === "MultiPeriodOverride"
        ? await listOverlappingActiveMultiPeriodChanges(
            tx,
            payload.employeeId,
            affectedPeriods[0],
            affectedPeriods[affectedPeriods.length - 1]
          )
        : await tx
            .select({ id: employeeSalaryChanges.id })
            .from(employeeSalaryChanges)
            .where(
              and(
                eq(employeeSalaryChanges.employeeId, payload.employeeId),
                eq(employeeSalaryChanges.payrollPeriodId, payload.payrollPeriodId),
                eq(employeeSalaryChanges.mode, payload.mode),
                eq(employeeSalaryChanges.status, "Active")
              )
            );

    const [createdChange] = await tx
      .insert(employeeSalaryChanges)
      .values({
        employeeId: payload.employeeId,
        payrollPeriodId: payload.payrollPeriodId,
        endPayrollPeriodId:
          payload.mode === "MultiPeriodOverride"
            ? payload.endPayrollPeriodId
            : null,
        mode: payload.mode,
        status: "Active",
        reason: payload.reason,
        notes: payload.notes ?? null,
        createdByUserId: actorUserId,
        beforeDailyRate: beforeSnapshot.dailyRate,
        beforeMonthlyRate: beforeSnapshot.monthlyRate,
        beforeMonthlyAllowance: beforeSnapshot.monthlyAllowance,
        beforeDailyAllowance: beforeSnapshot.dailyAllowance,
        beforeCola: beforeSnapshot.cola,
        beforeRateDivisor: beforeSnapshot.rateDivisor,
        beforeBillingRate: beforeSnapshot.billingRate,
        afterDailyRate: afterSnapshot.dailyRate,
        afterMonthlyRate: afterSnapshot.monthlyRate,
        afterMonthlyAllowance: afterSnapshot.monthlyAllowance,
        afterDailyAllowance: afterSnapshot.dailyAllowance,
        afterCola: afterSnapshot.cola,
        afterRateDivisor: afterSnapshot.rateDivisor,
        afterBillingRate: afterSnapshot.billingRate,
      })
      .returning();

    await tx.insert(employeeSalaryChangeEvents).values({
      changeId: createdChange.id,
      eventType: "Created",
      actorUserId,
      notes: payload.reason,
    });

    if (activeSameMode.length > 0) {
      const supersededIds = activeSameMode.map((row: { id: number }) => row.id);

      await tx
        .update(employeeSalaryChanges)
        .set({
          status: "Superseded",
          supersededAt: new Date(),
          supersededByChangeId: createdChange.id,
        })
        .where(inArray(employeeSalaryChanges.id, supersededIds));

      await tx.insert(employeeSalaryChangeEvents).values(
        supersededIds.map((changeId: number) => ({
          changeId,
          eventType: "Superseded" as const,
          actorUserId,
          notes: `Superseded by salary change #${createdChange.id}`,
        }))
      );
    }

    return {
      changeId: createdChange.id,
      affectedPeriodCount: affectedPeriods.length,
    };
  });
  revalidatePath("/salaryAdjustment");
  revalidatePath("/payroll");
  return result;
}

export async function cancelSalaryChange(input: unknown) {
  const actorUserId = await requireActorUserId();
  const payload = cancelSalaryChangeSchema.parse(input);

  const result = await db.transaction(async (tx) => {
    const change = await tx.query.employeeSalaryChanges.findFirst({
      where: eq(employeeSalaryChanges.id, payload.changeId),
      with: {
        payrollPeriod: true,
      },
    });

    if (!change) {
      throw new Error("Salary change not found.");
    }

    if (change.status !== "Active") {
      throw new Error("Only active salary changes can be canceled.");
    }

    const affectedPeriods = await listAffectedPeriods(
      tx,
      change.payrollPeriodId,
      change.mode,
      change.endPayrollPeriodId
    );
    await lockSalaryContext(tx, change.employeeId, change.payrollPeriodId, change.mode);
    await markAffectedRunsStale(tx, affectedPeriods, actorUserId);

    await tx
      .update(employeeSalaryChanges)
      .set({
        status: "Canceled",
        canceledAt: new Date(),
        canceledByUserId: actorUserId,
        cancelReason: payload.reason,
      })
      .where(eq(employeeSalaryChanges.id, change.id));

    await tx.insert(employeeSalaryChangeEvents).values({
      changeId: change.id,
      eventType: "Canceled",
      actorUserId,
      notes: payload.reason,
    });

    return { success: true };
  });
  revalidatePath("/salaryAdjustment");
  return result;
}

export async function makeSalaryChangeBaseSalary(input: unknown) {
  const actorUserId = await requireActorUserId();
  const payload = makeBaseSalarySchema.parse(input);

  const result = await db.transaction(async (tx) => {
    const change = await tx.query.employeeSalaryChanges.findFirst({
      where: and(
        eq(employeeSalaryChanges.id, payload.changeId),
        eq(employeeSalaryChanges.employeeId, payload.employeeId)
      ),
      with: {
        payrollPeriod: true,
      },
    });

    if (!change) {
      throw new Error("Salary change not found.");
    }

    if (change.mode !== "ForwardEffective") {
      throw new Error("Only forward-effective salary changes can be made base salary.");
    }

    if (change.status !== "Active") {
      throw new Error("Only active salary changes can be made base salary.");
    }

    if (change.appliedPermanentAt) {
      throw new Error("This salary change has already been applied permanently.");
    }

    if (!change.payrollPeriod) {
      throw new Error("Payroll period not found.");
    }

    const salaryUpdate = buildBaseSalaryUpdate(change);
    if (Object.keys(salaryUpdate).length === 0) {
      throw new Error("Salary change has no salary values to apply.");
    }

    const affectedPeriods = await listAffectedPeriods(
      tx,
      change.payrollPeriodId,
      change.mode
    );
    await lockSalaryContext(tx, change.employeeId, change.payrollPeriodId, change.mode);
    await markAffectedRunsStaleForBaseSalary(tx, affectedPeriods, actorUserId);

    const now = new Date();

    await tx
      .insert(employeesSalary)
      .values({
        employeeId: change.employeeId,
        ...salaryUpdate,
      })
      .onConflictDoUpdate({
        target: [employeesSalary.employeeId],
        set: {
          ...salaryUpdate,
          updatedAt: now,
        },
      });

    await tx
      .update(employeeSalaryChanges)
      .set({
        status: "AppliedPermanent",
        appliedPermanentAt: now,
        updatedAt: now,
      })
      .where(eq(employeeSalaryChanges.id, change.id));

    await tx.insert(employeeSalaryChangeEvents).values({
      changeId: change.id,
      eventType: "AppliedPermanent",
      actorUserId,
      notes: "Made salary change the employee base salary.",
    });

    const olderActiveForwardChanges = await tx
      .select({ id: employeeSalaryChanges.id })
      .from(employeeSalaryChanges)
      .innerJoin(
        payrollPeriods,
        eq(employeeSalaryChanges.payrollPeriodId, payrollPeriods.id)
      )
      .where(
        and(
          eq(employeeSalaryChanges.employeeId, change.employeeId),
          eq(employeeSalaryChanges.mode, "ForwardEffective"),
          eq(employeeSalaryChanges.status, "Active"),
          lte(payrollPeriods.startDate, change.payrollPeriod.startDate),
          sql`${employeeSalaryChanges.id} <> ${change.id}`
        )
      );

    const supersededIds = olderActiveForwardChanges.map((row) => row.id);
    if (supersededIds.length > 0) {
      await tx
        .update(employeeSalaryChanges)
        .set({
          status: "Superseded",
          supersededAt: now,
          supersededByChangeId: change.id,
          updatedAt: now,
        })
        .where(inArray(employeeSalaryChanges.id, supersededIds));

      await tx.insert(employeeSalaryChangeEvents).values(
        supersededIds.map((changeId) => ({
          changeId,
          eventType: "Superseded" as const,
          actorUserId,
          notes: `Superseded because salary change #${change.id} was made base salary.`,
        }))
      );
    }

    const updatedBaseSalary = await tx.query.employeesSalary.findFirst({
      where: eq(employeesSalary.employeeId, change.employeeId),
    });

    return {
      success: true,
      changeId: change.id,
      appliedPermanentAt: now.toISOString(),
      supersededForwardCount: supersededIds.length,
      baseSalary: normalizeSnapshot(salaryRecordToSnapshot(updatedBaseSalary)),
    };
  });
  revalidatePath("/salaryAdjustment");
  revalidatePath("/payroll");
  return result;
}

export async function getResolvedSalaryForPeriod(input: unknown) {
  await requireActorUserId();
  const payload = salaryChangePeriodLookupSchema.parse(input);

  const [period, resolvedSalary] = await Promise.all([
    db.query.payrollPeriods.findFirst({
      where: eq(payrollPeriods.id, payload.payrollPeriodId),
    }),
    resolveEmployeeSalaryForPeriod(payload.employeeId, payload.payrollPeriodId),
  ]);

  if (!period) {
    throw new Error("Payroll period not found.");
  }

  return resolvedSalaryReadSchema.parse({
    employeeId: payload.employeeId,
    payrollPeriodId: payload.payrollPeriodId,
    payrollCode: period.code,
    salary: normalizeSnapshot(salaryRecordToSnapshot(resolvedSalary.salary)),
    adjustmentId: resolvedSalary.adjustmentId,
    adjustmentMode: resolvedSalary.adjustmentMode,
    resolvedFrom: resolvedSalary.resolvedFrom,
    latestRunStatus: await getLatestRunStatus(payload.payrollPeriodId),
  });
}

export async function listSalaryChanges(input: unknown = {}) {
  await requireActorUserId();
  const filters = salaryChangeFilterSchema.parse(input) as SalaryChangeFilter;
  const endPayrollPeriods = alias(payrollPeriods, "salary_change_end_periods");

  const query = db
    .select({
      id: employeeSalaryChanges.id,
      employeeId: employeeSalaryChanges.employeeId,
      payrollPeriodId: employeeSalaryChanges.payrollPeriodId,
      endPayrollPeriodId: employeeSalaryChanges.endPayrollPeriodId,
      payrollCode: payrollPeriods.code,
      periodStartDate: payrollPeriods.startDate,
      periodEndDate: payrollPeriods.endDate,
      endPayrollCode: endPayrollPeriods.code,
      endPeriodStartDate: endPayrollPeriods.startDate,
      endPeriodEndDate: endPayrollPeriods.endDate,
      mode: employeeSalaryChanges.mode,
      status: employeeSalaryChanges.status,
      reason: employeeSalaryChanges.reason,
      notes: employeeSalaryChanges.notes,
      createdByUserId: employeeSalaryChanges.createdByUserId,
      createdAt: employeeSalaryChanges.createdAt,
      supersededAt: employeeSalaryChanges.supersededAt,
      canceledAt: employeeSalaryChanges.canceledAt,
      appliedPermanentAt: employeeSalaryChanges.appliedPermanentAt,
      employeeNo: employees.employeeNo,
      employeeType: employees.employeeType,
      firstName: employees.firstName,
      lastName: employees.lastName,
      middleName: employees.middleName,
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
    })
    .from(employeeSalaryChanges)
    .innerJoin(employees, eq(employeeSalaryChanges.employeeId, employees.id))
    .innerJoin(payrollPeriods, eq(employeeSalaryChanges.payrollPeriodId, payrollPeriods.id))
    .leftJoin(
      endPayrollPeriods,
      eq(employeeSalaryChanges.endPayrollPeriodId, endPayrollPeriods.id)
    )
    .where(
      and(
        filters.employeeId ? eq(employeeSalaryChanges.employeeId, filters.employeeId) : undefined,
        filters.payrollPeriodId
          ? eq(employeeSalaryChanges.payrollPeriodId, filters.payrollPeriodId)
          : undefined,
        filters.status ? eq(employeeSalaryChanges.status, filters.status) : undefined,
        filters.year ? eq(payrollPeriods.year, filters.year) : undefined
      )
    )
    .orderBy(desc(employeeSalaryChanges.createdAt), desc(employeeSalaryChanges.id));

  const rows = await query;

  return rows.map((row) =>
    historyRowToReadModel({
      id: row.id,
      employeeId: row.employeeId,
      payrollPeriodId: row.payrollPeriodId,
      endPayrollPeriodId: row.endPayrollPeriodId,
      payrollCode: row.payrollCode,
      periodStartDate: row.periodStartDate,
      periodEndDate: row.periodEndDate,
      endPayrollCode: row.endPayrollCode,
      endPeriodStartDate: row.endPeriodStartDate,
      endPeriodEndDate: row.endPeriodEndDate,
      mode: row.mode,
      status: row.status,
      reason: row.reason,
      notes: row.notes,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt,
      supersededAt: row.supersededAt,
      canceledAt: row.canceledAt,
      appliedPermanentAt: row.appliedPermanentAt,
      employeeNo: row.employeeNo,
      employeeType: row.employeeType,
      firstName: row.firstName,
      lastName: row.lastName,
      middleName: row.middleName,
      before: {
        dailyRate: row.beforeDailyRate,
        monthlyRate: row.beforeMonthlyRate,
        monthlyAllowance: row.beforeMonthlyAllowance,
        dailyAllowance: row.beforeDailyAllowance,
        cola: row.beforeCola,
        rateDivisor: row.beforeRateDivisor,
        billingRate: row.beforeBillingRate,
      },
      after: {
        dailyRate: row.afterDailyRate,
        monthlyRate: row.afterMonthlyRate,
        monthlyAllowance: row.afterMonthlyAllowance,
        dailyAllowance: row.afterDailyAllowance,
        cola: row.afterCola,
        rateDivisor: row.afterRateDivisor,
        billingRate: row.afterBillingRate,
      },
    })
  );
}

export async function listSalaryAdjustmentPeriods(year: number) {
  await requireActorUserId();

  return db
    .select({
      id: payrollPeriods.id,
      code: payrollPeriods.code,
      payrollTerms: payrollPeriods.payrollTerms,
      year: payrollPeriods.year,
      startDate: payrollPeriods.startDate,
      endDate: payrollPeriods.endDate,
      adjustedPayDate: payrollPeriods.adjustedPayDate,
      cycle: payrollPeriods.cycle,
      status: payrollPeriods.status,
    })
    .from(payrollPeriods)
    .where(eq(payrollPeriods.year, year))
    .orderBy(payrollPeriods.startDate);
}

export async function getSalaryChangeWorkspaceSnapshot(args: {
  payrollPeriodId: string;
  employeeIds: string[];
}) {
  await requireActorUserId();

  const period = await db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, args.payrollPeriodId),
  });

  if (!period) {
    throw new Error("Payroll period not found.");
  }

  const employeesForWorkspace = await db.query.employees.findMany({
    where: and(
      inArray(employees.id, args.employeeIds)
    ),
    with: {
      salary: true,
    },
  });

  return buildResolvedSalaryByEmployeeId({
    employees: employeesForWorkspace.map((employee) => ({
      id: employee.id,
      salary: employee.salary,
    })),
    period,
  });
}

export type SalaryChangeHistoryResultsType = Awaited<ReturnType<typeof listSalaryChanges>>;

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import {
  revertAttendanceImportBatchAction,
} from "@/app/actions/attendanceImportAction";
import { db } from "@/db";
import {
  adminAuditEvents,
  attendanceImportBatches,
  authAccounts,
  department,
  payrollPeriods,
  payrollRuns,
} from "@/db/schema";
import { actionClient } from "@/lib/safe-action";
import { requireAdminActor } from "@/lib/admin";

const BIOMETRICS_DATA_PATH = "/constants/dataMenu/biometricsData";
const DELETE_SELECTED_PERIOD_CONFIRMATION =
  "DELETE_SELECTED_PERIOD_BIOMETRICS_IMPORTS";
const IMPORT_AUDIT_ACTIONS = [
  "attendance.imported",
  "attendance.manager_imported",
] as const;

function parseYear(value: number | string | null | undefined) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : new Date().getFullYear();
}

function parseAuditDetails(value: string | null) {
  if (!value) return { departmentIds: [] as number[] };

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const departmentIds = Array.isArray(parsed.departmentIds)
      ? parsed.departmentIds.filter(
          (departmentId): departmentId is number =>
            Number.isInteger(departmentId)
        )
      : [];

    return { departmentIds };
  } catch {
    return { departmentIds: [] as number[] };
  }
}

function pickSelectedPeriodId(
  periods: (typeof payrollPeriods.$inferSelect)[],
  requestedPeriodId: string | null | undefined
) {
  if (periods.some((period) => period.id === requestedPeriodId)) {
    return requestedPeriodId!;
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    periods.find(
      (period) => period.startDate <= today && period.endDate >= today
    )?.id ??
    [...periods].reverse().find((period) => period.endDate <= today)?.id ??
    periods[0]?.id ??
    null
  );
}

export async function getBiometricsDataPageData(input?: {
  year?: number | string | null;
  periodId?: string | null;
}) {
  await requireAdminActor();

  const year = parseYear(input?.year);
  const yearRows = await db
    .select({ year: payrollPeriods.year })
    .from(payrollPeriods)
    .groupBy(payrollPeriods.year)
    .orderBy(desc(payrollPeriods.year));
  const availableYears = yearRows.length
    ? yearRows.map((row) => row.year)
    : [year];
  const selectedYear = availableYears.includes(year)
    ? year
    : availableYears[0] ?? year;

  const periodRows = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.year, selectedYear))
    .orderBy(asc(payrollPeriods.startDate), asc(payrollPeriods.code));
  const periodIds = periodRows.map((period) => period.id);
  const importCountRows = periodIds.length
    ? await db
        .select({
          payrollPeriodId: attendanceImportBatches.payrollPeriodId,
          importedFileCount: sql<number>`count(*)::int`,
        })
        .from(attendanceImportBatches)
        .where(inArray(attendanceImportBatches.payrollPeriodId, periodIds))
        .groupBy(attendanceImportBatches.payrollPeriodId)
    : [];
  const importedFileCountByPeriodId = new Map(
    importCountRows
      .filter((row) => row.payrollPeriodId)
      .map((row) => [row.payrollPeriodId!, row.importedFileCount])
  );
  const selectedPeriodId = pickSelectedPeriodId(periodRows, input?.periodId);
  const selectedPeriod =
    periodRows.find((period) => period.id === selectedPeriodId) ?? null;

  const [batchRows, blockingRunRows] = selectedPeriodId
    ? await Promise.all([
        db
          .select()
          .from(attendanceImportBatches)
          .where(eq(attendanceImportBatches.payrollPeriodId, selectedPeriodId))
          .orderBy(desc(attendanceImportBatches.importedAt)),
        db
          .select({
            id: payrollRuns.id,
            status: payrollRuns.status,
            runNumber: payrollRuns.runNumber,
          })
          .from(payrollRuns)
          .where(
            and(
              eq(payrollRuns.payrollPeriodId, selectedPeriodId),
              inArray(payrollRuns.status, ["Approved", "Posted"])
            )
          ),
      ])
    : [[], []];

  const batchIds = batchRows.map((batch) => batch.id);
  const auditRows = batchIds.length
    ? await db
        .select({
          actorUserId: adminAuditEvents.actorUserId,
          entityId: adminAuditEvents.entityId,
          action: adminAuditEvents.action,
          details: adminAuditEvents.details,
          createdAt: adminAuditEvents.createdAt,
        })
        .from(adminAuditEvents)
        .where(
          and(
            eq(adminAuditEvents.entityType, "attendance_import_batch"),
            inArray(adminAuditEvents.entityId, batchIds),
            inArray(adminAuditEvents.action, [...IMPORT_AUDIT_ACTIONS])
          )
        )
        .orderBy(desc(adminAuditEvents.createdAt))
    : [];
  const latestAuditByBatchId = new Map<string, (typeof auditRows)[number]>();

  for (const audit of auditRows) {
    if (!audit.entityId || latestAuditByBatchId.has(audit.entityId)) continue;
    latestAuditByBatchId.set(audit.entityId, audit);
  }

  const actorIds = [
    ...new Set(
      auditRows
        .map((audit) => audit.actorUserId)
        .filter((actorUserId): actorUserId is string => Boolean(actorUserId))
    ),
  ];
  const accountRows = actorIds.length
    ? await db
        .select({ id: authAccounts.id, email: authAccounts.email })
        .from(authAccounts)
        .where(inArray(authAccounts.id, actorIds))
    : [];
  const emailByAccountId = new Map(
    accountRows.map((account) => [account.id, account.email])
  );
  const departmentIds = [
    ...new Set(
      auditRows.flatMap((audit) => parseAuditDetails(audit.details).departmentIds)
    ),
  ];
  const departmentRows = departmentIds.length
    ? await db
        .select({ id: department.id, name: department.name })
        .from(department)
        .where(inArray(department.id, departmentIds))
    : [];
  const departmentNameById = new Map(
    departmentRows.map((row) => [row.id, row.name])
  );
  const periodView = selectedPeriod
    ? {
        id: selectedPeriod.id,
        code: selectedPeriod.code,
        startDate: selectedPeriod.startDate,
        endDate: selectedPeriod.endDate,
        adjustedPayDate: selectedPeriod.adjustedPayDate,
        status: selectedPeriod.status,
      }
    : null;
  const isRevertBlocked = blockingRunRows.length > 0;

  return {
    selectedYear,
    availableYears,
    selectedPeriodId,
    periods: periodRows.map((period) => ({
      id: period.id,
      code: period.code,
      year: period.year,
      startDate: period.startDate,
      endDate: period.endDate,
      adjustedPayDate: period.adjustedPayDate,
      status: period.status,
      importedFileCount: importedFileCountByPeriodId.get(period.id) ?? 0,
    })),
    selectedPeriod: periodView,
    isRevertBlocked,
    revertBlockedReason: isRevertBlocked
      ? `Revert is blocked because this period has ${blockingRunRows
          .map((run) => `${run.status} run #${run.runNumber}`)
          .join(", ")}.`
      : null,
    batches: batchRows.map((batch) => {
      const audit = latestAuditByBatchId.get(batch.id);
      const uploaderEmail = audit
        ? emailByAccountId.get(audit.actorUserId) ?? audit.actorUserId
        : null;
      const auditDetails = parseAuditDetails(audit?.details ?? null);
      const departmentNames = auditDetails.departmentIds
        .map((departmentId) => departmentNameById.get(departmentId))
        .filter((name): name is string => Boolean(name));
      const postedBy =
        audit?.action === "attendance.manager_imported"
          ? [
              uploaderEmail ? `Manager: ${uploaderEmail}` : "Manager",
              departmentNames.length ? departmentNames.join(", ") : null,
            ]
              .filter(Boolean)
              .join(" - ")
          : uploaderEmail ?? "Unknown";

      return {
        id: batch.id,
        payrollPeriod: periodView,
        sourceFileName: batch.sourceFileName,
        sourceFormat: batch.sourceFormat,
        status: batch.status,
        totalRows: batch.totalRows,
        matchedRows: batch.matchedRows,
        unmatchedRows: batch.unmatchedRows,
        duplicateRows: batch.duplicateRows,
        importedAt: batch.importedAt.toISOString(),
        postedBy,
        postedByType:
          audit?.action === "attendance.manager_imported"
            ? "Department Manager"
            : audit?.action === "attendance.imported"
              ? "Admin/User"
              : "Unknown",
        canRevert: batch.status === "Processed" && !isRevertBlocked,
      };
    }),
  };
}

export const revertBiometricsImportBatchAction = actionClient
  .metadata({ actionName: "revertBiometricsImportBatch" })
  .schema(z.object({ batchId: z.string().uuid() }))
  .action(async ({ parsedInput }) => {
    const result = await revertAttendanceImportBatchAction(parsedInput.batchId);

    revalidatePath(BIOMETRICS_DATA_PATH);

    return result;
  });

export const deleteBiometricsImportsForPeriodAction = actionClient
  .metadata({ actionName: "deleteBiometricsImportsForPeriod" })
  .schema(
    z.object({
      payrollPeriodId: z.string().uuid(),
      confirmation: z.literal(DELETE_SELECTED_PERIOD_CONFIRMATION),
    })
  )
  .action(async ({ parsedInput }) => {
    await requireAdminActor();

    const [period] = await db
      .select({ code: payrollPeriods.code })
      .from(payrollPeriods)
      .where(eq(payrollPeriods.id, parsedInput.payrollPeriodId))
      .limit(1);

    if (!period) {
      throw new Error("Payroll period not found.");
    }

    const [blockingRun] = await db
      .select({ status: payrollRuns.status, runNumber: payrollRuns.runNumber })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.payrollPeriodId, parsedInput.payrollPeriodId),
          inArray(payrollRuns.status, ["Approved", "Posted"])
        )
      )
      .limit(1);

    if (blockingRun) {
      throw new Error(
        `Biometrics imports cannot be deleted because ${period.code} has a ${blockingRun.status} payroll run.`
      );
    }

    const batchRows = await db
      .select({ id: attendanceImportBatches.id })
      .from(attendanceImportBatches)
      .where(
        eq(attendanceImportBatches.payrollPeriodId, parsedInput.payrollPeriodId)
      )
      .orderBy(desc(attendanceImportBatches.importedAt));
    let rawLogCount = 0;
    let summaryCount = 0;
    let staleRunCount = 0;

    for (const batch of batchRows) {
      const result = await revertAttendanceImportBatchAction(batch.id);
      rawLogCount += result.rawLogCount;
      summaryCount += result.summaryCount;
      staleRunCount += result.staleRunCount;
    }

    revalidatePath("/payroll");
    revalidatePath(BIOMETRICS_DATA_PATH);

    return {
      payrollPeriodCode: period.code,
      deletedBatchCount: batchRows.length,
      rawLogCount,
      summaryCount,
      staleRunCount,
      message: `Deleted ${batchRows.length} biometrics import file${
        batchRows.length === 1 ? "" : "s"
      } for ${period.code}.`,
    };
  });

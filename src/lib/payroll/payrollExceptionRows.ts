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
  manualPayrollEntries,
  overtimeRules,
  payrollAccountCodeImportBatches,
  payrollAccountCodeImportItems,
  payrollAccountCodeImportSkippedRows,
  payrollPeriods,
  payrollRuns,
  type PayrollAccountCodeImportRowSnapshot,
} from "@/db/schema";
import { recordAdminAuditEvent, recordPayrollRunEvent } from "@/lib/admin";
import { fetchConfirmedHolidayRowsForRange } from "@/lib/holidays";
import { and, asc, desc, eq, gte, inArray, isNull, like, lte, or, sql } from "drizzle-orm";
import {
  computeManualPayrollLatestBaseline,
  getDailyRate,
  getHoursPerDay,
} from "./engine";
import { normalizeAttendanceEmployeeKey } from "./attendance";
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
import {
  appendPayrollAccountCodeImportDiagnostic,
  buildPayrollAccountCodeImportEmployeeLookup,
  combinePayrollAccountCodeImportRows,
  decodePayrollAccountCodeImportText,
  getPayrollAccountCodeImportDuplicateKey,
  PAYROLL_ACCOUNT_CODE_IMPORT_PREVIEW_LIMIT,
  parsePayrollAccountCodeImportText,
  type PayrollAccountCodeImportResult,
  type PayrollAccountCodeImportSkippedRow,
  type ResolvedPayrollAccountCodeImportRow,
} from "./payrollAccountCodeImport";
import { DEFAULT_EMPLOYEE_TYPE } from "@/utils/employeeCode";
import {
  buildApprovedPaidLeaveAccountCodeRows,
  buildManualPayrollLeaveAccountCodeRows,
} from "./manualLeaveAccountCodeRows";
import type {
  ImportPayrollAccountCodeRowsSchemaType,
  PayrollAccountCodeImportPeriodRevertSchemaType,
  SavePayrollExceptionRowsSchemaType,
} from "@/zod-schemas/payrollExceptionRows";

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

function normalizeImportAccountCode(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isAmountOnlyPayrollExceptionAccountType(
  accountType: PayrollExceptionAccountType | null
) {
  return (
    accountType === "Other Income" ||
    accountType === "Loan" ||
    accountType === "Other Deduction"
  );
}

function getImportExistingRowKey(args: {
  employeeId: string;
  accountCodeId: number;
  accountType: PayrollExceptionAccountType | null;
}) {
  return getPayrollAccountCodeImportDuplicateKey(args);
}

function createPayrollAccountCodeImportSnapshot(
  row: typeof employeePayrollExceptionRows.$inferSelect
): PayrollAccountCodeImportRowSnapshot {
  return {
    id: row.id,
    payrollPeriodId: row.payrollPeriodId,
    employeeId: row.employeeId,
    attendanceDate: row.attendanceDate,
    exceptionType: row.exceptionType,
    workedStatus: row.workedStatus,
    dayType: row.dayType,
    customPayrollCodeId: row.customPayrollCodeId,
    accountCodeId: row.accountCodeId,
    accountCodeSnapshot: row.accountCodeSnapshot,
    accountTypeSnapshot: row.accountTypeSnapshot,
    accountDescriptionSnapshot: row.accountDescriptionSnapshot,
    accountMonth13thPaySnapshot: row.accountMonth13thPaySnapshot,
    accountNonTaxableSnapshot: row.accountNonTaxableSnapshot,
    overtimeCategory: row.overtimeCategory,
    quantityMinutes: row.quantityMinutes,
    quantityDays: row.quantityDays,
    amountOverride: row.amountOverride,
    remarks: row.remarks,
    dtrOverrideSource: row.dtrOverrideSource,
    legacyOvertimeOverrideId: row.legacyOvertimeOverrideId,
  };
}

function createPayrollAccountCodeImportSnapshotFromValues(
  values: typeof employeePayrollExceptionRows.$inferInsert & { id: string }
): PayrollAccountCodeImportRowSnapshot {
  return {
    id: values.id,
    payrollPeriodId: values.payrollPeriodId,
    employeeId: values.employeeId,
    attendanceDate: values.attendanceDate,
    exceptionType: values.exceptionType ?? null,
    workedStatus: values.workedStatus ?? null,
    dayType: values.dayType ?? null,
    customPayrollCodeId: values.customPayrollCodeId ?? null,
    accountCodeId: values.accountCodeId ?? null,
    accountCodeSnapshot: values.accountCodeSnapshot,
    accountTypeSnapshot: values.accountTypeSnapshot ?? null,
    accountDescriptionSnapshot: values.accountDescriptionSnapshot ?? null,
    accountMonth13thPaySnapshot:
      values.accountMonth13thPaySnapshot ?? false,
    accountNonTaxableSnapshot: values.accountNonTaxableSnapshot ?? false,
    overtimeCategory: values.overtimeCategory ?? null,
    quantityMinutes: values.quantityMinutes ?? null,
    quantityDays: values.quantityDays == null ? null : String(values.quantityDays),
    amountOverride:
      values.amountOverride == null ? null : String(values.amountOverride),
    remarks: values.remarks ?? null,
    dtrOverrideSource: values.dtrOverrideSource ?? null,
    legacyOvertimeOverrideId: values.legacyOvertimeOverrideId ?? null,
  };
}

function getPayrollAccountCodeImportRestoreValues(
  snapshot: PayrollAccountCodeImportRowSnapshot
): typeof employeePayrollExceptionRows.$inferInsert {
  type PayrollExceptionRowInsert = typeof employeePayrollExceptionRows.$inferInsert;

  return {
    id: snapshot.id,
    payrollPeriodId: snapshot.payrollPeriodId,
    employeeId: snapshot.employeeId,
    attendanceDate: snapshot.attendanceDate,
    exceptionType:
      snapshot.exceptionType as PayrollExceptionRowInsert["exceptionType"],
    workedStatus:
      snapshot.workedStatus as PayrollExceptionRowInsert["workedStatus"],
    dayType: snapshot.dayType as PayrollExceptionRowInsert["dayType"],
    customPayrollCodeId: snapshot.customPayrollCodeId,
    accountCodeId: snapshot.accountCodeId,
    accountCodeSnapshot: snapshot.accountCodeSnapshot,
    accountTypeSnapshot:
      snapshot.accountTypeSnapshot as PayrollExceptionRowInsert["accountTypeSnapshot"],
    accountDescriptionSnapshot: snapshot.accountDescriptionSnapshot,
    accountMonth13thPaySnapshot: snapshot.accountMonth13thPaySnapshot,
    accountNonTaxableSnapshot: snapshot.accountNonTaxableSnapshot,
    overtimeCategory:
      snapshot.overtimeCategory as PayrollExceptionRowInsert["overtimeCategory"],
    quantityMinutes: snapshot.quantityMinutes,
    quantityDays: snapshot.quantityDays,
    amountOverride: snapshot.amountOverride,
    remarks: snapshot.remarks,
    dtrOverrideSource:
      snapshot.dtrOverrideSource as PayrollExceptionRowInsert["dtrOverrideSource"],
    legacyOvertimeOverrideId: snapshot.legacyOvertimeOverrideId,
    updatedAt: new Date(),
  };
}

export async function importPayrollAccountCodeRows(args: {
  actorUserId: string;
  payload: ImportPayrollAccountCodeRowsSchemaType;
}): Promise<PayrollAccountCodeImportResult> {
  const payrollPeriod = await db.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, args.payload.selectedPayrollPeriodId),
  });

  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  const text = decodePayrollAccountCodeImportText(args.payload.contentBase64);
  const parsed = parsePayrollAccountCodeImportText(text);
  const skippedRows = [...parsed.skippedRows];
  let skippedPeriodMismatchCount = 0;

  const selectedPeriodRows = parsed.rows.filter((row) => {
    if (row.payrollPeriodCode === payrollPeriod.code) return true;

    skippedPeriodMismatchCount += 1;
    appendPayrollAccountCodeImportDiagnostic(skippedRows, {
      sourceLine: row.sourceLine,
      payrollPeriodCode: row.payrollPeriodCode,
      employeeNo: row.employeeNo,
      accountCode: row.accountCode,
      reason: `Skipped because Payroll Period is not ${payrollPeriod.code}.`,
    });
    return false;
  });

  const [employeeRows, accountCodeRows] = await Promise.all([
    db
      .select({
        id: employees.id,
        employeeNo: employees.employeeNo,
        employeeType: employees.employeeType,
      })
      .from(employees)
      .where(
        and(
          eq(employees.employeeType, DEFAULT_EMPLOYEE_TYPE),
          isNull(employees.deletedAt)
        )
      ),
    getPayrollExceptionAccountCodeOptions(),
  ]);

  const { employeeByNormalizedKey, ambiguousEmployeeKeys } =
    buildPayrollAccountCodeImportEmployeeLookup(employeeRows);

  const accountCodeByCode = new Map(
    accountCodeRows.map((row) => [normalizeImportAccountCode(row.code), row] as const)
  );
  const resolvedRows: ResolvedPayrollAccountCodeImportRow[] = [];

  for (const row of selectedPeriodRows) {
    const normalizedEmployeeKey = normalizeAttendanceEmployeeKey(row.employeeNo);
    const baseSkippedRow = {
      sourceLine: row.sourceLine,
      payrollPeriodCode: row.payrollPeriodCode,
      employeeNo: row.employeeNo,
      accountCode: row.accountCode,
    };

    if (!normalizedEmployeeKey) {
      appendPayrollAccountCodeImportDiagnostic(skippedRows, {
        ...baseSkippedRow,
        reason: "Employee No could not be normalized to a numeric employee number.",
      });
      continue;
    }

    if (ambiguousEmployeeKeys.has(normalizedEmployeeKey)) {
      appendPayrollAccountCodeImportDiagnostic(skippedRows, {
        ...baseSkippedRow,
        reason: "Employee No matches more than one employee.",
      });
      continue;
    }

    const employee = employeeByNormalizedKey.get(normalizedEmployeeKey);
    if (!employee) {
      appendPayrollAccountCodeImportDiagnostic(skippedRows, {
        ...baseSkippedRow,
        reason: "Employee No was not found.",
      });
      continue;
    }

    const selectedAccount = accountCodeByCode.get(
      normalizeImportAccountCode(row.accountCode)
    );
    if (!selectedAccount) {
      appendPayrollAccountCodeImportDiagnostic(skippedRows, {
        ...baseSkippedRow,
        reason: "Account Code was not found.",
      });
      continue;
    }

    const quantityMinutes =
      Math.floor(row.hours ?? 0) * 60 + Math.floor(row.minutes ?? 0);
    const amount = row.amount == null ? null : roundMoney(row.amount);
    const isAmountOnly = isAmountOnlyPayrollExceptionAccountType(
      selectedAccount.accountType
    );
    const isHourBased = isManualPayrollHourBasedAccountType(
      selectedAccount.accountType
    );

    if (isAmountOnly && (amount == null || amount <= 0)) {
      appendPayrollAccountCodeImportDiagnostic(skippedRows, {
        ...baseSkippedRow,
        reason: "This account-code type requires an amount.",
      });
      continue;
    }

    if (!isAmountOnly && isHourBased && amount == null && quantityMinutes <= 0) {
      appendPayrollAccountCodeImportDiagnostic(skippedRows, {
        ...baseSkippedRow,
        reason: "This account-code type requires hours/minutes or an amount.",
      });
      continue;
    }

    resolvedRows.push({
      ...row,
      employeeId: employee.id,
      accountCodeId: selectedAccount.id,
      accountCode: selectedAccount.code,
      accountType: selectedAccount.accountType,
      accountDescription: selectedAccount.description,
      accountMonth13thPay: selectedAccount.month13thPay,
      accountNonTaxable: selectedAccount.nonTaxable,
      amount,
    });
  }

  const combinedRows = combinePayrollAccountCodeImportRows(resolvedRows);
  const affectedEmployeeIds = [
    ...new Set(combinedRows.map((row) => row.employeeId)),
  ];
  const skippedInvalidRowCount = selectedPeriodRows.length - resolvedRows.length;
  const skippedRowsPreview = skippedRows.slice(
    0,
    PAYROLL_ACCOUNT_CODE_IMPORT_PREVIEW_LIMIT
  );

  if (combinedRows.length === 0 || affectedEmployeeIds.length === 0) {
    return {
      batchId: null,
      fileName: args.payload.fileName,
      payrollPeriodId: payrollPeriod.id,
      payrollPeriodCode: payrollPeriod.code,
      totalRows: parsed.totalRows,
      insertedRowCount: 0,
      updatedRowCount: 0,
      importedRowCount: 0,
      skippedPeriodMismatchCount,
      skippedInvalidRowCount,
      skippedRows: skippedRowsPreview,
      affectedEmployeeCount: 0,
      affectedEmployeeIds: [],
      staleRunCount: 0,
    };
  }

  const existingRows = await db
    .select()
    .from(employeePayrollExceptionRows)
    .where(
      and(
        eq(employeePayrollExceptionRows.payrollPeriodId, payrollPeriod.id),
        inArray(employeePayrollExceptionRows.employeeId, affectedEmployeeIds)
      )
    );
  const accountCodeById = new Map(accountCodeRows.map((row) => [row.id, row]));
  const existingRowsByKey = new Map<
    string,
    typeof employeePayrollExceptionRows.$inferSelect
  >();

  for (const row of existingRows) {
    const mappedAccount =
      (row.accountCodeId != null ? accountCodeById.get(row.accountCodeId) : null) ??
      accountCodeByCode.get(normalizeImportAccountCode(row.accountCodeSnapshot)) ??
      null;
    if (!mappedAccount) continue;

    const key = getImportExistingRowKey({
      employeeId: row.employeeId,
      accountCodeId: mappedAccount.id,
      accountType: getLegacyAccountType(row),
    });

    if (!existingRowsByKey.has(key)) {
      existingRowsByKey.set(key, row);
    }
  }

  let insertedRowCount = 0;
  let updatedRowCount = 0;

  const result = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(payrollAccountCodeImportBatches)
      .values({
        payrollPeriodId: payrollPeriod.id,
        sourceFileName: args.payload.fileName,
        totalRows: parsed.totalRows,
        skippedPeriodMismatchCount,
        skippedInvalidRowCount,
        affectedEmployeeCount: affectedEmployeeIds.length,
        createdByUserId: args.actorUserId,
      })
      .returning({ id: payrollAccountCodeImportBatches.id });

    if (skippedRows.length > 0) {
      await tx.insert(payrollAccountCodeImportSkippedRows).values(
        skippedRows.map((row) => ({
          batchId: batch.id,
          sourceLine: row.sourceLine,
          payrollPeriodCode: row.payrollPeriodCode?.trim() || null,
          employeeNo: row.employeeNo?.trim() || null,
          accountCode: row.accountCode?.trim() || null,
          reason: row.reason,
        }))
      );
    }

    for (const row of combinedRows) {
      const existingRow = existingRowsByKey.get(
        getImportExistingRowKey({
          employeeId: row.employeeId,
          accountCodeId: row.accountCodeId,
          accountType: row.accountType,
        })
      );
      const rowValues = {
        payrollPeriodId: payrollPeriod.id,
        employeeId: row.employeeId,
        attendanceDate: payrollPeriod.startDate,
        exceptionType: null,
        workedStatus: null,
        dayType:
          row.accountType === "Sunday/Holiday"
            ? DEFAULT_PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPE
            : null,
        customPayrollCodeId: null,
        accountCodeId: row.accountCodeId,
        accountCodeSnapshot: row.accountCode,
        accountTypeSnapshot: row.accountType,
        accountDescriptionSnapshot: row.accountDescription,
        accountMonth13thPaySnapshot: row.accountMonth13thPay,
        accountNonTaxableSnapshot: row.accountNonTaxable,
        overtimeCategory:
          row.accountType === "Overtime" ? ("REGULAR_DAY" as const) : null,
        quantityMinutes: row.quantityMinutes,
        quantityDays: null,
        amountOverride:
          row.amount == null ? null : row.amount.toFixed(2),
        remarks: `Imported from ${args.payload.fileName}`,
        dtrOverrideSource: null,
        updatedAt: new Date(),
      } satisfies typeof employeePayrollExceptionRows.$inferInsert;

      if (existingRow) {
        await tx
          .update(employeePayrollExceptionRows)
          .set(rowValues)
          .where(eq(employeePayrollExceptionRows.id, existingRow.id));

        await tx.insert(payrollAccountCodeImportItems).values({
          batchId: batch.id,
          employeeId: row.employeeId,
          appliedRowId: existingRow.id,
          mutationType: "updated",
          previousRowSnapshot:
            createPayrollAccountCodeImportSnapshot(existingRow),
          appliedRowSnapshot:
            createPayrollAccountCodeImportSnapshotFromValues({
              ...rowValues,
              id: existingRow.id,
            }),
        });
        updatedRowCount += 1;
        continue;
      }

      const [insertedRow] = await tx
        .insert(employeePayrollExceptionRows)
        .values(rowValues)
        .returning({ id: employeePayrollExceptionRows.id });

      await tx.insert(payrollAccountCodeImportItems).values({
        batchId: batch.id,
        employeeId: row.employeeId,
        appliedRowId: insertedRow.id,
        mutationType: "inserted",
        previousRowSnapshot: null,
        appliedRowSnapshot:
          createPayrollAccountCodeImportSnapshotFromValues({
            ...rowValues,
            id: insertedRow.id,
          }),
      });
      insertedRowCount += 1;
    }

    await tx
      .update(payrollAccountCodeImportBatches)
      .set({
        insertedRowCount,
        updatedRowCount,
        updatedAt: new Date(),
      })
      .where(eq(payrollAccountCodeImportBatches.id, batch.id));

    const staleRunCount = await markLatestEditableRunStale({
      tx,
      payrollPeriodId: payrollPeriod.id,
      actorUserId: args.actorUserId,
      notes: "Marked stale because payroll account-code rows were imported.",
    });

    await recordAdminAuditEvent({
      actorUserId: args.actorUserId,
      entityType: "employee_payroll_exception_rows",
      entityId: `${payrollPeriod.id}:account-code-import`,
      action: "payroll.exception_rows.account_code_imported",
      details: {
        payrollPeriodId: payrollPeriod.id,
        payrollPeriodCode: payrollPeriod.code,
        batchId: batch.id,
        fileName: args.payload.fileName,
        totalRows: parsed.totalRows,
        insertedRowCount,
        updatedRowCount,
        affectedEmployeeCount: affectedEmployeeIds.length,
        skippedPeriodMismatchCount,
        skippedInvalidRowCount,
        staleRunCount,
      },
      database: tx,
    });

    return { batchId: batch.id, staleRunCount };
  });

  return {
    batchId: result.batchId,
    fileName: args.payload.fileName,
    payrollPeriodId: payrollPeriod.id,
    payrollPeriodCode: payrollPeriod.code,
    totalRows: parsed.totalRows,
    insertedRowCount,
    updatedRowCount,
    importedRowCount: insertedRowCount + updatedRowCount,
    skippedPeriodMismatchCount,
    skippedInvalidRowCount,
    skippedRows: skippedRowsPreview,
    affectedEmployeeCount: affectedEmployeeIds.length,
    affectedEmployeeIds,
    staleRunCount: result.staleRunCount,
  };
}

export type PayrollAccountCodeImportBatchSummary = {
  id: string;
  sourceFileName: string;
  totalRows: number;
  insertedRowCount: number;
  updatedRowCount: number;
  skippedPeriodMismatchCount: number;
  skippedInvalidRowCount: number;
  skippedRowCount: number;
  storedSkippedRowCount: number;
  affectedEmployeeCount: number;
  createdAt: string;
};

export type PayrollAccountCodeImportSkippedRowsView = {
  batchId: string;
  skippedRowCount: number;
  storedSkippedRowCount: number;
  detailsAvailable: boolean;
  rows: PayrollAccountCodeImportSkippedRow[];
};

export async function getRevertablePayrollAccountCodeImportBatches(
  payrollPeriodId: string
): Promise<PayrollAccountCodeImportBatchSummary[]> {
  const batches = await db
    .select({
      id: payrollAccountCodeImportBatches.id,
      sourceFileName: payrollAccountCodeImportBatches.sourceFileName,
      totalRows: payrollAccountCodeImportBatches.totalRows,
      insertedRowCount: payrollAccountCodeImportBatches.insertedRowCount,
      updatedRowCount: payrollAccountCodeImportBatches.updatedRowCount,
      skippedPeriodMismatchCount:
        payrollAccountCodeImportBatches.skippedPeriodMismatchCount,
      skippedInvalidRowCount: payrollAccountCodeImportBatches.skippedInvalidRowCount,
      affectedEmployeeCount: payrollAccountCodeImportBatches.affectedEmployeeCount,
      createdAt: payrollAccountCodeImportBatches.createdAt,
    })
    .from(payrollAccountCodeImportBatches)
    .where(
      and(
        eq(payrollAccountCodeImportBatches.payrollPeriodId, payrollPeriodId),
        isNull(payrollAccountCodeImportBatches.revertedAt)
      )
    )
    .orderBy(desc(payrollAccountCodeImportBatches.createdAt));
  const batchIds = batches.map((batch) => batch.id);
  const skippedCounts =
    batchIds.length === 0
      ? []
      : await db
          .select({
            batchId: payrollAccountCodeImportSkippedRows.batchId,
            count: sql<number>`count(*)::int`,
          })
          .from(payrollAccountCodeImportSkippedRows)
          .where(inArray(payrollAccountCodeImportSkippedRows.batchId, batchIds))
          .groupBy(payrollAccountCodeImportSkippedRows.batchId);
  const skippedCountByBatchId = new Map(
    skippedCounts.map((row) => [row.batchId, row.count])
  );

  return batches.map((batch) => ({
    ...batch,
    skippedRowCount:
      skippedCountByBatchId.get(batch.id) ??
      batch.skippedPeriodMismatchCount + batch.skippedInvalidRowCount,
    storedSkippedRowCount: skippedCountByBatchId.get(batch.id) ?? 0,
    createdAt: batch.createdAt.toISOString(),
  }));
}

export async function getPayrollAccountCodeImportSkippedRows(
  batchId: string
): Promise<PayrollAccountCodeImportSkippedRowsView> {
  const batch = await db.query.payrollAccountCodeImportBatches.findFirst({
    where: eq(payrollAccountCodeImportBatches.id, batchId),
  });

  if (!batch) {
    throw new Error("Account-code import file not found.");
  }

  const rows = await db
    .select({
      sourceLine: payrollAccountCodeImportSkippedRows.sourceLine,
      payrollPeriodCode: payrollAccountCodeImportSkippedRows.payrollPeriodCode,
      employeeNo: payrollAccountCodeImportSkippedRows.employeeNo,
      accountCode: payrollAccountCodeImportSkippedRows.accountCode,
      reason: payrollAccountCodeImportSkippedRows.reason,
    })
    .from(payrollAccountCodeImportSkippedRows)
    .where(eq(payrollAccountCodeImportSkippedRows.batchId, batch.id))
    .orderBy(
      asc(payrollAccountCodeImportSkippedRows.sourceLine),
      asc(payrollAccountCodeImportSkippedRows.id)
    );
  const skippedRowCount =
    rows.length > 0
      ? rows.length
      : batch.skippedPeriodMismatchCount + batch.skippedInvalidRowCount;

  return {
    batchId: batch.id,
    skippedRowCount,
    storedSkippedRowCount: rows.length,
    detailsAvailable: rows.length > 0 || skippedRowCount === 0,
    rows: rows.map((row) => ({
      sourceLine: row.sourceLine,
      payrollPeriodCode: row.payrollPeriodCode ?? undefined,
      employeeNo: row.employeeNo ?? undefined,
      accountCode: row.accountCode ?? undefined,
      reason: row.reason,
    })),
  };
}

export async function revertPayrollAccountCodeImportsForPeriod(args: {
  actorUserId: string;
  payload: PayrollAccountCodeImportPeriodRevertSchemaType;
}) {
  const result = await db.transaction(async (tx) => {
    const payrollPeriod = await tx.query.payrollPeriods.findFirst({
      where: eq(payrollPeriods.id, args.payload.payrollPeriodId),
    });

    if (!payrollPeriod) {
      throw new Error("Payroll period not found.");
    }

    const batches = await tx
      .select()
      .from(payrollAccountCodeImportBatches)
      .where(
        and(
          eq(payrollAccountCodeImportBatches.payrollPeriodId, payrollPeriod.id),
          isNull(payrollAccountCodeImportBatches.revertedAt)
        )
      )
      .orderBy(desc(payrollAccountCodeImportBatches.createdAt));

    const batchIds = batches.map((batch) => batch.id);
    const items =
      batchIds.length === 0
        ? []
        : await tx
            .select()
            .from(payrollAccountCodeImportItems)
            .where(
              and(
                inArray(payrollAccountCodeImportItems.batchId, batchIds),
                isNull(payrollAccountCodeImportItems.revertedAt)
              )
            );

    let deletedRowCount = 0;
    let restoredRowCount = 0;
    let legacyDeletedRowCount = 0;
    const itemsByBatchId = new Map<
      string,
      typeof payrollAccountCodeImportItems.$inferSelect[]
    >();
    const affectedEmployeeIdSet = new Set(
      items.map((item) => item.employeeId)
    );

    for (const item of items) {
      const batchItems = itemsByBatchId.get(item.batchId) ?? [];
      batchItems.push(item);
      itemsByBatchId.set(item.batchId, batchItems);
    }

    for (const batch of batches) {
      for (const item of itemsByBatchId.get(batch.id) ?? []) {
        if (item.mutationType === "inserted") {
          const deletedRows = await tx
            .delete(employeePayrollExceptionRows)
            .where(eq(employeePayrollExceptionRows.id, item.appliedRowId))
            .returning({ id: employeePayrollExceptionRows.id });
          deletedRowCount += deletedRows.length;
        } else if (item.mutationType === "updated") {
          const previousSnapshot = item.previousRowSnapshot;
          if (!previousSnapshot) {
            throw new Error("Account-code import revert snapshot is missing.");
          }

          const restoreValues =
            getPayrollAccountCodeImportRestoreValues(previousSnapshot);
          const { id: restoredRowId, ...updateValues } = restoreValues;
          void restoredRowId;
          const updatedRows = await tx
            .update(employeePayrollExceptionRows)
            .set(updateValues)
            .where(eq(employeePayrollExceptionRows.id, item.appliedRowId))
            .returning({ id: employeePayrollExceptionRows.id });

          if (updatedRows.length === 0) {
            await tx.insert(employeePayrollExceptionRows).values(restoreValues);
          }
          restoredRowCount += 1;
        } else {
          throw new Error("Unknown account-code import mutation type.");
        }
      }
    }

    const legacyDeletedRows = await tx
      .delete(employeePayrollExceptionRows)
      .where(
        and(
          eq(employeePayrollExceptionRows.payrollPeriodId, payrollPeriod.id),
          like(employeePayrollExceptionRows.remarks, "Imported from %")
        )
      )
      .returning({
        id: employeePayrollExceptionRows.id,
        employeeId: employeePayrollExceptionRows.employeeId,
      });
    legacyDeletedRowCount = legacyDeletedRows.length;
    for (const row of legacyDeletedRows) {
      affectedEmployeeIdSet.add(row.employeeId);
    }

    const revertedAt = new Date();
    if (batchIds.length > 0) {
      await tx
        .update(payrollAccountCodeImportItems)
        .set({
          revertedAt,
          revertedByUserId: args.actorUserId,
          updatedAt: revertedAt,
        })
        .where(inArray(payrollAccountCodeImportItems.batchId, batchIds));
      await tx
        .update(payrollAccountCodeImportBatches)
        .set({
          revertedAt,
          revertedByUserId: args.actorUserId,
          updatedAt: revertedAt,
        })
        .where(inArray(payrollAccountCodeImportBatches.id, batchIds));
    }

    const changedRowCount =
      deletedRowCount + restoredRowCount + legacyDeletedRowCount;
    const staleRunCount =
      changedRowCount > 0
        ? await markLatestEditableRunStale({
            tx,
            payrollPeriodId: payrollPeriod.id,
            actorUserId: args.actorUserId,
            notes:
              "Marked stale because payroll account-code imports were reverted.",
          })
        : 0;
    const affectedEmployeeIds = [...affectedEmployeeIdSet];

    if (changedRowCount > 0 || batchIds.length > 0) {
      await recordAdminAuditEvent({
        actorUserId: args.actorUserId,
        entityType: "employee_payroll_exception_rows",
        entityId: `${payrollPeriod.id}:account-code-imports`,
        action: "payroll.exception_rows.account_code_imports_reverted",
        details: {
          batchIds,
          payrollPeriodId: payrollPeriod.id,
          payrollPeriodCode: payrollPeriod.code,
          deletedRowCount,
          restoredRowCount,
          legacyDeletedRowCount,
          affectedEmployeeCount: affectedEmployeeIds.length,
          staleRunCount,
        },
        database: tx,
      });
    }

    return {
      payrollPeriodId: payrollPeriod.id,
      payrollPeriodCode: payrollPeriod.code,
      batchIds,
      revertedBatchCount: batchIds.length,
      deletedRowCount,
      restoredRowCount,
      legacyDeletedRowCount,
      affectedEmployeeIds,
      affectedEmployeeCount: affectedEmployeeIds.length,
      staleRunCount,
    };
  });

  return result;
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

type PayrollExceptionAccountCodeOptionRow = Awaited<
  ReturnType<typeof getPayrollExceptionAccountCodeOptions>
>[number];

export async function getEmployeePayrollManualLeaveAccountCodeRows(args: {
  payrollPeriodId: string;
  employeeId: string;
  accountCodeOptions?: PayrollExceptionAccountCodeOptionRow[];
}) {
  const [manualEntry, accountCodeOptionRows] = await Promise.all([
    db.query.manualPayrollEntries.findFirst({
      where: and(
        eq(manualPayrollEntries.payrollPeriodId, args.payrollPeriodId),
        eq(manualPayrollEntries.employeeId, args.employeeId)
      ),
      with: {
        lines: true,
      },
    }),
    args.accountCodeOptions
      ? Promise.resolve(args.accountCodeOptions)
      : getPayrollExceptionAccountCodeOptions(),
  ]);

  if (!manualEntry) return [];

  return buildManualPayrollLeaveAccountCodeRows({
    lines: manualEntry.lines,
    accountCodeOptions: accountCodeOptionRows,
  });
}

export async function getEmployeePayrollApprovedLeaveAccountCodeRows(args: {
  payrollPeriodId: string;
  employeeId: string;
  accountCodeOptions?: PayrollExceptionAccountCodeOptionRow[];
}) {
  const [baseline, accountCodeOptionRows] = await Promise.all([
    computeManualPayrollLatestBaseline(args.payrollPeriodId, args.employeeId),
    args.accountCodeOptions
      ? Promise.resolve(args.accountCodeOptions)
      : getPayrollExceptionAccountCodeOptions(),
  ]);

  if (!baseline) return [];

  return buildApprovedPaidLeaveAccountCodeRows({
    lines: baseline.lines,
    accountCodeOptions: accountCodeOptionRows,
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

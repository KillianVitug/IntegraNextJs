import { db } from "@/db";
import {
  accountCode,
  employeesLoans,
  loanInstallments,
  loanPayments,
  payrollPeriods,
  payrollRuns,
} from "@/db/schema";
import type { PayrollScheduledLoanDeductionView } from "@/app/(ntg)/payroll/types";
import { recordAdminAuditEvent, recordPayrollRunEvent } from "@/lib/admin";
import { fetchConfirmedHolidayRowsForRange } from "@/lib/holidays";
import type { UpdatePayrollLoanInstallmentAmountSchemaType } from "@/zod-schemas/payrollExceptionRows";
import {
  generateLoanInstallmentPlan,
  type LoanInstallmentSeed,
} from "./loan";
import {
  getNextSemiMonthlyCode,
  parsePayrollCode,
} from "./calendar";
import { ensureSemiMonthlyPayrollPeriods } from "./engine";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

type DbLike = Pick<typeof db, "insert" | "query" | "select" | "update">;

type PayrollPeriodLookup = {
  id: string;
  code: string;
};

type AffectedPayrollRun = {
  id: string;
  status: string;
  periodCode: string;
};

type ScheduledLoanRow = {
  installmentId: string;
  loanId: string;
  accountCodeId: number | null;
  accountCode: string | null;
  accountDescription: string | null;
  accountType: string | null;
  loanReferenceNumber: string;
  payrollCode: string;
  installmentNo: number;
  dueDate: string | Date;
  scheduledAmount: string;
  balanceAfter: string | null;
  status: string;
};

type LoanInstallmentStatus = PayrollScheduledLoanDeductionView["status"];

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue = Number(
    typeof value === "number" ? value : value.replaceAll(",", "").trim()
  );

  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function money(value: string | number | null | undefined) {
  return toAmount(value).toFixed(2);
}

function normalizeDateOnly(value: string | Date) {
  if (typeof value === "string") return value.slice(0, 10);

  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function isEditableLoanInstallmentStatus(status: string) {
  return status === "Pending" || status === "Due";
}

async function ensurePayrollPeriodsForCodes(payrollCodes: string[]) {
  const years = uniqueStrings(
    payrollCodes
      .map((code) => parsePayrollCode(code))
      .filter((parsed): parsed is NonNullable<ReturnType<typeof parsePayrollCode>> => parsed != null)
      .map((parsed) => String(parsed.year))
  ).map(Number);

  await Promise.all(years.map((year) => ensureSemiMonthlyPayrollPeriods(year)));
}

async function resolvePeriodsByCodes(
  database: DbLike,
  payrollCodes: string[]
): Promise<PayrollPeriodLookup[]> {
  const uniqueCodes = uniqueStrings(payrollCodes);
  if (uniqueCodes.length === 0) return [];

  return database
    .select({
      id: payrollPeriods.id,
      code: payrollPeriods.code,
    })
    .from(payrollPeriods)
    .where(inArray(payrollPeriods.code, uniqueCodes));
}

async function markAffectedLoanRunsStale(args: {
  database: DbLike;
  payrollCodes: string[];
  actorUserId: string;
}) {
  const affectedCodes = uniqueStrings(args.payrollCodes);
  if (affectedCodes.length === 0) return 0;

  const affectedPeriods = await resolvePeriodsByCodes(args.database, affectedCodes);
  const affectedPeriodIds = affectedPeriods.map((period) => period.id);
  if (affectedPeriodIds.length === 0) return 0;

  const affectedRuns: AffectedPayrollRun[] = await args.database
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
    (run) => run.status === "Approved" || run.status === "Posted"
  );

  if (blockingRun) {
    throw new Error(
      `Loan changes are blocked because payroll period ${blockingRun.periodCode} already has a ${blockingRun.status} run.`
    );
  }

  const staleRuns = affectedRuns.filter(
    (run) => run.status === "Draft" || run.status === "Reviewed"
  );

  if (staleRuns.length === 0) return 0;

  await args.database
    .update(payrollRuns)
    .set({
      status: "Stale",
      reviewedAt: null,
      reviewedByUserId: null,
      approvedAt: null,
      approvedByUserId: null,
      updatedAt: new Date(),
    })
    .where(inArray(payrollRuns.id, staleRuns.map((run) => run.id)));

  for (const run of staleRuns) {
    await recordPayrollRunEvent({
      payrollRunId: run.id,
      actorUserId: args.actorUserId,
      eventType: "MarkedStale",
      fromStatus: run.status as (typeof payrollRuns.$inferSelect)["status"],
      toStatus: "Stale",
      notes: "Marked stale because a loan installment amount changed.",
      database: args.database,
    });
  }

  return staleRuns.length;
}

export async function getEmployeePayrollScheduledLoanRows(args: {
  payrollPeriodId: string;
  employeeId: string;
  database?: DbLike;
}): Promise<PayrollScheduledLoanDeductionView[]> {
  const database = args.database ?? db;
  const payrollPeriod = await database.query.payrollPeriods.findFirst({
    where: eq(payrollPeriods.id, args.payrollPeriodId),
  });

  if (!payrollPeriod) {
    throw new Error("Payroll period not found.");
  }

  const rows: ScheduledLoanRow[] = await database
    .select({
      installmentId: loanInstallments.id,
      loanId: employeesLoans.id,
      accountCodeId: employeesLoans.accountCodeId,
      accountCode: accountCode.accountCode,
      accountDescription: accountCode.description,
      accountType: accountCode.accountType,
      loanReferenceNumber: employeesLoans.loanReferenceNumber,
      payrollCode: loanInstallments.payrollCode,
      installmentNo: loanInstallments.installmentNo,
      dueDate: loanInstallments.dueDate,
      scheduledAmount: loanInstallments.scheduledAmount,
      balanceAfter: loanInstallments.balanceAfter,
      status: loanInstallments.status,
    })
    .from(loanInstallments)
    .innerJoin(employeesLoans, eq(loanInstallments.loanId, employeesLoans.id))
    .leftJoin(accountCode, eq(employeesLoans.accountCodeId, accountCode.id))
    .where(
      and(
        eq(employeesLoans.employeeId, args.employeeId),
        eq(employeesLoans.status, "Active"),
        isNull(employeesLoans.deletedAt),
        eq(loanInstallments.payrollCode, payrollPeriod.code)
      )
    )
    .orderBy(asc(loanInstallments.installmentNo), asc(loanInstallments.dueDate));

  return rows.map((row) => ({
    installmentId: row.installmentId,
    loanId: row.loanId,
    accountCodeId: row.accountCodeId,
    accountCode: row.accountCode,
    accountDescription: row.accountDescription,
    accountType: row.accountType,
    loanReferenceNumber: row.loanReferenceNumber,
    payrollCode: row.payrollCode,
    installmentNo: row.installmentNo,
    dueDate: normalizeDateOnly(row.dueDate),
    scheduledAmount: money(row.scheduledAmount),
    balanceAfter: row.balanceAfter == null ? null : money(row.balanceAfter),
    status: row.status as LoanInstallmentStatus,
    editable: isEditableLoanInstallmentStatus(row.status),
  }));
}

function buildInstallmentRows(args: {
  loanId: string;
  periodByCode: Map<string, string>;
  installmentOffset: number;
  installments: LoanInstallmentSeed[];
}) {
  return args.installments.map((installment) => ({
    loanId: args.loanId,
    payrollPeriodId: args.periodByCode.get(installment.payrollCode) ?? null,
    payrollCode: installment.payrollCode,
    installmentNo: args.installmentOffset + installment.installmentNo,
    dueDate: installment.dueDate,
    scheduledAmount: installment.scheduledAmount.toFixed(2),
    balanceAfter: installment.balanceAfter.toFixed(2),
    status: "Pending" as const,
  }));
}

export async function updateEmployeePayrollLoanInstallmentAmount(args: {
  actorUserId: string;
  payload: UpdatePayrollLoanInstallmentAmountSchemaType;
}) {
  const scheduledAmount = roundMoney(args.payload.scheduledAmount);
  const holidays = await fetchConfirmedHolidayRowsForRange(
    "2000-01-01",
    "2100-12-31"
  );

  const result = await db.transaction(async (tx) => {
    const [selectedRow] = await tx
      .select({
        installment: loanInstallments,
        loan: employeesLoans,
        payrollPeriod: payrollPeriods,
      })
      .from(loanInstallments)
      .innerJoin(employeesLoans, eq(loanInstallments.loanId, employeesLoans.id))
      .innerJoin(payrollPeriods, eq(loanInstallments.payrollCode, payrollPeriods.code))
      .where(
        and(
          eq(loanInstallments.id, args.payload.installmentId),
          eq(payrollPeriods.id, args.payload.payrollPeriodId),
          eq(employeesLoans.employeeId, args.payload.employeeId),
          isNull(employeesLoans.deletedAt)
        )
      )
      .limit(1);

    if (!selectedRow) {
      throw new Error("Loan installment was not found for this employee and payroll period.");
    }

    if (selectedRow.loan.status !== "Active") {
      throw new Error("Only active loan installments can be edited.");
    }

    if (!isEditableLoanInstallmentStatus(selectedRow.installment.status)) {
      throw new Error("Only pending or due loan installments can be edited.");
    }

    await tx.execute(
      sql`select id from employees_loans where id = ${selectedRow.loan.id} for update`
    );
    await tx.execute(
      sql`select id from loan_installments where loan_id = ${selectedRow.loan.id} for update`
    );

    const existingInstallments = await tx
      .select()
      .from(loanInstallments)
      .where(eq(loanInstallments.loanId, selectedRow.loan.id))
      .orderBy(asc(loanInstallments.installmentNo), asc(loanInstallments.dueDate));

    const targetIndex = existingInstallments.findIndex(
      (installment) => installment.id === selectedRow.installment.id
    );

    if (targetIndex < 0) {
      throw new Error("Loan installment was not found in the current schedule.");
    }

    const paymentRows = await tx
      .select({
        installmentId: loanPayments.installmentId,
        totalPaid: sql<string>`COALESCE(SUM(${loanPayments.amountPaid}), 0)`,
      })
      .from(loanPayments)
      .where(eq(loanPayments.loanId, selectedRow.loan.id))
      .groupBy(loanPayments.installmentId);
    const paidByInstallmentId = new Map(
      paymentRows
        .filter((row) => row.installmentId != null)
        .map((row) => [row.installmentId!, toAmount(row.totalPaid)] as const)
    );

    let balanceBeforeTarget = roundMoney(toAmount(selectedRow.loan.payableLoan));

    for (const installment of existingInstallments.slice(0, targetIndex)) {
      let deductionAmount = 0;

      if (installment.status === "Paid") {
        deductionAmount =
          paidByInstallmentId.get(installment.id) ?? toAmount(installment.scheduledAmount);
      } else if (isEditableLoanInstallmentStatus(installment.status)) {
        deductionAmount = toAmount(installment.scheduledAmount);
      }

      balanceBeforeTarget = roundMoney(
        Math.max(0, balanceBeforeTarget - deductionAmount)
      );
    }

    if (scheduledAmount > balanceBeforeTarget) {
      throw new Error(
        `Scheduled deduction cannot exceed the remaining balance before this installment (${balanceBeforeTarget.toFixed(2)}).`
      );
    }

    const balanceAfterTarget = roundMoney(
      Math.max(0, balanceBeforeTarget - scheduledAmount)
    );
    const futureRegenerableInstallments = existingInstallments
      .slice(targetIndex + 1)
      .filter((installment) => isEditableLoanInstallmentStatus(installment.status));
    const startPayrollCode = getNextSemiMonthlyCode(selectedRow.installment.payrollCode);
    const amortizationAmount = roundMoney(toAmount(selectedRow.loan.amortization));
    const regeneratedInstallments =
      balanceAfterTarget > 0 && startPayrollCode
        ? generateLoanInstallmentPlan({
            firstPayrollCode: startPayrollCode,
            paymentTerms: "Always",
            payableAmount: balanceAfterTarget,
            amortization:
              amortizationAmount > 0 ? amortizationAmount : balanceAfterTarget,
            holidays,
          })
        : [];

    const affectedPayrollCodes = uniqueStrings([
      selectedRow.installment.payrollCode,
      ...futureRegenerableInstallments.map((installment) => installment.payrollCode),
      ...regeneratedInstallments.map((installment) => installment.payrollCode),
    ]);

    await ensurePayrollPeriodsForCodes(affectedPayrollCodes);
    const staleRunCount = await markAffectedLoanRunsStale({
      database: tx,
      payrollCodes: affectedPayrollCodes,
      actorUserId: args.actorUserId,
    });

    await tx
      .update(loanInstallments)
      .set({
        scheduledAmount: scheduledAmount.toFixed(2),
        balanceAfter: balanceAfterTarget.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(loanInstallments.id, selectedRow.installment.id));

    const futureRegenerableIds = futureRegenerableInstallments.map(
      (installment) => installment.id
    );
    if (futureRegenerableIds.length > 0) {
      await tx
        .delete(loanInstallments)
        .where(inArray(loanInstallments.id, futureRegenerableIds));
    }

    if (regeneratedInstallments.length > 0) {
      const periodRows = await resolvePeriodsByCodes(
        tx,
        regeneratedInstallments.map((installment) => installment.payrollCode)
      );
      const periodByCode = new Map(
        periodRows.map((period) => [period.code, period.id] as const)
      );

      await tx.insert(loanInstallments).values(
        buildInstallmentRows({
          loanId: selectedRow.loan.id,
          periodByCode,
          installmentOffset: selectedRow.installment.installmentNo,
          installments: regeneratedInstallments,
        })
      );
    }

    await recordAdminAuditEvent({
      actorUserId: args.actorUserId,
      entityType: "loan_installment",
      entityId: selectedRow.installment.id,
      action: "loan_installment.amount_updated",
      database: tx,
      details: {
        loanId: selectedRow.loan.id,
        loanReferenceNumber: selectedRow.loan.loanReferenceNumber,
        payrollCode: selectedRow.installment.payrollCode,
        previousAmount: money(selectedRow.installment.scheduledAmount),
        nextAmount: scheduledAmount.toFixed(2),
        balanceAfter: balanceAfterTarget.toFixed(2),
        regeneratedInstallmentCount: regeneratedInstallments.length,
        staleRunCount,
      },
    });

    return {
      staleRunCount,
    };
  });

  return {
    ...result,
    loanRows: await getEmployeePayrollScheduledLoanRows({
      payrollPeriodId: args.payload.payrollPeriodId,
      employeeId: args.payload.employeeId,
    }),
  };
}

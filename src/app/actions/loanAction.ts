"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  recordAdminAuditEvent,
  recordPayrollRunEvent,
  requireAdminActor,
} from "@/lib/admin";
import {
  accountCode,
  employees,
  employeesLoans,
  loanInstallments,
  loanPayments,
  payrollPeriods,
  payrollRuns,
} from "@/db/schema";
import {
  employeeLoanDeductionHistoryPageSchema,
  employeeLoanScheduleSchema,
  employeeLoanListSchema,
  employeeLoanSummarySchema,
  insertEmployeeLoanSchema,
  skipLoanInstallmentSchema,
  type EmployeeLoanList,
  type EmployeeLoanDeductionHistoryPage,
  type EmployeeLoanScheduleRow,
  type EmployeeLoanSummary,
  type InsertEmployeeLoanSchemaType,
} from "@/zod-schemas/employeeLoan";
import { stripCommas } from "@/lib/number";
import { actionClient } from "@/lib/safe-action";
import { flattenValidationErrors } from "next-safe-action";
import { ensureSemiMonthlyPayrollPeriods } from "@/lib/payroll/engine";
import { fetchConfirmedHolidayRowsForRange } from "@/lib/holidays";
import {
  generateLoanInstallmentPlan,
} from "@/lib/payroll/loan";
import { getNextSemiMonthlyCode, parsePayrollCode } from "@/lib/payroll/calendar";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";
import { employeeCodeSql } from "@/lib/employeeCodeSql";
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";

const LOAN_HISTORY_PAGE_SIZE = 10;
const PAID_WITH_RELOAN_STATUS = "Paid With Reloan";
const LOAN_EMPLOYEE_SEARCH_LIMIT = 20;

type LoanPaymentTerms =
  | "Always"
  | "First Payroll"
  | "Second Payroll"
  | "Third Payroll"
  | "Fourth Payroll";

type PayrollPeriodLookup = {
  id: string;
  code: string;
};

type LoanReferencePreview = {
  loanReferenceNumber: string;
  hasActiveConflict: boolean;
  message?: string;
};

type LoanReferenceContext = {
  employeeId: string;
  accountCodeId: number;
  loanId?: string | null;
};

type LoanReferenceDatabase = Pick<
  typeof db,
  "delete" | "execute" | "insert" | "query" | "select" | "update"
>;

export type LoanEmployeeSearchResult = {
  id: string;
  employeeNo: string;
  employeeType: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
};

function normalizeMoneyString(value: string) {
  return stripCommas(value).trim();
}

function toDecimalString(value: string | number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return numeric.toFixed(2);
}

function toAmount(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  return Number(typeof value === "number" ? value : normalizeMoneyString(value));
}

function normalizeTermMonths(value: number) {
  return Math.min(120, Math.max(1, Math.floor(value)));
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function normalizePage(page: number) {
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function formatLoanReferenceSequence(index: number) {
  return String(Math.max(0, Math.floor(index)) + 1).padStart(3, "0");
}

function normalizeLoanReferenceText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/PAG[\s-]*IBIG/g, "PAGIBIG")
    .replace(/\s+/g, " ");
}

function normalizeLoanReferenceSegment(value: string | null | undefined) {
  return normalizeLoanReferenceText(value)
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getLoanReferenceAccountCode(args: {
  accountCode: string;
  description: string | null;
  accountType: string | null;
}) {
  const description = normalizeLoanReferenceText(args.description);
  const accountCodeText = normalizeLoanReferenceText(args.accountCode);
  const searchableText = `${description} ${accountCodeText}`.trim();

  if (args.accountType === "Other Deduction") {
    return (
      normalizeLoanReferenceSegment(args.description) ||
      normalizeLoanReferenceSegment(args.accountCode) ||
      "OTHER-DEDUCTION"
    );
  }

  if (args.accountType !== "Loan") {
    return normalizeLoanReferenceSegment(args.description || args.accountCode) || "LOAN";
  }

  if (searchableText.includes("SSS") && searchableText.includes("SALARY")) {
    return "SSS-SL";
  }

  if (searchableText.includes("SSS") && searchableText.includes("CALAMITY")) {
    return "SSS-CL";
  }

  if (
    (searchableText.includes("HDMF") || searchableText.includes("PAGIBIG")) &&
    searchableText.includes("SALARY")
  ) {
    return "HDMF-SL";
  }

  if (
    (searchableText.includes("HDMF") || searchableText.includes("PAGIBIG")) &&
    searchableText.includes("CALAMITY")
  ) {
    return "HDMF-CL";
  }

  if (searchableText.includes("COMPANY")) {
    return "CL";
  }

  if (searchableText.includes("EMERGENCY")) {
    return "EL";
  }

  const fallbackSource = description || accountCodeText;
  const fallbackCode = fallbackSource
    .split(/[^A-Z0-9]+/)
    .filter((part) => part && part !== "LOAN")
    .map((part) => part[0])
    .join("");

  return fallbackCode || accountCodeText || "LOAN";
}

function formatLoanReferenceNumber(args: {
  employeeNo: string;
  loanCode: string;
  sequence: string;
}) {
  return `${formatEmployeeNoDisplay(args.employeeNo)}-${args.loanCode}-${args.sequence}`;
}

function normalizeAccountCodeId(value: string | number | null | undefined) {
  const accountCodeId = Number(value);
  return Number.isFinite(accountCodeId) && accountCodeId > 0
    ? accountCodeId
    : null;
}

async function lockLoanReferenceScope(
  tx: LoanReferenceDatabase,
  employeeId: string,
  accountCodeId: number
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${employeeId}:${accountCodeId}`}))`
  );
}

async function findActiveLoanConflict(
  database: LoanReferenceDatabase,
  { employeeId, accountCodeId, loanId }: LoanReferenceContext
) {
  const conditions = [
    eq(employeesLoans.employeeId, employeeId),
    eq(employeesLoans.accountCodeId, accountCodeId),
    eq(employeesLoans.status, "Active"),
    isNull(employeesLoans.deletedAt),
  ];

  if (loanId) {
    conditions.push(ne(employeesLoans.id, loanId));
  }

  const [conflict] = await database
    .select({
      id: employeesLoans.id,
      loanReferenceNumber: employeesLoans.loanReferenceNumber,
    })
    .from(employeesLoans)
    .where(and(...conditions))
    .limit(1);

  return conflict ?? null;
}

async function buildLoanReferencePreview(
  database: LoanReferenceDatabase,
  { employeeId, accountCodeId, loanId }: LoanReferenceContext
): Promise<LoanReferencePreview> {
  const [employeeRow] = await database
    .select({ employeeNo: employees.employeeNo })
    .from(employees)
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
    .limit(1);
  const [accountRow] = await database
    .select({
      accountCode: accountCode.accountCode,
      description: accountCode.description,
      accountType: accountCode.accountType,
    })
    .from(accountCode)
    .where(eq(accountCode.id, accountCodeId))
    .limit(1);
  const existingLoan = loanId
    ? await database.query.employeesLoans.findFirst({
        where: eq(employeesLoans.id, loanId),
      })
    : null;

  if (!employeeRow || !accountRow) {
    return {
      loanReferenceNumber: "",
      hasActiveConflict: false,
      message: "Select a valid employee and account code.",
    };
  }

  const conflict = await findActiveLoanConflict(database, {
    employeeId,
    accountCodeId,
    loanId,
  });
  const conflictMessage = conflict
    ? `This employee already has an active ${accountRow.accountCode} loan (${conflict.loanReferenceNumber}).`
    : undefined;

  if (existingLoan) {
    return {
      loanReferenceNumber: existingLoan.loanReferenceNumber,
      hasActiveConflict: Boolean(conflict),
      message: conflictMessage,
    };
  }

  const [countRow] = await database
    .select({ total: sql<number>`count(*)` })
    .from(employeesLoans)
    .where(
      and(
        eq(employeesLoans.employeeId, employeeId),
        eq(employeesLoans.accountCodeId, accountCodeId),
        isNull(employeesLoans.deletedAt)
      )
    );

  const loanReferenceNumber = formatLoanReferenceNumber({
    employeeNo: employeeRow.employeeNo,
    loanCode: getLoanReferenceAccountCode({
      accountCode: accountRow.accountCode,
      description: accountRow.description,
      accountType: accountRow.accountType,
    }),
    sequence: formatLoanReferenceSequence(Number(countRow?.total ?? 0)),
  });

  return {
    loanReferenceNumber,
    hasActiveConflict: Boolean(conflict),
    message: conflictMessage,
  };
}

async function resolveNewLoanReference(
  tx: LoanReferenceDatabase,
  { employeeId, accountCodeId }: LoanReferenceContext
) {
  await lockLoanReferenceScope(tx, employeeId, accountCodeId);

  const preview = await buildLoanReferencePreview(tx, {
    employeeId,
    accountCodeId,
  });

  if (preview.hasActiveConflict) {
    throw new Error(
      preview.message ??
        "This employee already has an active loan with the same account code."
    );
  }

  if (!preview.loanReferenceNumber) {
    throw new Error("Unable to generate loan reference number.");
  }

  return preview.loanReferenceNumber;
}

async function assertNoActiveLoanConflict(
  tx: LoanReferenceDatabase,
  context: LoanReferenceContext
) {
  const conflict = await findActiveLoanConflict(tx, context);

  if (conflict) {
    throw new Error(
      `This employee already has an active loan with the same account code (${conflict.loanReferenceNumber}).`
    );
  }
}

export async function getLoanReferencePreview(args: {
  employeeId?: string | null;
  accountCodeId?: string | number | null;
  loanId?: string | null;
}): Promise<LoanReferencePreview> {
  await requireAdminActor();

  const employeeId = args.employeeId?.trim();
  const accountCodeId = normalizeAccountCodeId(args.accountCodeId);

  if (!employeeId || accountCodeId == null) {
    return {
      loanReferenceNumber: "",
      hasActiveConflict: false,
    };
  }

  return buildLoanReferencePreview(db, {
    employeeId,
    accountCodeId,
    loanId: args.loanId ?? null,
  });
}

function toLoanPaymentTerms(value: string): LoanPaymentTerms {
  return value as LoanPaymentTerms;
}

function getLastScheduleAnchor<T extends { payrollCode: string; installmentNo: number; status: string }>(
  installments: T[]
) {
  return installments
    .filter((installment) =>
      installment.status === "Paid" || installment.status === "Skipped"
    )
    .sort((left, right) => {
      if (left.installmentNo !== right.installmentNo) {
        return right.installmentNo - left.installmentNo;
      }

      return right.payrollCode.localeCompare(left.payrollCode);
    })[0];
}

function isPayrollDeductibleLoanStatus(status: string) {
  return status === "Active";
}

function normalizeCompletedLoanStatus(status: string) {
  return status === PAID_WITH_RELOAN_STATUS ? PAID_WITH_RELOAN_STATUS : "Paid";
}

function isPendingOrDueInstallment(status: string) {
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
  tx: LoanReferenceDatabase,
  payrollCodes: string[]
): Promise<PayrollPeriodLookup[]> {
  const uniqueCodes = uniqueStrings(payrollCodes);
  if (uniqueCodes.length === 0) return [];

  return tx
    .select({
      id: payrollPeriods.id,
      code: payrollPeriods.code,
    })
    .from(payrollPeriods)
    .where(inArray(payrollPeriods.code, uniqueCodes));
}

async function markAffectedLoanRunsStale(
  tx: LoanReferenceDatabase,
  payrollCodes: string[],
  actorUserId?: string
) {
  const affectedCodes = uniqueStrings(payrollCodes);
  if (affectedCodes.length === 0) return;

  const affectedPeriods = await resolvePeriodsByCodes(tx, affectedCodes);
  const affectedPeriodIds = affectedPeriods.map((period: PayrollPeriodLookup) => period.id);
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
    (run: { status: string }) => run.status === "Approved" || run.status === "Posted"
  );

  if (blockingRun) {
    throw new Error(
      `Loan changes are blocked because payroll period ${blockingRun.periodCode} already has a ${blockingRun.status} run.`
    );
  }

  const staleRunIds = affectedRuns
    .filter((run: { status: string }) => run.status === "Draft" || run.status === "Reviewed")
    .map((run: { id: string }) => run.id);

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

  if (actorUserId) {
    for (const runId of staleRunIds) {
      await recordPayrollRunEvent({
        payrollRunId: runId,
        actorUserId,
        eventType: "MarkedStale",
        toStatus: "Stale",
        database: tx,
        notes: "Marked stale because loan schedule data changed.",
      });
    }
  }
}

async function createLoanRecord(args: {
  tx: LoanReferenceDatabase;
  parsedInput: InsertEmployeeLoanSchemaType;
  paymentTerms: LoanPaymentTerms;
  normalizedAmountGranted: string;
  normalizedPayableLoan: string;
  normalizedLoanTotalCredit: string;
  normalizedAmortization: string;
  termMonths: number;
  payableAmount: number;
  amortizationAmount: number;
  holidays: Array<{ holidayDate: string }>;
}) {
  const loanReferenceNumber = await resolveNewLoanReference(args.tx, {
    employeeId: args.parsedInput.employeeId,
    accountCodeId: args.parsedInput.accountCodeId,
  });

  const installments = generateLoanInstallmentPlan({
    firstPayrollCode: args.parsedInput.payrollDateDeduction,
    paymentTerms: args.paymentTerms,
    payableAmount: args.payableAmount,
    amortization:
      args.amortizationAmount > 0 ? args.amortizationAmount : args.payableAmount,
    holidays: args.holidays,
  });

  const payrollCodes = installments.map((installment) => installment.payrollCode);
  await ensurePayrollPeriodsForCodes(payrollCodes);
  const knownPeriods = await resolvePeriodsByCodes(args.tx, payrollCodes);
  const periodByCode = new Map<string, string>(
    knownPeriods.map((period: PayrollPeriodLookup) => [period.code, period.id])
  );

  const loanInsert: typeof employeesLoans.$inferInsert = {
    id: args.parsedInput.id,
    employeeId: args.parsedInput.employeeId,
    accountCodeId: args.parsedInput.accountCodeId,
    loanReferenceNumber,
    amountGranted: toDecimalString(args.normalizedAmountGranted),
    payrollDateDeduction: args.parsedInput.payrollDateDeduction,
    loanDate: args.parsedInput.loanDate,
    paymentTerms: "Always",
    termMonths: args.termMonths,
    payableLoan: args.normalizedPayableLoan,
    loanTotalCredit: toDecimalString(args.normalizedLoanTotalCredit),
    amortization: args.normalizedAmortization,
    loanBalance: toDecimalString(args.payableAmount),
    status: args.parsedInput.status as
      | "Active"
      | "Paid"
      | "Paid With Reloan"
      | "Inactive",
    loanPaymentDate: args.parsedInput.loanPaymentDate || null,
  };

  const [createdLoan] = await args.tx
    .insert(employeesLoans)
    .values(loanInsert)
    .returning({ id: employeesLoans.id });

  if (installments.length > 0) {
    const installmentRows: Array<typeof loanInstallments.$inferInsert> = installments.map(
      (installment) => ({
        loanId: createdLoan.id,
        payrollPeriodId: periodByCode.get(installment.payrollCode) ?? null,
        payrollCode: installment.payrollCode,
        installmentNo: installment.installmentNo,
        dueDate: installment.dueDate,
        scheduledAmount: installment.scheduledAmount.toFixed(2),
        balanceAfter: installment.balanceAfter.toFixed(2),
        status: "Pending",
      })
    );
    await args.tx.insert(loanInstallments).values(installmentRows);
  }

  return {
    id: createdLoan.id,
    loanReferenceNumber,
    mode: "created" as const,
  };
}

async function updateLoanRecord(args: {
  tx: LoanReferenceDatabase;
  loanId: string;
  actorUserId: string;
  parsedInput: InsertEmployeeLoanSchemaType;
  paymentTerms: LoanPaymentTerms;
  normalizedAmountGranted: string;
  normalizedPayableLoan: string;
  normalizedLoanTotalCredit: string;
  normalizedAmortization: string;
  payableAmount: number;
  amortizationAmount: number;
  holidays: Array<{ holidayDate: string }>;
}) {
  const existingLoan = await args.tx.query.employeesLoans.findFirst({
    where: eq(employeesLoans.id, args.loanId),
  });

  if (!existingLoan) {
    throw new Error("Loan record not found.");
  }

  await lockLoanReferenceScope(
    args.tx,
    existingLoan.employeeId,
    existingLoan.accountCodeId ?? args.parsedInput.accountCodeId
  );

  await args.tx.execute(
    sql`select id from employees_loans where id = ${args.loanId} for update`
  );

  const [paymentAggregate] = await args.tx
    .select({
      totalPaid: sql<string>`COALESCE(SUM(${loanPayments.amountPaid}), 0)`,
      latestPaymentDate: sql<string | null>`MAX(${loanPayments.paymentDate})`,
    })
    .from(loanPayments)
    .where(eq(loanPayments.loanId, args.loanId));

  const totalPaid = roundMoney(toAmount(paymentAggregate?.totalPaid));
  const recalculatedBalance = roundMoney(Math.max(0, args.payableAmount - totalPaid));
  const termMonths = normalizeTermMonths(args.parsedInput.termMonths);
  const amortizationAmount = roundMoney(toAmount(args.normalizedAmortization));
  const normalizedAmortization = toDecimalString(args.normalizedAmortization);

  const existingInstallments = await args.tx
    .select({
      id: loanInstallments.id,
      payrollCode: loanInstallments.payrollCode,
      installmentNo: loanInstallments.installmentNo,
      status: loanInstallments.status,
    })
    .from(loanInstallments)
    .where(eq(loanInstallments.loanId, args.loanId))
    .orderBy(asc(loanInstallments.installmentNo), asc(loanInstallments.dueDate));

  const scheduleAnchor = getLastScheduleAnchor(existingInstallments);
  const regenerableInstallments = existingInstallments.filter(
    (installment: { installmentNo: number; status: string }) =>
      isPendingOrDueInstallment(installment.status) &&
      (!scheduleAnchor || installment.installmentNo > scheduleAnchor.installmentNo)
  );
  const requestedStatus = args.parsedInput.status as
    | "Active"
    | "Paid"
    | "Paid With Reloan"
    | "Inactive";
  const nextLoanStatus =
    recalculatedBalance <= 0
      ? normalizeCompletedLoanStatus(requestedStatus)
      : requestedStatus;

  if (nextLoanStatus === "Active" && existingLoan.accountCodeId != null) {
    await assertNoActiveLoanConflict(args.tx, {
      employeeId: existingLoan.employeeId,
      accountCodeId: existingLoan.accountCodeId,
      loanId: args.loanId,
    });
  }

  const payrollDeductibleStatusChanged =
    isPayrollDeductibleLoanStatus(existingLoan.status) !==
    isPayrollDeductibleLoanStatus(nextLoanStatus);
  const statusAffectedPayrollCodes = payrollDeductibleStatusChanged
    ? existingInstallments
        .filter((installment: { status: string }) =>
          isPendingOrDueInstallment(installment.status)
        )
        .map((installment: { payrollCode: string }) => installment.payrollCode)
    : [];

  const scheduleChanged =
    normalizeMoneyString(existingLoan.payableLoan) !== args.normalizedPayableLoan ||
    normalizeMoneyString(existingLoan.amortization) !== normalizedAmortization ||
    existingLoan.termMonths !== termMonths ||
    existingLoan.payrollDateDeduction !== args.parsedInput.payrollDateDeduction ||
    existingLoan.paymentTerms !== "Always";

  if (scheduleChanged) {
    const startPayrollCode = scheduleAnchor
      ? getNextSemiMonthlyCode(scheduleAnchor.payrollCode)
      : args.parsedInput.payrollDateDeduction;

    const regeneratedInstallments =
      recalculatedBalance > 0 && startPayrollCode
        ? generateLoanInstallmentPlan({
            firstPayrollCode: startPayrollCode,
            paymentTerms: "Always",
            payableAmount: recalculatedBalance,
            amortization: amortizationAmount > 0 ? amortizationAmount : recalculatedBalance,
            holidays: args.holidays,
          })
        : [];

    const newPayrollCodes = regeneratedInstallments.map(
      (installment) => installment.payrollCode
    );
    const oldPayrollCodes = regenerableInstallments.map(
      (installment: { payrollCode: string }) => installment.payrollCode
    );
    const affectedPayrollCodes = uniqueStrings([
      ...oldPayrollCodes,
      ...newPayrollCodes,
      ...statusAffectedPayrollCodes,
    ]);

    await ensurePayrollPeriodsForCodes(newPayrollCodes);
    await markAffectedLoanRunsStale(args.tx, affectedPayrollCodes, args.actorUserId);

    const periodRows = await resolvePeriodsByCodes(args.tx, newPayrollCodes);
    const periodByCode = new Map<string, string>(
      periodRows.map((period: PayrollPeriodLookup) => [period.code, period.id])
    );

    const unpaidIds = regenerableInstallments.map(
      (installment: { id: string }) => installment.id
    );
    if (unpaidIds.length > 0) {
      await args.tx
        .delete(loanInstallments)
        .where(inArray(loanInstallments.id, unpaidIds));
    }

    if (regeneratedInstallments.length > 0) {
      const installmentOffset = scheduleAnchor?.installmentNo ?? 0;

      const installmentRows: Array<typeof loanInstallments.$inferInsert> =
        regeneratedInstallments.map((installment) => ({
          loanId: args.loanId,
          payrollPeriodId: periodByCode.get(installment.payrollCode) ?? null,
          payrollCode: installment.payrollCode,
          installmentNo: installmentOffset + installment.installmentNo,
          dueDate: installment.dueDate,
          scheduledAmount: installment.scheduledAmount.toFixed(2),
          balanceAfter: installment.balanceAfter.toFixed(2),
          status: "Pending",
        }));

      await args.tx.insert(loanInstallments).values(installmentRows);
    }

    await recordAdminAuditEvent({
      actorUserId: args.actorUserId,
      entityType: "employee_loan",
      entityId: args.loanId,
      action: "employee_loan.schedule_regenerated",
      database: args.tx,
      details: {
        termMonths,
        amortization: normalizedAmortization,
        currentBalance: recalculatedBalance.toFixed(2),
        regeneratedInstallmentCount: regeneratedInstallments.length,
      },
    });
  }

  if (!scheduleChanged && statusAffectedPayrollCodes.length > 0) {
    await markAffectedLoanRunsStale(
      args.tx,
      statusAffectedPayrollCodes,
      args.actorUserId
    );
  }

  const nextLoanPaymentDate =
    recalculatedBalance <= 0
      ? existingLoan.loanPaymentDate ?? paymentAggregate?.latestPaymentDate ?? null
      : args.parsedInput.loanPaymentDate || null;

  await args.tx
    .update(employeesLoans)
    .set({
      employeeId: existingLoan.employeeId,
      accountCodeId: existingLoan.accountCodeId,
      loanReferenceNumber: existingLoan.loanReferenceNumber,
      amountGranted: toDecimalString(args.normalizedAmountGranted),
      payrollDateDeduction: args.parsedInput.payrollDateDeduction,
      loanDate: args.parsedInput.loanDate,
      paymentTerms: "Always",
      termMonths,
      payableLoan: args.normalizedPayableLoan,
      loanTotalCredit: toDecimalString(args.normalizedLoanTotalCredit),
      amortization: normalizedAmortization,
      loanBalance: toDecimalString(recalculatedBalance),
      status: nextLoanStatus,
      loanPaymentDate: nextLoanPaymentDate,
      updatedAt: new Date(),
    })
    .where(eq(employeesLoans.id, args.loanId));

  return {
    id: args.loanId,
    loanReferenceNumber: existingLoan.loanReferenceNumber,
    mode: "updated" as const,
  };
}

export async function getEmployeeLoan(loanId: string): Promise<EmployeeLoanList[]> {
  const result = await db
    .select({
      id: employeesLoans.id,
      employeeId: employeesLoans.employeeId,
      accountCodeId: employeesLoans.accountCodeId,
      loanReferenceNumber: employeesLoans.loanReferenceNumber,
      amountGranted: employeesLoans.amountGranted,
      payrollDateDeduction: employeesLoans.payrollDateDeduction,
      loanDate: employeesLoans.loanDate,
      paymentTerms: employeesLoans.paymentTerms,
      termMonths: employeesLoans.termMonths,
      payableLoan: employeesLoans.payableLoan,
      loanTotalCredit: employeesLoans.loanTotalCredit,
      amortization: employeesLoans.amortization,
      loanBalance: employeesLoans.loanBalance,
      loanPaymentDate: employeesLoans.loanPaymentDate,
      status: employeesLoans.status,
      employeeNo: employees.employeeNo,
      employeeType: employees.employeeType,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
      accountCode: accountCode.accountCode,
      accountCodeDescription: accountCode.description,
      accountCodeType: accountCode.accountType,
    })
    .from(employeesLoans)
    .leftJoin(employees, eq(employeesLoans.employeeId, employees.id))
    .leftJoin(accountCode, eq(employeesLoans.accountCodeId, accountCode.id))
    .where(eq(employeesLoans.id, loanId))
    .orderBy(asc(employeesLoans.loanDate));

  return employeeLoanListSchema.array().parse(result);
}

export async function getEmployeeLoanFormData(
  loanId: string
): Promise<{
  loanRecord: EmployeeLoanList | null;
  loanSummary: EmployeeLoanSummary | null;
}> {
  const result = await db
    .select({
      id: employeesLoans.id,
      employeeId: employeesLoans.employeeId,
      accountCodeId: employeesLoans.accountCodeId,
      loanReferenceNumber: employeesLoans.loanReferenceNumber,
      amountGranted: employeesLoans.amountGranted,
      payrollDateDeduction: employeesLoans.payrollDateDeduction,
      loanDate: employeesLoans.loanDate,
      paymentTerms: employeesLoans.paymentTerms,
      termMonths: employeesLoans.termMonths,
      payableLoan: employeesLoans.payableLoan,
      loanTotalCredit: employeesLoans.loanTotalCredit,
      amortization: employeesLoans.amortization,
      loanBalance: employeesLoans.loanBalance,
      loanPaymentDate: employeesLoans.loanPaymentDate,
      status: employeesLoans.status,
      employeeNo: employees.employeeNo,
      employeeType: employees.employeeType,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
      accountCode: accountCode.accountCode,
      accountCodeDescription: accountCode.description,
      accountCodeType: accountCode.accountType,
      totalDeducted: sql<string>`COALESCE(SUM(${loanPayments.amountPaid}), 0)`,
      currentBalance: employeesLoans.loanBalance,
      summaryPayableLoan: employeesLoans.payableLoan,
    })
    .from(employeesLoans)
    .leftJoin(employees, eq(employeesLoans.employeeId, employees.id))
    .leftJoin(accountCode, eq(employeesLoans.accountCodeId, accountCode.id))
    .leftJoin(loanPayments, eq(loanPayments.loanId, employeesLoans.id))
    .where(eq(employeesLoans.id, loanId))
    .groupBy(
      employeesLoans.id,
      employeesLoans.employeeId,
      employeesLoans.accountCodeId,
      employeesLoans.loanReferenceNumber,
      employeesLoans.amountGranted,
      employeesLoans.payrollDateDeduction,
      employeesLoans.loanDate,
      employeesLoans.paymentTerms,
      employeesLoans.termMonths,
      employeesLoans.payableLoan,
      employeesLoans.loanTotalCredit,
      employeesLoans.amortization,
      employeesLoans.loanBalance,
      employeesLoans.loanPaymentDate,
      employeesLoans.status,
      employees.employeeNo,
      employees.employeeType,
      employees.firstName,
      employees.lastName,
      accountCode.accountCode,
      accountCode.description,
      accountCode.accountType
    )
    .limit(1);

  const row = result[0];
  if (!row) {
    return {
      loanRecord: null,
      loanSummary: null,
    };
  }

  const loanRecord = employeeLoanListSchema.parse({
    id: row.id,
    employeeId: row.employeeId,
    accountCodeId: row.accountCodeId,
    loanReferenceNumber: row.loanReferenceNumber,
    amountGranted: row.amountGranted,
    payrollDateDeduction: row.payrollDateDeduction,
    loanDate: row.loanDate,
    paymentTerms: row.paymentTerms,
    termMonths: row.termMonths,
    payableLoan: row.payableLoan,
    loanTotalCredit: row.loanTotalCredit,
    amortization: row.amortization,
    loanBalance: row.loanBalance,
    loanPaymentDate: row.loanPaymentDate,
    status: row.status,
    employeeNo: row.employeeNo,
    employeeType: row.employeeType,
    employeeFirstName: row.employeeFirstName,
    employeeLastName: row.employeeLastName,
    accountCode: row.accountCode,
    accountCodeDescription: row.accountCodeDescription,
    accountCodeType: row.accountCodeType,
  });

  const loanSummary = employeeLoanSummarySchema.parse({
    totalDeducted: row.totalDeducted,
    currentBalance: row.currentBalance,
    payableLoan: row.summaryPayableLoan,
  });

  return {
    loanRecord,
    loanSummary,
  };
}

export async function getEmployeeLoanSummary(
  loanId: string
): Promise<EmployeeLoanSummary | null> {
  const [result] = await db
    .select({
      totalDeducted: sql<string>`COALESCE(SUM(${loanPayments.amountPaid}), 0)`,
      currentBalance: employeesLoans.loanBalance,
      payableLoan: employeesLoans.payableLoan,
    })
    .from(employeesLoans)
    .leftJoin(loanPayments, eq(loanPayments.loanId, employeesLoans.id))
    .where(eq(employeesLoans.id, loanId))
    .groupBy(employeesLoans.id, employeesLoans.loanBalance, employeesLoans.payableLoan);

  return result ? employeeLoanSummarySchema.parse(result) : null;
}

export async function getEmployeeLoanDeductionHistory(
  loanId: string,
  page = 1
): Promise<EmployeeLoanDeductionHistoryPage> {
  const normalizedPage = normalizePage(page);

  const [totalRowsResult] = await db
    .select({
      totalRows: sql<number>`cast(count(*) as int)`,
    })
    .from(loanPayments)
    .where(eq(loanPayments.loanId, loanId));

  const totalRows = Number(totalRowsResult?.totalRows ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalRows / LOAN_HISTORY_PAGE_SIZE));
  const currentPage = Math.min(normalizedPage, totalPages);
  const offset = (currentPage - 1) * LOAN_HISTORY_PAGE_SIZE;

  const rows = await db
    .select({
      id: loanPayments.id,
      paymentDate: loanPayments.paymentDate,
      payrollCode: loanInstallments.payrollCode,
      installmentNo: loanInstallments.installmentNo,
      deductedAmount: loanPayments.amountPaid,
      balanceAfter: loanInstallments.balanceAfter,
    })
    .from(loanPayments)
    .leftJoin(loanInstallments, eq(loanPayments.installmentId, loanInstallments.id))
    .where(eq(loanPayments.loanId, loanId))
    .orderBy(desc(loanPayments.paymentDate), desc(loanPayments.createdAt))
    .limit(LOAN_HISTORY_PAGE_SIZE)
    .offset(offset);

  return employeeLoanDeductionHistoryPageSchema.parse({
    rows,
    page: currentPage,
    pageSize: LOAN_HISTORY_PAGE_SIZE,
    totalRows,
    totalPages,
  });
}

export async function getEmployeeLoanSchedule(
  loanId: string
): Promise<EmployeeLoanScheduleRow[]> {
  const rows = await db
    .select({
      id: loanInstallments.id,
      payrollCode: loanInstallments.payrollCode,
      dueDate: loanInstallments.dueDate,
      installmentNo: loanInstallments.installmentNo,
      scheduledAmount: loanInstallments.scheduledAmount,
      balanceAfter: loanInstallments.balanceAfter,
      status: loanInstallments.status,
      skippedAt: loanInstallments.skippedAt,
      skipReason: loanInstallments.skipReason,
    })
    .from(loanInstallments)
    .where(eq(loanInstallments.loanId, loanId))
    .orderBy(asc(loanInstallments.installmentNo), asc(loanInstallments.dueDate))
    .limit(60); // 5 years of semi-monthly installments; enough for all near-term schedule needs

  return employeeLoanScheduleSchema.parse(rows);
}

export async function searchActiveEmployeesForLoan(
  searchText: string
): Promise<LoanEmployeeSearchResult[]> {
  await requireAdminActor();

  const normalizedSearch = searchText.trim();
  if (normalizedSearch.length < 2) return [];

  const pattern = `%${normalizedSearch}%`;
  const compactNamePattern = `%${normalizedSearch
    .toLowerCase()
    .replace(/\s+/g, "%")}%`;

  return db
    .select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      employeeType: employees.employeeType,
      firstName: employees.firstName,
      middleName: employees.middleName,
      lastName: employees.lastName,
    })
    .from(employees)
    .where(
      and(
        isNull(employees.deletedAt),
        or(
          ilike(
            employeeCodeSql({
              employeeType: employees.employeeType,
              employeeNo: employees.employeeNo,
            }),
            pattern
          ),
          ilike(employees.employeeNo, pattern),
          ilike(sql<string>`cast(${employees.employeeType} as text)`, pattern),
          ilike(employees.firstName, pattern),
          ilike(employees.middleName, pattern),
          ilike(employees.lastName, pattern),
          ilike(
            sql<string>`concat(${employees.lastName}, ', ', ${employees.firstName}, ' ', COALESCE(${employees.middleName}, ''))`,
            pattern
          ),
          sql`lower(concat(${employees.firstName}, ' ', ${employees.lastName})) LIKE ${compactNamePattern}`,
          sql`lower(concat(${employees.lastName}, ' ', ${employees.firstName})) LIKE ${compactNamePattern}`
        )!
      )
    )
    .orderBy(
      asc(employees.lastName),
      asc(employees.firstName),
      asc(employees.middleName),
      asc(employees.employeeNo),
      asc(employees.id)
    )
    .limit(LOAN_EMPLOYEE_SEARCH_LIMIT);
}

export const skipLoanInstallmentAction = actionClient
  .metadata({ actionName: "skipLoanInstallmentAction" })
  .schema(skipLoanInstallmentSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(async ({ parsedInput }) => {
    try {
      const actor = await requireAdminActor();

      const holidays = await fetchConfirmedHolidayRowsForRange(
        "2000-01-01",
        "2100-12-31"
      );

      const result = await db.transaction(async (tx) => {
        const loan = await tx.query.employeesLoans.findFirst({
          where: eq(employeesLoans.id, parsedInput.loanId),
        });

        if (!loan) {
          throw new Error("Loan record not found.");
        }

        const existingInstallments = await tx
          .select({
            id: loanInstallments.id,
            payrollCode: loanInstallments.payrollCode,
            installmentNo: loanInstallments.installmentNo,
            status: loanInstallments.status,
          })
          .from(loanInstallments)
          .where(eq(loanInstallments.loanId, loan.id))
          .orderBy(asc(loanInstallments.installmentNo), asc(loanInstallments.dueDate));

        const installmentToSkip = existingInstallments.find(
          (installment: { id: string }) => installment.id === parsedInput.installmentId
        );

        if (!installmentToSkip) {
          throw new Error("Installment not found for this loan.");
        }

        if (
          installmentToSkip.status !== "Pending" &&
          installmentToSkip.status !== "Due"
        ) {
          throw new Error("Only pending or due installments can be skipped.");
        }

        const [paymentAggregate] = await tx
          .select({
            totalPaid: sql<string>`COALESCE(SUM(${loanPayments.amountPaid}), 0)`,
          })
          .from(loanPayments)
          .where(eq(loanPayments.loanId, loan.id));

        const currentBalance = roundMoney(
          Math.max(0, toAmount(loan.payableLoan) - toAmount(paymentAggregate?.totalPaid))
        );

        if (currentBalance <= 0) {
          throw new Error("This loan has no remaining balance to reschedule.");
        }

        const futureRegenerableInstallments = existingInstallments.filter(
          (installment: { installmentNo: number; status: string }) =>
            (installment.status === "Pending" || installment.status === "Due") &&
            installment.installmentNo > installmentToSkip.installmentNo
        );

        const termMonths = normalizeTermMonths(loan.termMonths);
        const normalizedAmortization = normalizeMoneyString(loan.amortization);
        const amortizationAmount = roundMoney(toAmount(normalizedAmortization));
        const startPayrollCode = getNextSemiMonthlyCode(
          installmentToSkip.payrollCode
        );
        const regeneratedInstallments =
          startPayrollCode && currentBalance > 0
            ? generateLoanInstallmentPlan({
                firstPayrollCode: startPayrollCode,
                paymentTerms: "Always",
                payableAmount: currentBalance,
                amortization:
                  amortizationAmount > 0 ? amortizationAmount : currentBalance,
                holidays,
              })
            : [];

        const oldPayrollCodes = futureRegenerableInstallments.map(
          (installment: { payrollCode: string }) => installment.payrollCode
        );
        const newPayrollCodes = regeneratedInstallments.map(
          (installment) => installment.payrollCode
        );
        const affectedPayrollCodes = uniqueStrings([
          installmentToSkip.payrollCode,
          ...oldPayrollCodes,
          ...newPayrollCodes,
        ]);

        await ensurePayrollPeriodsForCodes(affectedPayrollCodes);
        await markAffectedLoanRunsStale(tx, affectedPayrollCodes, actor.userId);

        await tx
          .update(loanInstallments)
          .set({
            status: "Skipped",
            balanceAfter: currentBalance.toFixed(2),
            skippedAt: new Date(),
            skippedByUserId: actor.userId,
            skipReason: parsedInput.skipReason,
            updatedAt: new Date(),
          })
          .where(eq(loanInstallments.id, installmentToSkip.id));

        const futureRegenerableIds = futureRegenerableInstallments.map(
          (installment: { id: string }) => installment.id
        );
        if (futureRegenerableIds.length > 0) {
          await tx
            .delete(loanInstallments)
            .where(inArray(loanInstallments.id, futureRegenerableIds));
        }

        if (regeneratedInstallments.length > 0) {
          const periodRows = await resolvePeriodsByCodes(tx, newPayrollCodes);
          const periodByCode = new Map<string, string>(
            periodRows.map((period: PayrollPeriodLookup) => [period.code, period.id])
          );

          const installmentRows: Array<typeof loanInstallments.$inferInsert> =
            regeneratedInstallments.map((installment) => ({
              loanId: loan.id,
              payrollPeriodId: periodByCode.get(installment.payrollCode) ?? null,
              payrollCode: installment.payrollCode,
              installmentNo:
                installmentToSkip.installmentNo + installment.installmentNo,
              dueDate: installment.dueDate,
              scheduledAmount: installment.scheduledAmount.toFixed(2),
              balanceAfter: installment.balanceAfter.toFixed(2),
              status: "Pending",
            }));

          await tx.insert(loanInstallments).values(installmentRows);
        }

        await tx
          .update(employeesLoans)
          .set({
            paymentTerms: "Always",
            amortization: normalizedAmortization,
            loanBalance: currentBalance.toFixed(2),
            status: currentBalance <= 0 ? "Paid" : loan.status,
            updatedAt: new Date(),
          })
          .where(eq(employeesLoans.id, loan.id));

        await recordAdminAuditEvent({
          actorUserId: actor.userId,
          entityType: "employee_loan",
          entityId: loan.id,
          action: "employee_loan.installment_skipped",
          database: tx,
          details: {
            installmentId: installmentToSkip.id,
            payrollCode: installmentToSkip.payrollCode,
            skipReason: parsedInput.skipReason,
          },
        });

        await recordAdminAuditEvent({
          actorUserId: actor.userId,
          entityType: "employee_loan",
          entityId: loan.id,
          action: "employee_loan.schedule_regenerated",
          database: tx,
          details: {
            termMonths,
            amortization: normalizedAmortization,
            currentBalance: currentBalance.toFixed(2),
            regeneratedInstallmentCount: regeneratedInstallments.length,
          },
        });

        return {
          loanId: loan.id,
          skippedInstallmentId: installmentToSkip.id,
        };
      });

      revalidatePath("/loans");
      return {
        message: "Installment skipped and loan schedule recalculated.",
        ...result,
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error(error);
        return { error: error.message };
      }

      console.error(error);
      return { error: "Unexpected error while skipping the installment." };
    }
  });

export const saveEmployeeLoanAction = actionClient
  .metadata({ actionName: "saveEmployeeLoanAction" })
  .schema(insertEmployeeLoanSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: InsertEmployeeLoanSchemaType }) => {
      try {
        const actor = await requireAdminActor();
        const normalizedAmountGranted = normalizeMoneyString(parsedInput.amountGranted);
        const normalizedPayableLoan = normalizeMoneyString(parsedInput.payableLoan);
        const normalizedLoanTotalCredit = normalizeMoneyString(parsedInput.loanTotalCredit);
        const normalizedAmortization = normalizeMoneyString(parsedInput.amortization);
        const payableAmount = roundMoney(toAmount(normalizedPayableLoan));
        const termMonths = normalizeTermMonths(parsedInput.termMonths);
        const amortizationAmount = roundMoney(toAmount(normalizedAmortization));
        const paymentTerms = toLoanPaymentTerms("Always");

        const parsedPayrollCode = parsePayrollCode(parsedInput.payrollDateDeduction);
        if (parsedPayrollCode) {
          await ensureSemiMonthlyPayrollPeriods(parsedPayrollCode.year);
        }

        const holidays = await fetchConfirmedHolidayRowsForRange(
          "2000-01-01",
          "2100-12-31"
        );

        const result = await db.transaction(async (tx) => {
          const existingLoan =
            parsedInput.id == null
              ? null
              : await tx.query.employeesLoans.findFirst({
                  where: eq(employeesLoans.id, parsedInput.id),
                });

          if (existingLoan) {
            return updateLoanRecord({
              tx,
              loanId: existingLoan.id,
              parsedInput,
              paymentTerms,
              normalizedAmountGranted,
              normalizedPayableLoan,
              normalizedLoanTotalCredit,
              normalizedAmortization,
              payableAmount,
              amortizationAmount,
              holidays,
              actorUserId: actor.userId,
            });
          }

          return createLoanRecord({
            tx,
            parsedInput,
            paymentTerms,
            normalizedAmountGranted,
            normalizedPayableLoan,
            normalizedLoanTotalCredit,
            normalizedAmortization,
            termMonths,
            payableAmount,
            amortizationAmount,
            holidays,
          });
        });

        await recordAdminAuditEvent({
          actorUserId: actor.userId,
          entityType: "employee_loan",
          entityId: result.id,
          action:
            result.mode === "updated" ? "employee_loan.updated" : "employee_loan.created",
          details: {
            loanReferenceNumber: result.loanReferenceNumber,
            employeeId: parsedInput.employeeId,
            paymentTerms: "Always",
            termMonths,
            amortization: normalizedAmortization,
          },
        });

        revalidatePath("/loans");
        revalidatePath("/payroll");
        return {
          message:
            result.mode === "updated"
              ? `Loan #${result.id} updated successfully.`
              : `Loan #${result.id} created successfully.`,
        };
      } catch (error: unknown) {
        if (error instanceof Error) {
          console.error(error);
          return { error: error.message };
        }

        console.error(error);
        return { error: "Unexpected error while saving the loan." };
      }
    }
  );

"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import type {
  PayrollAgencySummaryView,
  PayrollEmployeeDailyAdjustmentRowView,
  PayrollExceptionAccountCodeOptionView,
  PayrollExceptionWorkspaceView,
  PayrollLoanDeductionView,
  ManualPayrollAccountCodeOptionView,
  ManualPayrollEntryWorkspaceView,
  PayrollPayslipView,
  PayrollRunEmployeeDetailView,
  PayrollRegisterReportView,
  PayrollRunEmployeeView,
  PayrollRunHeaderView,
  PayrollRunLineView,
  PayrollRunPeriodView,
  PayrollWorkspaceSnapshotView,
} from "@/app/(ntg)/payroll/types";
import { db } from "@/db";
import {
  payrollArtifacts,
  payrollDisbursementBatches,
  payrollJournalBatches,
  payrollRunEvents,
  statutoryFilingPackages,
} from "@/db/schema";
import { requireAdminActor } from "@/lib/admin";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/server";
import {
  getEmployeeDepartmentMetadata,
  loadEmployeeDepartmentMetadataByEmployeeId,
  loadEmployeeDepartmentMetadataByPayrollRunId,
  type EmployeeDepartmentMetadata,
} from "@/lib/payroll/employeeDepartment";
import { ensurePayrollFoundationData } from "@/lib/payroll/foundation";
import {
  computeManualPayrollLatestBaseline,
  createOrRecomputePayrollRun,
  ensureSemiMonthlyPayrollPeriods,
  getPayrollPeriod,
  getPayrollRun,
  parsePayrollBreakdownNotes,
  transitionPayrollRunStatus,
} from "@/lib/payroll/engine";
import {
  generateBankBatch,
  generateGlJournal,
  generateStatutoryPackage,
  preflightPayroll,
  publishPayslips,
  reversePayrollRun,
  transitionPayrollRun,
  type PayrollPreflightOptions,
} from "@/lib/payroll/control";
import {
  getEmployeePayrollAdjustmentRows,
  saveEmployeePayrollOvertimeOverride,
} from "@/lib/payroll/overtimeOverrides";
import {
  getEmployeePayrollApprovedLeaveAccountCodeRows,
  getEmployeePayrollExceptionRows,
  getEmployeePayrollManualLeaveAccountCodeRows,
  getEmployeePayrollRecurringEntryRows,
  getPayrollAccountCodeImportSkippedRows,
  getPayrollExceptionAccountCodeOptions,
  getRevertablePayrollAccountCodeImportBatches,
  importPayrollAccountCodeRows,
  revertPayrollAccountCodeImportsForPeriod,
  saveEmployeePayrollExceptionRows,
} from "@/lib/payroll/payrollExceptionRows";
import {
  getEmployeePayrollScheduledLoanRows,
  updateEmployeePayrollLoanInstallmentAmount,
} from "@/lib/payroll/payrollLoanRows";
import {
  deleteManualPayrollEntry,
  getManualAccountCodeOptions,
  getManualPayrollEntryWorkspace,
  saveManualPayrollEntry,
} from "@/lib/payroll/manualPayroll";
import {
  getAgencyDeductionSummary,
  getEmployeePayslip,
  getLeaveUtilizationSummary,
  getLoanDeductionSummary,
  getPayrollRegister,
} from "@/lib/payroll/reports";
import { savePayrollOvertimeOverrideSchema } from "@/zod-schemas/payrollOvertimeOverride";
import {
  importPayrollAccountCodeRowsSchema,
  payrollAccountCodeImportPeriodRevertSchema,
  savePayrollExceptionRowsSchema,
  updatePayrollLoanInstallmentAmountSchema,
} from "@/zod-schemas/payrollExceptionRows";
import {
  deleteManualPayrollEntrySchema,
  saveManualPayrollEntrySchema,
} from "@/zod-schemas/manualPayroll";
import { loadPayrollWorkspaceSnapshot } from "@/lib/payroll/workspaceSnapshot";

const EMPTY_AGENCY_SUMMARY: PayrollAgencySummaryView = {
  sssEmployee: "0",
  philhealthEmployee: "0",
  pagibigEmployee: "0",
  withholdingTax: "0",
  sssEmployer: "0",
  philhealthEmployer: "0",
  pagibigEmployer: "0",
  sssEc: "0",
};

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function serializePayrollPeriod(
  period: {
    id: string;
    code: string;
    startDate: string;
    endDate: string;
    adjustedPayDate: string;
    nominalPayDate: string;
    cycle: "A" | "B";
    status: string;
  } | null
): PayrollRunPeriodView | null {
  if (!period) return null;

  return {
    id: period.id,
    code: period.code,
    startDate: period.startDate,
    endDate: period.endDate,
    adjustedPayDate: period.adjustedPayDate,
    nominalPayDate: period.nominalPayDate,
    cycle: period.cycle,
    status: period.status,
  };
}

function serializePayrollRunLine(line: {
  id: string;
  lineType: string;
  code: string;
  description: string;
  amount: string;
  quantity: string | null;
  rate: string | null;
  taxable: boolean;
  month13thEligible: boolean;
  sourceTable: string | null;
  sourceId: string | null;
}): PayrollRunLineView {
  return {
    id: line.id,
    lineType: line.lineType,
    code: line.code,
    description: line.description,
    amount: line.amount,
    quantity: line.quantity,
    rate: line.rate,
    taxable: line.taxable,
    month13thEligible: line.month13thEligible,
    sourceTable: line.sourceTable,
    sourceId: line.sourceId,
  };
}

function serializePayrollRunEmployee(
  employee: {
    id: string;
    employeeId: string;
    employeeNoSnapshot: string;
    employeeNameSnapshot: string;
    salaryAdjustmentId: number | null;
    salaryAdjustmentMode:
      | "OnePeriodOverride"
      | "ForwardEffective"
      | "MultiPeriodOverride"
      | null;
    regularPay: string;
    grossPay: string;
    taxablePay: string;
    nonTaxablePay: string;
    totalDeductions: string;
    employeeContributions: string;
    employerContributions: string;
    netPay: string;
    breakdownNotes: string | null;
    lines?: Array<{
      id: string;
      lineType: string;
      code: string;
      description: string;
      amount: string;
      quantity: string | null;
      rate: string | null;
      taxable: boolean;
      month13thEligible: boolean;
      sourceTable: string | null;
      sourceId: string | null;
    }>;
  },
  departmentByEmployeeId?: Map<string, EmployeeDepartmentMetadata>
): PayrollRunEmployeeView {
  const parsedNotes = parsePayrollBreakdownNotes(employee.breakdownNotes);
  const departmentMetadata = getEmployeeDepartmentMetadata(
    departmentByEmployeeId,
    employee.employeeId
  );

  return {
    id: employee.id,
    employeeId: employee.employeeId,
    employeeNoSnapshot: employee.employeeNoSnapshot,
    employeeNameSnapshot: employee.employeeNameSnapshot,
    departmentId: departmentMetadata.departmentId,
    departmentName: departmentMetadata.departmentName,
    departmentCode: departmentMetadata.departmentCode,
    salaryAdjustmentId: employee.salaryAdjustmentId,
    salaryAdjustmentMode: employee.salaryAdjustmentMode,
    regularPay: employee.regularPay,
    grossPay: employee.grossPay,
    taxablePay: employee.taxablePay,
    nonTaxablePay: employee.nonTaxablePay,
    totalDeductions: employee.totalDeductions,
    employeeContributions: employee.employeeContributions,
    employerContributions: employee.employerContributions,
    netPay: employee.netPay,
    payComputationMode: parsedNotes.payComputationMode,
    isManualPayrollOverride: parsedNotes.isManualPayrollOverride,
    statutoryMonthlyCompensationBase: parsedNotes.statutoryMonthlyCompensationBase,
    philhealthMonthlyCompensationBase: parsedNotes.philhealthMonthlyCompensationBase,
    sssContributionSource: parsedNotes.sssContributionSource,
    sssSalaryCredit: parsedNotes.sssSalaryCredit,
    sssBracketLabel: parsedNotes.sssBracketLabel,
    breakdownNotes: parsedNotes.breakdownNotes,
    lines: (employee.lines ?? []).map(serializePayrollRunLine),
  };
}

function serializePayrollRunHeader(run: {
  id: string;
  status: string;
  runNumber: number;
  notes: string | null;
  computedAt: Date | null;
  reviewedAt: Date | null;
  approvedAt: Date | null;
  postedAt: Date | null;
  createdAt: Date;
  payrollPeriod: {
    id: string;
    code: string;
    startDate: string;
    endDate: string;
    adjustedPayDate: string;
    nominalPayDate: string;
    cycle: "A" | "B";
    status: string;
  } | null;
}): PayrollRunHeaderView {
  return {
    id: run.id,
    status: run.status,
    runNumber: run.runNumber,
    notes: run.notes,
    computedAt: toIsoString(run.computedAt),
    reviewedAt: toIsoString(run.reviewedAt),
    approvedAt: toIsoString(run.approvedAt),
    postedAt: toIsoString(run.postedAt),
    createdAt: run.createdAt.toISOString(),
    payrollPeriod: serializePayrollPeriod(run.payrollPeriod),
  };
}

function serializePayrollRegisterReport(
  run: Awaited<ReturnType<typeof getPayrollRegister>>,
  departmentByEmployeeId?: Map<string, EmployeeDepartmentMetadata>
): PayrollRegisterReportView | null {
  if (!run) return null;

  return {
    ...serializePayrollRunHeader(run),
    employees: run.employees.map((employee) =>
      serializePayrollRunEmployee(employee, departmentByEmployeeId)
    ),
  };
}

function serializePayrollPayslip(
  payslip: Awaited<ReturnType<typeof getEmployeePayslip>>,
  departmentByEmployeeId?: Map<string, EmployeeDepartmentMetadata>
): PayrollPayslipView | null {
  if (!payslip) return null;

  return {
    ...serializePayrollRunEmployee(payslip, departmentByEmployeeId),
    payrollRun: payslip.payrollRun ? serializePayrollRunHeader(payslip.payrollRun) : null,
  };
}

function serializePayrollControlDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function serializePayrollControlMoney(value: string | number | null | undefined) {
  return value == null ? "0.00" : String(value);
}

export async function seedPayrollFoundation() {
  await requirePermission(AUTH_PERMISSIONS.PAYROLL_RULES_MANAGE);
  await ensurePayrollFoundationData();
  return { ok: true };
}

export async function seedPayrollPeriods(year: number) {
  await requirePermission(AUTH_PERMISSIONS.PAYROLL_MANAGE);
  return ensureSemiMonthlyPayrollPeriods(year);
}

type PayrollReadinessBypassOptions = Pick<
  PayrollPreflightOptions,
  "bypassTemporaryReadinessCategories"
>;

export async function preflightPayrollAction(
  payrollPeriodId: string,
  options: PayrollReadinessBypassOptions = {}
) {
  await requirePermission(AUTH_PERMISSIONS.PAYROLL_COMPUTE);
  return preflightPayroll(payrollPeriodId, options);
}

export async function computePayrollRun(
  payrollPeriodId: string,
  options: PayrollReadinessBypassOptions = {}
) {
  const actor = await requirePermission(AUTH_PERMISSIONS.PAYROLL_COMPUTE);
  const result = await createOrRecomputePayrollRun(
    payrollPeriodId,
    actor.accountId,
    options
  );
  revalidatePath("/payroll");
  return result;
}

export async function reviewPayrollRun(payrollRunId: string) {
  const actor = await requirePermission(AUTH_PERMISSIONS.PAYROLL_REVIEW);
  const result = await transitionPayrollRun({
    payrollRunId,
    nextStatus: "Reviewed",
    actorUserId: actor.accountId,
    transition: transitionPayrollRunStatus,
  });
  revalidatePath("/payroll");
  return result;
}

export async function approvePayrollRun(payrollRunId: string) {
  const actor = await requirePermission(AUTH_PERMISSIONS.PAYROLL_APPROVE);
  const result = await transitionPayrollRun({
    payrollRunId,
    nextStatus: "Approved",
    actorUserId: actor.accountId,
    transition: transitionPayrollRunStatus,
  });
  revalidatePath("/payroll");
  return result;
}

export async function postPayrollRun(payrollRunId: string) {
  const actor = await requirePermission(AUTH_PERMISSIONS.PAYROLL_POST);
  const result = await transitionPayrollRun({
    payrollRunId,
    nextStatus: "Posted",
    actorUserId: actor.accountId,
    transition: transitionPayrollRunStatus,
  });
  revalidatePath("/payroll");
  return result;
}

export async function voidPayrollRun(payrollRunId: string, reason?: string | null) {
  const actor = await requirePermission(AUTH_PERMISSIONS.PAYROLL_REVERSE);
  const result = await transitionPayrollRun({
    payrollRunId,
    nextStatus: "Void",
    actorUserId: actor.accountId,
    transition: transitionPayrollRunStatus,
    notes: reason ?? null,
  });
  revalidatePath("/payroll");
  return result;
}

export async function reversePostedPayrollRunAction(
  payrollRunId: string,
  reason: string
) {
  const actor = await requirePermission(AUTH_PERMISSIONS.PAYROLL_REVERSE);
  const result = await reversePayrollRun({
    payrollRunId,
    actorUserId: actor.accountId,
    reason,
  });
  revalidatePath("/payroll");
  return result;
}

export async function publishPayslipsAction(payrollRunId: string) {
  const actor = await requirePermission(AUTH_PERMISSIONS.PAYROLL_PUBLISH_PAYSLIPS);
  const result = await publishPayslips({
    payrollRunId,
    actorUserId: actor.accountId,
  });
  revalidatePath("/payroll");
  return result;
}

export async function generateBankBatchAction(payrollRunId: string) {
  const actor = await requirePermission(AUTH_PERMISSIONS.PAYROLL_EXPORT);
  const result = await generateBankBatch({
    payrollRunId,
    actorUserId: actor.accountId,
    batchType: "Bank",
    bankAdapter: "PNB",
  });
  revalidatePath("/payroll");
  return result;
}

export async function generateCashBatchAction(payrollRunId: string) {
  const actor = await requirePermission(AUTH_PERMISSIONS.PAYROLL_EXPORT);
  const result = await generateBankBatch({
    payrollRunId,
    actorUserId: actor.accountId,
    batchType: "Cash",
  });
  revalidatePath("/payroll");
  return result;
}

export async function generateGlJournalAction(payrollRunId: string) {
  const actor = await requirePermission(AUTH_PERMISSIONS.PAYROLL_EXPORT);
  const result = await generateGlJournal({
    payrollRunId,
    actorUserId: actor.accountId,
  });
  revalidatePath("/payroll");
  return result;
}

export async function getPayrollControlBundleAction(payrollRunId: string) {
  await requireAdminActor();

  const [artifacts, disbursements, journals, statutoryPackages, events] =
    await Promise.all([
      db
        .select()
        .from(payrollArtifacts)
        .where(eq(payrollArtifacts.payrollRunId, payrollRunId))
        .orderBy(desc(payrollArtifacts.createdAt)),
      db
        .select()
        .from(payrollDisbursementBatches)
        .where(eq(payrollDisbursementBatches.payrollRunId, payrollRunId))
        .orderBy(desc(payrollDisbursementBatches.createdAt)),
      db
        .select()
        .from(payrollJournalBatches)
        .where(eq(payrollJournalBatches.payrollRunId, payrollRunId))
        .orderBy(desc(payrollJournalBatches.createdAt)),
      db
        .select()
        .from(statutoryFilingPackages)
        .where(eq(statutoryFilingPackages.payrollRunId, payrollRunId))
        .orderBy(desc(statutoryFilingPackages.createdAt)),
      db
        .select()
        .from(payrollRunEvents)
        .where(eq(payrollRunEvents.payrollRunId, payrollRunId))
        .orderBy(desc(payrollRunEvents.createdAt)),
    ]);

  return {
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      status: artifact.status,
      format: artifact.format,
      fileName: artifact.fileName,
      storageKey: artifact.storageKey,
      metadata: artifact.metadata,
      generatedByUserId: artifact.generatedByUserId,
      generatedAt: serializePayrollControlDate(artifact.generatedAt),
      publishedByUserId: artifact.publishedByUserId,
      publishedAt: serializePayrollControlDate(artifact.publishedAt),
      createdAt: artifact.createdAt.toISOString(),
    })),
    disbursements: disbursements.map((batch) => ({
      id: batch.id,
      batchType: batch.batchType,
      status: batch.status,
      bankAdapter: batch.bankAdapter,
      employeeCount: batch.employeeCount,
      totalNetPay: serializePayrollControlMoney(batch.totalNetPay),
      artifactId: batch.artifactId,
      createdByUserId: batch.createdByUserId,
      createdAt: batch.createdAt.toISOString(),
      approvedAt: serializePayrollControlDate(batch.approvedAt),
      releasedAt: serializePayrollControlDate(batch.releasedAt),
      reconciledAt: serializePayrollControlDate(batch.reconciledAt),
    })),
    journals: journals.map((journal) => ({
      id: journal.id,
      status: journal.status,
      totalDebits: serializePayrollControlMoney(journal.totalDebits),
      totalCredits: serializePayrollControlMoney(journal.totalCredits),
      artifactId: journal.artifactId,
      createdByUserId: journal.createdByUserId,
      createdAt: journal.createdAt.toISOString(),
      postedAt: serializePayrollControlDate(journal.postedAt),
      reversedAt: serializePayrollControlDate(journal.reversedAt),
    })),
    statutoryPackages: statutoryPackages.map((filing) => ({
      id: filing.id,
      kind: filing.kind,
      status: filing.status,
      periodStart: filing.periodStart,
      periodEnd: filing.periodEnd,
      dueDate: filing.dueDate,
      amountDue: serializePayrollControlMoney(filing.amountDue),
      artifactId: filing.artifactId,
      paymentReference: filing.paymentReference,
      preparedByUserId: filing.preparedByUserId,
      submittedAt: serializePayrollControlDate(filing.submittedAt),
      paidAt: serializePayrollControlDate(filing.paidAt),
      createdAt: filing.createdAt.toISOString(),
    })),
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      actorUserId: event.actorUserId,
      notes: event.notes,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function generateStatutoryPackageAction(
  payrollRunId: string,
  kind: Parameters<typeof generateStatutoryPackage>[0]["kind"]
) {
  const actor = await requirePermission(AUTH_PERMISSIONS.PAYROLL_EXPORT);
  const result = await generateStatutoryPackage({
    payrollRunId,
    actorUserId: actor.accountId,
    kind,
  });
  revalidatePath("/payroll");
  return result;
}

export async function getPayrollRunById(payrollRunId: string) {
  await requireAdminActor();
  return getPayrollRun(payrollRunId);
}

export async function getPayrollRunEmployeeDetailAction(
  payrollRunId: string,
  employeeId: string
): Promise<PayrollRunEmployeeDetailView | null> {
  await requireAdminActor();
  const payslip = await getEmployeePayslip(payrollRunId, employeeId);
  const departmentByEmployeeId = await loadEmployeeDepartmentMetadataByEmployeeId([
    employeeId,
  ]);
  return payslip ? serializePayrollRunEmployee(payslip, departmentByEmployeeId) : null;
}

export async function getPayrollPeriodById(payrollPeriodId: string) {
  await requireAdminActor();
  return getPayrollPeriod(payrollPeriodId);
}

export async function getPayrollWorkspaceSnapshotAction(
  year: number,
  periodId?: string | null,
  lineEmployeeId?: string | null
): Promise<PayrollWorkspaceSnapshotView> {
  await requireAdminActor();
  return loadPayrollWorkspaceSnapshot({
    year,
    periodId,
    lineEmployeeId,
  });
}

export async function getPayrollRegisterAction(payrollRunId: string) {
  await requireAdminActor();
  // Run report and department metadata in parallel — department uses payrollRunEmployees directly
  const [report, departmentByEmployeeId] = await Promise.all([
    getPayrollRegister(payrollRunId),
    loadEmployeeDepartmentMetadataByPayrollRunId(payrollRunId),
  ]);
  return serializePayrollRegisterReport(report, departmentByEmployeeId);
}

export async function getEmployeePayslipAction(
  payrollRunId: string,
  employeeId: string
) {
  await requireAdminActor();
  const payslip = await getEmployeePayslip(payrollRunId, employeeId);
  const departmentByEmployeeId = await loadEmployeeDepartmentMetadataByEmployeeId([
    employeeId,
  ]);
  return serializePayrollPayslip(payslip, departmentByEmployeeId);
}

export async function getAgencyDeductionSummaryAction(payrollRunId: string) {
  await requireAdminActor();
  const summary = await getAgencyDeductionSummary(payrollRunId);

  return {
    sssEmployee: summary?.sssEmployee ?? EMPTY_AGENCY_SUMMARY.sssEmployee,
    philhealthEmployee:
      summary?.philhealthEmployee ?? EMPTY_AGENCY_SUMMARY.philhealthEmployee,
    pagibigEmployee: summary?.pagibigEmployee ?? EMPTY_AGENCY_SUMMARY.pagibigEmployee,
    withholdingTax: summary?.withholdingTax ?? EMPTY_AGENCY_SUMMARY.withholdingTax,
    sssEmployer: summary?.sssEmployer ?? EMPTY_AGENCY_SUMMARY.sssEmployer,
    philhealthEmployer:
      summary?.philhealthEmployer ?? EMPTY_AGENCY_SUMMARY.philhealthEmployer,
    pagibigEmployer: summary?.pagibigEmployer ?? EMPTY_AGENCY_SUMMARY.pagibigEmployer,
    sssEc: summary?.sssEc ?? EMPTY_AGENCY_SUMMARY.sssEc,
  } satisfies PayrollAgencySummaryView;
}

export async function getLoanDeductionSummaryAction(payrollRunId: string) {
  await requireAdminActor();
  const rows = await getLoanDeductionSummary(payrollRunId);

  return rows.map(
    (row) =>
      ({
        employeeId: row.employeeId,
        employeeNo: row.employeeNo,
        employeeName: row.employeeName,
        description: row.description,
        amount: row.amount,
        sourceId: row.sourceId,
      }) satisfies PayrollLoanDeductionView
  );
}

export async function getPayrollReportBundleAction(payrollRunId: string): Promise<{
  register: PayrollRegisterReportView | null;
  agencySummary: PayrollAgencySummaryView;
  loanDeductions: PayrollLoanDeductionView[];
}> {
  await requireAdminActor();
  const [report, departmentByEmployeeId, agencySummary, loanRows] =
    await Promise.all([
      getPayrollRegister(payrollRunId),
      loadEmployeeDepartmentMetadataByPayrollRunId(payrollRunId),
      getAgencyDeductionSummary(payrollRunId),
      getLoanDeductionSummary(payrollRunId),
    ]);

  return {
    register: serializePayrollRegisterReport(report, departmentByEmployeeId),
    agencySummary: {
      sssEmployee: agencySummary?.sssEmployee ?? EMPTY_AGENCY_SUMMARY.sssEmployee,
      philhealthEmployee:
        agencySummary?.philhealthEmployee ??
        EMPTY_AGENCY_SUMMARY.philhealthEmployee,
      pagibigEmployee:
        agencySummary?.pagibigEmployee ?? EMPTY_AGENCY_SUMMARY.pagibigEmployee,
      withholdingTax:
        agencySummary?.withholdingTax ?? EMPTY_AGENCY_SUMMARY.withholdingTax,
      sssEmployer: agencySummary?.sssEmployer ?? EMPTY_AGENCY_SUMMARY.sssEmployer,
      philhealthEmployer:
        agencySummary?.philhealthEmployer ??
        EMPTY_AGENCY_SUMMARY.philhealthEmployer,
      pagibigEmployer:
        agencySummary?.pagibigEmployer ?? EMPTY_AGENCY_SUMMARY.pagibigEmployer,
      sssEc: agencySummary?.sssEc ?? EMPTY_AGENCY_SUMMARY.sssEc,
    },
    loanDeductions: loanRows.map(
      (row) =>
        ({
          employeeId: row.employeeId,
          employeeNo: row.employeeNo,
          employeeName: row.employeeName,
          description: row.description,
          amount: row.amount,
          sourceId: row.sourceId,
        }) satisfies PayrollLoanDeductionView
    ),
  };
}

export async function getEmployeePayrollAdjustmentRowsAction(
  payrollPeriodId: string,
  employeeId: string
): Promise<PayrollEmployeeDailyAdjustmentRowView[]> {
  await requireAdminActor();
  return getEmployeePayrollAdjustmentRows({
    payrollPeriodId,
    employeeId,
  });
}

export async function saveEmployeePayrollOvertimeOverrideAction(input: unknown) {
  const actor = await requireAdminActor();
  const payload = savePayrollOvertimeOverrideSchema.parse(input);

  const result = await saveEmployeePayrollOvertimeOverride({
    actorUserId: actor.userId,
    ...payload,
  });
  revalidatePath("/payroll");
  return result;
}

export async function getEmployeePayrollExceptionWorkspaceAction(
  payrollPeriodId: string,
  employeeId: string
): Promise<PayrollExceptionWorkspaceView> {
  await requireAdminActor();
  const [rows, recurringRows, codeOptions, loanRows] = await Promise.all([
    getEmployeePayrollExceptionRows({
      payrollPeriodId,
      employeeId,
    }),
    getEmployeePayrollRecurringEntryRows({
      payrollPeriodId,
      employeeId,
    }),
    getPayrollExceptionAccountCodeOptions(),
    getEmployeePayrollScheduledLoanRows({
      payrollPeriodId,
      employeeId,
    }),
  ]);
  const [manualLeaveRows, approvedLeaveRows] = await Promise.all([
    getEmployeePayrollManualLeaveAccountCodeRows({
      payrollPeriodId,
      employeeId,
      accountCodeOptions: codeOptions,
    }),
    getEmployeePayrollApprovedLeaveAccountCodeRows({
      payrollPeriodId,
      employeeId,
      accountCodeOptions: codeOptions,
    }),
  ]);

  return {
    rows,
    recurringRows,
    leaveRows: [...manualLeaveRows, ...approvedLeaveRows],
    loanRows,
    accountCodeOptions: codeOptions,
  };
}

export async function getEmployeePayrollExceptionRowsAction(
  payrollPeriodId: string,
  employeeId: string
): Promise<PayrollExceptionWorkspaceView["rows"]> {
  await requireAdminActor();
  return getEmployeePayrollExceptionRows({
    payrollPeriodId,
    employeeId,
  });
}

export async function getEmployeePayrollLoanRowsAction(
  payrollPeriodId: string,
  employeeId: string
): Promise<PayrollExceptionWorkspaceView["loanRows"]> {
  await requireAdminActor();
  return getEmployeePayrollScheduledLoanRows({
    payrollPeriodId,
    employeeId,
  });
}

export async function getPayrollExceptionAccountCodeOptionsAction(): Promise<
  PayrollExceptionAccountCodeOptionView[]
> {
  await requireAdminActor();
  return getPayrollExceptionAccountCodeOptions();
}

export async function updateEmployeePayrollLoanInstallmentAction(input: unknown) {
  const actor = await requireAdminActor();
  const payload = updatePayrollLoanInstallmentAmountSchema.parse(input);

  const result = await updateEmployeePayrollLoanInstallmentAmount({
    actorUserId: actor.userId,
    payload,
  });
  revalidatePath("/payroll");
  return result;
}

export async function saveEmployeePayrollExceptionRowsAction(input: unknown) {
  const actor = await requireAdminActor();
  const payload = savePayrollExceptionRowsSchema.parse(input);

  const result = await saveEmployeePayrollExceptionRows({
    actorUserId: actor.userId,
    ...payload,
  });
  revalidatePath("/payroll");
  return result;
}

export async function importPayrollAccountCodeRowsAction(input: unknown) {
  const actor = await requireAdminActor();
  const payload = importPayrollAccountCodeRowsSchema.parse(input);

  const result = await importPayrollAccountCodeRows({
    actorUserId: actor.userId,
    payload,
  });
  revalidatePath("/payroll");
  return result;
}

export async function getPayrollAccountCodeImportBatchesAction(
  payrollPeriodId: string
) {
  await requireAdminActor();
  return getRevertablePayrollAccountCodeImportBatches(payrollPeriodId);
}

export async function getPayrollAccountCodeImportSkippedRowsAction(
  batchId: string
) {
  await requireAdminActor();
  return getPayrollAccountCodeImportSkippedRows(batchId);
}

export async function revertPayrollAccountCodeImportsForPeriodAction(input: unknown) {
  const actor = await requireAdminActor();
  const payload = payrollAccountCodeImportPeriodRevertSchema.parse(input);

  const result = await revertPayrollAccountCodeImportsForPeriod({
    actorUserId: actor.userId,
    payload,
  });
  revalidatePath("/payroll");
  return result;
}

export async function getManualPayrollEntryWorkspaceAction(
  payrollPeriodId: string,
  employeeId: string,
  includeAccountCodeOptions = true
): Promise<ManualPayrollEntryWorkspaceView> {
  await requireAdminActor();
  const latestBaseline = await computeManualPayrollLatestBaseline(
    payrollPeriodId,
    employeeId
  );
  return getManualPayrollEntryWorkspace({
    payrollPeriodId,
    employeeId,
    includeAccountCodeOptions,
    latestBaseline,
  });
}

export async function getManualPayrollAccountCodeOptionsAction(): Promise<
  ManualPayrollAccountCodeOptionView[]
> {
  await requireAdminActor();
  return getManualAccountCodeOptions();
}

export async function saveManualPayrollEntryAction(input: unknown) {
  const actor = await requireAdminActor();
  const payload = saveManualPayrollEntrySchema.parse(input);
  const latestBaseline = await computeManualPayrollLatestBaseline(
    payload.payrollPeriodId,
    payload.employeeId
  );

  const result = await saveManualPayrollEntry({
    actorUserId: actor.userId,
    payload,
    latestBaseline,
  });
  revalidatePath("/payroll");
  return result;
}

export async function deleteManualPayrollEntryAction(input: unknown) {
  const actor = await requireAdminActor();
  const payload = deleteManualPayrollEntrySchema.parse(input);
  const latestBaseline = await computeManualPayrollLatestBaseline(
    payload.payrollPeriodId,
    payload.employeeId
  );

  const result = await deleteManualPayrollEntry({
    actorUserId: actor.userId,
    latestBaseline,
    ...payload,
  });
  revalidatePath("/payroll");
  return result;
}

export async function getLeaveUtilizationSummaryAction(params: {
  employeeId?: string;
  fromDate: string;
  toDate: string;
}) {
  await requireAdminActor();
  return getLeaveUtilizationSummary(params);
}

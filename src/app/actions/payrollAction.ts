"use server";

import { revalidatePath } from "next/cache";
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
import { requireAdminActor } from "@/lib/admin";
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
  getEmployeePayrollAdjustmentRows,
  saveEmployeePayrollOvertimeOverride,
} from "@/lib/payroll/overtimeOverrides";
import {
  getEmployeePayrollExceptionRows,
  getEmployeePayrollRecurringEntryRows,
  getPayrollExceptionAccountCodeOptions,
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

export async function seedPayrollFoundation() {
  await requireAdminActor();
  await ensurePayrollFoundationData();
  return { ok: true };
}

export async function seedPayrollPeriods(year: number) {
  await requireAdminActor();
  return ensureSemiMonthlyPayrollPeriods(year);
}

export async function computePayrollRun(payrollPeriodId: string) {
  const actor = await requireAdminActor();
  const result = await createOrRecomputePayrollRun(payrollPeriodId, actor.userId);
  revalidatePath("/payroll");
  return result;
}

export async function reviewPayrollRun(payrollRunId: string) {
  const actor = await requireAdminActor();
  const result = await transitionPayrollRunStatus(payrollRunId, "Reviewed", actor.userId);
  revalidatePath("/payroll");
  return result;
}

export async function approvePayrollRun(payrollRunId: string) {
  const actor = await requireAdminActor();
  const result = await transitionPayrollRunStatus(payrollRunId, "Approved", actor.userId);
  revalidatePath("/payroll");
  return result;
}

export async function postPayrollRun(payrollRunId: string) {
  const actor = await requireAdminActor();
  const result = await transitionPayrollRunStatus(payrollRunId, "Posted", actor.userId);
  revalidatePath("/payroll");
  return result;
}

export async function voidPayrollRun(payrollRunId: string, reason?: string | null) {
  const actor = await requireAdminActor();
  const result = await transitionPayrollRunStatus(payrollRunId, "Void", actor.userId, reason ?? null);
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

  return {
    rows,
    recurringRows,
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

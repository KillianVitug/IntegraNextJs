import { db } from "@/db";
import {
  attendanceImportBatches,
  department,
  employees,
  employeesGeneralInfo,
  payrollPeriods,
  payrollRuns,
} from "@/db/schema";
import {
  getEmployeeDepartmentMetadata,
  loadEmployeeDepartmentMetadataByEmployeeId,
  type EmployeeDepartmentMetadata,
} from "@/lib/payroll/employeeDepartment";
import { getPayrollRun, parsePayrollBreakdownNotes } from "@/lib/payroll/engine";
import { asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  AttendanceImportBatchView,
  PayrollAccountCodeEmployeeView,
  PayrollAgencySummaryView,
  PayrollPeriodSummary,
  PayrollRunView,
  PayrollWorkspaceSnapshotView,
} from "@/app/(ntg)/payroll/types";

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

function addMoney(left: string | number, right: string | number) {
  return (Number(left) + Number(right)).toFixed(2);
}

export function isValidPayrollYear(value: string | undefined) {
  if (!value) return false;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100;
}

export function pickDefaultPayrollPeriodId(
  periods: Array<Pick<PayrollPeriodSummary, "id" | "startDate" | "endDate">>
) {
  if (periods.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const currentPeriod = periods.find(
    (period) => period.startDate <= today && period.endDate >= today
  );

  if (currentPeriod) return currentPeriod.id;

  const latestPastPeriod = [...periods]
    .reverse()
    .find((period) => period.endDate <= today);

  return latestPastPeriod?.id ?? periods[0]?.id ?? null;
}

export function serializePayrollRunForWorkspace(
  run: Awaited<ReturnType<typeof getPayrollRun>> | null,
  lineEmployeeId?: string | null,
  departmentByEmployeeId?: Map<string, EmployeeDepartmentMetadata>
): PayrollRunView | null {
  if (!run) return null;

  const agencySummary = { ...EMPTY_AGENCY_SUMMARY };
  for (const employee of run.employees) {
    for (const line of employee.lines) {
      if (line.code === "SSS") {
        agencySummary.sssEmployee = addMoney(agencySummary.sssEmployee, line.amount);
      }
      if (line.code === "PHILHEALTH") {
        agencySummary.philhealthEmployee = addMoney(
          agencySummary.philhealthEmployee,
          line.amount
        );
      }
      if (line.code === "PAGIBIG") {
        agencySummary.pagibigEmployee = addMoney(
          agencySummary.pagibigEmployee,
          line.amount
        );
      }
      if (line.code === "TAX") {
        agencySummary.withholdingTax = addMoney(
          agencySummary.withholdingTax,
          line.amount
        );
      }
      if (line.code === "SSS-ER") {
        agencySummary.sssEmployer = addMoney(agencySummary.sssEmployer, line.amount);
      }
      if (line.code === "PHILHEALTH-ER") {
        agencySummary.philhealthEmployer = addMoney(
          agencySummary.philhealthEmployer,
          line.amount
        );
      }
      if (line.code === "PAGIBIG-ER") {
        agencySummary.pagibigEmployer = addMoney(
          agencySummary.pagibigEmployer,
          line.amount
        );
      }
      if (line.code === "SSS-EC") {
        agencySummary.sssEc = addMoney(agencySummary.sssEc, line.amount);
      }
    }
  }

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
    payrollPeriod: run.payrollPeriod
      ? {
          id: run.payrollPeriod.id,
          code: run.payrollPeriod.code,
          startDate: run.payrollPeriod.startDate,
          endDate: run.payrollPeriod.endDate,
          adjustedPayDate: run.payrollPeriod.adjustedPayDate,
          nominalPayDate: run.payrollPeriod.nominalPayDate,
          cycle: run.payrollPeriod.cycle,
          status: run.payrollPeriod.status,
        }
      : null,
    employees: run.employees.map((employee) => {
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
        lines:
          employee.employeeId === lineEmployeeId
            ? employee.lines.map((line) => ({
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
              }))
            : [],
      };
    }),
    agencySummary,
  };
}

export function serializeAttendanceImportBatch(
  batch: typeof attendanceImportBatches.$inferSelect
): AttendanceImportBatchView {
  return {
    id: batch.id,
    sourceFileName: batch.sourceFileName,
    sourceFormat: batch.sourceFormat,
    status: batch.status,
    totalRows: batch.totalRows,
    matchedRows: batch.matchedRows,
    unmatchedRows: batch.unmatchedRows,
    duplicateRows: batch.duplicateRows,
    importedAt: batch.importedAt.toISOString(),
  };
}

export async function loadPayrollAccountCodeEmployees(): Promise<
  PayrollAccountCodeEmployeeView[]
> {
  return db
    .select({
      employeeId: employees.id,
      employeeNo: employees.employeeNo,
      employeeType: employees.employeeType,
      firstName: employees.firstName,
      middleName: employees.middleName,
      lastName: employees.lastName,
      employeeName: sql<string>`CONCAT(${employees.lastName}, ', ', ${employees.firstName}, ' ', COALESCE(${employees.middleName}, ''))`,
      departmentId: employeesGeneralInfo.departmentId,
      departmentName: department.name,
      departmentCode: department.code,
    })
    .from(employees)
    .leftJoin(
      employeesGeneralInfo,
      eq(employeesGeneralInfo.employeeId, employees.id)
    )
    .leftJoin(department, eq(employeesGeneralInfo.departmentId, department.id))
    .where(isNull(employees.deletedAt))
    .orderBy(
      asc(employees.lastName),
      asc(employees.firstName),
      asc(employees.middleName),
      asc(employees.employeeNo),
      asc(employees.id)
    );
}

export async function loadPayrollWorkspaceSnapshot(args: {
  year: number;
  periodId?: string | null;
  lineEmployeeId?: string | null;
}): Promise<PayrollWorkspaceSnapshotView> {
  const periodRows = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.year, args.year))
    .orderBy(asc(payrollPeriods.startDate));

  const periodIds = periodRows.map((period) => period.id);

  const [runRows, batchRows] = await Promise.all([
    periodIds.length > 0
      ? db
          .select()
          .from(payrollRuns)
          .where(inArray(payrollRuns.payrollPeriodId, periodIds))
          .orderBy(desc(payrollRuns.createdAt))
      : Promise.resolve([]),
    periodIds.length > 0
      ? db
          .select()
          .from(attendanceImportBatches)
          .where(inArray(attendanceImportBatches.payrollPeriodId, periodIds))
          .orderBy(desc(attendanceImportBatches.importedAt))
      : Promise.resolve([]),
  ]);

  const latestRunByPeriod = new Map<string, typeof payrollRuns.$inferSelect>();
  for (const run of runRows) {
    if (!latestRunByPeriod.has(run.payrollPeriodId)) {
      latestRunByPeriod.set(run.payrollPeriodId, run);
    }
  }

  const attendanceBatchCountByPeriod = new Map<string, number>();
  for (const batch of batchRows) {
    if (!batch.payrollPeriodId) continue;

    attendanceBatchCountByPeriod.set(
      batch.payrollPeriodId,
      (attendanceBatchCountByPeriod.get(batch.payrollPeriodId) ?? 0) + 1
    );
  }

  const periods: PayrollPeriodSummary[] = periodRows.map((period) => {
    const latestRun = latestRunByPeriod.get(period.id) ?? null;

    return {
      id: period.id,
      code: period.code,
      payrollTerms: period.payrollTerms,
      cycle: period.cycle,
      year: period.year,
      month: period.month,
      startDate: period.startDate,
      endDate: period.endDate,
      nominalPayDate: period.nominalPayDate,
      adjustedPayDate: period.adjustedPayDate,
      status: period.status,
      attendanceBatchCount: attendanceBatchCountByPeriod.get(period.id) ?? 0,
      latestRun: latestRun
        ? {
            id: latestRun.id,
            status: latestRun.status,
            runNumber: latestRun.runNumber,
            computedAt: toIsoString(latestRun.computedAt),
            reviewedAt: toIsoString(latestRun.reviewedAt),
            approvedAt: toIsoString(latestRun.approvedAt),
            postedAt: toIsoString(latestRun.postedAt),
            createdAt: latestRun.createdAt.toISOString(),
          }
        : null,
    };
  });

  const selectedPeriodId = periods.some((period) => period.id === args.periodId)
    ? args.periodId!
    : pickDefaultPayrollPeriodId(periods);

  const selectedPeriod =
    periods.find((period) => period.id === selectedPeriodId) ?? null;
  const latestSelectedRun = selectedPeriod
    ? latestRunByPeriod.get(selectedPeriod.id) ?? null
    : null;

  const [selectedRunRecord, selectedPeriodBatchRows] = await Promise.all([
    latestSelectedRun ? getPayrollRun(latestSelectedRun.id) : Promise.resolve(null),
    selectedPeriod
      ? db
          .select()
          .from(attendanceImportBatches)
          .where(eq(attendanceImportBatches.payrollPeriodId, selectedPeriod.id))
          .orderBy(desc(attendanceImportBatches.importedAt))
      : Promise.resolve([]),
  ]);
  const selectedRunDepartmentByEmployeeId = selectedRunRecord
    ? await loadEmployeeDepartmentMetadataByEmployeeId(
        selectedRunRecord.employees.map((employee) => employee.employeeId)
      )
    : undefined;
  const lineEmployeeId =
    args.lineEmployeeId ?? selectedRunRecord?.employees[0]?.employeeId ?? null;

  return {
    periods,
    selectedPeriodId,
    selectedRun: serializePayrollRunForWorkspace(
      selectedRunRecord,
      lineEmployeeId,
      selectedRunDepartmentByEmployeeId
    ),
    attendanceBatches: selectedPeriodBatchRows.map(serializeAttendanceImportBatch),
  };
}

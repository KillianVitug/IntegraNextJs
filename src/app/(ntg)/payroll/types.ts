import type {
  AttendanceCorrectionMetrics,
  AttendanceCorrectionPunch,
  AttendanceDtrCorrectionStatus,
  AttendanceDtrCorrectionType,
} from "@/lib/payroll/attendanceCorrections";
import type {
  AttendanceDtrDayType,
  AttendanceDtrManualStatus,
} from "@/lib/payroll/dtrOverrides";
import type {
  OvertimeCategory,
  OvertimeHolidayType,
} from "@/lib/payroll/overtime";
import type {
  PayrollExceptionAccountType,
  PayrollExceptionDtrOverrideSource,
} from "@/lib/payroll/payrollExceptions";

export type PayrollPeriodSummary = {
  id: string;
  code: string;
  payrollTerms: string;
  cycle: "A" | "B";
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  nominalPayDate: string;
  adjustedPayDate: string;
  status: string;
  attendanceBatchCount: number;
  latestRun: {
    id: string;
    status: string;
    runNumber: number;
    computedAt: string | null;
    reviewedAt: string | null;
    approvedAt: string | null;
    postedAt: string | null;
    createdAt: string;
  } | null;
};

export type AttendanceImportBatchView = {
  id: string;
  sourceFileName: string;
  sourceFormat: string;
  status: string;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  importedAt: string;
};

export type AttendanceImportBatchUnmatchedRowView = {
  id: number;
  employeeNo: string;
  sourceLine: number | null;
  loggedAt: string;
  logDate: string;
  logTime: string;
  deviceId: string | null;
  siteCode: string | null;
  rawText: string | null;
};

export type AttendanceImportBatchUnmatchedGroupView = {
  employeeNo: string;
  rowCount: number;
  startDate: string;
  endDate: string;
  firstSourceLine: number | null;
  lastSourceLine: number | null;
  sampleRawText: string | null;
  rows: AttendanceImportBatchUnmatchedRowView[];
};

export type AttendanceImportBatchDiagnosticsView = {
  batchId: string;
  totalUnmatchedRows: number;
  groups: AttendanceImportBatchUnmatchedGroupView[];
};

export type AttendanceDtrDayView = {
  attendanceDate: string;
  dayName: string;
  rawPunches: string[];
  firstInAt: string | null;
  lastOutAt: string | null;
  scheduledInTime: string | null;
  scheduledOutTime: string | null;
  scheduledMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
  paidLeaveMinutes: number;
  unpaidLeaveMinutes: number;
  absentMinutes: number;
  isRestDay: boolean;
  anomalyFlags: string[];
  computedStatus: string;
  manualStatus: AttendanceDtrManualStatus | null;
  effectiveStatus: string;
  isStatusOverridden: boolean;
  holdApprovalStatus: "Approved" | null;
  holdApprovalTargetPayrollPeriodCode: string | null;
  calendarDayType: AttendanceDtrDayType;
  manualDayType: AttendanceDtrDayType | null;
  effectiveDayType: AttendanceDtrDayType;
  isDayTypeOverridden: boolean;
};

export type AttendanceDtrEditableTotalsView = {
  presentDays: number;
  workedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
};

export type AttendanceDtrPeriodOverrideView = {
  presentDays: number | null;
  workedMinutes: number | null;
  lateMinutes: number | null;
  undertimeMinutes: number | null;
  overtimeMinutes: number | null;
};

export type AttendanceDtrTotalsView = {
  workedMinutes: number;
  biometricWorkedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
  paidLeaveMinutes: number;
  unpaidLeaveMinutes: number;
  absentMinutes: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  computed: AttendanceDtrEditableTotalsView;
  overrides: AttendanceDtrPeriodOverrideView;
};

export type AttendanceDtrSourceFileView = {
  batchId: string;
  sourceFileName: string;
  punchCount: number;
};

export type AttendanceDtrEmployeeView = {
  employeeId: string;
  employeeNo: string;
  employeeType: string;
  employeeName: string;
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
  hasDtrRecord: boolean;
  sourceFiles: AttendanceDtrSourceFileView[];
  rows: AttendanceDtrDayView[];
  totals: AttendanceDtrTotalsView;
};

export type AttendanceDtrEmployeeSummaryView = Omit<
  AttendanceDtrEmployeeView,
  "rows"
>;

export type AttendanceDtrEmployeeRowsView = Pick<
  AttendanceDtrEmployeeView,
  "employeeId" | "rows"
>;

export type AttendanceDtrView = {
  payrollPeriod: PayrollRunPeriodView;
  employees: AttendanceDtrEmployeeView[];
};

export type AttendanceDtrSummaryView = {
  payrollPeriod: PayrollRunPeriodView;
  employees: AttendanceDtrEmployeeSummaryView[];
};

export type AttendanceDtrCorrectionView = {
  id: string;
  payrollPeriodId: string;
  employeeId: string;
  employeeNo: string;
  employeeType: string;
  employeeName: string;
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
  attendanceDate: string;
  correctionType: AttendanceDtrCorrectionType;
  status: AttendanceDtrCorrectionStatus;
  confidence: number;
  reason: string;
  rawPunches: AttendanceCorrectionPunch[];
  ignoredRawLogIds: number[];
  syntheticPunches: AttendanceCorrectionPunch[];
  effectivePunches: AttendanceCorrectionPunch[];
  proposedMetrics: AttendanceCorrectionMetrics | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceDtrCorrectionQueueView = {
  payrollPeriod: PayrollRunPeriodView;
  corrections: AttendanceDtrCorrectionView[];
};

export type AttendanceDtrHeldRowView = {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
  attendanceDate: string;
  dayName: string;
  anomalyFlags: string[];
  scheduledInTime: string | null;
  scheduledOutTime: string | null;
  scheduledMinutes: number;
  workedMinutes: number;
  intendedWorkedMinutes: number;
  workedBaselineSource: "schedule" | "fallback_8_hours";
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
  rawPunches: string[];
  source: "auto" | "manual";
  approvalStatus: "Hold" | "Pending" | "Approved";
  targetPayrollPeriodId: string | null;
  targetPayrollPeriodCode: string | null;
  approvedWorkedMinutes: number | null;
  approvedLateMinutes: number | null;
  approvedUndertimeMinutes: number | null;
  approvedOvertimeMinutes: number | null;
};

export type AttendanceDtrHeldRowsView = {
  payrollPeriod: PayrollRunPeriodView;
  rows: AttendanceDtrHeldRowView[];
};

export type PayrollRunLineView = {
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
};

export type PayrollComputationModeView = "Daily Rate" | "Monthly Rate";

export type PayrollRunEmployeeView = {
  id: string;
  employeeId: string;
  employeeNoSnapshot: string;
  employeeNameSnapshot: string;
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
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
  payComputationMode: PayrollComputationModeView | null;
  isManualPayrollOverride: boolean;
  statutoryMonthlyCompensationBase: string | null;
  sssContributionSource: string | null;
  sssSalaryCredit: string | null;
  sssBracketLabel: string | null;
  breakdownNotes: string | null;
  lines: PayrollRunLineView[];
};

export type PayrollRunEmployeeSummaryView = Omit<PayrollRunEmployeeView, "lines">;

export type PayrollRunEmployeeDetailView = PayrollRunEmployeeView;

export type PayrollRunPeriodView = {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  adjustedPayDate: string;
  nominalPayDate: string;
  cycle: "A" | "B";
  status: string;
};

export type PayrollRunHeaderView = {
  id: string;
  status: string;
  runNumber: number;
  notes: string | null;
  computedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  createdAt: string;
  payrollPeriod: PayrollRunPeriodView | null;
};

export type PayrollRunSummaryView = PayrollRunHeaderView & {
  employees: Array<PayrollRunEmployeeSummaryView & { lines: PayrollRunLineView[] }>;
  agencySummary: PayrollAgencySummaryView;
};

export type PayrollRunView = PayrollRunSummaryView;

export type PayrollWorkspaceSnapshotView = {
  periods: PayrollPeriodSummary[];
  selectedPeriodId: string | null;
  selectedRun: PayrollRunView | null;
  attendanceBatches: AttendanceImportBatchView[];
};

export type PayrollRegisterReportView = PayrollRunHeaderView & {
  employees: PayrollRunEmployeeView[];
};

export type PayrollPayslipView = PayrollRunEmployeeView & {
  payrollRun: PayrollRunHeaderView | null;
};

export type PayrollAgencySummaryView = {
  sssEmployee: string;
  philhealthEmployee: string;
  pagibigEmployee: string;
  withholdingTax: string;
  sssEmployer: string;
  philhealthEmployer: string;
  pagibigEmployer: string;
  sssEc: string;
};

export type PayrollLoanDeductionView = {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  description: string;
  amount: string;
  sourceId: string | null;
};

export type PayrollAccountCodeEmployeeView = {
  employeeId: string;
  employeeNo: string;
  employeeType: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  employeeName: string;
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
};

export type PayrollEmployeeDailyAdjustmentRowView = {
  attendanceDate: string;
  dayName: string;
  isRestDay: boolean;
  holidayType: OvertimeHolidayType | null;
  workedMinutes: number;
  workedMinutesOverride: number | null;
  effectiveWorkedMinutes: number;
  scheduledMinutes: number;
  paidLeaveMinutes: number;
  unpaidLeaveMinutes: number;
  scheduleOvertimeMinutes: number;
  computedOvertimeMinutes: number;
  approvedOvertimeMinutes: number;
  overtimeApproved: boolean;
  overtimeCategory: OvertimeCategory;
  manualHours: number | null;
  manualMinutes: number | null;
  otPayPreview: string | null;
  otPayPreviewError: string | null;
};

export type PayrollExceptionAccountCodeOptionView = {
  id: number;
  code: string;
  accountType: PayrollExceptionAccountType | null;
  description: string | null;
  month13thPay: boolean;
  nonTaxable: boolean;
  dailyRate: string | null;
  monthlyRate: string | null;
};

export type PayrollExceptionRowView = {
  id: string;
  attendanceDate: string;
  accountCodeId: number | null;
  accountCodeSnapshot: string;
  accountTypeSnapshot: PayrollExceptionAccountType | null;
  accountDescriptionSnapshot: string | null;
  accountMonth13thPaySnapshot: boolean;
  accountNonTaxableSnapshot: boolean;
  dayType: AttendanceDtrDayType | null;
  overtimeCategory: OvertimeCategory | null;
  hours: number;
  minutes: number;
  amountOverride: string | null;
  remarks: string | null;
  dtrOverrideSource: PayrollExceptionDtrOverrideSource | null;
  computedAmount: string;
  computedDescription: string;
  computedError: string | null;
  computedLineType: "Earning" | "Deduction";
  isLegacy: boolean;
};

export type PayrollRecurringEntryRowView = {
  id: string;
  recurringEntryId: number;
  accountCodeId: number;
  accountCodeSnapshot: string;
  accountTypeSnapshot: PayrollExceptionAccountType;
  accountDescriptionSnapshot: string | null;
  accountMonth13thPaySnapshot: boolean;
  accountNonTaxableSnapshot: boolean;
  amount: string;
  description: string | null;
  sourceLabel: string;
  sourceRemark: string;
};

export type PayrollScheduledLoanDeductionView = {
  installmentId: string;
  loanId: string;
  accountCodeId: number | null;
  accountCode: string | null;
  accountDescription: string | null;
  accountType: string | null;
  loanReferenceNumber: string;
  payrollCode: string;
  installmentNo: number;
  dueDate: string;
  scheduledAmount: string;
  balanceAfter: string | null;
  status: "Pending" | "Due" | "Paid" | "Skipped" | "Void";
  editable: boolean;
};

export type PayrollExceptionWorkspaceView = {
  rows: PayrollExceptionRowView[];
  recurringRows: PayrollRecurringEntryRowView[];
  loanRows: PayrollScheduledLoanDeductionView[];
  accountCodeOptions: PayrollExceptionAccountCodeOptionView[];
};

export type ManualPayrollLineSummaryBucket =
  | "basicPay"
  | "otPaidLeaves"
  | "otherIncome"
  | "month13th"
  | "nonTaxable"
  | "deminimis"
  | "otherDeductions";

export type ManualPayrollSourceView = "manual" | "computed" | "blank";

export type ManualPayrollAccountCodeOptionView =
  PayrollExceptionAccountCodeOptionView & {
    deminimis: boolean;
    dailyRate: string | null;
    monthlyRate: string | null;
  };

export type ManualPayrollRateContextView = {
  payComputationMode: PayrollComputationModeView | null;
  dailyRate: string;
  monthlyRate: string;
  hoursPerDay: string;
  hourlyRate: string;
};

export type ManualPayrollEntryLineView = {
  id: string | null;
  accountCodeId: number | null;
  lineType: "Earning" | "Deduction" | "Employer Contribution" | "Information";
  summaryBucket: ManualPayrollLineSummaryBucket;
  code: string;
  description: string;
  loanRefNo: string | null;
  hours: number;
  minutes: number;
  amount: string;
  taxable: boolean;
  month13thEligible: boolean;
  nonTaxable: boolean;
  deminimis: boolean;
  sourceTable: string | null;
  sourceId: string | null;
  sortOrder: number;
};

export type ManualPayrollEntryFieldsView = {
  sssEmployee: string;
  sssEmployer: string;
  sssEc: string;
  sssBasis: string;
  philhealthEmployee: string;
  philhealthEmployer: string;
  philhealthBasis: string;
  pagibigEmployee: string;
  pagibigEmployer: string;
  pagibigBasis: string;
  withholdingTax: string;
  withholdingTaxBasis: string;
  peraaEmployee: string;
  peraaEmployer: string;
  peraaBasis: string;
  remarks: string | null;
};

export type ManualPayrollEntryWorkspaceView = ManualPayrollEntryFieldsView & {
  entryId: string | null;
  source: ManualPayrollSourceView;
  canEdit: boolean;
  editBlockReason: string | null;
  latestRunStatus: string | null;
  payrollPeriod: PayrollRunPeriodView;
  employee: PayrollAccountCodeEmployeeView;
  rateContext: ManualPayrollRateContextView;
  lines: ManualPayrollEntryLineView[];
  accountCodeOptions: ManualPayrollAccountCodeOptionView[];
};

"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import {
  approveAttendanceDtrHoldRowsAction,
  getAttendanceDtrHeldRowsAction,
  getAttendanceImportBatchUnmatchedDiagnosticsAction,
  getAttendancePeriodDtrEmployeeRowsAction,
  getAttendancePeriodDtrSummaryAction,
  importAttendanceLogs,
  refreshAttendancePeriodSummariesAction,
  resetAttendanceDtrHoldRowsAction,
  revertAttendanceImportBatchAction,
  saveAttendanceDtrDayOverridesAction,
  saveAttendanceDtrPeriodOverridesWithAccountCodesAction,
} from "@/app/actions/attendanceImportAction";
import {
  approvePayrollRun,
  computePayrollRun,
  deleteManualPayrollEntryAction,
  getAgencyDeductionSummaryAction,
  getEmployeePayrollExceptionWorkspaceAction,
  getEmployeePayslipAction,
  getManualPayrollAccountCodeOptionsAction,
  getManualPayrollEntryWorkspaceAction,
  getPayrollRunEmployeeDetailAction,
  getLoanDeductionSummaryAction,
  getPayrollRegisterAction,
  getPayrollWorkspaceSnapshotAction,
  postPayrollRun,
  reviewPayrollRun,
  saveManualPayrollEntryAction,
  saveEmployeePayrollExceptionRowsAction,
  seedPayrollPeriods,
  updateEmployeePayrollLoanInstallmentAction,
  voidPayrollRun,
} from "@/app/actions/payrollAction";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  OVERTIME_CATEGORY_LABELS,
  overtimeCategoryValues,
  resolveOvertimeCategory,
  type OvertimeCategory,
} from "@/lib/payroll/overtime";
import {
  attendanceDtrManualStatusValues,
  getHolidayTypeFromAttendanceDtrDayType,
  type AttendanceDtrDayType,
  type AttendanceDtrManualStatus,
} from "@/lib/payroll/dtrOverrides";
import {
  computeManualPayrollLineAmount,
  isManualPayrollHourBasedAccountType,
} from "@/lib/payroll/manualPayrollRate";
import { getManualPayrollBucketFromAccountCodeOrType } from "@/lib/payroll/manualPayrollBuckets";
import {
  isPayrollExceptionDtrQuantityOnlyDeductionSource,
  isPayrollExceptionHeldDtrSource,
  type PayrollExceptionAccountType,
  type PayrollExceptionDtrOverrideSource,
} from "@/lib/payroll/payrollExceptions";
import { cn } from "@/lib/utils";
import type {
  AttendanceDtrDayView,
  AttendanceDtrEmployeeRowsView,
  AttendanceDtrEmployeeSummaryView,
  AttendanceDtrHeldRowsView,
  AttendanceDtrSummaryView,
  AttendanceImportBatchDiagnosticsView,
  AttendanceImportBatchView,
  ManualPayrollAccountCodeOptionView,
  ManualPayrollEntryLineView,
  ManualPayrollEntryWorkspaceView,
  ManualPayrollLineSummaryBucket,
  PayrollAccountCodeEmployeeView,
  PayrollAgencySummaryView,
  PayrollExceptionAccountCodeOptionView,
  PayrollExceptionRowView,
  PayrollLoanDeductionView,
  PayrollPayslipView,
  PayrollPeriodSummary,
  PayrollRecurringEntryRowView,
  PayrollRunEmployeeDetailView,
  PayrollRunLineView,
  PayrollRegisterReportView,
  PayrollRunView,
  PayrollScheduledLoanDeductionView,
  PayrollWorkspaceSnapshotView,
} from "./types";
import {
  formatEmployeeNoDisplay,
  formatEmployeePickerLabel,
  getEmployeeTypeDisplay,
  sortEmployeesByLastName,
} from "@/utils/employeeDisplay";

type Props = {
  initialYear: number;
  periods: PayrollPeriodSummary[];
  selectedPeriodId: string | null;
  selectedRun: PayrollRunView | null;
  payrollAccountCodeEmployees: PayrollAccountCodeEmployeeView[];
  attendanceBatches: AttendanceImportBatchView[];
};

type WorkspaceTab = "run" | "reports" | "attendance" | "attendanceHold" | "accountCodes" | "manual";

type PayrollAccountCodeLineTab = "income" | "deduction";

type LoadStatus = "idle" | "loading" | "ready" | "error";

type AttendanceHoldEmployeeGroup = {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
  heldDates: string[];
  workedMinutes: number;
  intendedWorkedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
  status: "Hold" | "Pending" | "Approved" | "Partial";
  source: "Auto" | "Manual" | "Mixed";
  rows: AttendanceDtrHeldRowsView["rows"];
};

type AttendanceHoldApprovalDraft = {
  targetPayrollPeriodId: string;
  workedHours: string;
  workedMinutes: string;
  lateHours: string;
  lateMinutes: string;
  undertimeHours: string;
  undertimeMinutes: string;
  overtimeHours: string;
  overtimeMinutes: string;
  workedManuallyEdited: boolean;
};

type AttendanceHoldApprovalMetric = "worked" | "late" | "undertime" | "overtime";

type AttendanceHoldApprovalDraftTimeField =
  | "workedHours"
  | "workedMinutes"
  | "lateHours"
  | "lateMinutes"
  | "undertimeHours"
  | "undertimeMinutes"
  | "overtimeHours"
  | "overtimeMinutes";

type AttendanceHoldRowDisplayMinutes = {
  workedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
};

function isFixedScheduleAttendanceHoldRow(
  row: AttendanceDtrHeldRowsView["rows"][number]
) {
  return row.workedBaselineSource === "schedule" || row.scheduledMinutes > 0;
}

function getAttendanceHoldRowDisplayMinutes(
  row: AttendanceDtrHeldRowsView["rows"][number]
): AttendanceHoldRowDisplayMinutes {
  const isFixedSchedule = isFixedScheduleAttendanceHoldRow(row);

  if (row.approvalStatus === "Hold") {
    const lateMinutes = row.lateMinutes;
    const undertimeMinutes = row.undertimeMinutes;

    return {
      workedMinutes: isFixedSchedule
        ? row.intendedWorkedMinutes
        : Math.max(0, row.intendedWorkedMinutes - lateMinutes - undertimeMinutes),
      lateMinutes,
      undertimeMinutes,
      overtimeMinutes: row.overtimeMinutes,
    };
  }

  const lateMinutes = row.approvedLateMinutes ?? row.lateMinutes;
  const undertimeMinutes = row.approvedUndertimeMinutes ?? row.undertimeMinutes;

  return {
    workedMinutes:
      row.approvedWorkedMinutes ??
      (isFixedSchedule
        ? row.intendedWorkedMinutes
        : Math.max(0, row.intendedWorkedMinutes - lateMinutes - undertimeMinutes)),
    lateMinutes,
    undertimeMinutes,
    overtimeMinutes: row.approvedOvertimeMinutes ?? row.overtimeMinutes,
  };
}

type AttendanceBatchDiagnosticsState = {
  status: LoadStatus;
  data: AttendanceImportBatchDiagnosticsView | null;
  error: string | null;
};

type AttendanceImportResultRow = {
  fileName: string;
  status: "imported" | "denied";
  details: string;
};

type AttendanceImportResult = {
  attemptedCount: number;
  importedCount: number;
  deniedCount: number;
  rows: AttendanceImportResultRow[];
};

const ALL_DEPARTMENTS_VALUE = "all";
const UNASSIGNED_DEPARTMENT_VALUE = "unassigned";

type DepartmentFilterValue =
  | typeof ALL_DEPARTMENTS_VALUE
  | typeof UNASSIGNED_DEPARTMENT_VALUE
  | `department:${number}`;

type DepartmentFilterOption = {
  value: DepartmentFilterValue;
  label: string;
  description: string | null;
  count: number;
  searchText: string;
};

type DtrPeriodOverrideDraft = {
  presentDays: string;
  workedHours: string;
  workedMinutes: string;
  lateHours: string;
  lateMinutes: string;
  undertimeHours: string;
  undertimeMinutes: string;
  overtimeHours: string;
  overtimeMinutes: string;
};

type DtrStatusDrafts = Record<string, AttendanceDtrManualStatus | null>;

const COMPUTED_DTR_STATUS_VALUE = "__computed__";
const DEFAULT_PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPE: AttendanceDtrDayType =
  "Legal/Regular Holiday";
const PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPES = [
  "Legal/Regular Holiday",
  "Special Non-Working Holiday",
  "Company Holiday",
  "Special Working Holiday",
] as const satisfies readonly AttendanceDtrDayType[];

type DepartmentFilterEmployee = {
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
};

type ReportState = {
  status: LoadStatus;
  runId: string | null;
  register: PayrollRegisterReportView | null;
  agencySummary: PayrollAgencySummaryView | null;
  loanDeductions: PayrollLoanDeductionView[];
  error: string | null;
};

type PayslipState = {
  status: LoadStatus;
  runId: string | null;
  employeeId: string | null;
  payslip: PayrollPayslipView | null;
  error: string | null;
};

type AttendanceDtrState = {
  status: LoadStatus;
  periodId: string | null;
  data: AttendanceDtrSummaryView | null;
  error: string | null;
};

type AttendanceDtrRowsState = {
  status: LoadStatus;
  periodId: string | null;
  employeeId: string | null;
  data: AttendanceDtrEmployeeRowsView | null;
  error: string | null;
};

type PayrollExceptionState = {
  status: LoadStatus;
  periodId: string | null;
  employeeId: string | null;
  rows: PayrollExceptionRowView[];
  recurringRows: PayrollRecurringEntryRowView[];
  loanRows: PayrollScheduledLoanDeductionView[];
  accountCodeOptions: PayrollExceptionAccountCodeOptionView[];
  error: string | null;
};

type PayrollExceptionDraft = {
  localId: string;
  id: string | null;
  attendanceDate: string;
  accountCodeId: string;
  accountCodeSnapshot: string;
  accountTypeSnapshot: PayrollExceptionAccountType | null;
  accountDescriptionSnapshot: string;
  accountMonth13thPaySnapshot: boolean;
  accountNonTaxableSnapshot: boolean;
  dayType: AttendanceDtrDayType | null;
  overtimeCategory: OvertimeCategory;
  hours: string;
  minutes: string;
  amountOverride: string;
  remarks: string;
  dtrOverrideSource: PayrollExceptionDtrOverrideSource | null;
  isNew: boolean;
};

type ManualPayrollState = {
  status: LoadStatus;
  periodId: string | null;
  employeeId: string | null;
  data: ManualPayrollEntryWorkspaceView | null;
  error: string | null;
};

type ManualPayrollDraftLine = Omit<ManualPayrollEntryLineView, "id"> & {
  localId: string;
  id: string | null;
  amount: string;
  isSystem: boolean;
};

type ManualPayrollDraft = {
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
  remarks: string;
  lines: ManualPayrollDraftLine[];
};

const moneyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

const dayNameFormatter = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
});

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

const EMPTY_PAYROLL_EXCEPTION_ACCOUNT_CODE_OPTIONS: PayrollExceptionAccountCodeOptionView[] =
  [];
const EMPTY_PAYROLL_RECURRING_ENTRY_ROWS: PayrollRecurringEntryRowView[] = [];

const EMPTY_MANUAL_PAYROLL_ACCOUNT_CODE_OPTIONS: ManualPayrollAccountCodeOptionView[] =
  [];

const MANUAL_PAYROLL_SUMMARY_BUCKETS: Array<{
  key: ManualPayrollLineSummaryBucket;
  label: string;
  code: string;
  description: string;
  lineType: "Earning" | "Deduction";
  taxable: boolean;
  month13thEligible: boolean;
  nonTaxable: boolean;
  deminimis: boolean;
}> = [
  {
    key: "basicPay",
    label: "Basic Pay",
    code: "REG",
    description: "Basic Pay",
    lineType: "Earning",
    taxable: true,
    month13thEligible: true,
    nonTaxable: false,
    deminimis: false,
  },
  {
    key: "otPaidLeaves",
    label: "OT Pay/Paid Leaves",
    code: "OT-LEAVE",
    description: "OT Pay/Paid Leaves",
    lineType: "Earning",
    taxable: true,
    month13thEligible: true,
    nonTaxable: false,
    deminimis: false,
  },
  {
    key: "otherIncome",
    label: "Other Income",
    code: "O-INCOME",
    description: "Other Income",
    lineType: "Earning",
    taxable: true,
    month13thEligible: false,
    nonTaxable: false,
    deminimis: false,
  },
  {
    key: "month13th",
    label: "13th Month",
    code: "M13",
    description: "13th Month",
    lineType: "Earning",
    taxable: false,
    month13thEligible: false,
    nonTaxable: true,
    deminimis: false,
  },
  {
    key: "nonTaxable",
    label: "Non-Taxable",
    code: "NTAX",
    description: "Non-Taxable Income",
    lineType: "Earning",
    taxable: false,
    month13thEligible: false,
    nonTaxable: true,
    deminimis: false,
  },
  {
    key: "deminimis",
    label: "de minimis",
    code: "DEMINIMIS",
    description: "de minimis",
    lineType: "Earning",
    taxable: false,
    month13thEligible: false,
    nonTaxable: true,
    deminimis: true,
  },
  {
    key: "otherDeductions",
    label: "Other Deductions",
    code: "OTHER-DED",
    description: "Other Deductions",
    lineType: "Deduction",
    taxable: false,
    month13thEligible: false,
    nonTaxable: false,
    deminimis: false,
  },
];

const MANUAL_PAYROLL_SUMMARY_BUCKET_CONFIG = new Map(
  MANUAL_PAYROLL_SUMMARY_BUCKETS.map((bucket) => [bucket.key, bucket])
);

function toNumber(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function formatMoney(value: string | number | null | undefined) {
  return moneyFormatter.format(toNumber(value));
}

function formatMoneyInput(value: string | number | null | undefined) {
  return toNumber(value).toFixed(2);
}

function formatDecimalUpTo4(value: string | number | null | undefined) {
  if (value == null || value === "") return "-";

  const normalized = String(value).replace(/,/g, "").trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return String(value);

  const [wholeValue, decimalValue] = normalized.split(".");
  const whole = wholeValue === "" ? "0" : wholeValue;

  if (decimalValue == null || decimalValue === "") return whole;

  return `${whole}.${decimalValue.slice(0, 4)}`;
}

function isValidMoneyInput(value: string) {
  return /^\d{0,9}(\.\d{0,2})?$/.test(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "-";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return dateTimeFormatter.format(parsed);
}

function formatDateRange(startDate: string, endDate: string) {
  if (startDate === endDate) return startDate;
  return `${startDate} to ${endDate}`;
}

function addIsoDateDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function formatIsoDateDayName(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";

  return dayNameFormatter.format(new Date(Date.UTC(year, month - 1, day)));
}

function buildPeriodDateOptions(period: PayrollPeriodSummary | null) {
  if (!period) return [];

  const options: Array<{ value: string; label: string }> = [];
  let currentDate = period.startDate;

  while (currentDate <= period.endDate) {
    const dayName = formatIsoDateDayName(currentDate);

    options.push({
      value: currentDate,
      label: dayName ? `${currentDate} ${dayName}` : currentDate,
    });
    currentDate = addIsoDateDays(currentDate, 1);
  }

  return options;
}

function formatSourceLineRange(
  firstSourceLine: number | null,
  lastSourceLine: number | null
) {
  const first = firstSourceLine ?? lastSourceLine;
  const last = lastSourceLine ?? firstSourceLine;

  if (first == null || last == null) return "Line -";
  if (first === last) return `Line ${first}`;
  return `Lines ${first}-${last}`;
}

function formatDeviceSite(deviceId: string | null, siteCode: string | null) {
  const parts: string[] = [];
  if (deviceId) parts.push(deviceId);
  if (siteCode) parts.push(siteCode);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function formatMinutes(value: number | null | undefined) {
  const totalMinutes = Math.max(0, Math.round(Number(value ?? 0)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatPayrollTimeQuantity(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  return `${String(hours).padStart(2, "0")}(${String(minutes).padStart(2, "0")})`;
}

function formatPayrollLineQuantity(
  line: Pick<
    PayrollRunLineView,
    "code" | "description" | "quantity" | "sourceTable"
  >
) {
  if (line.quantity == null) return "-";

  const numericQuantity = Number(line.quantity);
  if (!Number.isFinite(numericQuantity)) return line.quantity;

  if (
    line.sourceTable === "employee_payroll_exception_rows" ||
    line.sourceTable === "manual_payroll_entry_lines" ||
    (line.sourceTable === "attendance_daily_summaries" && line.code === "REG")
  ) {
    return formatPayrollTimeQuantity(numericQuantity * 60);
  }

  if (line.sourceTable === "employees_leave_records") {
    return formatPayrollTimeQuantity(numericQuantity * 8 * 60);
  }

  if (line.sourceTable === "attendance_daily_summaries" && line.code === "LATE-UT") {
    return formatPayrollTimeQuantity(numericQuantity);
  }

  if (
    (line.sourceTable === "attendance_daily_summaries" ||
      line.sourceTable === "employee_attendance_period_overrides") &&
    line.description === "Regular Overtime"
  ) {
    return formatPayrollTimeQuantity(numericQuantity * 60);
  }

  return line.quantity;
}

function formatDtrDays(value: number | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : "0.00";
}

function splitDtrMinutes(value: number | null | undefined) {
  const totalMinutes = Math.max(0, Math.round(Number(value ?? 0)));

  return {
    hours: String(Math.floor(totalMinutes / 60)),
    minutes: String(totalMinutes % 60),
  };
}

function createDtrOverrideDraft(
  totals: AttendanceDtrEmployeeSummaryView["totals"] | null | undefined
): DtrPeriodOverrideDraft {
  const worked = splitDtrMinutes(totals?.workedMinutes ?? 0);
  const late = splitDtrMinutes(totals?.lateMinutes ?? 0);
  const undertime = splitDtrMinutes(totals?.undertimeMinutes ?? 0);
  const overtime = splitDtrMinutes(totals?.overtimeMinutes ?? 0);

  return {
    presentDays: String(totals?.presentDays ?? 0),
    workedHours: worked.hours,
    workedMinutes: worked.minutes,
    lateHours: late.hours,
    lateMinutes: late.minutes,
    undertimeHours: undertime.hours,
    undertimeMinutes: undertime.minutes,
    overtimeHours: overtime.hours,
    overtimeMinutes: overtime.minutes,
  };
}

function createDtrComputedOverrideDraft(
  totals: AttendanceDtrEmployeeSummaryView["totals"] | null | undefined
): DtrPeriodOverrideDraft {
  const worked = splitDtrMinutes(totals?.computed.workedMinutes ?? 0);
  const late = splitDtrMinutes(totals?.computed.lateMinutes ?? 0);
  const undertime = splitDtrMinutes(totals?.computed.undertimeMinutes ?? 0);
  const overtime = splitDtrMinutes(totals?.computed.overtimeMinutes ?? 0);

  return {
    presentDays: String(totals?.computed.presentDays ?? 0),
    workedHours: worked.hours,
    workedMinutes: worked.minutes,
    lateHours: late.hours,
    lateMinutes: late.minutes,
    undertimeHours: undertime.hours,
    undertimeMinutes: undertime.minutes,
    overtimeHours: overtime.hours,
    overtimeMinutes: overtime.minutes,
  };
}

function parseDtrDraftNumber(value: string, max: number) {
  const trimmed = value.trim();
  if (!trimmed) return 0;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(max, Math.floor(parsed));
}

function parseDtrMinuteDraft(hoursValue: string, minutesValue: string) {
  const hours = parseDtrDraftNumber(hoursValue, 9999);
  const minutes = parseDtrDraftNumber(minutesValue, 59);

  if (hours == null || minutes == null) return null;
  return hours * 60 + minutes;
}

function normalizeDtrPeriodOverrideValue(
  value: number,
  computedValue: number
) {
  return value === computedValue ? null : value;
}

function buildDtrPeriodOverridePayloadFromDraft(
  employee: AttendanceDtrEmployeeSummaryView,
  draft: DtrPeriodOverrideDraft,
  options: { workedDraftTouched?: boolean } = {}
) {
  const presentDays = Number(draft.presentDays.trim());
  const workedMinutes = parseDtrMinuteDraft(
    draft.workedHours,
    draft.workedMinutes
  );
  const lateMinutes = parseDtrMinuteDraft(draft.lateHours, draft.lateMinutes);
  const undertimeMinutes = parseDtrMinuteDraft(
    draft.undertimeHours,
    draft.undertimeMinutes
  );
  const overtimeMinutes = parseDtrMinuteDraft(
    draft.overtimeHours,
    draft.overtimeMinutes
  );

  if (
    !Number.isFinite(presentDays) ||
    presentDays < 0 ||
    workedMinutes == null ||
    lateMinutes == null ||
    undertimeMinutes == null ||
    overtimeMinutes == null
  ) {
    return null;
  }

  const shouldPersistWorkedOverride =
    options.workedDraftTouched ||
    employee.totals.overrides.workedMinutes != null;

  return {
    presentDays: normalizeDtrPeriodOverrideValue(
      presentDays,
      employee.totals.computed.presentDays
    ),
    workedMinutes: shouldPersistWorkedOverride
      ? normalizeDtrPeriodOverrideValue(
          workedMinutes,
          employee.totals.computed.workedMinutes
        )
      : null,
    lateMinutes: normalizeDtrPeriodOverrideValue(
      lateMinutes,
      employee.totals.computed.lateMinutes
    ),
    undertimeMinutes: normalizeDtrPeriodOverrideValue(
      undertimeMinutes,
      employee.totals.computed.undertimeMinutes
    ),
    overtimeMinutes: normalizeDtrPeriodOverrideValue(
      overtimeMinutes,
      employee.totals.computed.overtimeMinutes
    ),
  };
}

function dtrOverrideValuesMatch(
  left: number | null | undefined,
  right: number | null | undefined
) {
  return (left ?? null) === (right ?? null);
}

function isDtrPeriodOverridePayloadDirty(
  payload: ReturnType<typeof buildDtrPeriodOverridePayloadFromDraft>,
  employee: AttendanceDtrEmployeeSummaryView | null
) {
  if (!payload || !employee) return false;

  return (
    !dtrOverrideValuesMatch(payload.presentDays, employee.totals.overrides.presentDays) ||
    !dtrOverrideValuesMatch(payload.workedMinutes, employee.totals.overrides.workedMinutes) ||
    !dtrOverrideValuesMatch(payload.lateMinutes, employee.totals.overrides.lateMinutes) ||
    !dtrOverrideValuesMatch(
      payload.undertimeMinutes,
      employee.totals.overrides.undertimeMinutes
    ) ||
    !dtrOverrideValuesMatch(payload.overtimeMinutes, employee.totals.overrides.overtimeMinutes)
  );
}

function hasSavedDtrPeriodOverride(
  employee: AttendanceDtrEmployeeSummaryView | null
) {
  if (!employee) return false;
  return Object.values(employee.totals.overrides).some((value) => value != null);
}

function matchesSearchTerm(
  values: Array<string | number | null | undefined>,
  searchTerm: string
) {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  if (!normalizedSearchTerm) return true;

  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(normalizedSearchTerm)
  );
}

const payrollAccountCodeCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function comparePayrollAccountCodeOptions(
  left: PayrollExceptionAccountCodeOptionView,
  right: PayrollExceptionAccountCodeOptionView
) {
  const codeComparison = payrollAccountCodeCollator.compare(left.code, right.code);
  if (codeComparison !== 0) return codeComparison;

  const typeComparison = payrollAccountCodeCollator.compare(
    left.accountType ?? "",
    right.accountType ?? ""
  );
  if (typeComparison !== 0) return typeComparison;

  return payrollAccountCodeCollator.compare(
    left.description ?? "",
    right.description ?? ""
  );
}

function formatPayrollAccountCodeOption(
  option: PayrollExceptionAccountCodeOptionView
) {
  return [
    option.code,
    option.accountType,
    option.description,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" - ");
}

function getDepartmentFilterValue(
  employee: DepartmentFilterEmployee
): DepartmentFilterValue {
  return employee.departmentId == null
    ? UNASSIGNED_DEPARTMENT_VALUE
    : (`department:${employee.departmentId}` as DepartmentFilterValue);
}

function getDepartmentLabel(employee: DepartmentFilterEmployee) {
  if (employee.departmentId == null) return "Unassigned";

  const departmentName = employee.departmentName?.trim();
  const departmentCode = employee.departmentCode?.trim();

  return departmentName || departmentCode || `Department #${employee.departmentId}`;
}

function buildDepartmentFilterOptions(
  employees: DepartmentFilterEmployee[]
): DepartmentFilterOption[] {
  const departmentOptions = new Map<DepartmentFilterValue, DepartmentFilterOption>();
  let unassignedCount = 0;

  for (const employee of employees) {
    if (employee.departmentId == null) {
      unassignedCount += 1;
      continue;
    }

    const value = getDepartmentFilterValue(employee);
    const label = getDepartmentLabel(employee);
    const departmentCode = employee.departmentCode?.trim();
    const existingOption = departmentOptions.get(value);
    const description =
      departmentCode && departmentCode !== label ? `Code: ${departmentCode}` : null;

    departmentOptions.set(value, {
      value,
      label: existingOption?.label ?? label,
      description: existingOption?.description ?? description,
      count: (existingOption?.count ?? 0) + 1,
      searchText: "",
    });
  }

  const sortedDepartmentOptions = [...departmentOptions.values()]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((option) => ({
      ...option,
      searchText: [option.label, option.description, option.count].join(" "),
    }));

  const options: DepartmentFilterOption[] = [
    {
      value: ALL_DEPARTMENTS_VALUE,
      label: "All departments",
      description: null,
      count: employees.length,
      searchText: `All departments ${employees.length}`,
    },
    ...sortedDepartmentOptions,
  ];

  if (unassignedCount > 0) {
    options.push({
      value: UNASSIGNED_DEPARTMENT_VALUE,
      label: "Unassigned",
      description: null,
      count: unassignedCount,
      searchText: `Unassigned ${unassignedCount}`,
    });
  }

  return options;
}

function matchesDepartmentFilter(
  employee: DepartmentFilterEmployee,
  departmentFilter: DepartmentFilterValue
) {
  return (
    departmentFilter === ALL_DEPARTMENTS_VALUE ||
    getDepartmentFilterValue(employee) === departmentFilter
  );
}

function DepartmentFilterDropdown({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: DepartmentFilterValue;
  onChange: (value: DepartmentFilterValue) => void;
  options: DepartmentFilterOption[];
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [departmentSearch, setDepartmentSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setDepartmentSearch("");
    }
  }, [open]);

  const selectedOption =
    options.find((option) => option.value === value) ?? options[0];
  const filteredOptions = options.filter((option) =>
    matchesSearchTerm([option.searchText], departmentSearch)
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between"
          aria-label={ariaLabel}
          aria-expanded={open}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">
              {selectedOption?.label ?? "All departments"}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0"
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={departmentSearch}
              onChange={(event) => setDepartmentSearch(event.target.value)}
              placeholder="Search department..."
              aria-label="Search departments"
              className="pl-8"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-auto p-1">
          {filteredOptions.map((option) => {
            const selected = option.value === selectedOption?.value;

            return (
              <button
                key={option.value}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn("h-4 w-4", selected ? "opacity-100" : "opacity-0")}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.count}</span>
                  </span>
                  {option.description && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {filteredOptions.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No departments found.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MissingDtrBadge() {
  return (
    <span className="shrink-0 text-xs font-semibold text-destructive">
      Missing DTR
    </span>
  );
}

function EmployeeDtrPicker({
  value,
  employees,
  onChange,
  disabled,
}: {
  value: string | null;
  employees: AttendanceDtrEmployeeSummaryView[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setEmployeeSearch("");
    }
  }, [open]);

  const selectedEmployee =
    employees.find((employee) => employee.employeeId === value) ?? null;
  const filteredEmployees = employees.filter((employee) =>
    matchesSearchTerm(
      [
        employee.employeeName,
        employee.employeeNo,
        formatEmployeeNoDisplay(employee.employeeNo),
        getEmployeeTypeDisplay(employee),
        employee.departmentName,
        employee.departmentCode,
        formatEmployeePickerLabel({
          employeeNo: employee.employeeNo,
          employeeType: employee.employeeType,
          fallbackName: employee.employeeName,
        }),
        employee.hasDtrRecord ? null : "Missing DTR",
        employee.sourceFiles.map((sourceFile) => sourceFile.sourceFileName).join(" "),
      ],
      employeeSearch
    )
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-9 w-full justify-between whitespace-normal px-3 py-2 text-left"
          aria-label="Search semimonthly DTR employees"
          aria-expanded={open}
          disabled={disabled || employees.length === 0}
        >
          <span className="min-w-0 flex-1">
            {selectedEmployee ? (
              <>
                <span className="flex min-w-0 items-center gap-2">
                  {selectedEmployee.hasDtrRecord ? null : <MissingDtrBadge />}
                  <span className="min-w-0 truncate">
                    {formatEmployeePickerLabel({
                      employeeNo: selectedEmployee.employeeNo,
                      employeeType: selectedEmployee.employeeType,
                      fallbackName: selectedEmployee.employeeName,
                    })}
                  </span>
                </span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {selectedEmployee.departmentName ?? "No department"}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Search employee</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0"
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={employeeSearch}
              onChange={(event) => setEmployeeSearch(event.target.value)}
              placeholder="Search employee, no., department, or source file..."
              aria-label="Search semimonthly DTR employees"
              className="pl-8"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-auto p-1">
          {filteredEmployees.map((employee) => {
            const selected = employee.employeeId === selectedEmployee?.employeeId;
            const sourceFileText = employee.sourceFiles
              .map((sourceFile) => sourceFile.sourceFileName)
              .join(", ");

            return (
              <button
                key={employee.employeeId}
                type="button"
                className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                onClick={() => {
                  onChange(employee.employeeId);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    selected ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    {employee.hasDtrRecord ? null : <MissingDtrBadge />}
                    <span className="min-w-0 truncate">
                      {formatEmployeePickerLabel({
                        employeeNo: employee.employeeNo,
                        employeeType: employee.employeeType,
                        fallbackName: employee.employeeName,
                      })}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {employee.departmentName ?? "No department"}
                  </span>
                  {sourceFileText ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {sourceFileText}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
          {filteredEmployees.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No employees found.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PayrollAccountCodeEmployeePicker({
  value,
  employees,
  onChange,
  disabled,
}: {
  value: string | null;
  employees: PayrollAccountCodeEmployeeView[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setEmployeeSearch("");
    }
  }, [open]);

  const selectedEmployee =
    employees.find((employee) => employee.employeeId === value) ?? null;
  const filteredEmployees = employees.filter((employee) =>
    matchesSearchTerm(
      [
        employee.employeeName,
        employee.employeeNo,
        employee.firstName,
        employee.lastName,
        employee.middleName,
        formatEmployeeNoDisplay(employee.employeeNo),
        getEmployeeTypeDisplay(employee),
        employee.departmentName,
        employee.departmentCode,
        formatEmployeePickerLabel({
          firstName: employee.firstName,
          middleName: employee.middleName,
          lastName: employee.lastName,
          employeeNo: employee.employeeNo,
          employeeType: employee.employeeType,
          fallbackName: employee.employeeName,
        }),
      ],
      employeeSearch
    )
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-9 w-full justify-between whitespace-normal px-3 py-2 text-left"
          aria-label="Search payroll account-code employees"
          aria-expanded={open}
          disabled={disabled || employees.length === 0}
        >
          <span className="min-w-0 flex-1">
            {selectedEmployee ? (
              <>
                <span className="block truncate">
                  {formatEmployeePickerLabel({
                    firstName: selectedEmployee.firstName,
                    middleName: selectedEmployee.middleName,
                    lastName: selectedEmployee.lastName,
                    employeeNo: selectedEmployee.employeeNo,
                    employeeType: selectedEmployee.employeeType,
                    fallbackName: selectedEmployee.employeeName,
                  })}
                </span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {selectedEmployee.departmentName ?? "No department"}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Search employee</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[340px] p-0"
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={employeeSearch}
              onChange={(event) => setEmployeeSearch(event.target.value)}
              placeholder="Search employee, no., or department..."
              aria-label="Search payroll account-code employees"
              className="pl-8"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-auto p-1">
          {filteredEmployees.map((employee) => {
            const selected = employee.employeeId === selectedEmployee?.employeeId;

            return (
              <button
                key={employee.employeeId}
                type="button"
                className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                onClick={() => {
                  onChange(employee.employeeId);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    selected ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {formatEmployeePickerLabel({
                      firstName: employee.firstName,
                      middleName: employee.middleName,
                      lastName: employee.lastName,
                      employeeNo: employee.employeeNo,
                      employeeType: employee.employeeType,
                      fallbackName: employee.employeeName,
                    })}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {employee.departmentName ?? "No department"}
                  </span>
                </span>
              </button>
            );
          })}
          {filteredEmployees.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No employees found.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PayrollAccountCodePicker({
  value,
  options,
  snapshotCode,
  onChange,
  disabled,
}: {
  value: string;
  options: PayrollExceptionAccountCodeOptionView[];
  snapshotCode?: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [accountCodeSearch, setAccountCodeSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setAccountCodeSearch("");
    }
  }, [open]);

  const selectedOption =
    options.find((option) => String(option.id) === value) ?? null;
  const selectedSnapshotCode = value.startsWith("snapshot:")
    ? value.slice("snapshot:".length)
    : snapshotCode ?? null;
  const filteredOptions = options.filter((option) =>
    matchesSearchTerm([formatPayrollAccountCodeOption(option)], accountCodeSearch)
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-9 w-full min-w-[240px] justify-between whitespace-normal px-3 py-2 text-left"
          aria-label="Search payroll account codes"
          aria-expanded={open}
          disabled={disabled}
        >
          <span className="min-w-0 flex-1">
            {selectedOption ? (
              <>
                <span className="block truncate">{selectedOption.code}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {[selectedOption.accountType, selectedOption.description]
                    .filter((item): item is string => Boolean(item))
                    .join(" - ") || "Account code"}
                </span>
              </>
            ) : selectedSnapshotCode ? (
              <span className="block truncate">Snapshot: {selectedSnapshotCode}</span>
            ) : (
              <span className="text-muted-foreground">Select account code</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[340px] p-0"
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={accountCodeSearch}
              onChange={(event) => setAccountCodeSearch(event.target.value)}
              placeholder="Search account code, type, or description..."
              aria-label="Search payroll account codes"
              className="pl-8"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-auto p-1">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
            onClick={() => {
              onChange("__none__");
              setOpen(false);
            }}
          >
            <Check
              className={cn(
                "h-4 w-4 shrink-0",
                value === "__none__" ? "opacity-100" : "opacity-0"
              )}
            />
            <span className="text-muted-foreground">Select account code</span>
          </button>
          {selectedSnapshotCode && !selectedOption ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
              onClick={() => {
                onChange(`snapshot:${selectedSnapshotCode}`);
                setOpen(false);
              }}
            >
              <Check className="h-4 w-4 shrink-0 opacity-100" />
              <span className="min-w-0 flex-1 truncate">
                Snapshot: {selectedSnapshotCode}
              </span>
            </button>
          ) : null}
          {filteredOptions.map((option) => {
            const optionValue = String(option.id);
            const selected = optionValue === value;

            return (
              <button
                key={option.id}
                type="button"
                className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                onClick={() => {
                  onChange(optionValue);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    selected ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.code}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[option.accountType, option.description]
                      .filter((item): item is string => Boolean(item))
                      .join(" - ") || "Account code"}
                  </span>
                </span>
              </button>
            );
          })}
          {filteredOptions.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No account codes found.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ManualPayrollAccountCodePicker({
  value,
  options,
  snapshotCode,
  snapshotDescription,
  onChange,
  disabled,
}: {
  value: string;
  options: ManualPayrollAccountCodeOptionView[];
  snapshotCode?: string | null;
  snapshotDescription?: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [accountCodeSearch, setAccountCodeSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setAccountCodeSearch("");
    }
  }, [open]);

  const selectedOption =
    options.find((option) => String(option.id) === value) ?? null;
  const snapshotCodeText = snapshotCode?.trim() || null;
  const hasSnapshot = value === "__snapshot__" || Boolean(snapshotCodeText);
  const snapshotDisplayCode = snapshotCodeText ?? "Saved row";
  const snapshotDisplayDescription = snapshotDescription?.trim() || null;
  const filteredOptions = options.filter((option) =>
    matchesSearchTerm([formatPayrollAccountCodeOption(option)], accountCodeSearch)
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-9 w-full min-w-[240px] justify-between whitespace-normal px-3 py-2 text-left"
          aria-label="Search manual payroll account codes"
          aria-expanded={open}
          disabled={disabled}
        >
          <span className="min-w-0 flex-1">
            {selectedOption ? (
              <>
                <span className="block truncate">{selectedOption.code}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {[selectedOption.accountType, selectedOption.description]
                    .filter((item): item is string => Boolean(item))
                    .join(" - ") || "Account code"}
                </span>
              </>
            ) : hasSnapshot ? (
              <>
                <span className="block truncate">{snapshotDisplayCode}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {snapshotDisplayDescription ?? "Saved row"}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Select account code</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[340px] p-0"
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={accountCodeSearch}
              onChange={(event) => setAccountCodeSearch(event.target.value)}
              placeholder="Search account code, type, or description..."
              aria-label="Search manual payroll account codes"
              className="pl-8"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-auto p-1">
          {hasSnapshot && !selectedOption ? (
            <button
              type="button"
              className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
              onClick={() => setOpen(false)}
            >
              <Check className="mt-0.5 h-4 w-4 shrink-0 opacity-100" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">Saved row</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[snapshotCodeText, snapshotDisplayDescription]
                    .filter((item): item is string => Boolean(item))
                    .join(" - ") || snapshotDisplayCode}
                </span>
              </span>
            </button>
          ) : null}
          {filteredOptions.map((option) => {
            const optionValue = String(option.id);
            const selected = optionValue === value;

            return (
              <button
                key={option.id}
                type="button"
                className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                onClick={() => {
                  onChange(optionValue);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    selected ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.code}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[option.accountType, option.description]
                      .filter((item): item is string => Boolean(item))
                      .join(" - ") || "Account code"}
                  </span>
                </span>
              </button>
            );
          })}
          {filteredOptions.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No account codes found.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EditableDtrTotalCard({
  label,
  value,
  computedValue,
  secondaryValue,
  isOverridden,
  children,
}: {
  label: string;
  value: string;
  computedValue: string;
  secondaryValue?: ReactNode;
  isOverridden: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        isOverridden ? "border-sky-300 bg-sky-50/50 dark:bg-sky-950/20" : ""
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {isOverridden ? (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
            Manual
          </span>
        ) : null}
      </div>
      <div className="mt-1 font-semibold">{value}</div>
      {isOverridden ? (
        <div className="mt-1 text-xs text-muted-foreground">
          Computed {computedValue}
        </div>
      ) : null}
      {secondaryValue ? (
        <div className="mt-1 text-xs text-muted-foreground">
          {secondaryValue}
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        {children}
      </div>
    </div>
  );
}

function renderStatutoryAuditCards(employee: {
  statutoryMonthlyCompensationBase: string | null;
  sssContributionSource: string | null;
  sssSalaryCredit: string | null;
  sssBracketLabel: string | null;
}) {
  const hasAuditDetails =
    employee.statutoryMonthlyCompensationBase ||
    employee.sssContributionSource ||
    employee.sssSalaryCredit ||
    employee.sssBracketLabel;

  if (!hasAuditDetails) return null;

  const formattedBracketLabel = employee.sssBracketLabel
    ? employee.sssBracketLabel
        .split(" to ")
        .map((part) => {
          const numericValue = Number(part);
          return Number.isFinite(numericValue) ? formatMoney(numericValue) : part;
        })
        .join(" to ")
    : "-";

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <div className="font-semibold">Statutory Contribution Audit</div>
        <div className="text-sm text-muted-foreground">
          The statutory base below is the monthly amount used to determine SSS,
          PhilHealth, and Pag-IBIG. SSS salary credit and bracket appear only
          when the employee uses the statutory table instead of a fixed custom
          share.
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Statutory Base
          </div>
          <div className="mt-1 font-semibold">
            {employee.statutoryMonthlyCompensationBase
              ? formatMoney(employee.statutoryMonthlyCompensationBase)
              : "-"}
          </div>
          <div className="text-xs text-muted-foreground">
            Monthly basis used for SSS, PhilHealth, and Pag-IBIG.
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            SSS Source
          </div>
          <div className="mt-1 font-semibold">
            {employee.sssContributionSource ?? "-"}
          </div>
          <div className="text-xs text-muted-foreground">
            Shows whether SSS came from the statutory table or a fixed custom share.
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            SSS Salary Credit
          </div>
          <div className="mt-1 font-semibold">
            {employee.sssSalaryCredit ? formatMoney(employee.sssSalaryCredit) : "-"}
          </div>
          <div className="text-xs text-muted-foreground">
            The matched monthly salary credit for the active SSS version.
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            SSS Bracket
          </div>
          <div className="mt-1 font-semibold">{formattedBracketLabel}</div>
          <div className="text-xs text-muted-foreground">
            The compensation range used to pick the SSS contribution row.
          </div>
        </div>
      </div>
    </div>
  );
}

const PAYROLL_ACCOUNT_CODE_DEDUCTION_TYPES = new Set<PayrollExceptionAccountType>([
  "Unpaid Leaves/Absences",
  "Loan",
  "Other Deduction",
]);

function isPayrollAccountCodeDeductionType(
  accountType: PayrollExceptionAccountType | null
) {
  return accountType != null && PAYROLL_ACCOUNT_CODE_DEDUCTION_TYPES.has(accountType);
}

function isOtherIncomeAccountType(
  accountType: PayrollExceptionAccountType | null
) {
  return accountType === "Other Income";
}

function getPayrollAccountCodeLineTab(
  accountType: PayrollExceptionAccountType | null
): PayrollAccountCodeLineTab {
  return isPayrollAccountCodeDeductionType(accountType) ? "deduction" : "income";
}

function parsePayrollExceptionNumber(value: string, max?: number) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return max == null ? parsed : Math.min(max, parsed);
}

function createPayrollExceptionDraft(row: PayrollExceptionRowView): PayrollExceptionDraft {
  return {
    localId: row.id,
    id: row.id,
    attendanceDate: row.attendanceDate,
    accountCodeId: row.accountCodeId != null ? String(row.accountCodeId) : "",
    accountCodeSnapshot: row.accountCodeSnapshot,
    accountTypeSnapshot: row.accountTypeSnapshot,
    accountDescriptionSnapshot: row.accountDescriptionSnapshot ?? "",
    accountMonth13thPaySnapshot: row.accountMonth13thPaySnapshot,
    accountNonTaxableSnapshot: row.accountNonTaxableSnapshot,
    dayType:
      row.dayType ??
      (row.accountTypeSnapshot === "Sunday/Holiday"
        ? DEFAULT_PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPE
        : null),
    overtimeCategory: row.overtimeCategory ?? "REGULAR_DAY",
    hours: String(row.hours ?? 0),
    minutes: String(row.minutes ?? 0),
    amountOverride: row.amountOverride ?? "",
    remarks: row.remarks ?? "",
    dtrOverrideSource: row.dtrOverrideSource,
    isNew: false,
  };
}

function getDefaultOvertimeCategory(row: AttendanceDtrDayView) {
  return resolveOvertimeCategory({
    isRestDay: row.isRestDay,
    holidayType: getHolidayTypeFromAttendanceDtrDayType(row.effectiveDayType),
  });
}

function isPayrollExceptionHolidayDayType(
  value: AttendanceDtrDayType | null | undefined
): value is (typeof PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPES)[number] {
  return PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPES.includes(
    value as (typeof PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPES)[number]
  );
}

function getDefaultPayrollExceptionHolidayDayType(
  row: AttendanceDtrDayView | null | undefined
) {
  return isPayrollExceptionHolidayDayType(row?.effectiveDayType)
    ? row.effectiveDayType
    : DEFAULT_PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPE;
}

function getDefaultPayrollAccountCodeOption(args: {
  accountCodeOptions: PayrollExceptionAccountCodeOptionView[];
  lineTab: PayrollAccountCodeLineTab;
}) {
  return (
    args.accountCodeOptions.find(
      (option) => getPayrollAccountCodeLineTab(option.accountType) === args.lineTab
    ) ??
    args.accountCodeOptions[0] ??
    null
  );
}

function createPayrollAccountCodeDraft(args: {
  attendanceDate: string;
  accountCodeOptions: PayrollExceptionAccountCodeOptionView[];
  lineTab: PayrollAccountCodeLineTab;
  dayType?: AttendanceDtrDayType | null;
}) {
  const accountCodeOption = getDefaultPayrollAccountCodeOption({
    accountCodeOptions: args.accountCodeOptions,
    lineTab: args.lineTab,
  });

  return {
    localId: `new-${Date.now()}-${args.lineTab}-${args.attendanceDate}`,
    id: null,
    attendanceDate: args.attendanceDate,
    accountCodeId: accountCodeOption ? String(accountCodeOption.id) : "",
    accountCodeSnapshot: accountCodeOption?.code ?? "",
    accountTypeSnapshot: accountCodeOption?.accountType ?? null,
    accountDescriptionSnapshot: accountCodeOption?.description ?? "",
    accountMonth13thPaySnapshot: accountCodeOption?.month13thPay ?? false,
    accountNonTaxableSnapshot: accountCodeOption?.nonTaxable ?? false,
    dayType:
      accountCodeOption?.accountType === "Sunday/Holiday"
        ? args.dayType ?? DEFAULT_PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPE
        : null,
    overtimeCategory: "REGULAR_DAY",
    hours: "0",
    minutes: "0",
    amountOverride: "",
    remarks: "",
    dtrOverrideSource: null,
    isNew: true,
  } satisfies PayrollExceptionDraft;
}

function normalizePayrollExceptionComparisonText(
  value: string | null | undefined
) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function normalizePayrollExceptionComparisonMoney(
  value: string | number | null | undefined
) {
  if (value == null || value === "") return null;
  const parsed =
    typeof value === "number"
      ? value
      : parsePayrollExceptionNumber(String(value));

  return parsed == null ? null : parsed.toFixed(2);
}

function isPayrollExceptionDraftDirty(
  draft: PayrollExceptionDraft,
  row: PayrollExceptionRowView | null
) {
  if (draft.isNew || !row) return true;

  const serializedDraft = serializePayrollExceptionDraft(draft);
  const rowDayType =
    serializedDraft.accountTypeSnapshot === "Sunday/Holiday"
      ? row.dayType
      : null;
  const rowOvertimeCategory =
    serializedDraft.accountTypeSnapshot === "Overtime"
      ? row.overtimeCategory
      : null;

  return (
    serializedDraft.attendanceDate !== row.attendanceDate ||
    serializedDraft.accountCodeId !== row.accountCodeId ||
    normalizePayrollExceptionComparisonText(
      serializedDraft.accountCodeSnapshot
    ) !== normalizePayrollExceptionComparisonText(row.accountCodeSnapshot) ||
    serializedDraft.accountTypeSnapshot !== row.accountTypeSnapshot ||
    normalizePayrollExceptionComparisonText(
      serializedDraft.accountDescriptionSnapshot
    ) !==
      normalizePayrollExceptionComparisonText(row.accountDescriptionSnapshot) ||
    draft.accountMonth13thPaySnapshot !== row.accountMonth13thPaySnapshot ||
    draft.accountNonTaxableSnapshot !== row.accountNonTaxableSnapshot ||
    serializedDraft.dayType !== rowDayType ||
    serializedDraft.overtimeCategory !== rowOvertimeCategory ||
    serializedDraft.dtrOverrideSource !== row.dtrOverrideSource ||
    serializedDraft.hours !== row.hours ||
    serializedDraft.minutes !== row.minutes ||
    normalizePayrollExceptionComparisonMoney(
      serializedDraft.amountOverride
    ) !== normalizePayrollExceptionComparisonMoney(row.amountOverride) ||
    normalizePayrollExceptionComparisonText(serializedDraft.remarks) !==
      normalizePayrollExceptionComparisonText(row.remarks)
  );
}

function getPayrollExceptionDraftChangeCount(
  drafts: PayrollExceptionDraft[],
  rows: PayrollExceptionRowView[]
) {
  const rowsById = new Map(rows.map((row) => [row.id, row] as const));
  const draftIds = new Set(
    drafts
      .map((draft) => draft.id)
      .filter((id): id is string => id != null)
  );
  const dirtyDraftCount = drafts.filter((draft) =>
    isPayrollExceptionDraftDirty(
      draft,
      draft.id ? rowsById.get(draft.id) ?? null : null
    )
  ).length;
  const deletedRowCount = rows.filter((row) => !draftIds.has(row.id)).length;

  return dirtyDraftCount + deletedRowCount;
}

function getPayrollExceptionDuplicateKey(draft: PayrollExceptionDraft) {
  const accountKey =
    draft.accountCodeId || draft.accountCodeSnapshot.trim() || "__missing__";
  const overtimeKey =
    draft.accountTypeSnapshot === "Overtime"
      ? draft.overtimeCategory || "__missing_ot__"
      : "__none__";

  return `${accountKey}:${overtimeKey}`;
}

function isGeneratedDtrQuantityOnlyDeductionDraft(
  draft: PayrollExceptionDraft
) {
  return isPayrollExceptionDtrQuantityOnlyDeductionSource(
    draft.dtrOverrideSource
  );
}

function isPayrollExceptionDraftHourBased(draft: PayrollExceptionDraft) {
  return (
    isManualPayrollHourBasedAccountType(draft.accountTypeSnapshot) ||
    isGeneratedDtrQuantityOnlyDeductionDraft(draft)
  );
}

function isPayrollExceptionDraftAmountOnly(draft: PayrollExceptionDraft) {
  return (
    isOtherIncomeAccountType(draft.accountTypeSnapshot) ||
    draft.accountTypeSnapshot === "Loan" ||
    (draft.accountTypeSnapshot === "Other Deduction" &&
      !isGeneratedDtrQuantityOnlyDeductionDraft(draft))
  );
}

function getPayrollExceptionDraftError(
  draft: PayrollExceptionDraft,
  duplicateKeys: Set<string>
) {
  if (duplicateKeys.has(getPayrollExceptionDuplicateKey(draft))) {
    return isOtherIncomeAccountType(draft.accountTypeSnapshot)
      ? "Only one Other Income row per payroll period and account code is allowed."
      : "Account code and OT category must be unique for this payroll period.";
  }

  if (!draft.accountCodeId && !draft.accountCodeSnapshot.trim()) {
    return "Select an account code.";
  }

  if (draft.accountTypeSnapshot === "Overtime" && !draft.overtimeCategory) {
    return "Select an OT category.";
  }

  const isDeduction = isPayrollAccountCodeDeductionType(
    draft.accountTypeSnapshot
  );
  const isOtherIncome = isOtherIncomeAccountType(draft.accountTypeSnapshot);
  const isHourBased = isPayrollExceptionDraftHourBased(draft);
  const isAmountOnly = isPayrollExceptionDraftAmountOnly(draft);
  const amountOverride = parsePayrollExceptionNumber(draft.amountOverride);
  const hasAmountOverride =
    Boolean(draft.amountOverride.trim()) && amountOverride != null;
  const quantityMinutes =
    Math.floor(parsePayrollExceptionNumber(draft.hours) ?? 0) * 60 +
    Math.floor(parsePayrollExceptionNumber(draft.minutes) ?? 0);

  if (isOtherIncome && (amountOverride == null || amountOverride <= 0)) {
    return "Enter an Other Income amount.";
  }

  if (isAmountOnly && !isOtherIncome && !hasAmountOverride) {
    return "Enter a deduction amount.";
  }

  if (isHourBased && !hasAmountOverride && quantityMinutes <= 0) {
    return "Enter hours/minutes or an amount override.";
  }

  if (hasAmountOverride && !draft.remarks.trim() && !isDeduction && !isOtherIncome) {
    return "Add remarks for amount overrides.";
  }

  return null;
}

function serializePayrollExceptionDraft(draft: PayrollExceptionDraft) {
  const isAmountOnly = isPayrollExceptionDraftAmountOnly(draft);
  const hours = isAmountOnly
    ? 0
    : Math.floor(parsePayrollExceptionNumber(draft.hours) ?? 0);
  const minutes = isAmountOnly
    ? 0
    : Math.floor(parsePayrollExceptionNumber(draft.minutes) ?? 0);
  const amountOverride = parsePayrollExceptionNumber(draft.amountOverride);

  return {
    id: draft.id,
    attendanceDate: draft.attendanceDate,
    accountCodeId: draft.accountCodeId
      ? Number(draft.accountCodeId)
      : null,
    accountCodeSnapshot: draft.accountCodeSnapshot.trim() || null,
    accountTypeSnapshot: draft.accountTypeSnapshot,
    accountDescriptionSnapshot: draft.accountDescriptionSnapshot.trim() || null,
    dayType:
      draft.accountTypeSnapshot === "Sunday/Holiday"
        ? draft.dayType ?? DEFAULT_PAYROLL_EXCEPTION_HOLIDAY_DAY_TYPE
        : null,
    overtimeCategory:
      draft.accountTypeSnapshot === "Overtime" ? draft.overtimeCategory : null,
    dtrOverrideSource: draft.dtrOverrideSource,
    hours,
    minutes,
    amountOverride,
    remarks: draft.remarks.trim() || null,
  };
}

function createManualPayrollDraft(
  workspace: ManualPayrollEntryWorkspaceView | null
): ManualPayrollDraft {
  const accountCodeById = new Map(
    workspace?.accountCodeOptions.map((option) => [option.id, option]) ?? []
  );

  return {
    sssEmployee: workspace?.sssEmployee ?? "0.00",
    sssEmployer: workspace?.sssEmployer ?? "0.00",
    sssEc: workspace?.sssEc ?? "0.00",
    sssBasis: workspace?.sssBasis ?? "0.00",
    philhealthEmployee: workspace?.philhealthEmployee ?? "0.00",
    philhealthEmployer: workspace?.philhealthEmployer ?? "0.00",
    philhealthBasis: workspace?.philhealthBasis ?? "0.00",
    pagibigEmployee: workspace?.pagibigEmployee ?? "0.00",
    pagibigEmployer: workspace?.pagibigEmployer ?? "0.00",
    pagibigBasis: workspace?.pagibigBasis ?? "0.00",
    withholdingTax: workspace?.withholdingTax ?? "0.00",
    withholdingTaxBasis: workspace?.withholdingTaxBasis ?? "0.00",
    peraaEmployee: workspace?.peraaEmployee ?? "0.00",
    peraaEmployer: workspace?.peraaEmployer ?? "0.00",
    peraaBasis: workspace?.peraaBasis ?? "0.00",
    remarks: workspace?.remarks ?? "",
    lines:
      workspace?.lines.map((line, index) => {
        const account =
          line.accountCodeId != null
            ? accountCodeById.get(line.accountCodeId) ?? null
            : null;

        return {
          ...line,
          localId: line.id ?? `loaded-${index}-${line.code}-${line.summaryBucket}`,
          id: line.id,
          summaryBucket: getManualPayrollBucketFromAccountCodeOrType(
            {
              code: account?.code ?? line.code,
              accountType: account?.accountType ?? null,
            },
            line.summaryBucket
          ),
          amount: formatMoneyInput(line.amount),
          loanRefNo: account?.accountType === "Loan" ? line.loanRefNo : null,
          isSystem: line.accountCodeId == null,
        };
      }) ?? [],
  };
}

function compareManualPayrollDraftLineCode(
  left: Pick<ManualPayrollDraftLine, "code" | "sortOrder">,
  right: Pick<ManualPayrollDraftLine, "code" | "sortOrder">
) {
  return (
    left.code.localeCompare(right.code, undefined, {
      numeric: true,
      sensitivity: "base",
    }) ||
    (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
  );
}

function sortManualPayrollDraftLines(lines: ManualPayrollDraftLine[]) {
  return [...lines].sort(compareManualPayrollDraftLineCode);
}

const EMPLOYEE_CONTRIBUTION_CODES = new Set([
  "SSS",
  "PHILHEALTH",
  "PAGIBIG",
  "PERAA",
  "TAX",
]);

const EMPLOYER_CONTRIBUTION_CODES = new Set([
  "SSS-ER",
  "SSS-EC",
  "PHILHEALTH-ER",
  "PAGIBIG-ER",
  "PERAA-ER",
]);

type PayrollRunLineDisplayRow =
  | { kind: "line"; line: PayrollRunLineView }
  | { kind: "separator"; id: string; label: string };

function comparePayrollRunLineCode(
  left: Pick<PayrollRunLineView, "code">,
  right: Pick<PayrollRunLineView, "code">
) {
  return left.code.localeCompare(right.code, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function isEmployeeContributionLine(line: PayrollRunLineView) {
  return (
    line.lineType === "Deduction" && EMPLOYEE_CONTRIBUTION_CODES.has(line.code)
  );
}

function isEmployerContributionLine(line: PayrollRunLineView) {
  return (
    line.lineType === "Employer Contribution" ||
    EMPLOYER_CONTRIBUTION_CODES.has(line.code)
  );
}

function buildPayrollRunLineDisplayRows(
  lines: PayrollRunLineView[]
): PayrollRunLineDisplayRow[] {
  const normalLines = lines.filter(
    (line) =>
      !isEmployeeContributionLine(line) && !isEmployerContributionLine(line)
  );
  const employeeContributionLines = lines.filter(isEmployeeContributionLine);
  const employerContributionLines = lines.filter(isEmployerContributionLine);

  const lineRows: PayrollRunLineDisplayRow[] = [
    ...normalLines.sort(comparePayrollRunLineCode),
    ...employeeContributionLines.sort(comparePayrollRunLineCode),
  ].map((line) => ({ kind: "line", line }));

  if (employerContributionLines.length === 0) return lineRows;

  return [
    ...lineRows,
    {
      kind: "separator",
      id: "employer-deduction-separator",
      label: "Employer Deduction",
    },
    ...employerContributionLines
      .sort(comparePayrollRunLineCode)
      .map((line) => ({ kind: "line" as const, line })),
  ];
}

function getManualPayrollLineBucketTotal(
  lines: ManualPayrollDraftLine[],
  bucket: ManualPayrollLineSummaryBucket
) {
  return lines
    .filter(
      (line) =>
        line.summaryBucket === bucket && !isManualPayrollSummaryExcludedLine(line)
    )
    .reduce((total, line) => total + toNumber(line.amount), 0);
}

function getManualPayrollTotals(draft: ManualPayrollDraft) {
  const grossIncome = draft.lines
    .filter((line) => line.lineType === "Earning")
    .reduce((total, line) => total + toNumber(line.amount), 0);
  const detailDeductions = draft.lines
    .filter((line) => line.lineType === "Deduction")
    .reduce((total, line) => total + toNumber(line.amount), 0);
  const employeeContributions =
    toNumber(draft.sssEmployee) +
    toNumber(draft.philhealthEmployee) +
    toNumber(draft.pagibigEmployee) +
    toNumber(draft.withholdingTax) +
    toNumber(draft.peraaEmployee);
  const employerContributions =
    toNumber(draft.sssEmployer) +
    toNumber(draft.sssEc) +
    toNumber(draft.philhealthEmployer) +
    toNumber(draft.pagibigEmployer) +
    toNumber(draft.peraaEmployer);
  const totalDeductions = detailDeductions + employeeContributions;

  return {
    grossIncome,
    detailDeductions,
    employeeContributions,
    employerContributions,
    totalDeductions,
    netPay: grossIncome - totalDeductions,
  };
}

function getManualPayrollBucketNonSystemTotal(
  lines: ManualPayrollDraftLine[],
  bucket: ManualPayrollLineSummaryBucket
) {
  return lines
    .filter(
      (line) =>
        line.summaryBucket === bucket &&
        !line.isSystem &&
        !isManualPayrollSummaryExcludedLine(line)
    )
    .reduce((total, line) => total + toNumber(line.amount), 0);
}

function isManualPayrollSummaryExcludedLine(
  line: Pick<ManualPayrollDraftLine, "code" | "lineType">
) {
  return (
    line.lineType === "Information" ||
    line.code.trim().toUpperCase() === "LATE-UT"
  );
}

function createManualPayrollSystemLine(
  bucket: ManualPayrollLineSummaryBucket,
  amount: string
): ManualPayrollDraftLine {
  const config = MANUAL_PAYROLL_SUMMARY_BUCKET_CONFIG.get(bucket)!;

  return {
    localId: `system-${bucket}`,
    id: null,
    accountCodeId: null,
    lineType: config.lineType,
    summaryBucket: bucket,
    code: config.code,
    description: config.description,
    loanRefNo: null,
    hours: 0,
    minutes: 0,
    amount,
    taxable: config.taxable,
    month13thEligible: config.month13thEligible,
    nonTaxable: config.nonTaxable,
    deminimis: config.deminimis,
    sourceTable: null,
    sourceId: null,
    sortOrder: 0,
    isSystem: true,
  };
}

function createManualPayrollAccountCodeLine(
  option: ManualPayrollAccountCodeOptionView,
  sortOrder: number
): ManualPayrollDraftLine {
  const isDeduction = isPayrollAccountCodeDeductionType(option.accountType);

  return {
    localId: `manual-${Date.now()}-${option.id}-${sortOrder}`,
    id: null,
    accountCodeId: option.id,
    lineType: isDeduction ? "Deduction" : "Earning",
    summaryBucket: getManualPayrollBucketFromAccountCodeOrType(
      {
        code: option.code,
        accountType: option.accountType,
      },
      "otherIncome"
    ),
    code: option.code,
    description: option.description ?? option.code,
    loanRefNo: null,
    hours: 0,
    minutes: 0,
    amount: "0.00",
    taxable: !isDeduction && !option.nonTaxable && !option.deminimis,
    month13thEligible: !isDeduction && option.month13thPay,
    nonTaxable: option.nonTaxable,
    deminimis: option.deminimis,
    sourceTable: null,
    sourceId: null,
    sortOrder,
    isSystem: false,
  };
}

function serializeManualPayrollDraft(
  draft: ManualPayrollDraft,
  workspace: ManualPayrollEntryWorkspaceView
) {
  const accountCodeById = new Map(
    workspace.accountCodeOptions.map((option) => [option.id, option])
  );

  return {
    payrollPeriodId: workspace.payrollPeriod.id,
    employeeId: workspace.employee.employeeId,
    sssEmployee: toNumber(draft.sssEmployee),
    sssEmployer: toNumber(draft.sssEmployer),
    sssEc: toNumber(draft.sssEc),
    sssBasis: toNumber(draft.sssBasis),
    philhealthEmployee: toNumber(draft.philhealthEmployee),
    philhealthEmployer: toNumber(draft.philhealthEmployer),
    philhealthBasis: toNumber(draft.philhealthBasis),
    pagibigEmployee: toNumber(draft.pagibigEmployee),
    pagibigEmployer: toNumber(draft.pagibigEmployer),
    pagibigBasis: toNumber(draft.pagibigBasis),
    withholdingTax: toNumber(draft.withholdingTax),
    withholdingTaxBasis: toNumber(draft.withholdingTaxBasis),
    peraaEmployee: toNumber(draft.peraaEmployee),
    peraaEmployer: toNumber(draft.peraaEmployer),
    peraaBasis: toNumber(draft.peraaBasis),
    remarks: draft.remarks.trim() || null,
    lines: sortManualPayrollDraftLines(draft.lines).map((line, index) => {
      const account =
        line.accountCodeId != null
          ? accountCodeById.get(line.accountCodeId) ?? null
          : null;

      return {
        id: line.id,
        accountCodeId: line.accountCodeId,
        lineType: line.lineType,
        summaryBucket: getManualPayrollBucketFromAccountCodeOrType(
          {
            code: account?.code ?? line.code,
            accountType: account?.accountType ?? null,
          },
          line.summaryBucket
        ),
        code: line.code.trim(),
        description: line.description.trim(),
        loanRefNo:
          account?.accountType === "Loan"
            ? line.loanRefNo?.trim() || null
            : null,
        hours: line.hours,
        minutes: line.minutes,
        amount: toNumber(line.amount),
        taxable: line.taxable,
        month13thEligible: line.month13thEligible,
        nonTaxable: line.nonTaxable,
        deminimis: line.deminimis,
        sourceTable: line.sourceTable,
        sourceId: line.sourceId,
        sortOrder: index,
      };
    }),
  };
}

function isManualPayrollDraftDirty(
  draft: ManualPayrollDraft,
  workspace: ManualPayrollEntryWorkspaceView | null
) {
  if (!workspace) return false;

  return (
    JSON.stringify(serializeManualPayrollDraft(draft, workspace)) !==
    JSON.stringify(
      serializeManualPayrollDraft(createManualPayrollDraft(workspace), workspace)
    )
  );
}

function hasAttendancePunches(row: AttendanceDtrDayView) {
  return row.rawPunches.length > 0 || row.firstInAt != null || row.lastOutAt != null;
}

function getAttendanceDayStatus(row: AttendanceDtrDayView) {
  if (row.holdApprovalStatus === "Approved") {
    return "Approved";
  }

  if (row.effectiveStatus) {
    return row.effectiveStatus;
  }

  if (row.isRestDay) {
    return hasAttendancePunches(row) ? "Rest Day Work" : "Rest Day";
  }

  if (hasAttendancePunches(row)) {
    return "Present";
  }

  if (row.paidLeaveMinutes > 0) {
    return "Paid Leave";
  }

  if (row.unpaidLeaveMinutes > 0) {
    return "Unpaid Leave";
  }

  if (row.absentMinutes > 0) {
    return "Absent";
  }

  if (row.anomalyFlags.includes("NO_LOGS")) {
    return "No Logs";
  }

  return "-";
}

function getAttendanceDayToneClassForStatus(status: string) {
  if (status === "Rest Day" || status === "Rest Day Work") {
    return "bg-slate-100 text-slate-700 dark:bg-slate-950/40 dark:text-slate-300";
  }

  if (status === "Present" || status === "Approved") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }

  if (status === "Absent") {
    return "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
  }

  if (status === "Paid Leave" || status === "Unpaid Leave") {
    return "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300";
  }

  if (status === "Hold") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  }

  return "bg-muted text-muted-foreground";
}

function getDtrStatusDraftKey(employeeId: string, attendanceDate: string) {
  return `${employeeId}:${attendanceDate}`;
}

function hasDtrStatusDraft(
  drafts: DtrStatusDrafts,
  employeeId: string,
  attendanceDate: string
) {
  return Object.prototype.hasOwnProperty.call(
    drafts,
    getDtrStatusDraftKey(employeeId, attendanceDate)
  );
}

function getDtrDraftDisplayStatus(
  row: AttendanceDtrDayView,
  draftStatus: AttendanceDtrManualStatus | null | undefined,
  hasDraft: boolean
) {
  if (!hasDraft) return getAttendanceDayStatus(row);
  return draftStatus ?? row.computedStatus ?? "-";
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getToneClass(status: string | null | undefined) {
  if (status === "Posted" || status === "Processed" || status === "Approved") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }

  if (status === "Reviewed") {
    return "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300";
  }

  if (status === "Stale") {
    return "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
  }

  if (status === "Draft" || status === "Open" || status === "Pending") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  }

  if (status === "Void") {
    return "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
  }

  return "bg-muted text-muted-foreground";
}

function getPayComputationModeToneClass(mode: string | null | undefined) {
  if (mode === "Daily Rate") {
    return "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300";
  }

  if (mode === "Monthly Rate") {
    return "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300";
  }

  return "bg-muted text-muted-foreground";
}

function renderPayComputationModeBadge(
  mode: string | null | undefined,
  isManualPayrollOverride: boolean | null | undefined
) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
        getPayComputationModeToneClass(mode)
      )}
    >
      <span>{mode ?? "-"}</span>
      {isManualPayrollOverride ? (
        <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-foreground/75">
          Manual
        </span>
      ) : null}
    </span>
  );
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;

      if (typeof result !== "string") {
        reject(new Error("Unable to read the selected file."));
        return;
      }

      const base64 = result.split(",")[1];
      if (!base64) {
        reject(new Error("Unable to encode the selected file."));
        return;
      }

      resolve(base64);
    };

    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

function buildRunSummary(run: PayrollRunView | null) {
  return (run?.employees ?? []).reduce(
    (totals, employee) => {
      totals.grossPay += toNumber(employee.grossPay);
      totals.totalDeductions += toNumber(employee.totalDeductions);
      totals.netPay += toNumber(employee.netPay);
      totals.employeeContributions += toNumber(employee.employeeContributions);
      totals.employerContributions += toNumber(employee.employerContributions);
      return totals;
    },
    {
      grossPay: 0,
      totalDeductions: 0,
      netPay: 0,
      employeeContributions: 0,
      employerContributions: 0,
    }
  );
}

function deleteCacheKeys<T>(
  cacheRef: { current: Record<string, T> },
  prefixes: string[]
) {
  for (const key of Object.keys(cacheRef.current)) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      delete cacheRef.current[key];
    }
  }
}

export function PayrollWorkspace({
  initialYear,
  periods: initialPeriods,
  selectedPeriodId: initialSelectedPeriodId,
  selectedRun: initialSelectedRun,
  payrollAccountCodeEmployees,
  attendanceBatches: initialAttendanceBatches,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [workspaceSnapshot, setWorkspaceSnapshot] =
    useState<PayrollWorkspaceSnapshotView>(() => ({
      periods: initialPeriods,
      selectedPeriodId: initialSelectedPeriodId,
      selectedRun: initialSelectedRun,
      attendanceBatches: initialAttendanceBatches,
    }));
  const [yearInput, setYearInput] = useState(String(initialYear));
  const [periodSearch, setPeriodSearch] = useState("");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("run");
  const [employeeSnapshotSearch, setEmployeeSnapshotSearch] = useState("");
  const [employeeSnapshotDepartmentFilter, setEmployeeSnapshotDepartmentFilter] =
    useState<DepartmentFilterValue>(ALL_DEPARTMENTS_VALUE);
  const [actionState, setActionState] = useState<string | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    initialSelectedRun?.employees[0]?.employeeId ?? null
  );
  const [selectedAttendanceFiles, setSelectedAttendanceFiles] = useState<File[]>([]);
  const [attendanceImportResult, setAttendanceImportResult] =
    useState<AttendanceImportResult | null>(null);
  const [replaceExistingAttendance, setReplaceExistingAttendance] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [reportState, setReportState] = useState<ReportState>({
    status: "idle",
    runId: null,
    register: null,
    agencySummary: null,
    loanDeductions: [],
    error: null,
  });
  const [payslipState, setPayslipState] = useState<PayslipState>({
    status: "idle",
    runId: null,
    employeeId: null,
    payslip: null,
    error: null,
  });
  const [attendanceDtrState, setAttendanceDtrState] = useState<AttendanceDtrState>({
    status: "idle",
    periodId: null,
    data: null,
    error: null,
  });
  const [attendanceDtrRowsState, setAttendanceDtrRowsState] =
    useState<AttendanceDtrRowsState>({
      status: "idle",
      periodId: null,
      employeeId: null,
      data: null,
      error: null,
    });
  const [payrollExceptionState, setPayrollExceptionState] =
    useState<PayrollExceptionState>({
      status: "idle",
      periodId: null,
      employeeId: null,
      rows: [],
      recurringRows: [],
      loanRows: [],
      accountCodeOptions: [],
      error: null,
    });
  const [payrollExceptionDrafts, setPayrollExceptionDrafts] = useState<
    PayrollExceptionDraft[]
  >([]);
  const [manualPayrollState, setManualPayrollState] = useState<ManualPayrollState>({
    status: "idle",
    periodId: null,
    employeeId: null,
    data: null,
    error: null,
  });
  const [manualPayrollDraft, setManualPayrollDraft] = useState<ManualPayrollDraft>(
    () => createManualPayrollDraft(null)
  );
  const [savingManualPayroll, setSavingManualPayroll] = useState(false);
  const [refreshingManualPayroll, setRefreshingManualPayroll] = useState(false);
  const [selectedManualPayrollEmployeeId, setSelectedManualPayrollEmployeeId] =
    useState<string | null>(
      () =>
        sortEmployeesByLastName(payrollAccountCodeEmployees)[0]?.employeeId ??
        null
    );
  const [manualPayrollDepartmentFilter, setManualPayrollDepartmentFilter] =
    useState<DepartmentFilterValue>(ALL_DEPARTMENTS_VALUE);
  const [selectedPayrollExceptionDate, setSelectedPayrollExceptionDate] =
    useState("");
  const [savingPayrollExceptions, setSavingPayrollExceptions] = useState(false);
  const [payrollLoanDraftAmounts, setPayrollLoanDraftAmounts] = useState<
    Record<string, string>
  >({});
  const [savingPayrollLoanInstallmentId, setSavingPayrollLoanInstallmentId] =
    useState<string | null>(null);
  const [attendanceDtrReloadKey, setAttendanceDtrReloadKey] = useState(0);
  const [dtrOverrideDraft, setDtrOverrideDraft] =
    useState<DtrPeriodOverrideDraft>(() => createDtrOverrideDraft(null));
  const [dtrWorkedDraftTouched, setDtrWorkedDraftTouched] = useState(false);
  const [savingDtrPeriodOverrides, setSavingDtrPeriodOverrides] =
    useState(false);
  const [dtrStatusDrafts, setDtrStatusDrafts] = useState<DtrStatusDrafts>({});
  const [savingDtrStatuses, setSavingDtrStatuses] = useState(false);
  const [attendanceDtrHeldRowsState, setAttendanceDtrHeldRowsState] = useState<{
    status: LoadStatus;
    periodId: string | null;
    data: AttendanceDtrHeldRowsView | null;
    error: string | null;
  }>({ status: "idle", periodId: null, data: null, error: null });
  const [attendanceDtrDepartmentFilter, setAttendanceDtrDepartmentFilter] =
    useState<DepartmentFilterValue>(ALL_DEPARTMENTS_VALUE);
  const [selectedDtrEmployeeId, setSelectedDtrEmployeeId] = useState<string | null>(
    null
  );
  const [
    selectedPayrollAccountCodeEmployeeId,
    setSelectedPayrollAccountCodeEmployeeId,
  ] = useState<string | null>(
    () =>
      sortEmployeesByLastName(payrollAccountCodeEmployees)[0]?.employeeId ??
      null
  );
  const [
    payrollAccountCodeDepartmentFilter,
    setPayrollAccountCodeDepartmentFilter,
  ] = useState<DepartmentFilterValue>(ALL_DEPARTMENTS_VALUE);
  const [payrollAccountCodeLineTab, setPayrollAccountCodeLineTab] =
    useState<PayrollAccountCodeLineTab>("income");
  const [expandedAttendanceBatchIds, setExpandedAttendanceBatchIds] = useState<
    Set<string>
  >(new Set());
  const [expandedUnmatchedGroupKeys, setExpandedUnmatchedGroupKeys] = useState<
    Set<string>
  >(new Set());
  const [
    expandedAttendanceHoldEmployeeIds,
    setExpandedAttendanceHoldEmployeeIds,
  ] = useState<Set<string>>(new Set());
  const [attendanceHoldSearch, setAttendanceHoldSearch] = useState("");
  const [attendanceHoldDepartmentFilter, setAttendanceHoldDepartmentFilter] =
    useState<DepartmentFilterValue>(ALL_DEPARTMENTS_VALUE);
  const [attendanceHoldApprovalDrafts, setAttendanceHoldApprovalDrafts] =
    useState<Record<string, AttendanceHoldApprovalDraft>>({});
  const [
    savingAttendanceHoldApprovalEmployeeIds,
    setSavingAttendanceHoldApprovalEmployeeIds,
  ] = useState<Set<string>>(new Set());
  const [
    resettingAttendanceHoldApprovalEmployeeIds,
    setResettingAttendanceHoldApprovalEmployeeIds,
  ] = useState<Set<string>>(new Set());
  const [attendanceBatchDiagnosticsById, setAttendanceBatchDiagnosticsById] =
    useState<Record<string, AttendanceBatchDiagnosticsState>>({});
  const [employeeDetailsByKey, setEmployeeDetailsByKey] = useState<
    Record<string, PayrollRunEmployeeDetailView>
  >({});
  const [employeeDetailStatusByKey, setEmployeeDetailStatusByKey] = useState<
    Record<string, LoadStatus>
  >({});
  const employeeDetailRequestsRef = useRef<Set<string>>(new Set());
  const reportCacheRef = useRef<Record<string, ReportState>>({});
  const payslipCacheRef = useRef<Record<string, PayslipState>>({});
  const attendanceDtrCacheRef = useRef<Record<string, AttendanceDtrState>>({});
  const attendanceDtrRowsCacheRef = useRef<Record<string, AttendanceDtrRowsState>>(
    {}
  );
  const payrollExceptionCacheRef = useRef<Record<string, PayrollExceptionState>>(
    {}
  );
  const manualPayrollAccountCodeOptionsRef = useRef<
    ManualPayrollAccountCodeOptionView[] | null
  >(null);
  const [isNavigating, startTransition] = useTransition();

  const periods = workspaceSnapshot.periods;
  const selectedPeriodId = workspaceSnapshot.selectedPeriodId;
  const selectedRun = workspaceSnapshot.selectedRun;
  const attendanceBatches = workspaceSnapshot.attendanceBatches;

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId]
  );
  const selectedPeriodKey = selectedPeriod?.id ?? null;
  const currentAttendanceDtrHeldRowsState =
    selectedPeriodKey &&
    attendanceDtrHeldRowsState.periodId === selectedPeriodKey
      ? attendanceDtrHeldRowsState
      : {
          status: "idle" as LoadStatus,
          periodId: selectedPeriodKey,
          data: null,
          error: null,
        };
  const attendanceHoldUnapprovedRowCount =
    currentAttendanceDtrHeldRowsState.data?.rows.filter(
      (row) => row.approvalStatus !== "Approved"
    ).length ?? 0;
  const groupedAttendanceHoldEmployees = useMemo<AttendanceHoldEmployeeGroup[]>(() => {
    const groupsByEmployeeId = new Map<string, AttendanceHoldEmployeeGroup>();

    for (const row of currentAttendanceDtrHeldRowsState.data?.rows ?? []) {
      const displayMinutes = getAttendanceHoldRowDisplayMinutes(row);
      const existing = groupsByEmployeeId.get(row.employeeId);
      const group =
        existing ??
        {
          employeeId: row.employeeId,
          employeeNo: row.employeeNo,
          employeeName: row.employeeName,
          departmentId: row.departmentId,
          departmentName: row.departmentName,
          departmentCode: row.departmentCode,
          heldDates: [],
          workedMinutes: 0,
          intendedWorkedMinutes: 0,
          lateMinutes: 0,
          undertimeMinutes: 0,
          overtimeMinutes: 0,
          status: "Hold",
          source: row.source === "auto" ? "Auto" : "Manual",
          rows: [],
        };

      group.rows.push(row);
      group.heldDates.push(row.attendanceDate);
      group.workedMinutes += displayMinutes.workedMinutes;
      group.intendedWorkedMinutes += row.intendedWorkedMinutes;
      group.lateMinutes += displayMinutes.lateMinutes;
      group.undertimeMinutes += displayMinutes.undertimeMinutes;
      group.overtimeMinutes += displayMinutes.overtimeMinutes;

      const rowSource = row.source === "auto" ? "Auto" : "Manual";
      if (group.source !== rowSource) {
        group.source = "Mixed";
      }

      groupsByEmployeeId.set(row.employeeId, group);
    }

    return [...groupsByEmployeeId.values()]
      .map((group) => {
        const rows = [...group.rows].sort((left, right) =>
          left.attendanceDate.localeCompare(right.attendanceDate)
        );
        const approvedCount = rows.filter(
          (row) => row.approvalStatus === "Approved"
        ).length;
        const pendingCount = rows.filter(
          (row) => row.approvalStatus === "Pending"
        ).length;

        const status: AttendanceHoldEmployeeGroup["status"] =
          approvedCount === 0
            ? pendingCount === rows.length
              ? "Pending"
              : pendingCount > 0
                ? "Partial"
                : "Hold"
            : approvedCount === rows.length
              ? "Approved"
              : "Partial";

        return {
          ...group,
          status,
          heldDates: [...new Set(group.heldDates)].sort((left, right) =>
            left.localeCompare(right)
          ),
          rows,
        };
      })
      .sort((left, right) => {
        const byName = left.employeeName.localeCompare(right.employeeName);
        if (byName !== 0) return byName;
        return left.employeeNo.localeCompare(right.employeeNo);
      });
  }, [currentAttendanceDtrHeldRowsState.data?.rows]);
  const attendanceHoldDepartmentOptions = useMemo(
    () => buildDepartmentFilterOptions(groupedAttendanceHoldEmployees),
    [groupedAttendanceHoldEmployees]
  );
  const departmentFilteredAttendanceHoldEmployees = useMemo(
    () =>
      groupedAttendanceHoldEmployees.filter((employee) =>
        matchesDepartmentFilter(employee, attendanceHoldDepartmentFilter)
      ),
    [attendanceHoldDepartmentFilter, groupedAttendanceHoldEmployees]
  );
  const filteredAttendanceHoldEmployees = useMemo(
    () =>
      departmentFilteredAttendanceHoldEmployees.filter((employee) =>
        matchesSearchTerm(
          [
            employee.employeeName,
            employee.employeeNo,
            formatEmployeeNoDisplay(employee.employeeNo),
            employee.heldDates.join(" "),
            employee.status,
          ],
          attendanceHoldSearch
        )
      ),
    [attendanceHoldSearch, departmentFilteredAttendanceHoldEmployees]
  );
  const selectedRunId = selectedRun?.id ?? null;
  const filteredPeriods = useMemo(
    () =>
      periods.filter((period) =>
        matchesSearchTerm(
          [
            period.code,
            period.startDate,
            period.endDate,
            period.adjustedPayDate,
            period.nominalPayDate,
            period.latestRun?.status,
            period.latestRun ? `Run #${period.latestRun.runNumber}` : "Not computed",
            period.latestRun?.runNumber,
            period.attendanceBatchCount,
          ],
          periodSearch
        )
      ),
    [periodSearch, periods]
  );
  const runEmployees = useMemo(
    () => sortEmployeesByLastName(selectedRun?.employees ?? []),
    [selectedRun?.employees]
  );
  const runDepartmentOptions = useMemo(
    () => buildDepartmentFilterOptions(runEmployees),
    [runEmployees]
  );
  const filteredRunEmployees = useMemo(
    () =>
      runEmployees.filter((employee) =>
        matchesDepartmentFilter(employee, employeeSnapshotDepartmentFilter) &&
        matchesSearchTerm(
          [employee.employeeNameSnapshot, employee.employeeNoSnapshot],
          employeeSnapshotSearch
        )
      ),
    [employeeSnapshotDepartmentFilter, employeeSnapshotSearch, runEmployees]
  );
  const selectedEmployeeSummary =
    runEmployees.find((employee) => employee.employeeId === selectedEmployeeId) ??
    runEmployees[0] ??
    null;
  const selectedEmployeeDetailKey =
    selectedRun && selectedEmployeeSummary
      ? `${selectedRun.id}:${selectedEmployeeSummary.employeeId}`
      : null;
  const selectedEmployee =
    selectedEmployeeDetailKey && employeeDetailsByKey[selectedEmployeeDetailKey]
      ? employeeDetailsByKey[selectedEmployeeDetailKey]
      : selectedEmployeeSummary;
  const selectedEmployeeLineDisplayRows = useMemo(
    () => buildPayrollRunLineDisplayRows(selectedEmployee?.lines ?? []),
    [selectedEmployee?.lines]
  );
  const selectedEmployeeDetailStatus = selectedEmployeeDetailKey
    ? (employeeDetailStatusByKey[selectedEmployeeDetailKey] ??
      (employeeDetailsByKey[selectedEmployeeDetailKey] ? "ready" : "idle"))
    : "idle";
  const runSummary = useMemo(() => buildRunSummary(selectedRun), [selectedRun]);
  const agencySummary = selectedRun?.agencySummary ?? EMPTY_AGENCY_SUMMARY;
  const reportAgencySummary = reportState.agencySummary ?? EMPTY_AGENCY_SUMMARY;
  const attendanceDtrEmployees = useMemo(
    () => sortEmployeesByLastName(attendanceDtrState.data?.employees ?? []),
    [attendanceDtrState.data?.employees]
  );
  const sortedPayrollAccountCodeEmployees = useMemo(
    () => sortEmployeesByLastName(payrollAccountCodeEmployees),
    [payrollAccountCodeEmployees]
  );
  const attendanceDtrDepartmentOptions = useMemo(
    () => buildDepartmentFilterOptions(attendanceDtrEmployees),
    [attendanceDtrEmployees]
  );
  const filteredAttendanceDtrEmployees = useMemo(
    () =>
      attendanceDtrEmployees.filter((employee) =>
        matchesDepartmentFilter(employee, attendanceDtrDepartmentFilter)
      ),
    [attendanceDtrDepartmentFilter, attendanceDtrEmployees]
  );
  const selectedDtrEmployee =
    filteredAttendanceDtrEmployees.find(
      (employee) => employee.employeeId === selectedDtrEmployeeId
    ) ??
    filteredAttendanceDtrEmployees[0] ??
    null;
  const selectedDtrRows = useMemo(
    () =>
      attendanceDtrRowsState.employeeId === selectedDtrEmployee?.employeeId
        ? (attendanceDtrRowsState.data?.rows ?? [])
        : [],
    [
      attendanceDtrRowsState.data?.rows,
      attendanceDtrRowsState.employeeId,
      selectedDtrEmployee?.employeeId,
    ]
  );
  const payrollAccountCodeDepartmentOptions = useMemo(
    () => buildDepartmentFilterOptions(sortedPayrollAccountCodeEmployees),
    [sortedPayrollAccountCodeEmployees]
  );
  const filteredPayrollAccountCodeEmployees = useMemo(
    () =>
      sortedPayrollAccountCodeEmployees.filter((employee) =>
        matchesDepartmentFilter(employee, payrollAccountCodeDepartmentFilter)
      ),
    [payrollAccountCodeDepartmentFilter, sortedPayrollAccountCodeEmployees]
  );
  const selectedPayrollAccountCodeEmployee =
    filteredPayrollAccountCodeEmployees.find(
      (employee) =>
        employee.employeeId === selectedPayrollAccountCodeEmployeeId
    ) ??
    filteredPayrollAccountCodeEmployees[0] ??
    null;
  const manualPayrollDepartmentOptions = useMemo(
    () => buildDepartmentFilterOptions(sortedPayrollAccountCodeEmployees),
    [sortedPayrollAccountCodeEmployees]
  );
  const filteredManualPayrollEmployees = useMemo(
    () =>
      sortedPayrollAccountCodeEmployees.filter((employee) =>
        matchesDepartmentFilter(employee, manualPayrollDepartmentFilter)
      ),
    [manualPayrollDepartmentFilter, sortedPayrollAccountCodeEmployees]
  );
  const selectedManualPayrollEmployee =
    filteredManualPayrollEmployees.find(
      (employee) => employee.employeeId === selectedManualPayrollEmployeeId
    ) ??
    filteredManualPayrollEmployees[0] ??
    null;
  const manualPayrollStateMatchesSelected =
    manualPayrollState.periodId === selectedPeriod?.id &&
    manualPayrollState.employeeId === selectedManualPayrollEmployee?.employeeId;
  const manualPayrollWorkspace = manualPayrollStateMatchesSelected
    ? manualPayrollState.data
    : null;
  const manualPayrollAccountCodeOptions = useMemo(() => {
    if (!manualPayrollWorkspace) return EMPTY_MANUAL_PAYROLL_ACCOUNT_CODE_OPTIONS;

    return [...manualPayrollWorkspace.accountCodeOptions].sort(
      comparePayrollAccountCodeOptions
    );
  }, [manualPayrollWorkspace]);
  const manualPayrollTotals = useMemo(
    () => getManualPayrollTotals(manualPayrollDraft),
    [manualPayrollDraft]
  );
  const manualPayrollDraftDirty = useMemo(
    () => isManualPayrollDraftDirty(manualPayrollDraft, manualPayrollWorkspace),
    [manualPayrollDraft, manualPayrollWorkspace]
  );
  const selectedDtrStatusChanges = useMemo(() => {
    if (!selectedDtrEmployee) return [];

    return selectedDtrRows.flatMap((row) => {
      const draftKey = getDtrStatusDraftKey(
        selectedDtrEmployee.employeeId,
        row.attendanceDate
      );

      if (!Object.prototype.hasOwnProperty.call(dtrStatusDrafts, draftKey)) {
        return [];
      }

      const status = dtrStatusDrafts[draftKey] ?? null;
      const persistedStatus = row.manualStatus ?? null;

      if (status === persistedStatus) return [];

      return [
        {
          attendanceDate: row.attendanceDate,
          status,
        },
      ];
    });
  }, [dtrStatusDrafts, selectedDtrEmployee, selectedDtrRows]);
  const selectedDtrRowOverrideChanges = useMemo(() => {
    return [...selectedDtrStatusChanges].sort((left, right) =>
      left.attendanceDate.localeCompare(right.attendanceDate)
    );
  }, [selectedDtrStatusChanges]);
  const dtrPeriodOverridePayload = useMemo(
    () =>
      selectedDtrEmployee
        ? buildDtrPeriodOverridePayloadFromDraft(
            selectedDtrEmployee,
            dtrOverrideDraft,
            { workedDraftTouched: dtrWorkedDraftTouched }
          )
        : null,
    [dtrOverrideDraft, dtrWorkedDraftTouched, selectedDtrEmployee]
  );
  const dtrPeriodOverrideDraftDirty = useMemo(
    () =>
      isDtrPeriodOverridePayloadDirty(
        dtrPeriodOverridePayload,
        selectedDtrEmployee
      ),
    [dtrPeriodOverridePayload, selectedDtrEmployee]
  );
  const selectedDtrHasPeriodOverride = useMemo(
    () => hasSavedDtrPeriodOverride(selectedDtrEmployee),
    [selectedDtrEmployee]
  );
  const payrollExceptionStateMatchesSelectedEmployee =
    payrollExceptionState.periodId === selectedPeriod?.id &&
    payrollExceptionState.employeeId === selectedPayrollAccountCodeEmployee?.employeeId;
  const showAttendancePayrollExceptionEditor = false;
  const payrollExceptionStateMatchesSelectedDtr =
    payrollExceptionStateMatchesSelectedEmployee;
  const payrollExceptionRows = useMemo(
    () =>
      payrollExceptionStateMatchesSelectedEmployee ? payrollExceptionState.rows : [],
    [payrollExceptionState.rows, payrollExceptionStateMatchesSelectedEmployee]
  );
  const payrollRecurringRows = useMemo(
    () =>
      payrollExceptionStateMatchesSelectedEmployee
        ? payrollExceptionState.recurringRows
        : EMPTY_PAYROLL_RECURRING_ENTRY_ROWS,
    [
      payrollExceptionState.recurringRows,
      payrollExceptionStateMatchesSelectedEmployee,
    ]
  );
  const payrollLoanRows = useMemo(
    () =>
      payrollExceptionStateMatchesSelectedEmployee
        ? payrollExceptionState.loanRows
        : [],
    [
      payrollExceptionState.loanRows,
      payrollExceptionStateMatchesSelectedEmployee,
    ]
  );
  const payrollExceptionRowsById = useMemo(
    () =>
      new Map(
        payrollExceptionRows.map((row) => [row.id, row] as const)
      ),
    [payrollExceptionRows]
  );
  const payrollExceptionAccountCodeOptions = useMemo(
    () =>
      payrollExceptionStateMatchesSelectedEmployee
        ? [...payrollExceptionState.accountCodeOptions].sort(
            comparePayrollAccountCodeOptions
          )
        : EMPTY_PAYROLL_EXCEPTION_ACCOUNT_CODE_OPTIONS,
    [
      payrollExceptionState.accountCodeOptions,
      payrollExceptionStateMatchesSelectedEmployee,
    ]
  );
  const activePayrollExceptionAccountCodeOptions = useMemo(
    () =>
      payrollExceptionAccountCodeOptions.filter(
        (option) =>
          getPayrollAccountCodeLineTab(option.accountType) ===
          payrollAccountCodeLineTab
      ),
    [payrollAccountCodeLineTab, payrollExceptionAccountCodeOptions]
  );
  const payrollExceptionDateOptions = useMemo(
    () => buildPeriodDateOptions(selectedPeriod),
    [selectedPeriod]
  );
  const effectiveSelectedPayrollExceptionDate =
    payrollExceptionDateOptions.some(
      (option) => option.value === selectedPayrollExceptionDate
    )
      ? selectedPayrollExceptionDate
      : payrollExceptionDateOptions[0]?.value ?? "";
  const payrollExceptionDuplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();

    for (const draft of payrollExceptionDrafts) {
      const key = getPayrollExceptionDuplicateKey(draft);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([key]) => key)
    );
  }, [payrollExceptionDrafts]);
  const payrollExceptionDraftErrors = useMemo(
    () =>
      new Map(
        payrollExceptionDrafts.map((draft) => [
          draft.localId,
          getPayrollExceptionDraftError(draft, payrollExceptionDuplicateKeys),
        ])
      ),
    [payrollExceptionDrafts, payrollExceptionDuplicateKeys]
  );
  const dirtyPayrollExceptionCount = useMemo(
    () =>
      getPayrollExceptionDraftChangeCount(
        payrollExceptionDrafts,
        payrollExceptionRows
      ),
    [payrollExceptionDrafts, payrollExceptionRows]
  );
  const hasPayrollExceptionDraftErrors = [...payrollExceptionDraftErrors.values()].some(
    Boolean
  );
  const visiblePayrollExceptionDrafts = useMemo(
    () =>
      payrollExceptionDrafts.filter(
        (draft) =>
          getPayrollAccountCodeLineTab(draft.accountTypeSnapshot) ===
          payrollAccountCodeLineTab
      ),
    [payrollAccountCodeLineTab, payrollExceptionDrafts]
  );
  const visiblePayrollRecurringRows = useMemo(
    () =>
      payrollRecurringRows.filter(
        (row) =>
          getPayrollAccountCodeLineTab(row.accountTypeSnapshot) ===
          payrollAccountCodeLineTab
      ),
    [payrollAccountCodeLineTab, payrollRecurringRows]
  );
  const visiblePayrollAccountCodeRowCount =
    visiblePayrollExceptionDrafts.length + visiblePayrollRecurringRows.length;
  const payrollExceptionIncomeCount = useMemo(
    () =>
      payrollExceptionDrafts.filter(
        (draft) => getPayrollAccountCodeLineTab(draft.accountTypeSnapshot) === "income"
      ).length +
      payrollRecurringRows.filter(
        (row) => getPayrollAccountCodeLineTab(row.accountTypeSnapshot) === "income"
      ).length,
    [payrollExceptionDrafts, payrollRecurringRows]
  );
  const payrollExceptionDeductionCount =
    payrollExceptionDrafts.length +
    payrollRecurringRows.length -
    payrollExceptionIncomeCount;
  const payrollDeductionTabCount =
    payrollExceptionDeductionCount + payrollLoanRows.length;
  const attendanceBatchKey = useMemo(
    () =>
      attendanceBatches
        .map(
          (batch) =>
            `${batch.id}:${batch.importedAt}:${batch.matchedRows}:${batch.unmatchedRows}`
        )
        .join("|"),
    [attendanceBatches]
  );

  const refreshWorkspaceSnapshot = useCallback(
    async (lineEmployeeId = selectedEmployeeId) => {
      const snapshot = await getPayrollWorkspaceSnapshotAction(
        initialYear,
        selectedPeriod?.id ?? selectedPeriodId,
        lineEmployeeId
      );

      setWorkspaceSnapshot(snapshot);
      return snapshot;
    },
    [initialYear, selectedEmployeeId, selectedPeriod?.id, selectedPeriodId]
  );

  useEffect(() => {
    setWorkspaceSnapshot({
      periods: initialPeriods,
      selectedPeriodId: initialSelectedPeriodId,
      selectedRun: initialSelectedRun,
      attendanceBatches: initialAttendanceBatches,
    });
  }, [
    initialAttendanceBatches,
    initialPeriods,
    initialSelectedPeriodId,
    initialSelectedRun,
  ]);

  useEffect(() => {
    setDtrStatusDrafts({});
    if (selectedPeriodKey) {
      deleteCacheKeys(attendanceDtrCacheRef, [
        `attendance-summary:${selectedPeriodKey}`,
      ]);
      deleteCacheKeys(attendanceDtrRowsCacheRef, [
        `attendance-rows:${selectedPeriodKey}:`,
      ]);
    }
  }, [attendanceBatchKey, attendanceDtrReloadKey, selectedPeriodKey]);

  useEffect(() => {
    setDtrOverrideDraft(createDtrOverrideDraft(selectedDtrEmployee?.totals));
    setDtrWorkedDraftTouched(false);
  }, [selectedDtrEmployee?.employeeId, selectedDtrEmployee?.totals]);

  useEffect(() => {
    const currentBatchIds = new Set(attendanceBatches.map((batch) => batch.id));

    setExpandedAttendanceBatchIds((current) => {
      let changed = false;
      const next = new Set<string>();

      current.forEach((batchId) => {
        if (currentBatchIds.has(batchId)) {
          next.add(batchId);
        } else {
          changed = true;
        }
      });

      return changed ? next : current;
    });

    setExpandedUnmatchedGroupKeys((current) => {
      let changed = false;
      const next = new Set<string>();

      current.forEach((groupKey) => {
        const separatorIndex = groupKey.indexOf(":");
        const batchId =
          separatorIndex >= 0 ? groupKey.slice(0, separatorIndex) : groupKey;

        if (currentBatchIds.has(batchId)) {
          next.add(groupKey);
        } else {
          changed = true;
        }
      });

      return changed ? next : current;
    });

    setAttendanceBatchDiagnosticsById((current) => {
      let changed = false;
      const next: Record<string, AttendanceBatchDiagnosticsState> = {};

      Object.entries(current).forEach(([batchId, state]) => {
        if (currentBatchIds.has(batchId)) {
          next[batchId] = state;
        } else {
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [attendanceBatches]);

  useEffect(() => {
    setYearInput(String(initialYear));
  }, [initialYear]);

  useEffect(() => {
    const seededDetails = Object.fromEntries(
      (selectedRun?.employees ?? [])
        .filter((employee) => employee.lines.length > 0)
        .map((employee) => [
          `${selectedRun!.id}:${employee.employeeId}`,
          employee,
        ])
    );

    setEmployeeDetailsByKey(seededDetails);
    setEmployeeDetailStatusByKey(
      Object.fromEntries(
        Object.keys(seededDetails).map((key) => [key, "ready" as LoadStatus])
      )
    );
  }, [selectedRun]);

  useEffect(() => {
    if (runEmployees.length === 0) {
      if (selectedEmployeeId !== null) {
        setSelectedEmployeeId(null);
      }
      return;
    }

    const employeeStillExists = runEmployees.some(
      (employee) => employee.employeeId === selectedEmployeeId
    );

    if (!employeeStillExists) {
      setSelectedEmployeeId(runEmployees[0]?.employeeId ?? null);
    }
  }, [runEmployees, selectedEmployeeId]);

  useEffect(() => {
    const filterStillExists = runDepartmentOptions.some(
      (option) => option.value === employeeSnapshotDepartmentFilter
    );

    if (!filterStillExists) {
      setEmployeeSnapshotDepartmentFilter(ALL_DEPARTMENTS_VALUE);
    }
  }, [employeeSnapshotDepartmentFilter, runDepartmentOptions]);

  useEffect(() => {
    const filterStillExists = manualPayrollDepartmentOptions.some(
      (option) => option.value === manualPayrollDepartmentFilter
    );

    if (!filterStillExists) {
      setManualPayrollDepartmentFilter(ALL_DEPARTMENTS_VALUE);
    }
  }, [manualPayrollDepartmentFilter, manualPayrollDepartmentOptions]);

  useEffect(() => {
    if (filteredManualPayrollEmployees.length === 0) {
      if (selectedManualPayrollEmployeeId !== null) {
        setSelectedManualPayrollEmployeeId(null);
      }
      return;
    }

    const employeeStillExists = filteredManualPayrollEmployees.some(
      (employee) => employee.employeeId === selectedManualPayrollEmployeeId
    );

    if (!employeeStillExists) {
      setSelectedManualPayrollEmployeeId(
        filteredManualPayrollEmployees[0]?.employeeId ?? null
      );
    }
  }, [filteredManualPayrollEmployees, selectedManualPayrollEmployeeId]);

  useEffect(() => {
    if (!selectedRun || !selectedEmployeeSummary || !selectedEmployeeDetailKey) {
      return;
    }

    if (
      selectedEmployeeSummary.lines.length > 0 ||
      employeeDetailsByKey[selectedEmployeeDetailKey] ||
      employeeDetailRequestsRef.current.has(selectedEmployeeDetailKey)
    ) {
      return;
    }

    const requestKey = selectedEmployeeDetailKey;
    const runId = selectedRun.id;
    const employeeId = selectedEmployeeSummary.employeeId;

    employeeDetailRequestsRef.current.add(requestKey);
    setEmployeeDetailStatusByKey((current) => ({
      ...current,
      [requestKey]: "loading",
    }));

    void (async () => {
      try {
        const detail = await getPayrollRunEmployeeDetailAction(runId, employeeId);

        if (detail) {
          setEmployeeDetailsByKey((current) => ({
            ...current,
            [requestKey]: detail,
          }));
          setEmployeeDetailStatusByKey((current) => ({
            ...current,
            [requestKey]: "ready",
          }));
        } else {
          setEmployeeDetailStatusByKey((current) => ({
            ...current,
            [requestKey]: "error",
          }));
        }
      } catch {
        setEmployeeDetailStatusByKey((current) => ({
          ...current,
          [requestKey]: "error",
        }));
      } finally {
        employeeDetailRequestsRef.current.delete(requestKey);
      }
    })();
  }, [
    employeeDetailsByKey,
    selectedEmployeeDetailKey,
    selectedEmployeeSummary,
    selectedRun,
  ]);


  useEffect(() => {
    if (activeTab !== "accountCodes") return;

    const employeeId = selectedPayrollAccountCodeEmployee?.employeeId ?? null;

    if (!selectedPeriodKey || !employeeId) {
      setPayrollExceptionState({
        status: "idle",
        periodId: null,
        employeeId: null,
        rows: [],
        recurringRows: [],
        loanRows: [],
        accountCodeOptions: [],
        error: null,
      });
      setPayrollExceptionDrafts([]);
      setPayrollLoanDraftAmounts({});
      return;
    }

    const cacheKey = `exceptions:${selectedPeriodKey}:${employeeId}`;
    const cachedState = payrollExceptionCacheRef.current[cacheKey];
    if (cachedState) {
      setPayrollExceptionState(cachedState);
      setPayrollExceptionDrafts(
        cachedState.rows.map((row) => createPayrollExceptionDraft(row))
      );
      return;
    }

    let cancelled = false;

    setPayrollExceptionState({
      status: "loading",
      periodId: selectedPeriodKey,
      employeeId,
      rows: [],
      recurringRows: [],
      loanRows: [],
      accountCodeOptions: [],
      error: null,
    });

    void (async () => {
      try {
        const workspace = await getEmployeePayrollExceptionWorkspaceAction(
          selectedPeriodKey,
          employeeId
        );

        if (cancelled) return;

        const nextState: PayrollExceptionState = {
          status: "ready",
          periodId: selectedPeriodKey,
          employeeId,
          rows: workspace.rows,
          recurringRows: workspace.recurringRows,
          loanRows: workspace.loanRows,
          accountCodeOptions: workspace.accountCodeOptions,
          error: null,
        };
        payrollExceptionCacheRef.current[cacheKey] = nextState;
        setPayrollExceptionState(nextState);
        setPayrollExceptionDrafts(
          workspace.rows.map((row) => createPayrollExceptionDraft(row))
        );
      } catch (error) {
        if (cancelled) return;

        setPayrollExceptionState({
          status: "error",
          periodId: selectedPeriodKey,
          employeeId,
          rows: [],
          recurringRows: [],
          loanRows: [],
          accountCodeOptions: [],
          error: getErrorMessage(
            error,
            "Unable to load payroll exception rows."
          ),
        });
        setPayrollExceptionDrafts([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    selectedPayrollAccountCodeEmployee?.employeeId,
    selectedPeriodKey,
  ]);

  useEffect(() => {
    if (activeTab !== "manual") return;

    const employeeId = selectedManualPayrollEmployee?.employeeId ?? null;

    if (!selectedPeriodKey || !employeeId) {
      setManualPayrollState({
        status: "idle",
        periodId: null,
        employeeId: null,
        data: null,
        error: null,
      });
      setManualPayrollDraft(createManualPayrollDraft(null));
      return;
    }

    let cancelled = false;

    setManualPayrollState({
      status: "loading",
      periodId: selectedPeriodKey,
      employeeId,
      data: null,
      error: null,
    });
    setManualPayrollDraft(createManualPayrollDraft(null));

    void (async () => {
      try {
        const [workspaceWithoutOptions, accountCodeOptions] = await Promise.all([
          getManualPayrollEntryWorkspaceAction(selectedPeriodKey, employeeId, false),
          getCachedManualPayrollAccountCodeOptions(),
        ]);
        const workspace = {
          ...workspaceWithoutOptions,
          accountCodeOptions,
        };

        if (cancelled) return;

        const nextState: ManualPayrollState = {
          status: "ready",
          periodId: selectedPeriodKey,
          employeeId,
          data: workspace,
          error: null,
        };
        setManualPayrollState(nextState);
        setManualPayrollDraft(createManualPayrollDraft(workspace));
      } catch (error) {
        if (cancelled) return;

        setManualPayrollState({
          status: "error",
          periodId: selectedPeriodKey,
          employeeId,
          data: null,
          error: getErrorMessage(error, "Unable to load manual payroll entry."),
        });
        setManualPayrollDraft(createManualPayrollDraft(null));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    selectedManualPayrollEmployee?.employeeId,
    selectedPeriodKey,
  ]);

  useEffect(() => {
    if (
      payrollExceptionDateOptions.length > 0 &&
      !payrollExceptionDateOptions.some(
        (option) => option.value === selectedPayrollExceptionDate
      )
    ) {
      setSelectedPayrollExceptionDate(payrollExceptionDateOptions[0].value);
    }
  }, [payrollExceptionDateOptions, selectedPayrollExceptionDate]);

  useEffect(() => {
    setPayrollLoanDraftAmounts((current) => {
      const next: Record<string, string> = {};

      for (const row of payrollLoanRows) {
        next[row.installmentId] =
          current[row.installmentId] ?? formatMoneyInput(row.scheduledAmount);
      }

      return next;
    });
  }, [payrollLoanRows]);

  useEffect(() => {
    if (activeTab !== "reports") return;

    if (!selectedRunId) {
      setReportState({
        status: "idle",
        runId: null,
        register: null,
        agencySummary: null,
        loanDeductions: [],
        error: null,
      });
      return;
    }

    const cacheKey = `reports:${selectedRunId}`;
    const cachedState = reportCacheRef.current[cacheKey];
    if (cachedState) {
      setReportState(cachedState);
      return;
    }

    let cancelled = false;

    setReportState({
      status: "loading",
      runId: selectedRunId,
      register: null,
      agencySummary: null,
      loanDeductions: [],
      error: null,
    });

    void (async () => {
      try {
        const [register, agencySummaryResult, loanDeductions] = await Promise.all([
          getPayrollRegisterAction(selectedRunId),
          getAgencyDeductionSummaryAction(selectedRunId),
          getLoanDeductionSummaryAction(selectedRunId),
        ]);

        if (cancelled) return;

        const nextState: ReportState = {
          status: "ready",
          runId: selectedRunId,
          register,
          agencySummary: agencySummaryResult ?? EMPTY_AGENCY_SUMMARY,
          loanDeductions: loanDeductions ?? [],
          error: null,
        };
        reportCacheRef.current[cacheKey] = nextState;
        setReportState(nextState);
      } catch (error) {
        if (cancelled) return;

        setReportState({
          status: "error",
          runId: selectedRunId,
          register: null,
          agencySummary: null,
          loanDeductions: [],
          error: getErrorMessage(error, "Unable to load payroll reports."),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedRunId]);

  useEffect(() => {
    if (activeTab !== "reports") return;

    if (!selectedRunId || !selectedEmployeeId) {
      setPayslipState({
        status: "idle",
        runId: null,
        employeeId: null,
        payslip: null,
        error: null,
      });
      return;
    }

    const cacheKey = `payslip:${selectedRunId}:${selectedEmployeeId}`;
    const cachedState = payslipCacheRef.current[cacheKey];
    if (cachedState) {
      setPayslipState(cachedState);
      return;
    }

    let cancelled = false;

    setPayslipState({
      status: "loading",
      runId: selectedRunId,
      employeeId: selectedEmployeeId,
      payslip: null,
      error: null,
    });

    void (async () => {
      try {
        const payslip = await getEmployeePayslipAction(
          selectedRunId,
          selectedEmployeeId
        );

        if (cancelled) return;

        const nextState: PayslipState = {
          status: "ready",
          runId: selectedRunId,
          employeeId: selectedEmployeeId,
          payslip,
          error: null,
        };
        payslipCacheRef.current[cacheKey] = nextState;
        setPayslipState(nextState);
      } catch (error) {
        if (cancelled) return;

        setPayslipState({
          status: "error",
          runId: selectedRunId,
          employeeId: selectedEmployeeId,
          payslip: null,
          error: getErrorMessage(error, "Unable to load the employee payslip."),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedEmployeeId, selectedRunId]);

  useEffect(() => {
    if (activeTab !== "attendance") return;

    if (!selectedPeriodKey) {
      setAttendanceDtrState({
        status: "idle",
        periodId: null,
        data: null,
        error: null,
      });
      return;
    }

    const cacheKey = `attendance-summary:${selectedPeriodKey}`;
    const cachedState = attendanceDtrCacheRef.current[cacheKey];
    if (cachedState) {
      setAttendanceDtrState(cachedState);
      return;
    }

    let cancelled = false;

    setAttendanceDtrState((current) =>
      current.periodId === selectedPeriodKey && current.data
        ? current
        : {
            status: "loading",
            periodId: selectedPeriodKey,
            data: null,
            error: null,
          }
    );

    void (async () => {
      try {
        const data = await getAttendancePeriodDtrSummaryAction(selectedPeriodKey);

        if (cancelled) return;

        const nextState: AttendanceDtrState = {
          status: "ready",
          periodId: selectedPeriodKey,
          data,
          error: null,
        };
        attendanceDtrCacheRef.current[cacheKey] = nextState;
        setAttendanceDtrState(nextState);
      } catch (error) {
        if (cancelled) return;

        setAttendanceDtrState({
          status: "error",
          periodId: selectedPeriodKey,
          data: null,
          error: getErrorMessage(error, "Unable to load the semimonthly DTR."),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, attendanceBatchKey, attendanceDtrReloadKey, selectedPeriodKey]);

  useEffect(() => {
    if (activeTab !== "attendance") return;

    const selectedDtrEmployeeKey = selectedDtrEmployee?.employeeId ?? null;

    if (!selectedPeriodKey || !selectedDtrEmployeeKey) {
      setAttendanceDtrRowsState({
        status: "idle",
        periodId: null,
        employeeId: null,
        data: null,
        error: null,
      });
      return;
    }

    const cacheKey = `attendance-rows:${selectedPeriodKey}:${selectedDtrEmployeeKey}`;
    const cachedState = attendanceDtrRowsCacheRef.current[cacheKey];
    if (cachedState) {
      setAttendanceDtrRowsState(cachedState);
      return;
    }

    let cancelled = false;

    setAttendanceDtrRowsState((current) =>
      current.periodId === selectedPeriodKey &&
      current.employeeId === selectedDtrEmployeeKey &&
      current.data
        ? current
        : {
            status: "loading",
            periodId: selectedPeriodKey,
            employeeId: selectedDtrEmployeeKey,
            data: null,
            error: null,
          }
    );

    void (async () => {
      try {
        const data = await getAttendancePeriodDtrEmployeeRowsAction(
          selectedPeriodKey,
          selectedDtrEmployeeKey
        );

        if (cancelled) return;

        const nextState: AttendanceDtrRowsState = {
          status: "ready",
          periodId: selectedPeriodKey,
          employeeId: selectedDtrEmployeeKey,
          data,
          error: null,
        };
        attendanceDtrRowsCacheRef.current[cacheKey] = nextState;
        setAttendanceDtrRowsState(nextState);

        const autoHoldDrafts: DtrStatusDrafts = {};
        const autoHoldClearDates: string[] = [];
        for (const row of data.rows) {
          const hasHoldFlag =
            row.anomalyFlags.includes("ODD_PUNCH_COUNT") ||
            row.anomalyFlags.includes("MISSING_OUT");
          const isResolvedByDoublePunch = row.anomalyFlags.includes("DOUBLE_PUNCH");
          if (hasHoldFlag && !isResolvedByDoublePunch && row.manualStatus === null) {
            autoHoldDrafts[
              getDtrStatusDraftKey(selectedDtrEmployeeKey, row.attendanceDate)
            ] = "Hold";
          }
          if (row.manualStatus === "Hold" && isResolvedByDoublePunch) {
            autoHoldClearDates.push(row.attendanceDate);
          }
        }
        if (Object.keys(autoHoldDrafts).length > 0) {
          setDtrStatusDrafts((prev) => ({ ...autoHoldDrafts, ...prev }));

          const autoHoldChanges = Object.entries(autoHoldDrafts).map(
            ([key, status]) => ({
              attendanceDate: key.slice(`${selectedDtrEmployeeKey}:`.length),
              status,
            })
          );
          try {
            await saveAttendanceDtrDayOverridesAction({
              payrollPeriodId: selectedPeriodKey,
              employeeId: selectedDtrEmployeeKey,
              changes: autoHoldChanges,
            });
            setDtrStatusDrafts((prev) => {
              const next = { ...prev };
              for (const key of Object.keys(autoHoldDrafts)) {
                delete next[key];
              }
              return next;
            });
            invalidatePayrollResourceCache([
              `attendance-summary:${selectedPeriodKey}`,
              `attendance-rows:${selectedPeriodKey}:`,
            ]);
            setAttendanceDtrHeldRowsState((prev) =>
              prev.periodId === selectedPeriodKey
                ? { ...prev, status: "idle" }
                : prev
            );
            await refreshWorkspaceSnapshot();
          } catch (saveError) {
            toast.error(
              getErrorMessage(saveError, "Unable to auto-save Hold rows.")
            );
          }
        }
        if (autoHoldClearDates.length > 0) {
          try {
            await saveAttendanceDtrDayOverridesAction({
              payrollPeriodId: selectedPeriodKey,
              employeeId: selectedDtrEmployeeKey,
              changes: autoHoldClearDates.map((attendanceDate) => ({
                attendanceDate,
                status: null,
              })),
            });
            invalidatePayrollResourceCache([
              `attendance-summary:${selectedPeriodKey}`,
              `attendance-rows:${selectedPeriodKey}:`,
            ]);
            setAttendanceDtrHeldRowsState((prev) =>
              prev.periodId === selectedPeriodKey
                ? { ...prev, status: "idle" }
                : prev
            );
            setAttendanceDtrReloadKey((current) => current + 1);
            await refreshWorkspaceSnapshot();
          } catch (saveError) {
            toast.error(
              getErrorMessage(saveError, "Unable to clear Hold for double-punch rows.")
            );
          }
        }
      } catch (error) {
        if (cancelled) return;

        setAttendanceDtrRowsState({
          status: "error",
          periodId: selectedPeriodKey,
          employeeId: selectedDtrEmployeeKey,
          data: null,
          error: getErrorMessage(error, "Unable to load employee DTR rows."),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    attendanceBatchKey,
    attendanceDtrReloadKey,
    refreshWorkspaceSnapshot,
    selectedDtrEmployee?.employeeId,
    selectedPeriodKey,
  ]);

  useEffect(() => {
    if (!selectedPeriodKey) {
      setAttendanceDtrHeldRowsState((prev) =>
        prev.status === "idle" &&
        prev.periodId === null &&
        prev.data === null &&
        prev.error === null
          ? prev
          : { status: "idle", periodId: null, data: null, error: null }
      );
      return;
    }
    if (activeTab !== "attendanceHold") return;

    setAttendanceDtrHeldRowsState({
      status: "loading",
      periodId: selectedPeriodKey,
      data: null,
      error: null,
    });

    let cancelled = false;
    void (async () => {
      try {
        const data = await getAttendanceDtrHeldRowsAction(selectedPeriodKey);
        if (cancelled) return;
        setAttendanceDtrHeldRowsState({
          status: "ready",
          periodId: selectedPeriodKey,
          data: data as AttendanceDtrHeldRowsView,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        setAttendanceDtrHeldRowsState({
          status: "error",
          periodId: selectedPeriodKey,
          data: null,
          error: getErrorMessage(error, "Unable to load held DTR rows."),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, attendanceDtrReloadKey, selectedPeriodKey]);

  useEffect(() => {
    setExpandedAttendanceHoldEmployeeIds(new Set());
    setAttendanceHoldSearch("");
    setAttendanceHoldDepartmentFilter(ALL_DEPARTMENTS_VALUE);
    setAttendanceHoldApprovalDrafts({});
  }, [attendanceDtrReloadKey, selectedPeriodKey]);

  useEffect(() => {
    const filterStillExists = attendanceHoldDepartmentOptions.some(
      (option) => option.value === attendanceHoldDepartmentFilter
    );

    if (!filterStillExists) {
      setAttendanceHoldDepartmentFilter(ALL_DEPARTMENTS_VALUE);
    }
  }, [attendanceHoldDepartmentFilter, attendanceHoldDepartmentOptions]);

  function createAttendanceHoldApprovalDraft(
    employee: AttendanceHoldEmployeeGroup
  ): AttendanceHoldApprovalDraft {
    const worked = splitAttendanceHoldDraftMinutes(employee.workedMinutes);
    const late = splitAttendanceHoldDraftMinutes(employee.lateMinutes);
    const undertime = splitAttendanceHoldDraftMinutes(employee.undertimeMinutes);
    const overtime = splitAttendanceHoldDraftMinutes(employee.overtimeMinutes);
    const targetPayrollPeriodId =
      employee.rows.find((row) => row.targetPayrollPeriodId)?.targetPayrollPeriodId ??
      "";

    return {
      targetPayrollPeriodId,
      workedHours: worked.hours,
      workedMinutes: worked.minutes,
      lateHours: late.hours,
      lateMinutes: late.minutes,
      undertimeHours: undertime.hours,
      undertimeMinutes: undertime.minutes,
      overtimeHours: overtime.hours,
      overtimeMinutes: overtime.minutes,
      workedManuallyEdited: false,
    };
  }

  function handleEditAttendanceHoldEmployee(employee: AttendanceHoldEmployeeGroup) {
    setAttendanceHoldApprovalDrafts((prev) => ({
      ...prev,
      [employee.employeeId]: createAttendanceHoldApprovalDraft(employee),
    }));
    setExpandedAttendanceHoldEmployeeIds((prev) => {
      const next = new Set(prev);
      next.add(employee.employeeId);
      return next;
    });
  }

  function handleCancelAttendanceHoldEmployee(employeeId: string) {
    setAttendanceHoldApprovalDrafts((prev) => {
      const next = { ...prev };
      delete next[employeeId];
      return next;
    });
    setExpandedAttendanceHoldEmployeeIds((prev) => {
      const next = new Set(prev);
      next.delete(employeeId);
      return next;
    });
  }

  function getAttendanceHoldDraftAutoWorkedMinutes(
    employee: AttendanceHoldEmployeeGroup,
    draft: AttendanceHoldApprovalDraft
  ) {
    const lateMinutes = parseAttendanceHoldDraftTime(
      draft.lateHours,
      draft.lateMinutes
    );
    const undertimeMinutes = parseAttendanceHoldDraftTime(
      draft.undertimeHours,
      draft.undertimeMinutes
    );

    if (lateMinutes == null || undertimeMinutes == null) return null;

    return Math.max(0, employee.intendedWorkedMinutes - lateMinutes - undertimeMinutes);
  }

  function updateAttendanceHoldApprovalDraft(
    employeeId: string,
    updates: Partial<AttendanceHoldApprovalDraft>,
    options?: {
      employee?: AttendanceHoldEmployeeGroup;
      markWorkedManual?: boolean;
    }
  ) {
    setAttendanceHoldApprovalDrafts((prev) => {
      const current = prev[employeeId];
      if (!current) return prev;
      const nextDraft = {
        ...current,
        ...updates,
        workedManuallyEdited:
          options?.markWorkedManual === true
            ? true
            : updates.workedManuallyEdited ?? current.workedManuallyEdited,
      };

      if (options?.employee && !nextDraft.workedManuallyEdited) {
        const autoWorkedMinutes = getAttendanceHoldDraftAutoWorkedMinutes(
          options.employee,
          nextDraft
        );

        if (autoWorkedMinutes != null) {
          const autoWorked = splitAttendanceHoldDraftMinutes(autoWorkedMinutes);
          nextDraft.workedHours = autoWorked.hours;
          nextDraft.workedMinutes = autoWorked.minutes;
        }
      }

      return {
        ...prev,
        [employeeId]: nextDraft,
      };
    });
  }

  function splitAttendanceHoldDraftMinutes(value: number) {
    const safeValue = Math.max(0, Math.trunc(value));
    return {
      hours: String(Math.floor(safeValue / 60)),
      minutes: String(safeValue % 60),
    };
  }

  function parseAttendanceHoldDraftTime(hoursValue: string, minutesValue: string) {
    const normalizedHours = hoursValue.trim();
    const normalizedMinutes = minutesValue.trim();
    const hours =
      normalizedHours === "" ? 0 : Number.parseInt(normalizedHours, 10);
    const minutes =
      normalizedMinutes === "" ? 0 : Number.parseInt(normalizedMinutes, 10);

    if (
      (normalizedHours !== "" && !/^\d+$/.test(normalizedHours)) ||
      (normalizedMinutes !== "" && !/^\d+$/.test(normalizedMinutes)) ||
      !Number.isSafeInteger(hours) ||
      !Number.isSafeInteger(minutes) ||
      minutes > 59
    ) {
      return null;
    }

    return hours * 60 + minutes;
  }

  function isAttendanceHoldDraftTimeInput(value: string) {
    return /^\d*$/.test(value);
  }

  function renderAttendanceHoldDraftTimeInputs(
    employee: AttendanceHoldEmployeeGroup,
    draft: AttendanceHoldApprovalDraft,
    metric: AttendanceHoldApprovalMetric,
    label: string,
    disabled: boolean
  ) {
    const hoursKey = `${metric}Hours` as AttendanceHoldApprovalDraftTimeField;
    const minutesKey =
      `${metric}Minutes` as AttendanceHoldApprovalDraftTimeField;
    const showAutoWorked = metric === "worked" && !draft.workedManuallyEdited;

    return (
      <div className="flex flex-col gap-1" onClick={(event) => event.stopPropagation()}>
        <div className="grid min-w-[132px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
          <Input
            type="text"
            inputMode="numeric"
            value={draft[hoursKey]}
            onChange={(event) => {
              if (!isAttendanceHoldDraftTimeInput(event.target.value)) return;
              updateAttendanceHoldApprovalDraft(
                employee.employeeId,
                {
                  [hoursKey]: event.target.value,
                },
                {
                  employee,
                  markWorkedManual: metric === "worked",
                }
              );
            }}
            placeholder="h"
            className="h-8 w-14"
            aria-label={`${label} hours for ${employee.employeeName}`}
            disabled={disabled}
          />
          <span className="text-center text-sm font-medium text-muted-foreground">
            :
          </span>
          <Input
            type="text"
            inputMode="numeric"
            value={draft[minutesKey]}
            onChange={(event) => {
              if (!isAttendanceHoldDraftTimeInput(event.target.value)) return;
              updateAttendanceHoldApprovalDraft(
                employee.employeeId,
                {
                  [minutesKey]: event.target.value,
                },
                {
                  employee,
                  markWorkedManual: metric === "worked",
                }
              );
            }}
            placeholder="m"
            className="h-8 w-14"
            aria-label={`${label} minutes for ${employee.employeeName}`}
            disabled={disabled}
          />
        </div>
        {showAutoWorked ? (
          <span className="text-[10px] font-medium uppercase text-muted-foreground">
            Auto
          </span>
        ) : null}
      </div>
    );
  }

  async function handleApproveAttendanceHoldEmployee(
    employee: AttendanceHoldEmployeeGroup
  ) {
    if (!selectedPeriodKey) return;

    const draft = attendanceHoldApprovalDrafts[employee.employeeId];
    if (!draft) {
      handleEditAttendanceHoldEmployee(employee);
      return;
    }

    if (!draft.targetPayrollPeriodId) {
      toast.error("Select a payroll period before approving held biometrics.");
      return;
    }

    const workedMinutes = parseAttendanceHoldDraftTime(
      draft.workedHours,
      draft.workedMinutes
    );
    const lateMinutes = parseAttendanceHoldDraftTime(
      draft.lateHours,
      draft.lateMinutes
    );
    const undertimeMinutes = parseAttendanceHoldDraftTime(
      draft.undertimeHours,
      draft.undertimeMinutes
    );
    const overtimeMinutes = parseAttendanceHoldDraftTime(
      draft.overtimeHours,
      draft.overtimeMinutes
    );

    if (
      workedMinutes == null ||
      lateMinutes == null ||
      undertimeMinutes == null ||
      overtimeMinutes == null
    ) {
      toast.error(
        "Enter non-negative whole-number hours and minutes from 0 to 59 before approving."
      );
      return;
    }

    setSavingAttendanceHoldApprovalEmployeeIds((prev) => {
      const next = new Set(prev);
      next.add(employee.employeeId);
      return next;
    });

    try {
      const result = await approveAttendanceDtrHoldRowsAction({
        sourcePayrollPeriodId: selectedPeriodKey,
        targetPayrollPeriodId: draft.targetPayrollPeriodId,
        employeeId: employee.employeeId,
        attendanceDates: employee.heldDates,
        workedMinutes,
        lateMinutes,
        undertimeMinutes,
        overtimeMinutes,
      });
      toast.success(
        `${employee.employeeName} Attendance Hold approved for ${result.targetPayrollPeriodCode}.`
      );
      setAttendanceHoldApprovalDrafts((prev) => {
        const next = { ...prev };
        delete next[employee.employeeId];
        return next;
      });
      setAttendanceDtrReloadKey((key) => key + 1);
      await refreshWorkspaceSnapshot();
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to approve held biometrics."));
    } finally {
      setSavingAttendanceHoldApprovalEmployeeIds((prev) => {
        const next = new Set(prev);
        next.delete(employee.employeeId);
        return next;
      });
    }
  }

  async function handleResetAttendanceHoldEmployee(
    employee: AttendanceHoldEmployeeGroup
  ) {
    if (!selectedPeriodKey) return;

    const submittedDates = employee.rows
      .filter((row) => row.approvalStatus !== "Hold")
      .map((row) => row.attendanceDate)
      .sort((left, right) => left.localeCompare(right));

    if (submittedDates.length === 0) {
      toast.error("No pending or approved held DTR rows were found to reset.");
      return;
    }

    const confirmed = window.confirm(
      `Reset ${submittedDates.length} submitted Attendance Hold row${
        submittedDates.length === 1 ? "" : "s"
      } for ${employee.employeeName}? This will return the DTR to Hold, reset submitted values to default DTR values, and remove generated payroll/manual payroll rows for approved rows.`
    );

    if (!confirmed) return;

    setResettingAttendanceHoldApprovalEmployeeIds((prev) => {
      const next = new Set(prev);
      next.add(employee.employeeId);
      return next;
    });

    try {
      const result = await resetAttendanceDtrHoldRowsAction({
        sourcePayrollPeriodId: selectedPeriodKey,
        employeeId: employee.employeeId,
        attendanceDates: submittedDates,
      });
      toast.success(
        `${employee.employeeName} Attendance Hold reset for ${result.resetDateCount} row${
          result.resetDateCount === 1 ? "" : "s"
        }.`
      );
      setAttendanceHoldApprovalDrafts((prev) => {
        const next = { ...prev };
        delete next[employee.employeeId];
        return next;
      });
      setAttendanceDtrReloadKey((key) => key + 1);
      await refreshWorkspaceSnapshot();
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to reset held biometrics."));
    } finally {
      setResettingAttendanceHoldApprovalEmployeeIds((prev) => {
        const next = new Set(prev);
        next.delete(employee.employeeId);
        return next;
      });
    }
  }

  useEffect(() => {
    const filterStillExists = attendanceDtrDepartmentOptions.some(
      (option) => option.value === attendanceDtrDepartmentFilter
    );

    if (!filterStillExists) {
      setAttendanceDtrDepartmentFilter(ALL_DEPARTMENTS_VALUE);
    }
  }, [attendanceDtrDepartmentFilter, attendanceDtrDepartmentOptions]);

  useEffect(() => {
    if (filteredAttendanceDtrEmployees.length === 0) {
      if (selectedDtrEmployeeId !== null) {
        setSelectedDtrEmployeeId(null);
      }
      return;
    }

    const employeeStillExists = filteredAttendanceDtrEmployees.some(
      (employee) => employee.employeeId === selectedDtrEmployeeId
    );

    if (!employeeStillExists) {
      setSelectedDtrEmployeeId(filteredAttendanceDtrEmployees[0]?.employeeId ?? null);
    }
  }, [filteredAttendanceDtrEmployees, selectedDtrEmployeeId]);

  useEffect(() => {
    const filterStillExists = payrollAccountCodeDepartmentOptions.some(
      (option) => option.value === payrollAccountCodeDepartmentFilter
    );

    if (!filterStillExists) {
      setPayrollAccountCodeDepartmentFilter(ALL_DEPARTMENTS_VALUE);
    }
  }, [
    payrollAccountCodeDepartmentFilter,
    payrollAccountCodeDepartmentOptions,
  ]);

  useEffect(() => {
    if (filteredPayrollAccountCodeEmployees.length === 0) {
      if (selectedPayrollAccountCodeEmployeeId !== null) {
        setSelectedPayrollAccountCodeEmployeeId(null);
      }
      return;
    }

    const employeeStillExists = filteredPayrollAccountCodeEmployees.some(
      (employee) => employee.employeeId === selectedPayrollAccountCodeEmployeeId
    );

    if (!employeeStillExists) {
      setSelectedPayrollAccountCodeEmployeeId(
        filteredPayrollAccountCodeEmployees[0]?.employeeId ?? null
      );
    }
  }, [
    filteredPayrollAccountCodeEmployees,
    selectedPayrollAccountCodeEmployeeId,
  ]);

  function replaceQueryParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        params.delete(key);
        continue;
      }

      params.set(key, value);
    }

    const queryString = params.toString();
    const nextPath = queryString ? `${pathname}?${queryString}` : pathname;

    startTransition(() => {
      router.replace(nextPath, { scroll: false });
    });
  }

  function invalidatePayrollResourceCache(prefixes: string[]) {
    deleteCacheKeys(reportCacheRef, prefixes);
    deleteCacheKeys(payslipCacheRef, prefixes);
    deleteCacheKeys(attendanceDtrCacheRef, prefixes);
    deleteCacheKeys(attendanceDtrRowsCacheRef, prefixes);
    deleteCacheKeys(payrollExceptionCacheRef, prefixes);
  }

  async function getCachedManualPayrollAccountCodeOptions() {
    if (manualPayrollAccountCodeOptionsRef.current) {
      return manualPayrollAccountCodeOptionsRef.current;
    }

    const options = await getManualPayrollAccountCodeOptionsAction();
    manualPayrollAccountCodeOptionsRef.current = options;
    return options;
  }

  async function loadManualPayrollWorkspace(periodId: string, employeeId: string) {
    const [workspaceWithoutOptions, accountCodeOptions] = await Promise.all([
      getManualPayrollEntryWorkspaceAction(periodId, employeeId, false),
      getCachedManualPayrollAccountCodeOptions(),
    ]);

    return {
      ...workspaceWithoutOptions,
      accountCodeOptions,
    };
  }

  function applyManualPayrollWorkspace(
    workspace: ManualPayrollEntryWorkspaceView
  ) {
    const nextState: ManualPayrollState = {
      status: "ready",
      periodId: workspace.payrollPeriod.id,
      employeeId: workspace.employee.employeeId,
      data: workspace,
      error: null,
    };

    setManualPayrollState(nextState);
    setManualPayrollDraft(createManualPayrollDraft(workspace));
  }

  async function refreshManualPayrollWorkspace(options?: {
    showSuccess?: boolean;
    preserveDirtyDraft?: boolean;
  }) {
    const periodId = selectedPeriodKey;
    const employeeId = selectedManualPayrollEmployee?.employeeId ?? null;

    if (!periodId || !employeeId) return null;

    if ((options?.preserveDirtyDraft ?? true) && manualPayrollDraftDirty) {
      toast.message("New Manual Payroll data is available.", {
        description: "Save or undo your current changes, then refresh to load it.",
      });
      return null;
    }

    try {
      setRefreshingManualPayroll(true);
      const workspace = await loadManualPayrollWorkspace(periodId, employeeId);
      applyManualPayrollWorkspace(workspace);

      if (options?.showSuccess) {
        toast.success("Manual payroll refreshed with latest employee data.");
      }

      return workspace;
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to refresh manual payroll."));
      return null;
    } finally {
      setRefreshingManualPayroll(false);
    }
  }

  async function refreshManualPayrollAfterExternalChange() {
    if (activeTab !== "manual" || !manualPayrollWorkspace) return;

    if (manualPayrollDraftDirty) {
      toast.message("New Manual Payroll data is available.", {
        description: "Save or undo your current changes, then refresh to load it.",
      });
      return;
    }

    await refreshManualPayrollWorkspace({ preserveDirtyDraft: false });
  }

  function updatePayrollExceptionDraft(
    localId: string,
    updates: Partial<PayrollExceptionDraft>
  ) {
    setPayrollExceptionDrafts((current) =>
      current.map((draft) =>
        draft.localId === localId ? { ...draft, ...updates } : draft
      )
    );
  }

  function getPayrollExceptionHolidayDayTypeForDate(attendanceDate: string) {
    const dtrRow =
      selectedDtrEmployee?.employeeId === selectedPayrollAccountCodeEmployee?.employeeId
        ? selectedDtrRows.find((row) => row.attendanceDate === attendanceDate)
        : null;

    return getDefaultPayrollExceptionHolidayDayType(dtrRow);
  }

  function handleAddPayrollExceptionRow() {
    if (!selectedPeriod || !selectedPayrollAccountCodeEmployee) {
      toast.error("Select a payroll period and employee first.");
      return;
    }

    if (activePayrollExceptionAccountCodeOptions.length === 0) {
      toast.error("Create at least one Account Code before adding exceptions.");
      return;
    }

    const attendanceDate =
      activeTab === "accountCodes"
        ? selectedPeriod.startDate
        : effectiveSelectedPayrollExceptionDate;
    if (!attendanceDate) {
      toast.error("Select a payroll date first.");
      return;
    }

    setPayrollExceptionDrafts((current) => [
      ...current,
      createPayrollAccountCodeDraft({
        attendanceDate,
        accountCodeOptions: activePayrollExceptionAccountCodeOptions,
        lineTab: payrollAccountCodeLineTab,
        dayType: getPayrollExceptionHolidayDayTypeForDate(attendanceDate),
      }),
    ]);
  }

  function handleDeletePayrollExceptionDraft(localId: string) {
    setPayrollExceptionDrafts((current) =>
      current.filter((draft) => draft.localId !== localId)
    );
  }

  function handleDiscardPayrollExceptionDrafts() {
    setPayrollExceptionDrafts(
      payrollExceptionRows.map((row) => createPayrollExceptionDraft(row))
    );
  }

  async function handleSavePayrollExceptionDrafts() {
    if (!selectedPeriod || !selectedPayrollAccountCodeEmployee) {
      toast.error("Select a payroll period and employee first.");
      return;
    }

    if (hasPayrollExceptionDraftErrors) {
      toast.error("Resolve payroll exception row issues before saving.");
      return;
    }

    try {
      setSavingPayrollExceptions(true);

      const result = await saveEmployeePayrollExceptionRowsAction({
        payrollPeriodId: selectedPeriod.id,
        employeeId: selectedPayrollAccountCodeEmployee.employeeId,
        rows: payrollExceptionDrafts.map((draft) =>
          serializePayrollExceptionDraft(draft)
        ),
      });

      toast.success(
        result.staleRunCount > 0
          ? "Payroll exceptions saved. The latest editable payroll run is now stale."
          : "Payroll exceptions saved."
      );
      const nextState: PayrollExceptionState = {
        status: "ready",
        periodId: selectedPeriod.id,
        employeeId: selectedPayrollAccountCodeEmployee.employeeId,
        rows: result.rows,
        recurringRows: payrollExceptionState.recurringRows,
        loanRows: payrollExceptionState.loanRows,
        accountCodeOptions: payrollExceptionState.accountCodeOptions,
        error: null,
      };
      payrollExceptionCacheRef.current[
        `exceptions:${selectedPeriod.id}:${selectedPayrollAccountCodeEmployee.employeeId}`
      ] = nextState;
      setPayrollExceptionState(nextState);
      setPayrollExceptionDrafts(
        result.rows.map((row) => createPayrollExceptionDraft(row))
      );
      invalidatePayrollResourceCache([
        `attendance-summary:${selectedPeriod.id}`,
        `attendance-rows:${selectedPeriod.id}:`,
        ...(selectedRunId
          ? [`reports:${selectedRunId}`, `payslip:${selectedRunId}:`]
          : []),
      ]);
      setAttendanceDtrReloadKey((current) => current + 1);
      await refreshWorkspaceSnapshot();
      await refreshManualPayrollAfterExternalChange();
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Unable to save payroll exceptions.")
      );
    } finally {
      setSavingPayrollExceptions(false);
    }
  }

  async function handleSavePayrollLoanInstallment(row: PayrollScheduledLoanDeductionView) {
    if (!selectedPeriod || !selectedPayrollAccountCodeEmployee) {
      toast.error("Select a payroll period and employee first.");
      return;
    }

    const draftAmount =
      payrollLoanDraftAmounts[row.installmentId] ?? row.scheduledAmount;
    if (!isValidMoneyInput(draftAmount) || toNumber(draftAmount) <= 0) {
      toast.error("Enter a valid scheduled loan deduction amount.");
      return;
    }

    try {
      setSavingPayrollLoanInstallmentId(row.installmentId);

      const result = await updateEmployeePayrollLoanInstallmentAction({
        payrollPeriodId: selectedPeriod.id,
        employeeId: selectedPayrollAccountCodeEmployee.employeeId,
        installmentId: row.installmentId,
        scheduledAmount: draftAmount,
      });

      toast.success(
        result.staleRunCount > 0
          ? "Loan deduction updated. Affected editable payroll runs are now stale."
          : "Loan deduction updated."
      );

      const nextState: PayrollExceptionState = {
        status: "ready",
        periodId: selectedPeriod.id,
        employeeId: selectedPayrollAccountCodeEmployee.employeeId,
        rows: payrollExceptionState.rows,
        recurringRows: payrollExceptionState.recurringRows,
        loanRows: result.loanRows,
        accountCodeOptions: payrollExceptionState.accountCodeOptions,
        error: null,
      };
      payrollExceptionCacheRef.current[
        `exceptions:${selectedPeriod.id}:${selectedPayrollAccountCodeEmployee.employeeId}`
      ] = nextState;
      setPayrollExceptionState(nextState);
      setPayrollLoanDraftAmounts(
        Object.fromEntries(
          result.loanRows.map((loanRow) => [
            loanRow.installmentId,
            formatMoneyInput(loanRow.scheduledAmount),
          ])
        )
      );
      invalidatePayrollResourceCache([
        `manual:${selectedPeriod.id}:${selectedPayrollAccountCodeEmployee.employeeId}`,
        ...(selectedRunId
          ? [`reports:${selectedRunId}`, `payslip:${selectedRunId}:`]
          : []),
      ]);
      await refreshWorkspaceSnapshot();
      await refreshManualPayrollAfterExternalChange();
    } catch (error) {
      toast.error(
        getErrorMessage(error, "Unable to update loan deduction.")
      );
    } finally {
      setSavingPayrollLoanInstallmentId(null);
    }
  }

  function updateManualPayrollDraft(updates: Partial<ManualPayrollDraft>) {
    setManualPayrollDraft((current) => ({
      ...current,
      ...updates,
    }));
  }

  function getManualPayrollAutoAmount(line: ManualPayrollDraftLine) {
    const account =
      line.accountCodeId != null
        ? manualPayrollAccountCodeOptions.find(
            (option) => option.id === line.accountCodeId
          ) ?? null
        : null;
    const amount = computeManualPayrollLineAmount({
      account,
      rateContext: manualPayrollWorkspace?.rateContext ?? null,
      hours: line.hours,
      minutes: line.minutes,
    });

    return amount == null ? null : amount.toFixed(2);
  }

  function updateManualPayrollLine(
    localId: string,
    updates: Partial<ManualPayrollDraftLine>
  ) {
    const shouldAutoComputeAmount =
      !Object.prototype.hasOwnProperty.call(updates, "amount") &&
      (Object.prototype.hasOwnProperty.call(updates, "accountCodeId") ||
        Object.prototype.hasOwnProperty.call(updates, "hours") ||
        Object.prototype.hasOwnProperty.call(updates, "minutes"));

    setManualPayrollDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => {
        if (line.localId !== localId) return line;

        const nextLine = { ...line, ...updates };
        if (!shouldAutoComputeAmount) return nextLine;

        const computedAmount = getManualPayrollAutoAmount(nextLine);
        return computedAmount == null
          ? nextLine
          : { ...nextLine, amount: computedAmount };
      }),
    }));
  }

  function handleManualPayrollSummaryAmountChange(
    bucket: ManualPayrollLineSummaryBucket,
    value: string
  ) {
    if (!isValidMoneyInput(value)) return;

    setManualPayrollDraft((current) => {
      const nonSystemTotal = getManualPayrollBucketNonSystemTotal(
        current.lines,
        bucket
      );
      const systemAmount = Math.max(0, toNumber(value) - nonSystemTotal);
      const formattedAmount = systemAmount.toFixed(2);
      const systemLineId = `system-${bucket}`;
      const hasSystemLine = current.lines.some(
        (line) => line.localId === systemLineId
      );
      const nextLines = hasSystemLine
        ? current.lines.map((line) =>
            line.localId === systemLineId
              ? { ...line, amount: formattedAmount }
              : line
          )
        : [
            ...current.lines,
            createManualPayrollSystemLine(bucket, formattedAmount),
          ];

      return {
        ...current,
        lines: nextLines.filter(
          (line) => !line.isSystem || toNumber(line.amount) > 0
        ),
      };
    });
  }

  function handleAddManualPayrollLine() {
    const option = manualPayrollAccountCodeOptions[0] ?? null;
    if (!option) {
      toast.error("Create at least one Account Code before adding manual rows.");
      return;
    }

    setManualPayrollDraft((current) => ({
      ...current,
      lines: [
        ...current.lines,
        createManualPayrollAccountCodeLine(option, current.lines.length),
      ],
    }));
  }

  function handleSelectManualPayrollAccountCode(localId: string, value: string) {
    const option = manualPayrollAccountCodeOptions.find(
      (candidate) => String(candidate.id) === value
    );
    if (!option) return;

    const isDeduction = isPayrollAccountCodeDeductionType(option.accountType);
    const updates: Partial<ManualPayrollDraftLine> = {
      accountCodeId: option.id,
      code: option.code,
      description: option.description ?? option.code,
      lineType: isDeduction ? "Deduction" : "Earning",
      summaryBucket: getManualPayrollBucketFromAccountCodeOrType(
        {
          code: option.code,
          accountType: option.accountType,
        },
        "otherIncome"
      ),
      taxable: !isDeduction && !option.nonTaxable && !option.deminimis,
      month13thEligible: !isDeduction && option.month13thPay,
      nonTaxable: option.nonTaxable,
      deminimis: option.deminimis,
    };

    if (option.accountType !== "Loan") {
      updates.loanRefNo = null;
    }

    updateManualPayrollLine(localId, updates);
  }

  function handleDeleteManualPayrollLine(localId: string) {
    setManualPayrollDraft((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.localId !== localId),
    }));
  }

  function handleDiscardManualPayrollDraft() {
    setManualPayrollDraft(createManualPayrollDraft(manualPayrollWorkspace));
  }

  async function handleSaveManualPayrollDraft() {
    if (!manualPayrollWorkspace) {
      toast.error("Load a manual payroll entry first.");
      return;
    }

    if (!manualPayrollWorkspace.canEdit) {
      toast.error(manualPayrollWorkspace.editBlockReason ?? "Manual Payroll is read-only.");
      return;
    }

    try {
      setSavingManualPayroll(true);
      const workspace = await saveManualPayrollEntryAction(
        serializeManualPayrollDraft(manualPayrollDraft, manualPayrollWorkspace)
      );
      const accountCodeOptions =
        manualPayrollAccountCodeOptionsRef.current ?? workspace.accountCodeOptions;
      manualPayrollAccountCodeOptionsRef.current = accountCodeOptions;
      const workspaceForCache = {
        ...workspace,
        accountCodeOptions,
      };
      const nextState: ManualPayrollState = {
        status: "ready",
        periodId: workspaceForCache.payrollPeriod.id,
        employeeId: workspaceForCache.employee.employeeId,
        data: workspaceForCache,
        error: null,
      };

      setManualPayrollState(nextState);
      setManualPayrollDraft(createManualPayrollDraft(workspaceForCache));
      toast.success("Manual payroll override saved. Recompute when ready to update reports.");
      invalidatePayrollResourceCache([
        ...(selectedRunId
          ? [`reports:${selectedRunId}`, `payslip:${selectedRunId}:`]
          : []),
      ]);
      await refreshWorkspaceSnapshot();
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to save manual payroll."));
    } finally {
      setSavingManualPayroll(false);
    }
  }

  async function handleDeleteManualPayrollDraft() {
    if (!manualPayrollWorkspace) {
      toast.error("Load a manual payroll entry first.");
      return;
    }

    if (!manualPayrollWorkspace.entryId) {
      toast.message("No manual override is saved for this employee and period.");
      return;
    }

    if (!manualPayrollWorkspace.canEdit) {
      toast.error(manualPayrollWorkspace.editBlockReason ?? "Manual Payroll is read-only.");
      return;
    }

    try {
      setSavingManualPayroll(true);
      const workspace = await deleteManualPayrollEntryAction({
        payrollPeriodId: manualPayrollWorkspace.payrollPeriod.id,
        employeeId: manualPayrollWorkspace.employee.employeeId,
      });
      const accountCodeOptions =
        manualPayrollAccountCodeOptionsRef.current ?? workspace.accountCodeOptions;
      manualPayrollAccountCodeOptionsRef.current = accountCodeOptions;
      const workspaceForCache = {
        ...workspace,
        accountCodeOptions,
      };
      const nextState: ManualPayrollState = {
        status: "ready",
        periodId: workspaceForCache.payrollPeriod.id,
        employeeId: workspaceForCache.employee.employeeId,
        data: workspaceForCache,
        error: null,
      };

      setManualPayrollState(nextState);
      setManualPayrollDraft(createManualPayrollDraft(workspaceForCache));
      toast.success("Manual payroll override deleted. Recompute when ready to restore computed payroll.");
      invalidatePayrollResourceCache([
        ...(selectedRunId
          ? [`reports:${selectedRunId}`, `payslip:${selectedRunId}:`]
          : []),
      ]);
      await refreshWorkspaceSnapshot();
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to delete manual payroll."));
    } finally {
      setSavingManualPayroll(false);
    }
  }

  function updateDtrOverrideDraft(updates: Partial<DtrPeriodOverrideDraft>) {
    setDtrOverrideDraft((current) => ({
      ...current,
      ...updates,
    }));
  }

  function handleResetDtrPeriodOverrideDraft() {
    setDtrOverrideDraft(createDtrOverrideDraft(selectedDtrEmployee?.totals));
    setDtrWorkedDraftTouched(false);
  }

  function handleClearDtrPeriodOverrideDraft() {
    setDtrOverrideDraft(
      createDtrComputedOverrideDraft(selectedDtrEmployee?.totals)
    );
    setDtrWorkedDraftTouched(false);
  }

  async function handleSaveDtrPeriodOverrides() {
    if (!selectedPeriod || !selectedDtrEmployee) {
      toast.error("Select a payroll period and employee first.");
      return;
    }

    if (!dtrPeriodOverridePayload) {
      toast.error("Enter non-negative DTR override values.");
      return;
    }

    try {
      setSavingDtrPeriodOverrides(true);

      const result = await saveAttendanceDtrPeriodOverridesWithAccountCodesAction({
        payrollPeriodId: selectedPeriod.id,
        employeeId: selectedDtrEmployee.employeeId,
        ...dtrPeriodOverridePayload,
      });

      toast.success(
        result.manualPayrollRefresh?.refreshed
          ? "DTR overrides saved and account-code rows refreshed. Manual Payroll attendance rows were refreshed."
          : result.staleRunCount > 0
            ? "DTR overrides saved and account-code rows refreshed. The latest editable payroll run is now stale."
            : "DTR overrides saved and account-code rows refreshed."
      );
      const nextPayrollExceptionState: PayrollExceptionState = {
        status: "ready",
        periodId: selectedPeriod.id,
        employeeId: selectedDtrEmployee.employeeId,
        rows: result.payrollExceptionWorkspace.rows,
        recurringRows: result.payrollExceptionWorkspace.recurringRows,
        loanRows: result.payrollExceptionWorkspace.loanRows,
        accountCodeOptions: result.payrollExceptionWorkspace.accountCodeOptions,
        error: null,
      };
      payrollExceptionCacheRef.current[
        `exceptions:${selectedPeriod.id}:${selectedDtrEmployee.employeeId}`
      ] = nextPayrollExceptionState;

      if (
        selectedPayrollAccountCodeEmployee?.employeeId ===
        selectedDtrEmployee.employeeId
      ) {
        setPayrollExceptionState(nextPayrollExceptionState);
        setPayrollExceptionDrafts(
          result.payrollExceptionWorkspace.rows.map((row) =>
            createPayrollExceptionDraft(row)
          )
        );
      }
      invalidatePayrollResourceCache([
        `attendance-summary:${selectedPeriod.id}`,
        `attendance-rows:${selectedPeriod.id}:`,
        ...(selectedRunId
          ? [`reports:${selectedRunId}`, `payslip:${selectedRunId}:`]
          : []),
      ]);
      setAttendanceDtrReloadKey((current) => current + 1);
      await refreshWorkspaceSnapshot();
      await refreshManualPayrollAfterExternalChange();
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to save the DTR overrides."));
    } finally {
      setSavingDtrPeriodOverrides(false);
    }
  }

  function handleDraftDtrDayStatus(row: AttendanceDtrDayView, value: string) {
    if (!selectedDtrEmployee) return;
    const status =
      value === COMPUTED_DTR_STATUS_VALUE
        ? null
        : (value as AttendanceDtrManualStatus);
    const persistedStatus = row.manualStatus ?? null;
    const draftKey = getDtrStatusDraftKey(
      selectedDtrEmployee.employeeId,
      row.attendanceDate
    );

    setDtrStatusDrafts((current) => {
      const next = { ...current };

      if (status === persistedStatus) {
        delete next[draftKey];
      } else {
        next[draftKey] = status;
      }

      return next;
    });
  }

  function handleDiscardDtrStatusDrafts() {
    if (!selectedDtrEmployee) return;
    const keyPrefix = `${selectedDtrEmployee.employeeId}:`;

    setDtrStatusDrafts((current) => {
      const next = { ...current };

      Object.keys(next).forEach((key) => {
        if (key.startsWith(keyPrefix)) {
          delete next[key];
        }
      });

      return next;
    });
  }

  async function handleSaveDtrStatusDrafts() {
    if (!selectedPeriod || !selectedDtrEmployee) {
      toast.error("Select a payroll period and employee first.");
      return;
    }

    if (selectedDtrRowOverrideChanges.length === 0) {
      toast.error("No DTR row override changes to save.");
      return;
    }

    try {
      setSavingDtrStatuses(true);

      const result = await saveAttendanceDtrDayOverridesAction({
        payrollPeriodId: selectedPeriod.id,
        employeeId: selectedDtrEmployee.employeeId,
        changes: selectedDtrRowOverrideChanges,
      });

      toast.success(
        result.manualPayrollRefresh?.refreshed
          ? `${result.changedCount} DTR row override change(s) saved and account-code rows refreshed. Manual Payroll attendance rows were refreshed.`
          : result.staleRunCount > 0
            ? `${result.changedCount} DTR row override change(s) saved and account-code rows refreshed. The latest editable payroll run is now stale.`
            : `${result.changedCount} DTR row override change(s) saved and account-code rows refreshed.`
      );
      const nextPayrollExceptionState: PayrollExceptionState = {
        status: "ready",
        periodId: selectedPeriod.id,
        employeeId: selectedDtrEmployee.employeeId,
        rows: result.payrollExceptionWorkspace.rows,
        recurringRows: result.payrollExceptionWorkspace.recurringRows,
        loanRows: result.payrollExceptionWorkspace.loanRows,
        accountCodeOptions: result.payrollExceptionWorkspace.accountCodeOptions,
        error: null,
      };
      payrollExceptionCacheRef.current[
        `exceptions:${selectedPeriod.id}:${selectedDtrEmployee.employeeId}`
      ] = nextPayrollExceptionState;

      if (
        selectedPayrollAccountCodeEmployee?.employeeId ===
        selectedDtrEmployee.employeeId
      ) {
        setPayrollExceptionState(nextPayrollExceptionState);
        setPayrollExceptionDrafts(
          result.payrollExceptionWorkspace.rows.map((row) =>
            createPayrollExceptionDraft(row)
          )
        );
      }
      handleDiscardDtrStatusDrafts();
      invalidatePayrollResourceCache([
        `attendance-summary:${selectedPeriod.id}`,
        `attendance-rows:${selectedPeriod.id}:`,
        ...(selectedRunId
          ? [`reports:${selectedRunId}`, `payslip:${selectedRunId}:`]
          : []),
      ]);
      setAttendanceDtrReloadKey((current) => current + 1);
      setAttendanceDtrHeldRowsState((prev) =>
        prev.periodId === selectedPeriod.id
          ? { ...prev, status: "idle" }
          : prev
      );
      await refreshWorkspaceSnapshot();
      await refreshManualPayrollAfterExternalChange();
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to save the DTR row overrides."));
    } finally {
      setSavingDtrStatuses(false);
    }
  }

  async function runAction(
    label: string,
    callback: () => Promise<unknown>,
    successMessage: string | (() => string)
  ) {
    try {
      setActionState(label);
      await callback();
      invalidatePayrollResourceCache(["reports:", "payslip:"]);
      await refreshWorkspaceSnapshot();
      await refreshManualPayrollAfterExternalChange();
      toast.success(
        typeof successMessage === "function" ? successMessage() : successMessage
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Something went wrong."
      );
    } finally {
      setActionState(null);
    }
  }

  async function loadAttendanceBatchDiagnostics(batchId: string) {
    setAttendanceBatchDiagnosticsById((current) => ({
      ...current,
      [batchId]: {
        status: "loading",
        data: current[batchId]?.data ?? null,
        error: null,
      },
    }));

    try {
      const data = await getAttendanceImportBatchUnmatchedDiagnosticsAction(batchId);

      setAttendanceBatchDiagnosticsById((current) => ({
        ...current,
        [batchId]: {
          status: "ready",
          data,
          error: null,
        },
      }));
    } catch (error) {
      setAttendanceBatchDiagnosticsById((current) => ({
        ...current,
        [batchId]: {
          status: "error",
          data: null,
          error: getErrorMessage(error, "Unable to load unmatched rows."),
        },
      }));
    }
  }

  function handleToggleAttendanceBatch(batchId: string) {
    const isExpanded = expandedAttendanceBatchIds.has(batchId);

    setExpandedAttendanceBatchIds((current) => {
      const next = new Set(current);
      if (isExpanded) {
        next.delete(batchId);
      } else {
        next.add(batchId);
      }
      return next;
    });

    const diagnosticsState = attendanceBatchDiagnosticsById[batchId];
    if (
      !isExpanded &&
      diagnosticsState?.status !== "loading" &&
      diagnosticsState?.status !== "ready"
    ) {
      void loadAttendanceBatchDiagnostics(batchId);
    }
  }

  function handleToggleUnmatchedGroup(batchId: string, employeeNo: string) {
    const groupKey = `${batchId}:${employeeNo}`;

    setExpandedUnmatchedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }

  async function handleImportAttendance() {
    if (!selectedPeriod) {
      toast.error("Select a payroll period first.");
      return;
    }

    const filesToImport = [...selectedAttendanceFiles];

    if (filesToImport.length === 0) {
      toast.error("Choose one or more CSV or TXT attendance files first.");
      return;
    }

    let importSuccessMessage = "Attendance import finished.";

    await runAction(
      "import-attendance",
      async () => {
        const resultRows: AttendanceImportResultRow[] = [];

        for (const file of filesToImport) {
          try {
            const contentBase64 = await readFileAsBase64(file);
            const result = await importAttendanceLogs({
              fileName: file.name,
              contentBase64,
              payrollPeriodId: selectedPeriod.id,
              replaceExisting: replaceExistingAttendance,
            });

            resultRows.push({
              fileName: result?.sourceFileName ?? file.name,
              status: "imported",
              details:
                result == null
                  ? "Imported."
                  : [
                      `${result.matchedRows}/${result.totalRows} rows matched, ${result.unmatchedRows} unmatched, ${result.duplicateRows} duplicate.`,
                      result.notes,
                    ]
                      .filter(Boolean)
                      .join(" "),
            });
          } catch (error) {
            resultRows.push({
              fileName: file.name,
              status: "denied",
              details: getErrorMessage(error, "Unable to import file."),
            });
          }
        }

        const importedCount = resultRows.filter(
          (row) => row.status === "imported"
        ).length;
        const deniedCount = resultRows.length - importedCount;

        setAttendanceImportResult({
          attemptedCount: filesToImport.length,
          importedCount,
          deniedCount,
          rows: resultRows,
        });

        if (importedCount === 0) {
          throw new Error(
            `Attendance import denied ${deniedCount} file(s). See details below.`
          );
        }

        setSelectedAttendanceFiles([]);
        setFileInputKey((current) => current + 1);
        setAttendanceDtrReloadKey((current) => current + 1);

        if (deniedCount > 0) {
          importSuccessMessage = `Attendance import finished. ${deniedCount} file(s) denied; see details below.`;
        }
      },
      () => importSuccessMessage
    );
  }

  async function handleRevertAttendanceBatch(batch: AttendanceImportBatchView) {
    const confirmed = window.confirm(
      `Revert attendance import "${batch.sourceFileName}"? This removes its raw logs and affected daily summaries for the selected payroll period.`
    );

    if (!confirmed) return;

    await runAction(
      `revert-attendance-${batch.id}`,
      async () => {
        const result = await revertAttendanceImportBatchAction(batch.id);
        setAttendanceDtrReloadKey((current) => current + 1);

        toast.message("Attendance import reverted", {
          description: `${result.sourceFileName}: ${result.rawLogCount} raw log(s) and ${result.summaryCount} daily summary row(s) removed. ${result.staleRunCount} payroll run(s) marked stale.`,
        });
      },
      "Attendance import reverted."
    );
  }

  async function handleRefreshAttendanceSummaries() {
    if (!selectedPeriod) {
      toast.error("Select a payroll period first.");
      return;
    }

    await runAction(
      "refresh-attendance-summaries",
      async () => {
        const result = await refreshAttendancePeriodSummariesAction(selectedPeriod.id);
        setAttendanceDtrReloadKey((current) => current + 1);

        toast.message("Attendance summaries refreshed", {
          description: `${result.payrollPeriodCode}: ${result.summaryCount} summary row(s) rebuilt for ${result.employeeCount} employee(s). ${result.staleRunCount} payroll run(s) marked stale.`,
        });
      },
      "Attendance summaries refreshed."
    );
  }

  async function handleSeedPeriods() {
    const parsedYear = Number(yearInput);

    if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      toast.error("Enter a valid 4-digit year first.");
      return;
    }

    try {
      setActionState("seed-periods");
      const result = await seedPayrollPeriods(parsedYear);
      toast.success(`${result.length} payroll periods are ready for ${parsedYear}.`);
      replaceQueryParams({
        year: String(parsedYear),
        periodId: null,
      });
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to seed payroll periods."
      );
    } finally {
      setActionState(null);
    }
  }

  function handleOpenYear() {
    const parsedYear = Number(yearInput);

    if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      toast.error("Enter a valid 4-digit year first.");
      return;
    }

    replaceQueryParams({
      year: String(parsedYear),
      periodId: null,
    });
  }

  function getAccountCodeSelectValue(draft: PayrollExceptionDraft) {
    return (
      draft.accountCodeId ||
      (draft.accountCodeSnapshot
        ? `snapshot:${draft.accountCodeSnapshot}`
        : "__none__")
    );
  }

  function handleSelectPayrollAccountCode(
    draft: PayrollExceptionDraft,
    value: string,
    accountOptions: PayrollExceptionAccountCodeOptionView[]
  ) {
    if (value === "__none__") {
      updatePayrollExceptionDraft(draft.localId, {
        accountCodeId: "",
        accountCodeSnapshot: "",
        accountTypeSnapshot: null,
        accountDescriptionSnapshot: "",
        accountMonth13thPaySnapshot: false,
        accountNonTaxableSnapshot: false,
        dayType: null,
      });
      return;
    }

    if (value.startsWith("snapshot:")) {
      updatePayrollExceptionDraft(draft.localId, {
        accountCodeId: "",
        accountCodeSnapshot: value.slice("snapshot:".length),
      });
      return;
    }

    const option = accountOptions.find(
      (candidate) => String(candidate.id) === value
    );
    const selectedAccountType = option?.accountType ?? null;
    const isAmountOnlyAccount =
      isOtherIncomeAccountType(selectedAccountType) ||
      selectedAccountType === "Loan" ||
      (selectedAccountType === "Other Deduction" &&
        !isGeneratedDtrQuantityOnlyDeductionDraft(draft));

    updatePayrollExceptionDraft(draft.localId, {
      accountCodeId: value,
      accountCodeSnapshot: option?.code ?? draft.accountCodeSnapshot,
      accountTypeSnapshot: selectedAccountType,
      accountDescriptionSnapshot: option?.description ?? "",
      accountMonth13thPaySnapshot: option?.month13thPay ?? false,
      accountNonTaxableSnapshot: option?.nonTaxable ?? false,
      dayType:
        selectedAccountType === "Sunday/Holiday"
          ? isPayrollExceptionHolidayDayType(draft.dayType)
            ? draft.dayType
            : getPayrollExceptionHolidayDayTypeForDate(draft.attendanceDate)
          : null,
      hours: isAmountOnlyAccount ? "0" : draft.hours,
      minutes: isAmountOnlyAccount ? "0" : draft.minutes,
    });
  }

  function renderScheduledLoanDeductionsTable() {
    return (
      <div className="space-y-2">
        <div>
          <h3 className="text-sm font-medium">Scheduled Loan Deductions</h3>
          <p className="text-xs text-muted-foreground">
            These rows come from the employee loan schedule and are applied on
            payroll recompute.
          </p>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payroll Code</TableHead>
                <TableHead>Account Code</TableHead>
                <TableHead>Loan Ref</TableHead>
                <TableHead>Installment</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Scheduled Deduction</TableHead>
                <TableHead>Balance After</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Save</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payrollLoanRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    No scheduled loan deductions for this employee and period.
                  </TableCell>
                </TableRow>
              ) : (
                payrollLoanRows.map((row) => {
                  const draftAmount =
                    payrollLoanDraftAmounts[row.installmentId] ??
                    formatMoneyInput(row.scheduledAmount);
                  const normalizedDraftAmount = formatMoneyInput(draftAmount);
                  const savedAmount = formatMoneyInput(row.scheduledAmount);
                  const amountIsValid =
                    isValidMoneyInput(draftAmount) && toNumber(draftAmount) > 0;
                  const amountChanged =
                    amountIsValid && normalizedDraftAmount !== savedAmount;
                  const isSaving =
                    savingPayrollLoanInstallmentId === row.installmentId;
                  const accountLabel = row.accountCode
                    ? `${row.accountCode}${
                        row.accountDescription
                          ? ` | ${row.accountDescription}`
                          : ""
                      }`
                    : "No account code";

                  return (
                    <TableRow key={row.installmentId}>
                      <TableCell className="whitespace-nowrap">
                        {row.payrollCode}
                      </TableCell>
                      <TableCell className="min-w-[190px] text-sm">
                        {accountLabel}
                        {row.accountType ? (
                          <div className="text-xs text-muted-foreground">
                            {row.accountType}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.loanReferenceNumber}
                      </TableCell>
                      <TableCell>#{row.installmentNo}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.dueDate}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={draftAmount}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            if (!isValidMoneyInput(nextValue)) return;
                            setPayrollLoanDraftAmounts((current) => ({
                              ...current,
                              [row.installmentId]: nextValue,
                            }));
                          }}
                          onBlur={() =>
                            setPayrollLoanDraftAmounts((current) => ({
                              ...current,
                              [row.installmentId]: formatMoneyInput(
                                current[row.installmentId] ??
                                  row.scheduledAmount
                              ),
                            }))
                          }
                          inputMode="decimal"
                          className="w-32 text-right"
                          disabled={!row.editable || isSaving}
                          aria-label={`Scheduled deduction for ${row.loanReferenceNumber}`}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.balanceAfter == null
                          ? "-"
                          : formatMoney(row.balanceAfter)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex rounded-md border px-2 py-1 text-xs",
                            row.editable
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
                              : "border-muted bg-muted/40 text-muted-foreground"
                          )}
                        >
                          {row.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            !row.editable ||
                            !amountChanged ||
                            !amountIsValid ||
                            isSaving ||
                            savingPayrollExceptions
                          }
                          onClick={() => handleSavePayrollLoanInstallment(row)}
                        >
                          {isSaving ? "Saving..." : "Save"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  function renderPayrollAccountCodeTable(lineTab: PayrollAccountCodeLineTab) {
    const isDeductionTab = lineTab === "deduction";
    const accountOptions = payrollExceptionAccountCodeOptions.filter(
      (option) => getPayrollAccountCodeLineTab(option.accountType) === lineTab
    );
    const drafts = payrollExceptionDrafts.filter(
      (draft) => getPayrollAccountCodeLineTab(draft.accountTypeSnapshot) === lineTab
    );
    const recurringRows = payrollRecurringRows.filter(
      (row) => getPayrollAccountCodeLineTab(row.accountTypeSnapshot) === lineTab
    );
    const hasRows = drafts.length > 0 || recurringRows.length > 0;
    const columnCount = isDeductionTab ? 7 : 9;

    return (
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account Code</TableHead>
              <TableHead>Account Type</TableHead>
              {!isDeductionTab && <TableHead>Daily Rate</TableHead>}
              {!isDeductionTab && <TableHead>Monthly Rate</TableHead>}
              <TableHead>Hours / Minutes</TableHead>
              {isDeductionTab && <TableHead>Amount</TableHead>}
              <TableHead>Computed Preview</TableHead>
              {!isDeductionTab && <TableHead>Amount</TableHead>}
              <TableHead>Remarks</TableHead>
              <TableHead className="text-right">Delete</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!hasRows ? (
              <TableRow>
                <TableCell
                  colSpan={columnCount}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  No {isDeductionTab ? "deduction" : "income"} account-code rows
                  saved.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {drafts.map((draft) => {
                  const savedRow = draft.id
                    ? payrollExceptionRowsById.get(draft.id) ?? null
                    : null;
                  const draftIsDirty = isPayrollExceptionDraftDirty(
                    draft,
                    savedRow
                  );
                  const draftError =
                    payrollExceptionDraftErrors.get(draft.localId) ?? null;
                  const selectedAccountOption = draft.accountCodeId
                    ? payrollExceptionAccountCodeOptions.find(
                        (option) => String(option.id) === draft.accountCodeId
                      ) ?? null
                    : null;
                  const isOtherIncomeAccount = isOtherIncomeAccountType(
                    draft.accountTypeSnapshot
                  );
                  const isGeneratedDtrRow = draft.dtrOverrideSource != null;
                  const generatedDtrLabel = isGeneratedDtrRow
                    ? isPayrollExceptionHeldDtrSource(draft.dtrOverrideSource)
                      ? "Held DTR generated"
                      : "DTR generated"
                    : null;
                  const isHourBasedAccount =
                    isPayrollExceptionDraftHourBased(draft);
                  const isAmountOnlyAccount =
                    isPayrollExceptionDraftAmountOnly(draft);

                  return (
                    <TableRow key={draft.localId}>
                      <TableCell>
                        <PayrollAccountCodePicker
                          value={getAccountCodeSelectValue(draft)}
                          options={accountOptions}
                          snapshotCode={
                            draft.accountCodeSnapshot && !draft.accountCodeId
                              ? draft.accountCodeSnapshot
                              : null
                          }
                          onChange={(value) =>
                            handleSelectPayrollAccountCode(
                              draft,
                              value,
                              accountOptions
                            )
                          }
                          disabled={savingPayrollExceptions || isGeneratedDtrRow}
                        />
                      </TableCell>
                      <TableCell className="min-w-[150px] text-sm">
                        <div className="flex flex-col gap-1">
                          <span>
                            {draft.accountTypeSnapshot ?? (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </span>
                          {generatedDtrLabel ? (
                            <span className="text-xs text-muted-foreground">
                              {generatedDtrLabel}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      {!isDeductionTab && (
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDecimalUpTo4(selectedAccountOption?.dailyRate)}
                        </TableCell>
                      )}
                      {!isDeductionTab && (
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDecimalUpTo4(selectedAccountOption?.monthlyRate)}
                        </TableCell>
                      )}
                      <TableCell>
                        {!isHourBasedAccount ? (
                          <span className="text-sm text-muted-foreground">-</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Input
                              value={draft.hours}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                if (!/^\d*$/.test(nextValue)) return;
                                updatePayrollExceptionDraft(draft.localId, {
                                  hours: nextValue,
                                });
                              }}
                              inputMode="numeric"
                              aria-label={`Hours for ${draft.attendanceDate}`}
                              className="w-16"
                              disabled={savingPayrollExceptions || isGeneratedDtrRow}
                            />
                            <span className="text-xs text-muted-foreground">h</span>
                            <Input
                              value={draft.minutes}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                if (!/^\d*$/.test(nextValue)) return;
                                updatePayrollExceptionDraft(draft.localId, {
                                  minutes: nextValue,
                                });
                              }}
                              inputMode="numeric"
                              aria-label={`Minutes for ${draft.attendanceDate}`}
                              className="w-16"
                              disabled={savingPayrollExceptions || isGeneratedDtrRow}
                            />
                            <span className="text-xs text-muted-foreground">m</span>
                          </div>
                        )}
                      </TableCell>
                      {isDeductionTab && (
                        <TableCell>
                          <Input
                            value={draft.amountOverride}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              if (!/^\d{0,9}(\.\d{0,2})?$/.test(nextValue)) return;
                              updatePayrollExceptionDraft(draft.localId, {
                                amountOverride: nextValue,
                                ...(isAmountOnlyAccount
                                  ? { hours: "0", minutes: "0" }
                                  : {}),
                              });
                            }}
                            inputMode="decimal"
                            aria-label={`Deduction amount for ${draft.attendanceDate}`}
                            className="w-32"
                            placeholder="0.00"
                            disabled={savingPayrollExceptions || isGeneratedDtrRow}
                          />
                        </TableCell>
                      )}
                      <TableCell className="min-w-[170px] text-sm">
                        {draftIsDirty ? (
                          <span className="text-amber-700 dark:text-amber-300">
                            Save to preview
                          </span>
                        ) : savedRow?.computedError ? (
                          <span className="text-rose-700 dark:text-rose-300">
                            {savedRow.computedError}
                          </span>
                        ) : savedRow ? (
                          <div>
                            <div>{formatMoney(savedRow.computedAmount)}</div>
                            <div className="text-xs text-muted-foreground">
                              {savedRow.computedDescription}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                        {draftError ? (
                          <div className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                            {draftError}
                          </div>
                        ) : null}
                      </TableCell>
                      {!isDeductionTab && (
                        <TableCell>
                          <Input
                            value={draft.amountOverride}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              if (!/^\d{0,9}(\.\d{0,2})?$/.test(nextValue)) return;
                              updatePayrollExceptionDraft(draft.localId, {
                                amountOverride: nextValue,
                                ...(isOtherIncomeAccount
                                  ? { hours: "0", minutes: "0" }
                                  : {}),
                              });
                            }}
                            inputMode="decimal"
                            aria-label={
                              isOtherIncomeAccount
                                ? `Other Income amount for ${
                                    draft.accountCodeSnapshot || draft.attendanceDate
                                  }`
                                : `Amount override for ${draft.attendanceDate}`
                            }
                            className="w-32"
                            placeholder="0.00"
                            disabled={savingPayrollExceptions || isGeneratedDtrRow}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <Input
                          value={draft.remarks}
                          onChange={(event) =>
                            updatePayrollExceptionDraft(draft.localId, {
                              remarks: event.target.value,
                            })
                          }
                          aria-label={`Remarks for ${draft.attendanceDate}`}
                          className="min-w-[180px]"
                          disabled={savingPayrollExceptions || isGeneratedDtrRow}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleDeletePayrollExceptionDraft(draft.localId)
                          }
                          disabled={savingPayrollExceptions || isGeneratedDtrRow}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {recurringRows.map((row) => {
                  const selectedAccountOption =
                    payrollExceptionAccountCodeOptions.find(
                      (option) => option.id === row.accountCodeId
                    ) ?? null;
                  const amountValue = formatMoneyInput(row.amount);

                  return (
                    <TableRow key={row.id} className="bg-muted/20">
                      <TableCell>
                        <PayrollAccountCodePicker
                          value={String(row.accountCodeId)}
                          options={accountOptions}
                          snapshotCode={row.accountCodeSnapshot}
                          onChange={() => undefined}
                          disabled
                        />
                      </TableCell>
                      <TableCell className="min-w-[150px] text-sm">
                        <div className="flex flex-col gap-1">
                          <span>{row.accountTypeSnapshot}</span>
                          <span className="text-xs text-muted-foreground">
                            {row.sourceLabel}
                          </span>
                        </div>
                      </TableCell>
                      {!isDeductionTab && (
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDecimalUpTo4(selectedAccountOption?.dailyRate)}
                        </TableCell>
                      )}
                      {!isDeductionTab && (
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDecimalUpTo4(selectedAccountOption?.monthlyRate)}
                        </TableCell>
                      )}
                      <TableCell>
                        <span className="text-sm text-muted-foreground">-</span>
                      </TableCell>
                      {isDeductionTab && (
                        <TableCell>
                          <Input
                            value={amountValue}
                            inputMode="decimal"
                            aria-label={`Recurring deduction amount for ${row.accountCodeSnapshot}`}
                            className="w-32"
                            disabled
                          />
                        </TableCell>
                      )}
                      <TableCell className="min-w-[170px] text-sm">
                        <div>
                          <div>{formatMoney(row.amount)}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.sourceLabel}
                          </div>
                        </div>
                      </TableCell>
                      {!isDeductionTab && (
                        <TableCell>
                          <Input
                            value={amountValue}
                            inputMode="decimal"
                            aria-label={`Recurring income amount for ${row.accountCodeSnapshot}`}
                            className="w-32"
                            disabled
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <Input
                          value={row.sourceRemark}
                          aria-label={`Recurring entry source for ${row.accountCodeSnapshot}`}
                          className="min-w-[180px]"
                          disabled
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-sm text-muted-foreground">-</span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </>
            )}
          </TableBody>
        </Table>
      </div>
    );
  }

  function renderManualMoneyInput(args: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    ariaLabel: string;
    className?: string;
  }) {
    return (
      <Input
        value={args.value}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (!isValidMoneyInput(nextValue)) return;
          args.onChange(nextValue);
        }}
        inputMode="decimal"
        aria-label={args.ariaLabel}
        className={cn("text-right", args.className)}
        disabled={args.disabled}
      />
    );
  }

  function renderManualSummaryInput(bucket: ManualPayrollLineSummaryBucket) {
    const config = MANUAL_PAYROLL_SUMMARY_BUCKET_CONFIG.get(bucket)!;
    const value = formatMoneyInput(
      getManualPayrollLineBucketTotal(manualPayrollDraft.lines, bucket)
    );

    return (
      <div className="grid grid-cols-[minmax(0,1fr)_130px] items-center gap-3">
        <label className="text-sm text-muted-foreground">{config.label}</label>
        {renderManualMoneyInput({
          value,
          onChange: (nextValue) =>
            handleManualPayrollSummaryAmountChange(bucket, nextValue),
          disabled:
            !manualPayrollWorkspace?.canEdit ||
            savingManualPayroll ||
            refreshingManualPayroll,
          ariaLabel: `Manual payroll ${config.label}`,
        })}
      </div>
    );
  }

  function renderManualContributionRow(args: {
    label: string;
    employeeField: keyof Pick<
      ManualPayrollDraft,
      | "sssEmployee"
      | "philhealthEmployee"
      | "pagibigEmployee"
      | "withholdingTax"
      | "peraaEmployee"
    >;
    employerField?: keyof Pick<
      ManualPayrollDraft,
      "sssEmployer" | "philhealthEmployer" | "pagibigEmployer" | "peraaEmployer"
    >;
    ecField?: keyof Pick<ManualPayrollDraft, "sssEc">;
    basisField: keyof Pick<
      ManualPayrollDraft,
      | "sssBasis"
      | "philhealthBasis"
      | "pagibigBasis"
      | "withholdingTaxBasis"
      | "peraaBasis"
    >;
  }) {
    const disabled =
      !manualPayrollWorkspace?.canEdit ||
      savingManualPayroll ||
      refreshingManualPayroll;

    return (
      <div className="grid gap-2 md:grid-cols-[110px_1fr_1fr_1fr_1fr] md:items-center">
        <div className="text-sm text-muted-foreground">{args.label}</div>
        {renderManualMoneyInput({
          value: manualPayrollDraft[args.employeeField],
          onChange: (value) =>
            updateManualPayrollDraft({ [args.employeeField]: value }),
          disabled,
          ariaLabel: `${args.label} employee share`,
        })}
        {args.employerField ? (
          renderManualMoneyInput({
            value: manualPayrollDraft[args.employerField],
            onChange: (value) =>
              updateManualPayrollDraft({ [args.employerField!]: value }),
            disabled,
            ariaLabel: `${args.label} employer share`,
          })
        ) : (
          <div />
        )}
        {args.ecField ? (
          renderManualMoneyInput({
            value: manualPayrollDraft[args.ecField],
            onChange: (value) =>
              updateManualPayrollDraft({ [args.ecField!]: value }),
            disabled,
            ariaLabel: `${args.label} EC share`,
          })
        ) : (
          <div />
        )}
        {renderManualMoneyInput({
          value: manualPayrollDraft[args.basisField],
          onChange: (value) =>
            updateManualPayrollDraft({ [args.basisField]: value }),
          disabled,
          ariaLabel: `${args.label} basis of computation`,
        })}
      </div>
    );
  }

  function renderManualPayrollDetailsTable() {
    const disabled =
      !manualPayrollWorkspace?.canEdit ||
      savingManualPayroll ||
      refreshingManualPayroll;

    return (
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Loan Ref No.</TableHead>
              <TableHead>No of Hours(mins)</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="text-right">Delete</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {manualPayrollDraft.lines.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No manual payroll detail rows yet.
                </TableCell>
              </TableRow>
            ) : (
              sortManualPayrollDraftLines(manualPayrollDraft.lines).map((line) => {
                const account =
                  line.accountCodeId != null
                    ? manualPayrollAccountCodeOptions.find(
                        (option) => option.id === line.accountCodeId
                      ) ?? null
                    : null;
                const isLoanAccount = account?.accountType === "Loan";

                return (
                  <TableRow key={line.localId}>
                  <TableCell>
                    {line.isSystem ? (
                      <Input
                        value={line.code}
                        onChange={(event) =>
                          updateManualPayrollLine(line.localId, {
                            code: event.target.value,
                          })
                        }
                        className="min-w-[110px]"
                        disabled={disabled}
                      />
                    ) : (
                      <ManualPayrollAccountCodePicker
                        value={
                          line.accountCodeId != null
                            ? String(line.accountCodeId)
                            : "__snapshot__"
                        }
                        options={manualPayrollAccountCodeOptions}
                        snapshotCode={line.accountCodeId == null ? line.code : null}
                        snapshotDescription={
                          line.accountCodeId == null ? line.description : null
                        }
                        onChange={(value) =>
                          handleSelectManualPayrollAccountCode(line.localId, value)
                        }
                        disabled={disabled}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={line.description}
                      onChange={(event) =>
                        updateManualPayrollLine(line.localId, {
                          description: event.target.value,
                        })
                      }
                      className="min-w-[240px]"
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={isLoanAccount ? line.loanRefNo ?? "" : ""}
                      onChange={(event) =>
                        updateManualPayrollLine(line.localId, {
                          loanRefNo: event.target.value,
                        })
                      }
                      className="min-w-[130px]"
                      disabled={disabled || !isLoanAccount}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-[150px] items-center gap-2">
                      <Input
                        value={String(line.hours)}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (!/^\d{0,3}$/.test(value)) return;
                          updateManualPayrollLine(line.localId, {
                            hours: Number(value || 0),
                          });
                        }}
                        inputMode="numeric"
                        className="w-16 text-right"
                        disabled={disabled}
                      />
                      <Input
                        value={String(line.minutes)}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (!/^\d{0,2}$/.test(value)) return;
                          updateManualPayrollLine(line.localId, {
                            minutes: Math.min(59, Number(value || 0)),
                          });
                        }}
                        inputMode="numeric"
                        className="w-16 text-right"
                        disabled={disabled}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    {renderManualMoneyInput({
                      value: line.amount,
                      onChange: (value) =>
                        updateManualPayrollLine(line.localId, { amount: value }),
                      disabled,
                      ariaLabel: `Manual payroll amount for ${line.code}`,
                      className: "min-w-[130px]",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteManualPayrollLine(line.localId)}
                      disabled={disabled}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    );
  }

  const canReview = selectedRun?.status === "Draft";
  const canApprove = selectedRun?.status === "Reviewed";
  const canPost = selectedRun?.status === "Approved";
  const canVoid =
    selectedRun != null &&
    selectedRun.status !== "Posted" &&
    selectedRun.status !== "Void";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Payroll Workspace</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            This is the first operational UI for the new payroll engine. Use it to
            seed semi-monthly periods, import employee time logs, compute a payroll
            run, review employee line items, and then approve or post the run.
          </p>
        </div>

        <Card className="w-full max-w-md">
          <CardHeader className="pb-3">
            <CardTitle>Year Setup</CardTitle>
            <CardDescription>
              Period seeding also initializes the payroll foundation data for this
              module.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="min-w-28 flex-1">
              <label className="mb-2 block text-sm font-medium">Payroll Year</label>
              <Input
                value={yearInput}
                onChange={(event) => setYearInput(event.target.value)}
                inputMode="numeric"
                placeholder="2026"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenYear}
              disabled={isNavigating || actionState !== null}
            >
              Open Year
            </Button>
            <Button
              type="button"
              onClick={handleSeedPeriods}
              disabled={isNavigating || actionState !== null}
            >
              {actionState === "seed-periods" ? "Seeding..." : "Seed Periods"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Workflow</CardTitle>
          <CardDescription>
            The payroll lifecycle now follows stored transactions instead of
            recalculating everything only in forms.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          {[
            "1. Seed or refresh the semi-monthly payroll periods for the year.",
            "2. Import every branch CSV or TXT attendance file for the payroll period using numeric UID matching.",
            "3. Compute the payroll run so earnings, deductions, loans, and taxes are snapshotted.",
            "4. Review employee totals and detailed payroll lines before approval.",
            "5. Approve and post the run to finalize loan payments and reporting totals.",
          ].map((step) => (
            <div
              key={step}
              className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground"
            >
              {step}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1.9fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Payroll Periods</CardTitle>
            <CardDescription>
              A covers days 1-15 and B covers days 16-end of month.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-6 pb-6">
            <Input
              value={periodSearch}
              onChange={(event) => setPeriodSearch(event.target.value)}
              placeholder="Search payroll periods..."
              aria-label="Search payroll periods"
            />
            <div className="max-h-[380px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Coverage</TableHead>
                    <TableHead>Pay Date</TableHead>
                    <TableHead>Run</TableHead>
                    <TableHead>Imports</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPeriods.map((period) => (
                    <TableRow
                      key={period.id}
                      className={cn(
                        "cursor-pointer",
                        period.id === selectedPeriodId && "bg-muted/60"
                      )}
                      onClick={() =>
                        replaceQueryParams({
                          year: String(initialYear),
                          periodId: period.id,
                        })
                      }
                    >
                      <TableCell className="font-medium">{period.code}</TableCell>
                      <TableCell>
                        <div>{period.startDate}</div>
                        <div className="text-xs text-muted-foreground">
                          to {period.endDate}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{period.adjustedPayDate}</div>
                        <div className="text-xs text-muted-foreground">
                          Nominal: {period.nominalPayDate}
                        </div>
                      </TableCell>
                      <TableCell>
                        {period.latestRun ? (
                          <div className="space-y-1">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                                getToneClass(period.latestRun.status)
                              )}
                            >
                              {period.latestRun.status}
                            </span>
                            <div className="text-xs text-muted-foreground">
                              Run #{period.latestRun.runNumber}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            Not computed
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{period.attendanceBatchCount}</TableCell>
                    </TableRow>
                  ))}
                  {periods.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-10 text-center text-muted-foreground"
                      >
                        No payroll periods yet for {initialYear}. Seed the year to
                        start the payroll workflow.
                      </TableCell>
                    </TableRow>
                  )}
                  {periods.length > 0 && filteredPeriods.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-10 text-center text-muted-foreground"
                      >
                        No matching payroll periods found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Selected Payroll Period</CardTitle>
            <CardDescription>
              Actions here operate on the currently selected period only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedPeriod ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Period Code
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {selectedPeriod.code}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {selectedPeriod.payrollTerms}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Coverage
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {selectedPeriod.startDate}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      to {selectedPeriod.endDate}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Adjusted Pay Date
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {selectedPeriod.adjustedPayDate}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Nominal: {selectedPeriod.nominalPayDate}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Current Run
                    </div>
                    <div className="mt-1">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                          getToneClass(selectedRun?.status ?? selectedPeriod.status)
                        )}
                      >
                        {selectedRun?.status ?? "Not computed"}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {selectedRun ? `Run #${selectedRun.runNumber}` : "No run yet"}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() =>
                      runAction(
                        "compute-run",
                        () => computePayrollRun(selectedPeriod.id),
                        selectedRun
                          ? "Payroll run refreshed."
                          : "Payroll run computed."
                      )
                    }
                    disabled={actionState !== null || isNavigating}
                  >
                    {actionState === "compute-run"
                      ? "Computing..."
                      : selectedRun &&
                          (selectedRun.status === "Posted" ||
                            selectedRun.status === "Void")
                        ? "Create New Draft Run"
                        : "Compute / Recompute Run"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      selectedRun &&
                      runAction(
                        "review-run",
                        () => reviewPayrollRun(selectedRun.id),
                        "Payroll run marked as reviewed."
                      )
                    }
                    disabled={!canReview || actionState !== null || isNavigating}
                  >
                    {actionState === "review-run" ? "Reviewing..." : "Review"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      selectedRun &&
                      runAction(
                        "approve-run",
                        () => approvePayrollRun(selectedRun.id),
                        "Payroll run approved."
                      )
                    }
                    disabled={!canApprove || actionState !== null || isNavigating}
                  >
                    {actionState === "approve-run" ? "Approving..." : "Approve"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      selectedRun &&
                      runAction(
                        "post-run",
                        () => postPayrollRun(selectedRun.id),
                        "Payroll run posted and loan payments finalized."
                      )
                    }
                    disabled={!canPost || actionState !== null || isNavigating}
                  >
                    {actionState === "post-run" ? "Posting..." : "Post"}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      if (!selectedRun) return;
                      const reason = window.prompt("Enter the void reason.");
                      if (reason == null) return;

                      void runAction(
                        "void-run",
                        () => voidPayrollRun(selectedRun.id, reason),
                        "Payroll run voided."
                      );
                    }}
                    disabled={!canVoid || actionState !== null || isNavigating}
                  >
                    {actionState === "void-run" ? "Voiding..." : "Void"}
                  </Button>
                </div>

                <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                  Review moves the run into checking status, approve signals that
                  the values are final, and post is the step that writes loan
                  payments and makes the run operationally final.
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Select or seed a payroll year first to start using the payroll
                workspace.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as WorkspaceTab)}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="run">Payroll Run</TabsTrigger>
          <TabsTrigger value="manual">Manual Payroll</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="attendance">Attendance Imports</TabsTrigger>
          <TabsTrigger value="attendanceHold" className="gap-1.5">
            Attendance Hold
            {attendanceHoldUnapprovedRowCount > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                {attendanceHoldUnapprovedRowCount}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="accountCodes">Payroll Account Code</TabsTrigger>
        </TabsList>

        <TabsContent value="run" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-5">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Employees</CardDescription>
                <CardTitle>{runEmployees.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Gross Pay</CardDescription>
                <CardTitle>{formatMoney(runSummary.grossPay)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Deductions</CardDescription>
                <CardTitle>{formatMoney(runSummary.totalDeductions)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Net Pay</CardDescription>
                <CardTitle>{formatMoney(runSummary.netPay)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Employer Share</CardDescription>
                <CardTitle>{formatMoney(runSummary.employerContributions)}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Employee Payroll Snapshot</CardTitle>
                <CardDescription>
                  Each row is stored in payroll_run_employees, with detailed line
                  items in payroll_run_lines.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-6 pb-6">
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_260px]">
                  <Input
                    value={employeeSnapshotSearch}
                    onChange={(event) =>
                      setEmployeeSnapshotSearch(event.target.value)
                    }
                    placeholder="Search employee name or No..."
                    aria-label="Search employee payroll snapshots"
                  />
                  <DepartmentFilterDropdown
                    value={employeeSnapshotDepartmentFilter}
                    onChange={setEmployeeSnapshotDepartmentFilter}
                    options={runDepartmentOptions}
                    ariaLabel="Filter employee payroll snapshots by department"
                  />
                </div>
                <div className="max-h-[380px] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee No</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Employee</TableHead>
                        <TableHead>Basis</TableHead>
                        <TableHead>Gross</TableHead>
                        <TableHead>Deductions</TableHead>
                        <TableHead>Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRunEmployees.map((employee) => (
                        <TableRow
                          key={employee.id}
                          className={cn(
                            "cursor-pointer",
                            employee.employeeId === selectedEmployee?.employeeId &&
                              "bg-muted/60"
                          )}
                          onClick={() => setSelectedEmployeeId(employee.employeeId)}
                        >
                          <TableCell>
                            {formatEmployeeNoDisplay(employee.employeeNoSnapshot)}
                          </TableCell>
                          <TableCell>
                            {getEmployeeTypeDisplay({
                              employeeNo: employee.employeeNoSnapshot,
                            }) || "-"}
                          </TableCell>
                          <TableCell className="font-medium">
                            {employee.employeeNameSnapshot}
                          </TableCell>
                          <TableCell>
                            {renderPayComputationModeBadge(
                              employee.payComputationMode,
                              employee.isManualPayrollOverride
                            )}
                          </TableCell>
                          <TableCell>{formatMoney(employee.grossPay)}</TableCell>
                          <TableCell>{formatMoney(employee.totalDeductions)}</TableCell>
                          <TableCell className="font-semibold">
                            {formatMoney(employee.netPay)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {runEmployees.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="py-10 text-center text-muted-foreground"
                          >
                            Compute a payroll run for the selected period to view
                            employee payroll snapshots here.
                          </TableCell>
                        </TableRow>
                      )}
                      {runEmployees.length > 0 &&
                        filteredRunEmployees.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="py-10 text-center text-muted-foreground"
                            >
                              No matching employees found.
                            </TableCell>
                          </TableRow>
                        )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Agency And Tax Summary</CardTitle>
                <CardDescription>
                  These totals are derived from stored payroll line items.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground">SSS Employee</div>
                    <div className="mt-1 font-semibold">
                      {formatMoney(agencySummary.sssEmployee)}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground">SSS Employer</div>
                    <div className="mt-1 font-semibold">
                      {formatMoney(agencySummary.sssEmployer)}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground">SSS EC</div>
                    <div className="mt-1 font-semibold">
                      {formatMoney(agencySummary.sssEc)}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground">PhilHealth Employee</div>
                    <div className="mt-1 font-semibold">
                      {formatMoney(agencySummary.philhealthEmployee)}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground">PhilHealth Employer</div>
                    <div className="mt-1 font-semibold">
                      {formatMoney(agencySummary.philhealthEmployer)}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground">Pag-IBIG Employee</div>
                    <div className="mt-1 font-semibold">
                      {formatMoney(agencySummary.pagibigEmployee)}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground">Pag-IBIG Employer</div>
                    <div className="mt-1 font-semibold">
                      {formatMoney(agencySummary.pagibigEmployer)}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-muted-foreground">Withholding Tax</div>
                    <div className="mt-1 font-semibold">
                      {formatMoney(agencySummary.withholdingTax)}
                    </div>
                  </div>
                </div>

                {selectedRun && (
                  <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                    Run #{selectedRun.runNumber} created {formatDateTime(selectedRun.createdAt)}
                    {selectedRun.computedAt
                      ? ` and last computed ${formatDateTime(selectedRun.computedAt)}.`
                      : "."}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Employee Line Details</CardTitle>
              <CardDescription>
                Click an employee above to inspect the exact earning and deduction
                lines that were posted into the run. Paid and unpaid leave now
                appear explicitly in the breakdown, and the daily OT approval
                grid below controls what will be used on the next recompute.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedEmployee ? (
                <>
                  <div className="grid gap-3 md:grid-cols-5">
                    <div className="rounded-lg border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Employee
                      </div>
                      <div className="mt-1 font-semibold">
                        {selectedEmployee.employeeNameSnapshot}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatEmployeeNoDisplay(
                          selectedEmployee.employeeNoSnapshot
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Computation Basis
                      </div>
                      <div className="mt-2">
                        {renderPayComputationModeBadge(
                          selectedEmployee.payComputationMode,
                          selectedEmployee.isManualPayrollOverride
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Taxable Pay
                      </div>
                      <div className="mt-1 font-semibold">
                        {formatMoney(selectedEmployee.taxablePay)}
                      </div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Employee Share
                      </div>
                      <div className="mt-1 font-semibold">
                        {formatMoney(selectedEmployee.employeeContributions)}
                      </div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Net Pay
                      </div>
                      <div className="mt-1 font-semibold">
                        {formatMoney(selectedEmployee.netPay)}
                      </div>
                    </div>
                  </div>

                  {selectedRun?.status === "Stale" && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                      This payroll run is marked <span className="font-semibold">Stale</span>.
                      Leave, attendance, schedule, or OT approval changes were made
                      after this run was computed, so the line items below may be
                      outdated until you recompute the payroll run.
                    </div>
                  )}

                  {selectedEmployee.breakdownNotes && (
                    <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                      {selectedEmployee.breakdownNotes}
                    </div>
                  )}

                  {renderStatutoryAuditCards(selectedEmployee)}

                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Code</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Qty</TableHead>
                          <TableHead>Rate</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedEmployeeLineDisplayRows.map((row) => {
                          if (row.kind === "separator") {
                            return (
                              <TableRow key={row.id}>
                                <TableCell
                                  colSpan={7}
                                  className="bg-muted/40 py-2 text-xs font-semibold uppercase text-muted-foreground"
                                >
                                  {row.label}
                                </TableCell>
                              </TableRow>
                            );
                          }

                          const line = row.line;

                          return (
                            <TableRow key={line.id}>
                              <TableCell>{line.lineType}</TableCell>
                              <TableCell className="font-medium">{line.code}</TableCell>
                              <TableCell>
                                <div>{line.description}</div>
                                <div className="text-xs text-muted-foreground">
                                  {line.taxable ? "Taxable" : "Non-taxable"}
                                  {line.month13thEligible ? " | 13th-month eligible" : ""}
                                </div>
                              </TableCell>
                              <TableCell>{formatPayrollLineQuantity(line)}</TableCell>
                              <TableCell>{line.rate ?? "-"}</TableCell>
                              <TableCell>{formatMoney(line.amount)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {line.sourceTable ?? "-"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {selectedEmployee.lines.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={7}
                              className="py-8 text-center text-sm text-muted-foreground"
                            >
                              {selectedEmployeeDetailStatus === "loading"
                                ? "Loading employee line details..."
                                : selectedEmployeeDetailStatus === "error"
                                  ? "Unable to load employee line details."
                                  : "No payroll line details found for this employee."}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No employee line items yet for this payroll period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Manual Payroll</CardTitle>
              <CardDescription>
                Save a full employee-period payroll override. Recompute the selected
                period when you are ready to apply saved overrides to reports.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedPeriod ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Select a payroll period first to open Manual Payroll.
                </div>
              ) : sortedPayrollAccountCodeEmployees.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No active employees are available for Manual Payroll.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
                      <div>
                        <label className="mb-2 block text-sm font-medium">
                          Employee
                        </label>
                        <PayrollAccountCodeEmployeePicker
                          value={selectedManualPayrollEmployee?.employeeId ?? ""}
                          onChange={setSelectedManualPayrollEmployeeId}
                          employees={filteredManualPayrollEmployees}
                          disabled={
                            filteredManualPayrollEmployees.length === 0 ||
                            savingManualPayroll ||
                            refreshingManualPayroll
                          }
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium">
                          Department
                        </label>
                        <DepartmentFilterDropdown
                          value={manualPayrollDepartmentFilter}
                          onChange={setManualPayrollDepartmentFilter}
                          options={manualPayrollDepartmentOptions}
                          ariaLabel="Filter manual payroll employees by department"
                        />
                      </div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                      Saved overrides are durable and replace this employee during
                      the next recompute. Editing is available only while the latest
                      run is Draft or Stale.
                    </div>
                  </div>

                  {manualPayrollState.status === "loading" ? (
                    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                      Loading manual payroll entry...
                    </div>
                  ) : manualPayrollState.status === "error" ? (
                    <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                      {manualPayrollState.error ?? "Unable to load manual payroll."}
                    </div>
                  ) : manualPayrollWorkspace ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-4">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Employee No
                          </div>
                          <div className="mt-1 font-semibold">
                            {formatEmployeeNoDisplay(
                              manualPayrollWorkspace.employee.employeeNo
                            )}
                          </div>
                        </div>
                        <div className="md:col-span-2">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Employee Name
                          </div>
                          <div className="mt-1 font-semibold">
                            {manualPayrollWorkspace.employee.employeeName}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Source
                          </div>
                          <div className="mt-1 font-semibold capitalize">
                            {manualPayrollWorkspace.source}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Payroll Period
                          </div>
                          <div className="mt-1 font-semibold">
                            {manualPayrollWorkspace.payrollPeriod.code}
                          </div>
                        </div>
                        <div className="md:col-span-2">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Period Covered
                          </div>
                          <div className="mt-1 font-semibold">
                            {manualPayrollWorkspace.payrollPeriod.startDate} to{" "}
                            {manualPayrollWorkspace.payrollPeriod.endDate}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Latest Run
                          </div>
                          <div className="mt-1 font-semibold">
                            {manualPayrollWorkspace.latestRunStatus ?? "No run yet"}
                          </div>
                        </div>
                      </div>

                      {manualPayrollWorkspace.editBlockReason ? (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                          {manualPayrollWorkspace.editBlockReason}
                        </div>
                      ) : null}

                      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.55fr]">
                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle>Summary</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {renderManualSummaryInput("basicPay")}
                            {renderManualSummaryInput("otPaidLeaves")}
                            {renderManualSummaryInput("otherIncome")}
                            {renderManualSummaryInput("month13th")}
                            {renderManualSummaryInput("nonTaxable")}
                            {renderManualSummaryInput("deminimis")}
                            <div className="border-t pt-3">
                              <div className="grid grid-cols-[minmax(0,1fr)_130px] items-center gap-3">
                                <div className="text-sm text-muted-foreground">
                                  Gross Income
                                </div>
                                <div className="text-right font-semibold">
                                  {formatMoney(manualPayrollTotals.grossIncome)}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  Total Deductions
                                </div>
                                <div className="text-right font-semibold">
                                  {formatMoney(manualPayrollTotals.totalDeductions)}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  Net Pay
                                </div>
                                <div className="text-right text-lg font-semibold">
                                  {formatMoney(manualPayrollTotals.netPay)}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader className="pb-3">
                            <CardTitle>Deductions</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="hidden grid-cols-[110px_1fr_1fr_1fr_1fr] gap-2 text-xs uppercase tracking-wide text-muted-foreground md:grid">
                              <div />
                              <div className="text-right">Employee</div>
                              <div className="text-right">Employer</div>
                              <div className="text-right">EC</div>
                              <div className="text-right">Basis</div>
                            </div>
                            {renderManualContributionRow({
                              label: "SSS",
                              employeeField: "sssEmployee",
                              employerField: "sssEmployer",
                              ecField: "sssEc",
                              basisField: "sssBasis",
                            })}
                            {renderManualContributionRow({
                              label: "PhilHealth",
                              employeeField: "philhealthEmployee",
                              employerField: "philhealthEmployer",
                              basisField: "philhealthBasis",
                            })}
                            {renderManualContributionRow({
                              label: "Pag-IBIG",
                              employeeField: "pagibigEmployee",
                              employerField: "pagibigEmployer",
                              basisField: "pagibigBasis",
                            })}
                            {renderManualContributionRow({
                              label: "W/Tax",
                              employeeField: "withholdingTax",
                              basisField: "withholdingTaxBasis",
                            })}
                            {renderManualContributionRow({
                              label: "PERAA",
                              employeeField: "peraaEmployee",
                              employerField: "peraaEmployer",
                              basisField: "peraaBasis",
                            })}
                            <div className="border-t pt-3">
                              {renderManualSummaryInput("otherDeductions")}
                            </div>
                          </CardContent>
                        </Card>
                      </div>

                      <Card>
                        <CardHeader className="flex flex-col gap-3 pb-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <CardTitle>Details</CardTitle>
                            <CardDescription>
                              Rows drive the summary and other deduction amounts.
                            </CardDescription>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleAddManualPayrollLine}
                            disabled={
                              !manualPayrollWorkspace.canEdit ||
                              savingManualPayroll ||
                              refreshingManualPayroll ||
                              manualPayrollAccountCodeOptions.length === 0
                            }
                          >
                            Add Row
                          </Button>
                        </CardHeader>
                        <CardContent>{renderManualPayrollDetailsTable()}</CardContent>
                      </Card>

                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <div>
                          <label className="mb-2 block text-sm font-medium">
                            Remarks
                          </label>
                          <Input
                            value={manualPayrollDraft.remarks}
                            onChange={(event) =>
                              updateManualPayrollDraft({
                                remarks: event.target.value,
                              })
                            }
                            disabled={
                              !manualPayrollWorkspace.canEdit ||
                              savingManualPayroll ||
                              refreshingManualPayroll
                            }
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              void refreshManualPayrollWorkspace({
                                showSuccess: true,
                              })
                            }
                            disabled={
                              !manualPayrollWorkspace.canEdit ||
                              savingManualPayroll ||
                              refreshingManualPayroll
                            }
                          >
                            <RefreshCw
                              className={cn(
                                "mr-2 h-4 w-4",
                                refreshingManualPayroll && "animate-spin"
                              )}
                              aria-hidden="true"
                            />
                            {refreshingManualPayroll ? "Refreshing..." : "Refresh"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleDiscardManualPayrollDraft}
                            disabled={
                              !manualPayrollDraftDirty ||
                              savingManualPayroll ||
                              refreshingManualPayroll
                            }
                          >
                            Undo Changes
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleDeleteManualPayrollDraft}
                            disabled={
                              !manualPayrollWorkspace.entryId ||
                              !manualPayrollWorkspace.canEdit ||
                              savingManualPayroll ||
                              refreshingManualPayroll
                            }
                          >
                            Delete Override
                          </Button>
                          <Button
                            type="button"
                            onClick={handleSaveManualPayrollDraft}
                            disabled={
                              !manualPayrollWorkspace.canEdit ||
                              savingManualPayroll ||
                              refreshingManualPayroll ||
                              !manualPayrollDraftDirty
                            }
                          >
                            {savingManualPayroll ? "Saving..." : "Save Override"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                      Select an employee to open a Manual Payroll draft.
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          {!selectedRun ? (
            <Card>
              <CardContent className="py-10">
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Compute a payroll run for the selected period to load payroll
                  register, payslip, agency summary, and loan deduction reports.
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>Selected Run Reports</CardTitle>
                  <CardDescription>
                    These sections are loaded from the payroll report actions for
                    the currently selected run.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded-lg border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Run
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        #{selectedRun.runNumber}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {selectedRun.payrollPeriod?.code ?? selectedPeriod?.code ?? "-"}
                      </div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Status
                      </div>
                      <div className="mt-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                            getToneClass(selectedRun.status)
                          )}
                        >
                          {selectedRun.status}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Adjusted Pay Date
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {selectedRun.payrollPeriod?.adjustedPayDate ?? "-"}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Created {formatDateTime(selectedRun.createdAt)}
                      </div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Payslip Employee
                      </div>
                      <div className="mt-2">
                        {runEmployees.length > 0 ? (
                          <Select
                            value={
                              selectedEmployee?.employeeId ??
                              runEmployees[0]?.employeeId
                            }
                            onValueChange={setSelectedEmployeeId}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select employee" />
                            </SelectTrigger>
                            <SelectContent>
                              {runEmployees.map((employee) => (
                                <SelectItem
                                  key={employee.employeeId}
                                  value={employee.employeeId}
                                >
                                  {formatEmployeePickerLabel({
                                    employeeNo: employee.employeeNoSnapshot,
                                    fallbackName: employee.employeeNameSnapshot,
                                  })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="text-sm text-muted-foreground">
                            No employees available in this run.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                    Opening this tab loads the selected-run reports without
                    changing the payroll workflow. Changing the employee selector
                    refreshes only the payslip section below.
                  </div>
                </CardContent>
              </Card>

              {reportState.status === "loading" && (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    Loading payroll register, agency summary, and loan deduction
                    report data...
                  </CardContent>
                </Card>
              )}

              {reportState.status === "error" && (
                <Card>
                  <CardContent className="py-10">
                    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                      {reportState.error ?? "Unable to load payroll reports."}
                    </div>
                  </CardContent>
                </Card>
              )}

              {reportState.status === "ready" && reportState.register && (
                <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle>Payroll Register</CardTitle>
                      <CardDescription>
                        Employee-level totals loaded from the payroll register
                        report for this run.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 p-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Employee No</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Employee</TableHead>
                              <TableHead>Basis</TableHead>
                              <TableHead>Gross</TableHead>
                              <TableHead>Deductions</TableHead>
                              <TableHead>Net</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {reportState.register.employees.map((employee) => (
                              <TableRow
                                key={employee.id}
                                className={cn(
                                  "cursor-pointer",
                                  employee.employeeId === selectedEmployee?.employeeId &&
                                    "bg-muted/60"
                                )}
                                onClick={() => setSelectedEmployeeId(employee.employeeId)}
                              >
                                <TableCell>
                                  {formatEmployeeNoDisplay(
                                    employee.employeeNoSnapshot
                                  )}
                                </TableCell>
                                <TableCell>
                                  {getEmployeeTypeDisplay({
                                    employeeNo: employee.employeeNoSnapshot,
                                  }) || "-"}
                                </TableCell>
                                <TableCell className="font-medium">
                                  {employee.employeeNameSnapshot}
                                </TableCell>
                                <TableCell>
                                  {renderPayComputationModeBadge(
                                    employee.payComputationMode,
                                    employee.isManualPayrollOverride
                                  )}
                                </TableCell>
                                <TableCell>{formatMoney(employee.grossPay)}</TableCell>
                                <TableCell>
                                  {formatMoney(employee.totalDeductions)}
                                </TableCell>
                                <TableCell className="font-semibold">
                                  {formatMoney(employee.netPay)}
                                </TableCell>
                              </TableRow>
                            ))}
                            {reportState.register.employees.length === 0 && (
                              <TableRow>
                                <TableCell
                                  colSpan={7}
                                  className="py-10 text-center text-muted-foreground"
                                >
                                  This payroll register does not contain any employee
                                  rows.
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>

                      <div className="px-6 pb-6 text-xs text-muted-foreground">
                        Run #{reportState.register.runNumber} created{" "}
                        {formatDateTime(reportState.register.createdAt)}
                        {reportState.register.computedAt
                          ? ` and last computed ${formatDateTime(
                              reportState.register.computedAt
                            )}.`
                          : "."}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle>Agency Summary</CardTitle>
                      <CardDescription>
                        Government contribution and withholding totals loaded from
                        the agency summary report.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg border p-3">
                          <div className="text-muted-foreground">SSS Employee</div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(reportAgencySummary.sssEmployee)}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-muted-foreground">SSS Employer</div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(reportAgencySummary.sssEmployer)}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-muted-foreground">SSS EC</div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(reportAgencySummary.sssEc)}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-muted-foreground">
                            PhilHealth Employee
                          </div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(reportAgencySummary.philhealthEmployee)}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-muted-foreground">
                            PhilHealth Employer
                          </div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(reportAgencySummary.philhealthEmployer)}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-muted-foreground">Pag-IBIG Employee</div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(reportAgencySummary.pagibigEmployee)}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-muted-foreground">Pag-IBIG Employer</div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(reportAgencySummary.pagibigEmployer)}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-muted-foreground">Withholding Tax</div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(reportAgencySummary.withholdingTax)}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {reportState.status === "ready" && !reportState.register && (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    The selected payroll run did not return a payroll register.
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>Employee Payslip</CardTitle>
                  <CardDescription>
                    Detailed line items loaded for the currently selected employee
                    only.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {runEmployees.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                      No employees are available in the selected payroll run.
                    </div>
                  ) : payslipState.status === "loading" ? (
                    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                      Loading payslip for {selectedEmployee?.employeeNameSnapshot ?? "the selected employee"}...
                    </div>
                  ) : payslipState.status === "error" ? (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                      {payslipState.error ?? "Unable to load the employee payslip."}
                    </div>
                  ) : payslipState.payslip ? (
                    <>
                      <div className="grid gap-3 md:grid-cols-5">
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Employee
                          </div>
                          <div className="mt-1 font-semibold">
                            {payslipState.payslip.employeeNameSnapshot}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatEmployeeNoDisplay(
                              payslipState.payslip.employeeNoSnapshot
                            )}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Computation Basis
                          </div>
                          <div className="mt-2">
                            {renderPayComputationModeBadge(
                              payslipState.payslip.payComputationMode,
                              payslipState.payslip.isManualPayrollOverride
                            )}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Period Code
                          </div>
                          <div className="mt-1 font-semibold">
                            {payslipState.payslip.payrollRun?.payrollPeriod?.code ?? "-"}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {payslipState.payslip.payrollRun?.payrollPeriod?.startDate ?? "-"} to{" "}
                            {payslipState.payslip.payrollRun?.payrollPeriod?.endDate ?? "-"}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Adjusted Pay Date
                          </div>
                          <div className="mt-1 font-semibold">
                            {payslipState.payslip.payrollRun?.payrollPeriod?.adjustedPayDate ?? "-"}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Run #{payslipState.payslip.payrollRun?.runNumber ?? "-"}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Run Status
                          </div>
                          <div className="mt-2">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                                getToneClass(payslipState.payslip.payrollRun?.status)
                              )}
                            >
                              {payslipState.payslip.payrollRun?.status ?? "-"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-5">
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Gross Pay
                          </div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(payslipState.payslip.grossPay)}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Taxable Pay
                          </div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(payslipState.payslip.taxablePay)}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Deductions
                          </div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(payslipState.payslip.totalDeductions)}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Employee Share
                          </div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(payslipState.payslip.employeeContributions)}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Net Pay
                          </div>
                          <div className="mt-1 font-semibold">
                            {formatMoney(payslipState.payslip.netPay)}
                          </div>
                        </div>
                      </div>

                      {payslipState.payslip.breakdownNotes && (
                        <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                          {payslipState.payslip.breakdownNotes}
                        </div>
                      )}

                      {renderStatutoryAuditCards(payslipState.payslip)}

                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Type</TableHead>
                              <TableHead>Code</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead>Qty</TableHead>
                              <TableHead>Rate</TableHead>
                              <TableHead>Amount</TableHead>
                              <TableHead>Source</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {payslipState.payslip.lines.map((line) => (
                              <TableRow key={line.id}>
                                <TableCell>{line.lineType}</TableCell>
                                <TableCell className="font-medium">{line.code}</TableCell>
                                <TableCell>
                                  <div>{line.description}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {line.taxable ? "Taxable" : "Non-taxable"}
                                    {line.month13thEligible
                                      ? " | 13th-month eligible"
                                      : ""}
                                  </div>
                                </TableCell>
                                <TableCell>{formatPayrollLineQuantity(line)}</TableCell>
                                <TableCell>{line.rate ?? "-"}</TableCell>
                                <TableCell>{formatMoney(line.amount)}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {line.sourceTable ?? "-"}
                                </TableCell>
                              </TableRow>
                            ))}
                            {payslipState.payslip.lines.length === 0 && (
                              <TableRow>
                                <TableCell
                                  colSpan={7}
                                  className="py-10 text-center text-muted-foreground"
                                >
                                  No payroll line items were returned for this payslip.
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                      No payslip is available for the selected employee.
                    </div>
                  )}
                </CardContent>
              </Card>

              {reportState.status === "ready" && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle>Loan Deduction Summary</CardTitle>
                    <CardDescription>
                      Loan deduction lines loaded from the selected payroll run.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Employee No</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Employee</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reportState.loanDeductions.map((row) => (
                            <TableRow key={`${row.employeeId}-${row.sourceId ?? row.description}`}>
                              <TableCell>
                                {formatEmployeeNoDisplay(row.employeeNo)}
                              </TableCell>
                              <TableCell>
                                {getEmployeeTypeDisplay({
                                  employeeNo: row.employeeNo,
                                }) || "-"}
                              </TableCell>
                              <TableCell className="font-medium">
                                {row.employeeName}
                              </TableCell>
                              <TableCell>{row.description}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {row.sourceId ?? "-"}
                              </TableCell>
                              <TableCell className="font-semibold">
                                {formatMoney(row.amount)}
                              </TableCell>
                            </TableRow>
                          ))}
                          {reportState.loanDeductions.length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={6}
                                className="py-10 text-center text-muted-foreground"
                              >
                                No loan deduction lines were posted for this payroll
                                run.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="attendanceHold" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Attendance Hold</CardTitle>
              <CardDescription>
                DTR rows on hold for the selected payroll period. Rows are
                automatically held when biometric flags{" "}
                <span className="font-medium">ODD_PUNCH_COUNT</span> or{" "}
                <span className="font-medium">MISSING_OUT</span> are detected.
                Rows can also be manually held from the Attendance Imports tab.
                Held rows contribute 0 Worked, 0 Late, 0 OT, and 0 UT, and are
                excluded from Present Days.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedPeriod ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Select a payroll period first to review held DTR rows.
                </div>
              ) : currentAttendanceDtrHeldRowsState.status === "loading" ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Loading held rows for {selectedPeriod.code}...
                </div>
              ) : currentAttendanceDtrHeldRowsState.status === "error" ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                  {currentAttendanceDtrHeldRowsState.error ?? "Unable to load held DTR rows."}
                </div>
              ) : currentAttendanceDtrHeldRowsState.status === "idle" ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Switch to this tab to load held rows.
                </div>
              ) : currentAttendanceDtrHeldRowsState.data?.rows.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No held DTR rows for {selectedPeriod.code}. Rows are placed on
                  hold when flagged with ODD_PUNCH_COUNT or MISSING_OUT (for
                  fixed-schedule employees) or when manually set to Hold.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
                    <div>
                      <label className="mb-2 block text-sm font-medium">
                        Search
                      </label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={attendanceHoldSearch}
                          onChange={(event) =>
                            setAttendanceHoldSearch(event.target.value)
                          }
                          placeholder="Search employee, no., date, or status..."
                          aria-label="Search Attendance Hold employees"
                          className="pl-8"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium">
                        Department
                      </label>
                      <DepartmentFilterDropdown
                        value={attendanceHoldDepartmentFilter}
                        onChange={setAttendanceHoldDepartmentFilter}
                        options={attendanceHoldDepartmentOptions}
                        ariaLabel="Filter Attendance Hold employees by department"
                      />
                    </div>
                  </div>
                  {filteredAttendanceHoldEmployees.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                      {departmentFilteredAttendanceHoldEmployees.length === 0
                        ? "No held employees match the selected department."
                        : "No held employees match your search."}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[320px]">Employee</TableHead>
                            <TableHead>Held Dates</TableHead>
                            <TableHead>Worked</TableHead>
                            <TableHead>Late</TableHead>
                            <TableHead>UT</TableHead>
                            <TableHead>OT</TableHead>
                            <TableHead>Rows</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredAttendanceHoldEmployees.map((employee) => {
                        const isExpanded = expandedAttendanceHoldEmployeeIds.has(
                          employee.employeeId
                        );
                        const approvalDraft =
                          attendanceHoldApprovalDrafts[employee.employeeId] ?? null;
                        const isSavingApproval =
                          savingAttendanceHoldApprovalEmployeeIds.has(
                            employee.employeeId
                          );
                        const isResettingApproval =
                          resettingAttendanceHoldApprovalEmployeeIds.has(
                            employee.employeeId
                          );
                        const isAttendanceHoldActionBusy =
                          isSavingApproval || isResettingApproval;
                        const statusClass =
                          employee.status === "Approved"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : employee.status === "Pending"
                              ? "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                            : employee.status === "Partial"
                              ? "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
                        const rowClass =
                          employee.status === "Hold"
                            ? "cursor-pointer bg-amber-50 dark:bg-amber-950/20"
                            : employee.status === "Pending"
                              ? "cursor-pointer bg-violet-50 dark:bg-violet-950/20"
                            : employee.status === "Partial"
                              ? "cursor-pointer bg-sky-50 dark:bg-sky-950/20"
                              : "cursor-pointer";
                        const detailRowClass =
                          employee.status === "Hold"
                            ? "bg-amber-50/50 dark:bg-amber-950/10"
                            : employee.status === "Pending"
                              ? "bg-violet-50/50 dark:bg-violet-950/10"
                            : employee.status === "Partial"
                              ? "bg-sky-50/50 dark:bg-sky-950/10"
                              : "";

                        return (
                          <Fragment key={employee.employeeId}>
                          <TableRow
                            className={rowClass}
                            onClick={() =>
                              setExpandedAttendanceHoldEmployeeIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(employee.employeeId)) {
                                  next.delete(employee.employeeId);
                                } else {
                                  next.add(employee.employeeId);
                                }
                                return next;
                              })
                            }
                          >
                            <TableCell>
                              <div className="flex items-start gap-2">
                                {isExpanded ? (
                                  <ChevronDown
                                    className="mt-0.5 h-4 w-4 shrink-0"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <ChevronRight
                                    className="mt-0.5 h-4 w-4 shrink-0"
                                    aria-hidden="true"
                                  />
                                )}
                                <div>
                                  <div className="font-medium">
                                    {employee.employeeName}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {employee.employeeNo}
                                    {employee.departmentName
                                      ? ` / ${employee.departmentName}`
                                      : ""}
                                    {employee.departmentCode
                                      ? ` - ${employee.departmentCode}`
                                      : ""}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {employee.heldDates.join(", ")}
                            </TableCell>
                            <TableCell>
                              {approvalDraft ? (
                                renderAttendanceHoldDraftTimeInputs(
                                  employee,
                                  approvalDraft,
                                  "worked",
                                  "Worked",
                                  isAttendanceHoldActionBusy
                                )
                              ) : (
                                formatMinutes(employee.workedMinutes)
                              )}
                            </TableCell>
                            <TableCell>
                              {approvalDraft ? (
                                renderAttendanceHoldDraftTimeInputs(
                                  employee,
                                  approvalDraft,
                                  "late",
                                  "Late",
                                  isAttendanceHoldActionBusy
                                )
                              ) : (
                                formatMinutes(employee.lateMinutes)
                              )}
                            </TableCell>
                            <TableCell>
                              {approvalDraft ? (
                                renderAttendanceHoldDraftTimeInputs(
                                  employee,
                                  approvalDraft,
                                  "undertime",
                                  "Undertime",
                                  isAttendanceHoldActionBusy
                                )
                              ) : (
                                formatMinutes(employee.undertimeMinutes)
                              )}
                            </TableCell>
                            <TableCell>
                              {approvalDraft ? (
                                renderAttendanceHoldDraftTimeInputs(
                                  employee,
                                  approvalDraft,
                                  "overtime",
                                  "Overtime",
                                  isAttendanceHoldActionBusy
                                )
                              ) : (
                                formatMinutes(employee.overtimeMinutes)
                              )}
                            </TableCell>
                            <TableCell>{employee.rows.length}</TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                                  statusClass
                                )}
                              >
                                {employee.status}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div
                                className="flex min-w-[320px] flex-col gap-2"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {approvalDraft ? (
                                  <Select
                                    value={approvalDraft.targetPayrollPeriodId}
                                    onValueChange={(value) =>
                                      updateAttendanceHoldApprovalDraft(
                                        employee.employeeId,
                                        { targetPayrollPeriodId: value }
                                      )
                                    }
                                    disabled={isAttendanceHoldActionBusy}
                                  >
                                    <SelectTrigger
                                      className="h-8"
                                      aria-label={`Target payroll period for ${employee.employeeName}`}
                                    >
                                      <SelectValue placeholder="Target period" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {periods.map((period) => (
                                        <SelectItem key={period.id} value={period.id}>
                                          {period.code}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : null}
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      handleEditAttendanceHoldEmployee(employee)
                                    }
                                    disabled={isAttendanceHoldActionBusy}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() =>
                                      handleApproveAttendanceHoldEmployee(employee)
                                    }
                                    disabled={isAttendanceHoldActionBusy}
                                  >
                                    {isSavingApproval ? "Approving..." : "Approve"}
                                  </Button>
                                  {employee.status !== "Hold" ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        handleResetAttendanceHoldEmployee(employee)
                                      }
                                      disabled={isAttendanceHoldActionBusy}
                                    >
                                      {isResettingApproval ? "Resetting..." : "Reset"}
                                    </Button>
                                  ) : null}
                                  {approvalDraft ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleCancelAttendanceHoldEmployee(
                                          employee.employeeId
                                        )
                                      }
                                      disabled={isAttendanceHoldActionBusy}
                                    >
                                      Cancel
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                          {isExpanded ? (
                            <TableRow className={detailRowClass}>
                              <TableCell colSpan={9} className="p-0">
                                <div className="space-y-3 border-t px-4 py-4">
                                  {employee.rows.map((row) => {
                                    const rowDisplayMinutes =
                                      getAttendanceHoldRowDisplayMinutes(row);
                                    const isRowApproved =
                                      row.approvalStatus === "Approved";
                                    const isRowPending =
                                      row.approvalStatus === "Pending";

                                    return (
                                    <div
                                      key={`${row.employeeId}-${row.attendanceDate}`}
                                      className="rounded-md border bg-background p-3"
                                    >
                                      <div className="mb-3 flex flex-wrap items-center gap-2">
                                        <span
                                          className={cn(
                                            "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                                            isRowApproved
                                              ? "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                              : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                          )}
                                        >
                                          Hold
                                        </span>
                                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                          {row.source === "auto" ? "Auto" : "Manual"}
                                        </span>
                                        {row.approvalStatus === "Approved" ? (
                                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                            Approved
                                            {row.targetPayrollPeriodCode
                                              ? ` to ${row.targetPayrollPeriodCode}`
                                              : ""}
                                          </span>
                                        ) : null}
                                        {isRowPending ? (
                                          <span className="inline-flex rounded-full bg-violet-100 px-2 py-1 text-xs font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                                            Pending
                                            {row.targetPayrollPeriodCode
                                              ? ` to ${row.targetPayrollPeriodCode}`
                                              : ""}
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="grid gap-3 text-sm md:grid-cols-4 xl:grid-cols-9">
                                        <div>
                                          <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                            Date
                                          </div>
                                          <div className="font-medium">
                                            {row.attendanceDate}
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            {row.dayName}
                                          </div>
                                        </div>
                                        <div className="md:col-span-2 xl:col-span-2">
                                          <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                            Punches
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            {row.rawPunches.length > 0
                                              ? row.rawPunches.join(", ")
                                              : "-"}
                                          </div>
                                        </div>
                                        <div>
                                          <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                            Schedule
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            {row.scheduledInTime && row.scheduledOutTime
                                              ? `${row.scheduledInTime} - ${row.scheduledOutTime}`
                                              : "-"}
                                          </div>
                                          {row.scheduledMinutes > 0 ? (
                                            <div className="text-[10px] text-muted-foreground">
                                              {formatMinutes(row.scheduledMinutes)}
                                            </div>
                                          ) : null}
                                        </div>
                                        <div>
                                          <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                            Intended
                                          </div>
                                          <div>
                                            {formatMinutes(row.intendedWorkedMinutes)}
                                          </div>
                                          <div className="text-[10px] text-muted-foreground">
                                            {row.workedBaselineSource === "schedule"
                                              ? "Schedule"
                                              : "8h fallback"}
                                          </div>
                                        </div>
                                        <div>
                                          <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                            Raw Worked
                                          </div>
                                          <div>{formatMinutes(row.workedMinutes)}</div>
                                        </div>
                                        <div>
                                          <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                            Raw Late
                                          </div>
                                          <div>
                                            {formatMinutes(row.lateMinutes)}
                                          </div>
                                        </div>
                                        <div>
                                          <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                            Raw Undertime
                                          </div>
                                          <div>
                                            {formatMinutes(row.undertimeMinutes)}
                                          </div>
                                        </div>
                                        <div>
                                          <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                            OT
                                          </div>
                                          <div>
                                            {formatMinutes(
                                              rowDisplayMinutes.overtimeMinutes
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="mt-3">
                                        <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                                          Flags
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                          {row.anomalyFlags.length > 0
                                            ? row.anomalyFlags.map((flag) => (
                                                <span
                                                  key={flag}
                                                  className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                                                >
                                                  {flag}
                                                </span>
                                              ))
                                            : "-"}
                                        </div>
                                      </div>
                                    </div>
                                    );
                                  })}
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accountCodes" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Payroll Account Code</CardTitle>
              <CardDescription>
                Add period-specific income and deduction account-code rows for one
                employee at a time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedPeriod ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Select a payroll period first to add payroll account-code rows.
                </div>
              ) : sortedPayrollAccountCodeEmployees.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No employees are available for payroll account-code rows.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
                      <div>
                        <label className="mb-2 block text-sm font-medium">
                          Employee
                        </label>
                        <PayrollAccountCodeEmployeePicker
                          value={
                            selectedPayrollAccountCodeEmployee?.employeeId ?? ""
                          }
                          onChange={setSelectedPayrollAccountCodeEmployeeId}
                          employees={filteredPayrollAccountCodeEmployees}
                          disabled={
                            filteredPayrollAccountCodeEmployees.length === 0
                          }
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium">
                          Department
                        </label>
                        <DepartmentFilterDropdown
                          value={payrollAccountCodeDepartmentFilter}
                          onChange={setPayrollAccountCodeDepartmentFilter}
                          options={payrollAccountCodeDepartmentOptions}
                          ariaLabel="Filter payroll account-code employees by department"
                        />
                      </div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                      Rows saved here are included the next time the selected
                      payroll period is computed. Loan, unpaid leave or absence,
                      and other deduction account types are kept in the Deduction
                      section.
                    </div>
                  </div>

                  {filteredPayrollAccountCodeEmployees.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                      No employees match the selected department.
                    </div>
                  ) : selectedPayrollAccountCodeEmployee ? (
                    <div className="space-y-4">
                      <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 text-sm md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <div className="font-medium">
                            {formatEmployeePickerLabel({
                              firstName: selectedPayrollAccountCodeEmployee.firstName,
                              middleName:
                                selectedPayrollAccountCodeEmployee.middleName,
                              lastName: selectedPayrollAccountCodeEmployee.lastName,
                              employeeNo:
                                selectedPayrollAccountCodeEmployee.employeeNo,
                              employeeType:
                                selectedPayrollAccountCodeEmployee.employeeType,
                              fallbackName:
                                selectedPayrollAccountCodeEmployee.employeeName,
                            })}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {selectedPeriod.code} -{" "}
                            {selectedPayrollAccountCodeEmployee.departmentName ??
                              "No department"}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleAddPayrollExceptionRow}
                            disabled={
                              activePayrollExceptionAccountCodeOptions.length ===
                                0 ||
                              savingPayrollExceptions
                            }
                          >
                            Add{" "}
                            {payrollAccountCodeLineTab === "deduction"
                              ? "Deduction"
                              : "Income"}{" "}
                            Row
                          </Button>
                        </div>
                      </div>

                      {payrollExceptionStateMatchesSelectedEmployee &&
                        payrollExceptionState.status === "loading" && (
                          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                            Loading payroll account-code rows...
                          </div>
                        )}
                      {payrollExceptionStateMatchesSelectedEmployee &&
                        payrollExceptionState.status === "error" && (
                          <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                            {payrollExceptionState.error ??
                              "Unable to load payroll account-code rows."}
                          </div>
                        )}

                      <Tabs
                        value={payrollAccountCodeLineTab}
                        onValueChange={(value) =>
                          setPayrollAccountCodeLineTab(
                            value as PayrollAccountCodeLineTab
                          )
                        }
                        className="space-y-3"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <TabsList>
                            <TabsTrigger value="income">
                              Income ({payrollExceptionIncomeCount})
                            </TabsTrigger>
                            <TabsTrigger value="deduction">
                              Deduction ({payrollDeductionTabCount})
                            </TabsTrigger>
                          </TabsList>
                          <div className="text-sm text-muted-foreground">
                            {visiblePayrollAccountCodeRowCount} visible row
                            {visiblePayrollAccountCodeRowCount === 1 ? "" : "s"}
                          </div>
                        </div>

                        <TabsContent value="income" className="mt-0">
                          {renderPayrollAccountCodeTable("income")}
                        </TabsContent>
                        <TabsContent value="deduction" className="mt-0">
                          <div className="space-y-4">
                            {renderScheduledLoanDeductionsTable()}
                            {renderPayrollAccountCodeTable("deduction")}
                          </div>
                        </TabsContent>
                      </Tabs>

                      <div className="flex flex-col gap-3 border-t pt-3 text-sm md:flex-row md:items-center md:justify-between">
                        <div className="text-muted-foreground">
                          {dirtyPayrollExceptionCount} unsaved account-code row
                          {dirtyPayrollExceptionCount === 1 ? "" : "s"}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleDiscardPayrollExceptionDrafts}
                            disabled={
                              dirtyPayrollExceptionCount === 0 ||
                              savingPayrollExceptions
                            }
                          >
                            Discard Changes
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleSavePayrollExceptionDrafts}
                            disabled={
                              dirtyPayrollExceptionCount === 0 ||
                              savingPayrollExceptions ||
                              hasPayrollExceptionDraftErrors
                            }
                          >
                            {savingPayrollExceptions
                              ? "Saving..."
                              : "Save Account Codes"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Import Attendance</CardTitle>
            <CardDescription>
              Upload the biometric DTR files for the selected payroll period.
              ID, EnNo, UID, and employee number values are matched using the
              numeric employee key, so `83`, `00083`, and `EMP00083` resolve
              to the same employee.
            </CardDescription>
          </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div>
                  <label className="mb-2 block text-sm font-medium">
                    Attendance Files
                  </label>
                  <Input
                    key={fileInputKey}
                    type="file"
                    multiple
                    accept=".csv,.txt,text/plain"
                    onChange={(event) => {
                      const files = event.currentTarget.files;
                      setSelectedAttendanceFiles(files ? Array.from(files) : []);
                    }}
                    disabled={!selectedPeriod || actionState !== null}
                  />
                  {selectedAttendanceFiles.length > 0 ? (
                    <p className="mt-2 break-words text-xs text-muted-foreground">
                      {selectedAttendanceFiles.length} file(s) selected:{" "}
                      {selectedAttendanceFiles
                        .map((file) => file.name)
                        .join(", ")}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Import all branch files for the selected payroll period before
                    computing payroll. Comma, tab, semicolon, pipe, whitespace,
                    CSV, and TXT exports are accepted; unknown or ambiguous
                    numeric IDs stay unmatched.
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Use Refresh Stored Summaries after schedule or attendance-rule
                    changes to rebuild payroll-ready daily summaries from the
                    imported raw logs.
                  </p>
                  <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={replaceExistingAttendance}
                      onChange={(event) =>
                        setReplaceExistingAttendance(event.target.checked)
                      }
                      disabled={!selectedPeriod || actionState !== null}
                    />
                    Replace existing daily summaries for matching employee/date rows
                  </label>
                </div>
                <div className="flex items-end">
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      onClick={handleImportAttendance}
                      disabled={!selectedPeriod || actionState !== null}
                    >
                      {actionState === "import-attendance"
                        ? "Importing..."
                        : "Import Attendance"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleRefreshAttendanceSummaries}
                      disabled={!selectedPeriod || actionState !== null}
                    >
                      {actionState === "refresh-attendance-summaries"
                        ? "Refreshing..."
                        : "Refresh Stored Summaries"}
                    </Button>
                  </div>
                </div>
              </div>
              {attendanceImportResult ? (
                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">
                        Last import result
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {attendanceImportResult.attemptedCount} file(s) checked,{" "}
                        {attendanceImportResult.importedCount} imported,{" "}
                        {attendanceImportResult.deniedCount} denied.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAttendanceImportResult(null)}
                      disabled={actionState !== null}
                    >
                      Clear result
                    </Button>
                  </div>
                  <div className="mt-3 overflow-x-auto rounded-md border bg-background">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[220px]">File</TableHead>
                          <TableHead className="w-32">Status</TableHead>
                          <TableHead className="min-w-[320px]">Details</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {attendanceImportResult.rows.map((row, index) => (
                          <TableRow key={`${row.fileName}-${index}`}>
                            <TableCell className="max-w-[320px] break-words font-medium">
                              {row.fileName}
                            </TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                                  row.status === "denied"
                                    ? "bg-destructive/10 text-destructive"
                                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                )}
                              >
                                {row.status === "denied"
                                  ? "Denied"
                                  : "Imported"}
                              </span>
                            </TableCell>
                            <TableCell
                              className={cn(
                                "max-w-[560px] whitespace-normal break-words text-sm",
                                row.status === "denied"
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                              )}
                            >
                              {row.details}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Semimonthly DTR</CardTitle>
            <CardDescription>
              Review one employee at a time for the selected payroll
                period. Daily rows include punches, schedule, leave, anomalies,
                DTR status, worked-time overrides, and OT approval before payroll
                computation.
            </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedPeriod ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Select a payroll period first to review the semimonthly DTR.
                </div>
              ) : attendanceDtrState.status === "loading" ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Loading semimonthly DTR for {selectedPeriod.code}...
                </div>
              ) : attendanceDtrState.status === "error" ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                  {attendanceDtrState.error ?? "Unable to load the semimonthly DTR."}
                </div>
              ) : attendanceDtrEmployees.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No active semimonthly employees are available for this payroll
                  period.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
                      <div>
                        <label className="mb-2 block text-sm font-medium">
                          Employee DTR
                        </label>
                        <EmployeeDtrPicker
                          value={selectedDtrEmployee?.employeeId ?? ""}
                          onChange={setSelectedDtrEmployeeId}
                          employees={filteredAttendanceDtrEmployees}
                          disabled={filteredAttendanceDtrEmployees.length === 0}
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium">
                          Department
                        </label>
                        <DepartmentFilterDropdown
                          value={attendanceDtrDepartmentFilter}
                          onChange={setAttendanceDtrDepartmentFilter}
                          options={attendanceDtrDepartmentOptions}
                          ariaLabel="Filter semimonthly DTR employees by department"
                        />
                      </div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                      Import every branch file for {selectedPeriod.code} before
                      computing payroll. Review DTR status, approve daily OT, and
                      adjust payroll worked time here before recomputing the run.
                      Employees without period DTR summaries are marked as missing.
                    </div>
                  </div>

                  {filteredAttendanceDtrEmployees.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                      No employees match the selected department.
                    </div>
                  ) : selectedDtrEmployee && (
                    <>
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                          Source file(s)
                        </div>
                        {selectedDtrEmployee.sourceFiles.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedDtrEmployee.sourceFiles.map((sourceFile) => (
                              <span
                                key={sourceFile.batchId}
                                className="max-w-full rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground"
                              >
                                <span className="break-words font-medium text-foreground">
                                  {sourceFile.sourceFileName}
                                </span>{" "}
                                ({sourceFile.punchCount} punch
                                {sourceFile.punchCount === 1 ? "" : "es"})
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-1 text-sm text-muted-foreground">
                            No source file details are available.
                          </div>
                        )}
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
                        <EditableDtrTotalCard
                          label="Present Days"
                          value={formatDtrDays(selectedDtrEmployee.totals.presentDays)}
                          computedValue={formatDtrDays(
                            selectedDtrEmployee.totals.computed.presentDays
                          )}
                          isOverridden={
                            selectedDtrEmployee.totals.overrides.presentDays != null
                          }
                        >
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={dtrOverrideDraft.presentDays}
                            onChange={(event) =>
                              updateDtrOverrideDraft({
                                presentDays: event.target.value,
                              })
                            }
                            aria-label="Present days override"
                            className="h-8"
                            disabled={savingDtrPeriodOverrides}
                          />
                        </EditableDtrTotalCard>
                        <EditableDtrTotalCard
                          label="Worked"
                          value={formatMinutes(selectedDtrEmployee.totals.workedMinutes)}
                          computedValue={formatMinutes(
                            selectedDtrEmployee.totals.computed.workedMinutes
                          )}
                          secondaryValue={`Biometrics ${formatMinutes(
                            selectedDtrEmployee.totals.biometricWorkedMinutes
                          )}`}
                          isOverridden={
                            selectedDtrEmployee.totals.overrides.workedMinutes != null
                          }
                        >
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="number"
                              min="0"
                              value={dtrOverrideDraft.workedHours}
                              onChange={(event) => {
                                setDtrWorkedDraftTouched(true);
                                updateDtrOverrideDraft({
                                  workedHours: event.target.value,
                                });
                              }}
                              placeholder="h"
                              aria-label="Worked override hours"
                              className="h-8"
                              disabled={savingDtrPeriodOverrides}
                            />
                            <Input
                              type="number"
                              min="0"
                              max="59"
                              value={dtrOverrideDraft.workedMinutes}
                              onChange={(event) => {
                                setDtrWorkedDraftTouched(true);
                                updateDtrOverrideDraft({
                                  workedMinutes: event.target.value,
                                });
                              }}
                              placeholder="m"
                              aria-label="Worked override minutes"
                              className="h-8"
                              disabled={savingDtrPeriodOverrides}
                            />
                          </div>
                        </EditableDtrTotalCard>
                        <EditableDtrTotalCard
                          label="Late"
                          value={formatMinutes(selectedDtrEmployee.totals.lateMinutes)}
                          computedValue={formatMinutes(
                            selectedDtrEmployee.totals.computed.lateMinutes
                          )}
                          isOverridden={
                            selectedDtrEmployee.totals.overrides.lateMinutes != null
                          }
                        >
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="number"
                              min="0"
                              value={dtrOverrideDraft.lateHours}
                              onChange={(event) =>
                                updateDtrOverrideDraft({
                                  lateHours: event.target.value,
                                })
                              }
                              placeholder="h"
                              aria-label="Late override hours"
                              className="h-8"
                              disabled={savingDtrPeriodOverrides}
                            />
                            <Input
                              type="number"
                              min="0"
                              max="59"
                              value={dtrOverrideDraft.lateMinutes}
                              onChange={(event) =>
                                updateDtrOverrideDraft({
                                  lateMinutes: event.target.value,
                                })
                              }
                              placeholder="m"
                              aria-label="Late override minutes"
                              className="h-8"
                              disabled={savingDtrPeriodOverrides}
                            />
                          </div>
                        </EditableDtrTotalCard>
                        <EditableDtrTotalCard
                          label="Undertime"
                          value={formatMinutes(
                            selectedDtrEmployee.totals.undertimeMinutes
                          )}
                          computedValue={formatMinutes(
                            selectedDtrEmployee.totals.computed.undertimeMinutes
                          )}
                          isOverridden={
                            selectedDtrEmployee.totals.overrides.undertimeMinutes !=
                            null
                          }
                        >
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="number"
                              min="0"
                              value={dtrOverrideDraft.undertimeHours}
                              onChange={(event) =>
                                updateDtrOverrideDraft({
                                  undertimeHours: event.target.value,
                                })
                              }
                              placeholder="h"
                              aria-label="Undertime override hours"
                              className="h-8"
                              disabled={savingDtrPeriodOverrides}
                            />
                            <Input
                              type="number"
                              min="0"
                              max="59"
                              value={dtrOverrideDraft.undertimeMinutes}
                              onChange={(event) =>
                                updateDtrOverrideDraft({
                                  undertimeMinutes: event.target.value,
                                })
                              }
                              placeholder="m"
                              aria-label="Undertime override minutes"
                              className="h-8"
                              disabled={savingDtrPeriodOverrides}
                            />
                          </div>
                        </EditableDtrTotalCard>
                        <EditableDtrTotalCard
                          label="Regular Overtime"
                          value={formatMinutes(selectedDtrEmployee.totals.overtimeMinutes)}
                          computedValue={formatMinutes(
                            selectedDtrEmployee.totals.computed.overtimeMinutes
                          )}
                          isOverridden={
                            selectedDtrEmployee.totals.overrides.overtimeMinutes != null
                          }
                        >
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="number"
                              min="0"
                              value={dtrOverrideDraft.overtimeHours}
                              onChange={(event) =>
                                updateDtrOverrideDraft({
                                  overtimeHours: event.target.value,
                                })
                              }
                              placeholder="h"
                              aria-label="Regular Overtime override hours"
                              className="h-8"
                              disabled={savingDtrPeriodOverrides}
                            />
                            <Input
                              type="number"
                              min="0"
                              max="59"
                              value={dtrOverrideDraft.overtimeMinutes}
                              onChange={(event) =>
                                updateDtrOverrideDraft({
                                  overtimeMinutes: event.target.value,
                                })
                              }
                              placeholder="m"
                              aria-label="Regular Overtime override minutes"
                              className="h-8"
                              disabled={savingDtrPeriodOverrides}
                            />
                          </div>
                        </EditableDtrTotalCard>
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                              Paid / Unpaid Leave
                            </div>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              Computed
                            </span>
                          </div>
                          <div className="mt-1 font-semibold">
                            {formatDtrDays(selectedDtrEmployee.totals.paidLeaveDays)} /{" "}
                            {formatDtrDays(selectedDtrEmployee.totals.unpaidLeaveDays)} day(s)
                          </div>
                        </div>
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                              Absences
                            </div>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              Computed
                            </span>
                          </div>
                          <div className="mt-1 font-semibold">
                            {formatDtrDays(selectedDtrEmployee.totals.absentDays)} day(s)
                          </div>
                        </div>
                        <div className="rounded-lg border bg-background p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            Override Actions
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {dtrPeriodOverridePayload
                              ? dtrPeriodOverrideDraftDirty
                                ? "Unsaved card changes"
                                : selectedDtrHasPeriodOverride
                                  ? "Saved overrides active"
                                  : "No overrides"
                              : "Invalid override values"}
                          </div>
                          <div className="mt-3 flex flex-col gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={handleSaveDtrPeriodOverrides}
                              disabled={
                                savingDtrPeriodOverrides ||
                                !dtrPeriodOverridePayload ||
                                (!dtrPeriodOverrideDraftDirty &&
                                  !selectedDtrHasPeriodOverride)
                              }
                            >
                              {savingDtrPeriodOverrides ? "Saving..." : "Save All"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={handleResetDtrPeriodOverrideDraft}
                              disabled={
                                savingDtrPeriodOverrides ||
                                !dtrPeriodOverrideDraftDirty
                              }
                            >
                              Reset Draft
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={handleClearDtrPeriodOverrideDraft}
                              disabled={
                                savingDtrPeriodOverrides ||
                                (!selectedDtrHasPeriodOverride &&
                                  !dtrPeriodOverrideDraftDirty)
                              }
                            >
                              Clear Overrides
                            </Button>
                          </div>
                        </div>
                      </div>

                      {attendanceDtrRowsState.status === "loading" ? (
                        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                          Loading DTR rows for {selectedDtrEmployee.employeeName}...
                        </div>
                      ) : attendanceDtrRowsState.status === "error" ? (
                        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                          {attendanceDtrRowsState.error ??
                            "Unable to load employee DTR rows."}
                        </div>
                      ) : !selectedDtrEmployee.hasDtrRecord ? (
                        <div className="rounded-lg border border-dashed p-4 text-sm">
                          <div className="font-semibold text-destructive">
                            Missing DTR
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            This employee has no DTR records for{" "}
                            {selectedPeriod.code}. Import or refresh attendance
                            summaries to review daily rows.
                          </div>
                        </div>
                      ) : selectedDtrRows.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                          No DTR rows are available for this employee.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="overflow-x-auto">
                            <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Punches</TableHead>
                                <TableHead>First In</TableHead>
                                <TableHead>Last Out</TableHead>
                                <TableHead>Schedule</TableHead>
                                <TableHead>Worked</TableHead>
                                <TableHead>Late</TableHead>
                                <TableHead>UT</TableHead>
                                <TableHead>OT</TableHead>
                                <TableHead>Leave</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Flags</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {selectedDtrRows.map((row) => {
                                const draftKey = getDtrStatusDraftKey(
                                  selectedDtrEmployee.employeeId,
                                  row.attendanceDate
                                );
                                const hasStatusDraft = hasDtrStatusDraft(
                                  dtrStatusDrafts,
                                  selectedDtrEmployee.employeeId,
                                  row.attendanceDate
                                );
                                const draftStatus = hasStatusDraft
                                  ? (dtrStatusDrafts[draftKey] ?? null)
                                  : undefined;
                                const displayedStatus = getDtrDraftDisplayStatus(
                                  row,
                                  draftStatus,
                                  hasStatusDraft
                                );
                                const statusIsDirty =
                                  hasStatusDraft &&
                                  (draftStatus ?? null) !== (row.manualStatus ?? null);
                                const selectedStatusValue = hasStatusDraft
                                  ? (draftStatus ?? COMPUTED_DTR_STATUS_VALUE)
                                  : (row.manualStatus ?? COMPUTED_DTR_STATUS_VALUE);

                                return (
                                  <TableRow
                                    key={`${selectedDtrEmployee.employeeId}-${row.attendanceDate}`}
                                    className={cn(
                                      displayedStatus === "Hold"
                                        ? "bg-amber-50 dark:bg-amber-950/20"
                                        : ""
                                    )}
                                  >
                                  <TableCell>
                                    <div className="font-medium">{row.attendanceDate}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {row.dayName}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {row.rawPunches.length > 0
                                      ? row.rawPunches.join(", ")
                                      : "-"}
                                  </TableCell>
                                  <TableCell>{row.firstInAt ?? "-"}</TableCell>
                                  <TableCell>{row.lastOutAt ?? "-"}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {row.scheduledInTime && row.scheduledOutTime
                                      ? `${row.scheduledInTime} - ${row.scheduledOutTime}`
                                      : "-"}
                                  </TableCell>
                                  <TableCell>{formatMinutes(row.workedMinutes)}</TableCell>
                                  <TableCell>{formatMinutes(row.lateMinutes)}</TableCell>
                                  <TableCell>{formatMinutes(row.undertimeMinutes)}</TableCell>
                                  <TableCell>{formatMinutes(row.overtimeMinutes)}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {row.paidLeaveMinutes > 0 || row.unpaidLeaveMinutes > 0
                                      ? `P ${formatMinutes(row.paidLeaveMinutes)} / U ${formatMinutes(row.unpaidLeaveMinutes)}`
                                      : "-"}
                                  </TableCell>
                                  <TableCell>
                                    <div className="min-w-[160px] space-y-1">
                                      <Select
                                        value={selectedStatusValue}
                                        onValueChange={(value) =>
                                          handleDraftDtrDayStatus(row, value)
                                        }
                                        disabled={savingDtrStatuses}
                                      >
                                        <SelectTrigger
                                          className={cn(
                                            "h-8 text-xs",
                                            statusIsDirty
                                              ? "border-amber-300"
                                              : row.isStatusOverridden
                                              ? "border-sky-300"
                                              : ""
                                          )}
                                          aria-label={`Status for ${row.attendanceDate}`}
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value={COMPUTED_DTR_STATUS_VALUE}>
                                            Computed: {row.computedStatus}
                                          </SelectItem>
                                          {attendanceDtrManualStatusValues.map(
                                            (status) => (
                                              <SelectItem key={status} value={status}>
                                                {status}
                                              </SelectItem>
                                            )
                                          )}
                                        </SelectContent>
                                      </Select>
                                      <span
                                        className={cn(
                                          "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                                          getAttendanceDayToneClassForStatus(
                                            displayedStatus
                                          )
                                        )}
                                      >
                                        {displayedStatus}
                                      </span>
                                      {statusIsDirty ? (
                                        <div className="text-xs font-medium text-amber-700 dark:text-amber-300">
                                          Unsaved
                                        </div>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {row.anomalyFlags.length > 0
                                      ? row.anomalyFlags.join(", ")
                                      : "-"}
                                  </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                            </Table>
                          </div>
                          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 text-sm md:flex-row md:items-center md:justify-between">
                            <div className="text-muted-foreground">
                              {selectedDtrRowOverrideChanges.length} unsaved row override
                              {selectedDtrRowOverrideChanges.length === 1 ? "" : "s"}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleDiscardDtrStatusDrafts}
                                disabled={
                                  selectedDtrRowOverrideChanges.length === 0 ||
                                  savingDtrStatuses
                                }
                              >
                                Discard Changes
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={handleSaveDtrStatusDrafts}
                                disabled={
                                  selectedDtrRowOverrideChanges.length === 0 ||
                                  savingDtrStatuses
                                }
                              >
                                {savingDtrStatuses
                                  ? "Saving..."
                                  : "Save Row Overrides"}
                              </Button>
                            </div>
                          </div>
                          {showAttendancePayrollExceptionEditor ? (
                          <div className="space-y-3 rounded-lg border bg-background p-3">
                            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                              <div>
                                <div className="text-sm font-semibold">
                                  Payroll Exceptions
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {payrollExceptionDrafts.length} saved/payable row
                                  {payrollExceptionDrafts.length === 1 ? "" : "s"}
                                </div>
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <Select
                                  value={effectiveSelectedPayrollExceptionDate}
                                  onValueChange={setSelectedPayrollExceptionDate}
                                  disabled={
                                    payrollExceptionDateOptions.length === 0 ||
                                    savingPayrollExceptions
                                  }
                                >
                                  <SelectTrigger className="w-full sm:w-[220px]">
                                    <SelectValue placeholder="Add from DTR date" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {payrollExceptionDateOptions.map((option) => (
                                      <SelectItem
                                        key={option.value}
                                        value={option.value}
                                      >
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={handleAddPayrollExceptionRow}
                                  disabled={
                                    !effectiveSelectedPayrollExceptionDate ||
                                    payrollExceptionAccountCodeOptions.length === 0 ||
                                    savingPayrollExceptions
                                  }
                                >
                                  Add Row
                                </Button>
                              </div>
                            </div>

                            {payrollExceptionStateMatchesSelectedDtr &&
                              payrollExceptionState.status === "loading" && (
                                <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                                  Loading payroll exceptions...
                                </div>
                              )}
                            {payrollExceptionStateMatchesSelectedDtr &&
                              payrollExceptionState.status === "error" && (
                                <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                                  {payrollExceptionState.error ??
                                    "Unable to load payroll exceptions."}
                                </div>
                              )}

                            <div className="overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Account Code</TableHead>
                                    <TableHead>Account Type</TableHead>
                                    <TableHead>OT Category</TableHead>
                                    <TableHead>Hours / Minutes</TableHead>
                                    <TableHead>Computed Preview</TableHead>
                                    <TableHead>Amount</TableHead>
                                    <TableHead>Remarks</TableHead>
                                    <TableHead className="text-right">Delete</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {payrollExceptionDrafts.length === 0 ? (
                                    <TableRow>
                                      <TableCell
                                        colSpan={9}
                                        className="py-6 text-center text-sm text-muted-foreground"
                                      >
                                        No payroll exceptions saved.
                                      </TableCell>
                                    </TableRow>
                                  ) : (
                                    payrollExceptionDrafts.map((draft) => {
                                      const savedRow = draft.id
                                        ? payrollExceptionRowsById.get(draft.id) ??
                                          null
                                        : null;
                                      const draftIsDirty =
                                        isPayrollExceptionDraftDirty(
                                          draft,
                                          savedRow
                                        );
                                      const draftError =
                                        payrollExceptionDraftErrors.get(
                                          draft.localId
                                        ) ?? null;
                                      const accountCodeSelectValue =
                                        draft.accountCodeId ||
                                        (draft.accountCodeSnapshot
                                          ? `snapshot:${draft.accountCodeSnapshot}`
                                          : "__none__");
                                      const isOvertimeAccount =
                                        draft.accountTypeSnapshot === "Overtime";
                                      const isOtherIncomeAccount =
                                        isOtherIncomeAccountType(
                                          draft.accountTypeSnapshot
                                        );

                                      return (
                                        <TableRow key={draft.localId}>
                                          <TableCell>
                                            {isOtherIncomeAccount ? (
                                              <span className="text-sm text-muted-foreground">
                                                -
                                              </span>
                                            ) : (
                                              <Select
                                                value={draft.attendanceDate}
                                                onValueChange={(value) => {
                                                  const dtrRow =
                                                    selectedDtrRows.find(
                                                      (candidate) =>
                                                        candidate.attendanceDate ===
                                                        value
                                                    ) ?? null;
                                                  updatePayrollExceptionDraft(
                                                    draft.localId,
                                                    {
                                                      attendanceDate: value,
                                                      overtimeCategory: dtrRow
                                                        ? getDefaultOvertimeCategory(
                                                            dtrRow
                                                          )
                                                        : draft.overtimeCategory,
                                                    }
                                                  );
                                                }}
                                                disabled={savingPayrollExceptions}
                                              >
                                                <SelectTrigger className="min-w-[150px]">
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  {payrollExceptionDateOptions.map(
                                                    (option) => (
                                                      <SelectItem
                                                        key={option.value}
                                                        value={option.value}
                                                      >
                                                        {option.label}
                                                      </SelectItem>
                                                    )
                                                  )}
                                                </SelectContent>
                                              </Select>
                                            )}
                                          </TableCell>
                                          <TableCell>
                                            <PayrollAccountCodePicker
                                              value={accountCodeSelectValue}
                                              options={
                                                payrollExceptionAccountCodeOptions
                                              }
                                              snapshotCode={
                                                draft.accountCodeSnapshot &&
                                                !draft.accountCodeId
                                                  ? draft.accountCodeSnapshot
                                                  : null
                                              }
                                              onChange={(value) =>
                                                handleSelectPayrollAccountCode(
                                                  draft,
                                                  value,
                                                  payrollExceptionAccountCodeOptions
                                                )
                                              }
                                              disabled={savingPayrollExceptions}
                                            />
                                          </TableCell>
                                          <TableCell className="min-w-[150px] text-sm">
                                            {draft.accountTypeSnapshot ?? (
                                              <span className="text-muted-foreground">
                                                -
                                              </span>
                                            )}
                                          </TableCell>
                                          <TableCell>
                                            {isOvertimeAccount ? (
                                              <Select
                                                value={draft.overtimeCategory}
                                                onValueChange={(value) =>
                                                  updatePayrollExceptionDraft(
                                                    draft.localId,
                                                    {
                                                      overtimeCategory:
                                                        value as OvertimeCategory,
                                                    }
                                                  )
                                                }
                                                disabled={savingPayrollExceptions}
                                              >
                                                <SelectTrigger className="min-w-[210px]">
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  {overtimeCategoryValues.map(
                                                    (category) => (
                                                      <SelectItem
                                                        key={category}
                                                        value={category}
                                                      >
                                                        {
                                                          OVERTIME_CATEGORY_LABELS[
                                                            category
                                                          ]
                                                        }
                                                      </SelectItem>
                                                    )
                                                  )}
                                                </SelectContent>
                                              </Select>
                                            ) : (
                                              <span className="text-sm text-muted-foreground">
                                                -
                                              </span>
                                            )}
                                          </TableCell>
                                          <TableCell>
                                            {isOtherIncomeAccount ? (
                                              <span className="text-sm text-muted-foreground">
                                                -
                                              </span>
                                            ) : (
                                              <div className="flex items-center gap-2">
                                                <Input
                                                  value={draft.hours}
                                                  onChange={(event) => {
                                                    const nextValue =
                                                      event.target.value;
                                                    if (
                                                      !/^\d{0,2}$/.test(nextValue)
                                                    ) {
                                                      return;
                                                    }
                                                    updatePayrollExceptionDraft(
                                                      draft.localId,
                                                      { hours: nextValue }
                                                    );
                                                  }}
                                                  inputMode="numeric"
                                                  aria-label={`Hours for ${draft.attendanceDate}`}
                                                  className="w-16"
                                                  disabled={savingPayrollExceptions}
                                                />
                                                <span className="text-xs text-muted-foreground">
                                                  h
                                                </span>
                                                <Input
                                                  value={draft.minutes}
                                                  onChange={(event) => {
                                                    const nextValue =
                                                      event.target.value;
                                                    if (
                                                      !/^\d{0,2}$/.test(nextValue)
                                                    ) {
                                                      return;
                                                    }
                                                    updatePayrollExceptionDraft(
                                                      draft.localId,
                                                      { minutes: nextValue }
                                                    );
                                                  }}
                                                  inputMode="numeric"
                                                  aria-label={`Minutes for ${draft.attendanceDate}`}
                                                  className="w-16"
                                                  disabled={savingPayrollExceptions}
                                                />
                                                <span className="text-xs text-muted-foreground">
                                                  m
                                                </span>
                                              </div>
                                            )}
                                          </TableCell>
                                          <TableCell className="min-w-[170px] text-sm">
                                            {draftIsDirty ? (
                                              <span className="text-amber-700 dark:text-amber-300">
                                                Save to preview
                                              </span>
                                            ) : savedRow?.computedError ? (
                                              <span className="text-rose-700 dark:text-rose-300">
                                                {savedRow.computedError}
                                              </span>
                                            ) : savedRow ? (
                                              <div>
                                                <div>
                                                  {formatMoney(
                                                    savedRow.computedAmount
                                                  )}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                  {savedRow.computedDescription}
                                                </div>
                                              </div>
                                            ) : (
                                              <span className="text-muted-foreground">
                                                -
                                              </span>
                                            )}
                                            {draftError ? (
                                              <div className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                                                {draftError}
                                              </div>
                                            ) : null}
                                          </TableCell>
                                          <TableCell>
                                            <Input
                                              value={draft.amountOverride}
                                              onChange={(event) => {
                                                const nextValue =
                                                  event.target.value;
                                                if (
                                                  !/^\d{0,9}(\.\d{0,2})?$/.test(
                                                    nextValue
                                                  )
                                                ) {
                                                  return;
                                                }
                                                updatePayrollExceptionDraft(
                                                  draft.localId,
                                                  {
                                                    amountOverride: nextValue,
                                                    ...(isOtherIncomeAccount
                                                      ? {
                                                          hours: "0",
                                                          minutes: "0",
                                                        }
                                                      : {}),
                                                  }
                                                );
                                              }}
                                              inputMode="decimal"
                                              aria-label={
                                                isOtherIncomeAccount
                                                  ? `Other Income amount for ${
                                                      draft.accountCodeSnapshot ||
                                                      draft.attendanceDate
                                                    }`
                                                  : `Amount override for ${draft.attendanceDate}`
                                              }
                                              className="w-32"
                                              placeholder="0.00"
                                              disabled={savingPayrollExceptions}
                                            />
                                          </TableCell>
                                          <TableCell>
                                            <Input
                                              value={draft.remarks}
                                              onChange={(event) =>
                                                updatePayrollExceptionDraft(
                                                  draft.localId,
                                                  { remarks: event.target.value }
                                                )
                                              }
                                              aria-label={`Remarks for ${draft.attendanceDate}`}
                                              className="min-w-[180px]"
                                              disabled={savingPayrollExceptions}
                                            />
                                          </TableCell>
                                          <TableCell className="text-right">
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              onClick={() =>
                                                handleDeletePayrollExceptionDraft(
                                                  draft.localId
                                                )
                                              }
                                              disabled={savingPayrollExceptions}
                                            >
                                              Delete
                                            </Button>
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })
                                  )}
                                </TableBody>
                              </Table>
                            </div>

                            <div className="flex flex-col gap-3 border-t pt-3 text-sm md:flex-row md:items-center md:justify-between">
                              <div className="text-muted-foreground">
                                {dirtyPayrollExceptionCount} unsaved exception
                                {dirtyPayrollExceptionCount === 1 ? "" : "s"}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={handleDiscardPayrollExceptionDrafts}
                                  disabled={
                                    dirtyPayrollExceptionCount === 0 ||
                                    savingPayrollExceptions
                                  }
                                >
                                  Discard Changes
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={handleSavePayrollExceptionDrafts}
                                  disabled={
                                    dirtyPayrollExceptionCount === 0 ||
                                    savingPayrollExceptions ||
                                    hasPayrollExceptionDraftErrors
                                  }
                                >
                                  {savingPayrollExceptions
                                    ? "Saving..."
                                    : "Save Exceptions"}
                                </Button>
                              </div>
                            </div>
                          </div>
                          ) : null}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Recent Import Batches</CardTitle>
              <CardDescription>
                Imported files are persisted in attendance_import_batches, raw logs
                in attendance_raw_logs, and summarized days in
                attendance_daily_summaries.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <span className="sr-only">Expand batch</span>
                      </TableHead>
                      <TableHead>File</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Matched</TableHead>
                      <TableHead>Unmatched</TableHead>
                      <TableHead>Imported</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendanceBatches.map((batch) => {
                      const revertActionKey = `revert-attendance-${batch.id}`;
                      const canRevert = batch.status === "Processed";
                      const isBatchExpanded = expandedAttendanceBatchIds.has(
                        batch.id
                      );
                      const diagnosticsState =
                        attendanceBatchDiagnosticsById[batch.id];
                      const unmatchedGroups = diagnosticsState?.data?.groups ?? [];
                      const totalUnmatchedRows =
                        diagnosticsState?.data?.totalUnmatchedRows ?? 0;
                      const detailRowId = `attendance-batch-${batch.id}-diagnostics`;

                      return (
                        <Fragment key={batch.id}>
                          <TableRow
                            className={cn(
                              "cursor-pointer",
                              isBatchExpanded && "bg-muted/40 hover:bg-muted/40"
                            )}
                            onClick={() => handleToggleAttendanceBatch(batch.id)}
                          >
                            <TableCell className="w-10">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleToggleAttendanceBatch(batch.id);
                                }}
                                aria-label={`${
                                  isBatchExpanded ? "Collapse" : "Expand"
                                } unmatched rows for ${batch.sourceFileName}`}
                                aria-expanded={isBatchExpanded}
                                aria-controls={detailRowId}
                                title={`${
                                  isBatchExpanded ? "Collapse" : "Expand"
                                } unmatched rows`}
                              >
                                {isBatchExpanded ? (
                                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="font-medium">
                              {batch.sourceFileName}
                            </TableCell>
                            <TableCell>{batch.sourceFormat}</TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                                  getToneClass(batch.status)
                                )}
                              >
                                {batch.status}
                              </span>
                            </TableCell>
                            <TableCell>{batch.totalRows}</TableCell>
                            <TableCell>{batch.matchedRows}</TableCell>
                            <TableCell>{batch.unmatchedRows}</TableCell>
                            <TableCell>{formatDateTime(batch.importedAt)}</TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleRevertAttendanceBatch(batch);
                                }}
                                disabled={!canRevert || actionState !== null}
                              >
                                {actionState === revertActionKey
                                  ? "Reverting..."
                                  : "Revert"}
                              </Button>
                            </TableCell>
                          </TableRow>
                          {isBatchExpanded && (
                            <TableRow
                              id={detailRowId}
                              className="bg-muted/20 hover:bg-muted/20"
                            >
                              <TableCell colSpan={9} className="p-0">
                                <div className="border-t px-4 py-4">
                                  {diagnosticsState?.status === "error" ? (
                                    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                      {diagnosticsState.error ??
                                        "Unable to load unmatched rows."}
                                    </div>
                                  ) : diagnosticsState?.status === "ready" ? (
                                    unmatchedGroups.length === 0 ? (
                                      <div className="rounded-md border bg-background px-3 py-3 text-sm text-muted-foreground">
                                        No unmatched rows were saved for this batch.
                                      </div>
                                    ) : (
                                      <div className="space-y-3">
                                        <div className="text-sm font-medium">
                                          Unmatched rows ({totalUnmatchedRows})
                                        </div>
                                        <div className="overflow-hidden rounded-md border bg-background">
                                          {unmatchedGroups.map((group) => {
                                            const groupKey = `${batch.id}:${group.employeeNo}`;
                                            const isGroupExpanded =
                                              expandedUnmatchedGroupKeys.has(groupKey);

                                            return (
                                              <div
                                                key={groupKey}
                                                className="border-t first:border-t-0"
                                              >
                                                <button
                                                  type="button"
                                                  className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                  onClick={() =>
                                                    handleToggleUnmatchedGroup(
                                                      batch.id,
                                                      group.employeeNo
                                                    )
                                                  }
                                                  aria-expanded={isGroupExpanded}
                                                  title={`${
                                                    isGroupExpanded
                                                      ? "Collapse"
                                                      : "Expand"
                                                  } rows for ${
                                                    formatEmployeeNoDisplay(
                                                      group.employeeNo
                                                    ) || group.employeeNo
                                                  }`}
                                                >
                                                  {isGroupExpanded ? (
                                                    <ChevronDown
                                                      className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                                                      aria-hidden="true"
                                                    />
                                                  ) : (
                                                    <ChevronRight
                                                      className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                                                      aria-hidden="true"
                                                    />
                                                  )}
                                                  <span className="min-w-0 flex-1">
                                                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                                      <span className="font-medium">
                                                        {formatEmployeeNoDisplay(
                                                          group.employeeNo
                                                        ) || group.employeeNo}
                                                      </span>
                                                      <span className="text-xs text-muted-foreground">
                                                        {group.rowCount} row(s)
                                                      </span>
                                                      <span className="text-xs text-muted-foreground">
                                                        {formatDateRange(
                                                          group.startDate,
                                                          group.endDate
                                                        )}
                                                      </span>
                                                      <span className="text-xs text-muted-foreground">
                                                        {formatSourceLineRange(
                                                          group.firstSourceLine,
                                                          group.lastSourceLine
                                                        )}
                                                      </span>
                                                    </span>
                                                    {group.sampleRawText && (
                                                      <span className="mt-1 block whitespace-normal break-words text-xs text-muted-foreground">
                                                        {group.sampleRawText}
                                                      </span>
                                                    )}
                                                  </span>
                                                </button>
                                                {isGroupExpanded && (
                                                  <div className="border-t bg-muted/20 p-3">
                                                    <Table className="min-w-[760px] table-fixed bg-background">
                                                      <TableHeader>
                                                        <TableRow>
                                                          <TableHead className="w-20">
                                                            Line
                                                          </TableHead>
                                                          <TableHead className="w-28">
                                                            Date
                                                          </TableHead>
                                                          <TableHead className="w-24">
                                                            Time
                                                          </TableHead>
                                                          <TableHead className="w-40">
                                                            Device / Site
                                                          </TableHead>
                                                          <TableHead>Raw text</TableHead>
                                                        </TableRow>
                                                      </TableHeader>
                                                      <TableBody>
                                                        {group.rows.map((row) => (
                                                          <TableRow key={row.id}>
                                                            <TableCell>
                                                              {row.sourceLine ?? "-"}
                                                            </TableCell>
                                                            <TableCell>
                                                              {row.logDate}
                                                            </TableCell>
                                                            <TableCell>
                                                              {row.logTime}
                                                            </TableCell>
                                                            <TableCell className="text-xs text-muted-foreground">
                                                              {formatDeviceSite(
                                                                row.deviceId,
                                                                row.siteCode
                                                              )}
                                                            </TableCell>
                                                            <TableCell className="whitespace-normal break-words text-xs text-muted-foreground">
                                                              {row.rawText ?? "-"}
                                                            </TableCell>
                                                          </TableRow>
                                                        ))}
                                                      </TableBody>
                                                    </Table>
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )
                                  ) : (
                                    <div className="rounded-md border bg-background px-3 py-3 text-sm text-muted-foreground">
                                      Loading unmatched rows...
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                    {attendanceBatches.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="py-10 text-center text-muted-foreground"
                        >
                          No attendance import batches yet for the selected payroll
                          period.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

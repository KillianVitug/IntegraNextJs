"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  getManagerAttendanceImportBatchUnmatchedDiagnosticsAction,
  saveManagerAttendanceDtrDayMetricOverrideAction,
} from "@/app/actions/attendanceImportAction";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  AttendanceImportBatchDiagnosticsView,
  AttendanceDtrHeldRowsView,
  AttendanceDtrView,
} from "@/app/(ntg)/payroll/types";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  computeAttendanceHoldWorkedMinutes,
  computeDisplayedDtrWorkedMinutes,
} from "@/lib/payroll/dtrOverrides";
import { cn } from "@/lib/utils";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";

type PayrollPeriodOption = {
  id: string;
  code: string;
  payrollTerms: string;
  cycle: "A" | "B";
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  adjustedPayDate: string;
  status: string;
  attendanceBatchCount: number;
};

type ManagerImportBatch = {
  id: string;
  payrollPeriodId: string | null;
  sourceFileName: string;
  sourceFormat: string;
  status: string;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  scopedMatchedRows: number;
  canViewUnmatchedDiagnostics: boolean;
  notes: string | null;
  importedAt: string;
};

type Props = {
  year: number;
  periods: PayrollPeriodOption[];
  selectedPeriodId: string | null;
  managerEmployeeCount: number;
  batches: ManagerImportBatch[];
  dtr: AttendanceDtrView | null;
  heldRows: AttendanceDtrHeldRowsView | null;
  employeeId: string;
  importStatus?: string;
  imported?: number;
  denied?: number;
  unmatched?: number;
  refreshStatus?: string;
  summaries?: number;
  removeStatus?: string;
  removedLogs?: number;
  removedSummaries?: number;
  holdRefreshed?: number;
  holdDeleted?: number;
  holdOverridesCleared?: number;
  holdEditEmployeeId?: string;
  holdStatus?: string;
  holdMessage?: string;
  payrollRecomputeStatus?: string;
  payrollRunNumber?: number;
  payrollRecomputeMessage?: string;
};

type AttendanceHoldEmployeeGroup = {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentId: number | null;
  departmentName: string | null;
  departmentCode: string | null;
  heldDates: string[];
  editableDates: string[];
  workedMinutes: number;
  intendedWorkedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
  editableWorkedMinutes: number;
  editableIntendedWorkedMinutes: number;
  editableLateMinutes: number;
  editableUndertimeMinutes: number;
  editableOvertimeMinutes: number;
  status: "Hold" | "Pending" | "Approved" | "Partial";
  source: "Auto" | "Manual" | "Mixed";
  rows: AttendanceDtrHeldRowsView["rows"];
};

type AttendanceHoldDraft = {
  targetPayrollPeriodId: string;
  workedHours: string;
  workedMinutes: string;
  lateHours: string;
  lateMinutes: string;
  undertimeHours: string;
  undertimeMinutes: string;
  overtimeHours: string;
  overtimeMinutes: string;
};

type ManagerDtrMetricDraft = {
  lateHours: string;
  lateMinutes: string;
  undertimeHours: string;
  undertimeMinutes: string;
  overtimeHours: string;
  overtimeMinutes: string;
};

type ManagerDtrMetricDraftField = keyof ManagerDtrMetricDraft;

type AttendanceHoldMetric = "worked" | "late" | "undertime" | "overtime";

type AttendanceHoldDraftTimeField =
  | "workedHours"
  | "workedMinutes"
  | "lateHours"
  | "lateMinutes"
  | "undertimeHours"
  | "undertimeMinutes"
  | "overtimeHours"
  | "overtimeMinutes";

type AttendanceHoldDisplayMinutes = {
  workedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  overtimeMinutes: number;
};

type AttendanceBatchDiagnosticsState = {
  status: "loading" | "ready" | "error";
  data: AttendanceImportBatchDiagnosticsView | null;
  error: string | null;
};

const MANILA_TIME_ZONE = "Asia/Manila";
const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: MANILA_TIME_ZONE,
});

function formatDateTime(value: string) {
  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return dateTimeFormatter.format(parsedDate);
}

function formatDateRange(startDate: string, endDate: string) {
  if (startDate === endDate) return startDate;
  return `${startDate} to ${endDate}`;
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

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatMinutes(minutes: number) {
  const sign = minutes < 0 ? "-" : "";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const mins = absolute % 60;
  return `${sign}${hours}h ${String(mins).padStart(2, "0")}m`;
}

function formatDays(days: number) {
  return days.toFixed(2).replace(/\.00$/, "");
}

function getDisplayedDtrWorkedMinutes(
  row: AttendanceDtrView["employees"][number]["rows"][number]
) {
  return computeDisplayedDtrWorkedMinutes({
    workedMinutes: row.workedMinutes,
    scheduledMinutes: row.scheduledMinutes,
    lateMinutes: row.lateMinutes,
    undertimeMinutes: row.undertimeMinutes,
  });
}

function getAttendanceHoldRowDisplayMinutes(
  row: AttendanceDtrHeldRowsView["rows"][number]
): AttendanceHoldDisplayMinutes {
  if (row.approvalStatus === "Hold") {
    const lateMinutes = row.lateMinutes;
    const undertimeMinutes = row.undertimeMinutes;

    return {
      workedMinutes: computeAttendanceHoldWorkedMinutes({
        intendedWorkedMinutes: row.intendedWorkedMinutes,
        lateMinutes,
        undertimeMinutes,
      }),
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
      computeAttendanceHoldWorkedMinutes({
        intendedWorkedMinutes: row.intendedWorkedMinutes,
        lateMinutes,
        undertimeMinutes,
      }),
    lateMinutes,
    undertimeMinutes,
    overtimeMinutes: row.approvedOvertimeMinutes ?? row.overtimeMinutes,
  };
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
  const hours = normalizedHours === "" ? 0 : Number.parseInt(normalizedHours, 10);
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

function getManagerDtrMetricDraftKey(employeeId: string, attendanceDate: string) {
  return `${employeeId}:${attendanceDate}`;
}

function getManagerDtrMetricBaselineWorkedMinutes(
  row: AttendanceDtrView["employees"][number]["rows"][number]
) {
  if (row.scheduledMinutes > 0) return row.scheduledMinutes;
  if (row.biometricWorkedMinutes > 0) return row.biometricWorkedMinutes;
  return row.workedMinutes > 0 ? row.workedMinutes : 8 * 60;
}

function getManagerDtrMetricComputedWorkedMinutes(args: {
  row: AttendanceDtrView["employees"][number]["rows"][number];
  lateMinutes: number;
  undertimeMinutes: number;
}) {
  return Math.max(
    0,
    getManagerDtrMetricBaselineWorkedMinutes(args.row) -
      args.lateMinutes -
      args.undertimeMinutes
  );
}

function createManagerDtrMetricDraft(
  row: AttendanceDtrView["employees"][number]["rows"][number]
): ManagerDtrMetricDraft {
  const late = splitAttendanceHoldDraftMinutes(row.lateMinutes);
  const undertime = splitAttendanceHoldDraftMinutes(row.undertimeMinutes);
  const overtime = splitAttendanceHoldDraftMinutes(row.overtimeMinutes);

  return {
    lateHours: late.hours,
    lateMinutes: late.minutes,
    undertimeHours: undertime.hours,
    undertimeMinutes: undertime.minutes,
    overtimeHours: overtime.hours,
    overtimeMinutes: overtime.minutes,
  };
}

function getManagerDtrMetricDraftMinutes(draft: ManagerDtrMetricDraft) {
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
    lateMinutes == null ||
    undertimeMinutes == null ||
    overtimeMinutes == null
  ) {
    return null;
  }

  return { lateMinutes, undertimeMinutes, overtimeMinutes };
}

function importResultLabel(args: {
  importStatus?: string;
  imported?: number;
  denied?: number;
  unmatched?: number;
}) {
  if (!args.importStatus) return null;
  if (args.importStatus === "missing-files") {
    return "No DTR files were selected for import.";
  }
  if (args.importStatus === "missing-period") {
    return "Select a payroll period before importing DTR files.";
  }
  if (args.importStatus === "failed") {
    return "DTR import failed before the files could be processed.";
  }

  const imported = args.imported ?? 0;
  const denied = args.denied ?? 0;
  const unmatched = args.unmatched ?? 0;
  const unmatchedMessage =
    unmatched > 0 ? ` ${unmatched} unmatched row(s) need review.` : "";
  if (denied > 0) {
    return `${imported} DTR file(s) imported. ${denied} file(s) could not be imported.${unmatchedMessage}`;
  }
  return `${imported} DTR file(s) imported.${unmatchedMessage}`;
}

function refreshResultLabel(args: {
  refreshStatus?: string;
  summaries?: number;
  holdRefreshed?: number;
  holdDeleted?: number;
  holdOverridesCleared?: number;
}) {
  if (!args.refreshStatus) return null;
  if (args.refreshStatus === "missing-period") {
    return "Select a payroll period before refreshing stored summaries.";
  }
  if (args.refreshStatus === "failed") {
    return "Stored summary refresh failed. No approved Attendance Hold values were changed.";
  }

  const summaries = args.summaries ?? 0;
  const holdRefreshed = args.holdRefreshed ?? 0;
  const holdDeleted = args.holdDeleted ?? 0;
  const holdOverridesCleared = args.holdOverridesCleared ?? 0;
  return `${summaries} stored summary row(s) refreshed. Attendance Hold values were refreshed for ${holdRefreshed} unapproved row(s), ${holdDeleted} unapproved row(s) no longer on hold were cleared, and ${holdOverridesCleared} stale manual Hold override(s) without hold flags were removed. Approved Attendance Hold values were unchanged. These shared updates are visible to Admin after reload.`;
}

function payrollRecomputeResultLabel(args: {
  payrollRecomputeStatus?: string;
  payrollRunNumber?: number;
  payrollRecomputeMessage?: string;
}) {
  if (!args.payrollRecomputeStatus) return null;

  if (args.payrollRecomputeStatus === "computed") {
    return args.payrollRunNumber
      ? `Payroll recomputed. Admin Payroll now shows Run #${args.payrollRunNumber} with the latest DTR totals.`
      : "Payroll recomputed. Admin Payroll now shows the latest DTR totals.";
  }

  if (args.payrollRecomputeStatus === "skipped") {
    return args.payrollRecomputeMessage ?? "Payroll recompute skipped.";
  }

  if (
    args.payrollRecomputeStatus === "failed" ||
    args.payrollRecomputeStatus === "blocked"
  ) {
    return `Payroll recompute failed. ${
      args.payrollRecomputeMessage ??
      "Admin must resolve the payroll run status before totals can be updated."
    }`;
  }

  return args.payrollRecomputeMessage ?? null;
}

function removeResultLabel(args: {
  removeStatus?: string;
  removedLogs?: number;
  removedSummaries?: number;
}) {
  if (!args.removeStatus) return null;
  if (args.removeStatus === "missing-batch") {
    return "Select an imported DTR file before removing it.";
  }
  if (args.removeStatus === "failed") {
    return "DTR file removal failed. Mixed-department files and approved or posted payroll periods must be handled by Admin.";
  }

  const removedLogs = args.removedLogs ?? 0;
  const removedSummaries = args.removedSummaries ?? 0;
  return `DTR file removed. ${removedLogs} raw log(s) and ${removedSummaries} daily summary row(s) were removed.`;
}

function buildManagerDtrFilesHref(args: {
  year: number;
  periodId: string | null;
  employeeId: string | null;
  holdEditEmployeeId?: string | null;
  payrollRecomputeStatus?: string | null;
  payrollRunNumber?: number | null;
  payrollRecomputeMessage?: string | null;
}) {
  const params = new URLSearchParams();
  params.set("year", String(args.year));
  if (args.periodId) params.set("periodId", args.periodId);
  if (args.employeeId) params.set("employeeId", args.employeeId);
  if (args.holdEditEmployeeId) {
    params.set("holdEditEmployeeId", args.holdEditEmployeeId);
  }
  if (args.payrollRecomputeStatus) {
    params.set("payrollRecomputeStatus", args.payrollRecomputeStatus);
  }
  if (args.payrollRunNumber != null) {
    params.set("payrollRunNumber", String(args.payrollRunNumber));
  }
  if (args.payrollRecomputeMessage) {
    params.set("payrollRecomputeMessage", args.payrollRecomputeMessage);
  }
  return `/managerDtrFiles?${params.toString()}`;
}

export function ManagerDtrFilesClient({
  year,
  periods,
  selectedPeriodId,
  managerEmployeeCount,
  batches,
  dtr,
  heldRows,
  employeeId,
  importStatus,
  imported,
  denied,
  unmatched,
  refreshStatus,
  summaries,
  removeStatus,
  removedLogs,
  removedSummaries,
  holdRefreshed,
  holdDeleted,
  holdOverridesCleared,
  holdEditEmployeeId = "",
  holdStatus,
  holdMessage,
  payrollRecomputeStatus,
  payrollRunNumber,
  payrollRecomputeMessage,
}: Props) {
  const [heldRowsState, setHeldRowsState] =
    useState<AttendanceDtrHeldRowsView | null>(heldRows);
  const [expandedAttendanceBatchIds, setExpandedAttendanceBatchIds] =
    useState<Set<string>>(new Set());
  const [expandedUnmatchedGroupKeys, setExpandedUnmatchedGroupKeys] =
    useState<Set<string>>(new Set());
  const [
    attendanceBatchDiagnosticsById,
    setAttendanceBatchDiagnosticsById,
  ] = useState<Record<string, AttendanceBatchDiagnosticsState>>({});
  const [expandedAttendanceHoldEmployeeIds, setExpandedAttendanceHoldEmployeeIds] =
    useState<Set<string>>(new Set());
  const [attendanceHoldDrafts, setAttendanceHoldDrafts] = useState<
    Record<string, AttendanceHoldDraft>
  >({});
  const [editingDtrMetricKey, setEditingDtrMetricKey] = useState<string | null>(
    null
  );
  const [dtrMetricDraft, setDtrMetricDraft] =
    useState<ManagerDtrMetricDraft | null>(null);
  const [savingDtrMetricKey, setSavingDtrMetricKey] = useState<string | null>(
    null
  );
  const [dtrMetricError, setDtrMetricError] = useState<string | null>(null);
  const selectedPeriod =
    periods.find((period) => period.id === selectedPeriodId) ?? null;
  const attendanceHoldTargetPeriods = useMemo(() => {
    if (!selectedPeriod) return [];
    return periods.filter(
      (period) =>
        period.id === selectedPeriod.id ||
        period.startDate >= selectedPeriod.startDate
    );
  }, [periods, selectedPeriod]);
  const employees = dtr?.employees ?? [];
  const selectedEmployee =
    employees.find((employee) => employee.employeeId === employeeId) ??
    employees[0] ??
    null;
  const visibleHeldRows = useMemo(
    () => heldRowsState?.rows ?? [],
    [heldRowsState]
  );
  const resultLabel = importResultLabel({
    importStatus,
    imported,
    denied,
    unmatched,
  });
  const importSucceeded = importStatus === "success";
  const refreshLabel = refreshResultLabel({
    refreshStatus,
    summaries,
    holdRefreshed,
    holdDeleted,
    holdOverridesCleared,
  });
  const refreshSucceeded = refreshStatus === "success";
  const removeLabel = removeResultLabel({
    removeStatus,
    removedLogs,
    removedSummaries,
  });
  const removeSucceeded = removeStatus === "success";
  const payrollRecomputeLabel = payrollRecomputeResultLabel({
    payrollRecomputeStatus,
    payrollRunNumber,
    payrollRecomputeMessage,
  });
  const payrollRecomputeSucceeded = payrollRecomputeStatus === "computed";
  const payrollRecomputeFailed =
    payrollRecomputeStatus === "failed" ||
    payrollRecomputeStatus === "blocked";
  const holdResultMessage =
    holdMessage ??
    (holdStatus === "submitted"
      ? "Attendance Hold saved and approved."
      : holdStatus === "failed"
        ? "Unable to save Attendance Hold."
        : null);
  const holdResultSucceeded = holdStatus === "submitted";
  const groupedAttendanceHoldEmployees = useMemo<AttendanceHoldEmployeeGroup[]>(() => {
    const groupsByEmployeeId = new Map<string, AttendanceHoldEmployeeGroup>();

    for (const row of visibleHeldRows) {
      const displayMinutes = getAttendanceHoldRowDisplayMinutes(row);
      const isEditable = true;
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
          editableDates: [],
          workedMinutes: 0,
          intendedWorkedMinutes: 0,
          lateMinutes: 0,
          undertimeMinutes: 0,
          overtimeMinutes: 0,
          editableWorkedMinutes: 0,
          editableIntendedWorkedMinutes: 0,
          editableLateMinutes: 0,
          editableUndertimeMinutes: 0,
          editableOvertimeMinutes: 0,
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

      if (isEditable) {
        group.editableDates.push(row.attendanceDate);
        group.editableWorkedMinutes += displayMinutes.workedMinutes;
        group.editableIntendedWorkedMinutes += row.intendedWorkedMinutes;
        group.editableLateMinutes += displayMinutes.lateMinutes;
        group.editableUndertimeMinutes += displayMinutes.undertimeMinutes;
        group.editableOvertimeMinutes += displayMinutes.overtimeMinutes;
      }

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
          editableDates: [...new Set(group.editableDates)].sort((left, right) =>
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
  }, [visibleHeldRows]);

  useEffect(() => {
    setHeldRowsState(heldRows);
    setAttendanceHoldDrafts({});
    setExpandedAttendanceHoldEmployeeIds(new Set());
    setExpandedAttendanceBatchIds(new Set());
    setExpandedUnmatchedGroupKeys(new Set());
    setAttendanceBatchDiagnosticsById({});
    setEditingDtrMetricKey(null);
    setDtrMetricDraft(null);
    setSavingDtrMetricKey(null);
    setDtrMetricError(null);
  }, [heldRows, selectedPeriodId]);

  useEffect(() => {
    setEditingDtrMetricKey(null);
    setDtrMetricDraft(null);
    setSavingDtrMetricKey(null);
    setDtrMetricError(null);
  }, [selectedEmployee?.employeeId]);

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
      const data =
        await getManagerAttendanceImportBatchUnmatchedDiagnosticsAction(batchId);

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

  function handleToggleAttendanceBatch(batch: ManagerImportBatch) {
    if (!batch.canViewUnmatchedDiagnostics) return;

    const isExpanded = expandedAttendanceBatchIds.has(batch.id);

    setExpandedAttendanceBatchIds((current) => {
      const next = new Set(current);
      if (isExpanded) {
        next.delete(batch.id);
      } else {
        next.add(batch.id);
      }
      return next;
    });

    const diagnosticsState = attendanceBatchDiagnosticsById[batch.id];
    if (
      !isExpanded &&
      diagnosticsState?.status !== "loading" &&
      diagnosticsState?.status !== "ready"
    ) {
      void loadAttendanceBatchDiagnostics(batch.id);
    }
  }

  function handleToggleUnmatchedGroup(batchId: string, employeeNo: string, reason: string) {
    const groupKey = `${batchId}:${employeeNo}:${reason}`;

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

  function createAttendanceHoldDraft(
    employee: AttendanceHoldEmployeeGroup
  ): AttendanceHoldDraft {
    const worked = splitAttendanceHoldDraftMinutes(employee.editableWorkedMinutes);
    const late = splitAttendanceHoldDraftMinutes(employee.editableLateMinutes);
    const undertime = splitAttendanceHoldDraftMinutes(
      employee.editableUndertimeMinutes
    );
    const overtime = splitAttendanceHoldDraftMinutes(employee.editableOvertimeMinutes);
    const targetPayrollPeriodId = selectedPeriodId ?? "";

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
    };
  }

  function handleEditAttendanceHoldEmployee(employee: AttendanceHoldEmployeeGroup) {
    setAttendanceHoldDrafts((prev) => ({
      ...prev,
      [employee.employeeId]: createAttendanceHoldDraft(employee),
    }));
    setExpandedAttendanceHoldEmployeeIds((prev) => {
      const next = new Set(prev);
      next.add(employee.employeeId);
      return next;
    });
  }

  function toggleAttendanceHoldExpanded(employeeId: string) {
    setExpandedAttendanceHoldEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) {
        next.delete(employeeId);
      } else {
        next.add(employeeId);
      }
      return next;
    });
  }

  function getAttendanceHoldDraftAutoWorkedMinutes(
    employee: AttendanceHoldEmployeeGroup,
    draft: AttendanceHoldDraft
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

    return Math.max(
      0,
      computeAttendanceHoldWorkedMinutes({
        intendedWorkedMinutes: employee.editableIntendedWorkedMinutes,
        lateMinutes,
        undertimeMinutes,
      })
    );
  }

  function updateAttendanceHoldDraft(
    employeeId: string,
    updates: Partial<AttendanceHoldDraft>,
    options?: {
      employee?: AttendanceHoldEmployeeGroup;
    }
  ) {
    setAttendanceHoldDrafts((prev) => {
      const current = prev[employeeId];
      if (!current) return prev;
      const nextDraft = {
        ...current,
        ...updates,
      };

      if (options?.employee) {
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

  function renderAttendanceHoldDraftTimeInputs(
    employee: AttendanceHoldEmployeeGroup,
  draft: AttendanceHoldDraft,
  metric: AttendanceHoldMetric,
  label: string,
  disabled: boolean,
  formId: string
) {
    const hoursKey = `${metric}Hours` as AttendanceHoldDraftTimeField;
    const minutesKey = `${metric}Minutes` as AttendanceHoldDraftTimeField;
    const isWorked = metric === "worked";

    return (
      <div className="flex flex-col gap-1">
        <div className="grid min-w-[140px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
          <Input
            type="text"
            inputMode="numeric"
            value={draft[hoursKey]}
            name={hoursKey}
            form={formId}
            onChange={(event) => {
              if (isWorked) return;
              if (!isAttendanceHoldDraftTimeInput(event.target.value)) return;
              updateAttendanceHoldDraft(
                employee.employeeId,
                { [hoursKey]: event.target.value },
                { employee }
              );
            }}
            placeholder="h"
            className={cn(
              "h-9 w-16",
              isWorked ? "bg-muted/40 text-muted-foreground" : ""
            )}
            aria-label={`${label} hours for ${employee.employeeName}`}
            disabled={disabled}
            readOnly={isWorked}
          />
          <span className="text-center text-sm font-medium text-muted-foreground">
            :
          </span>
          <Input
            type="text"
            inputMode="numeric"
            value={draft[minutesKey]}
            name={minutesKey}
            form={formId}
            onChange={(event) => {
              if (isWorked) return;
              if (!isAttendanceHoldDraftTimeInput(event.target.value)) return;
              updateAttendanceHoldDraft(
                employee.employeeId,
                { [minutesKey]: event.target.value },
                { employee }
              );
            }}
            placeholder="m"
            className={cn(
              "h-9 w-16",
              isWorked ? "bg-muted/40 text-muted-foreground" : ""
            )}
            aria-label={`${label} minutes for ${employee.employeeName}`}
            disabled={disabled}
            readOnly={isWorked}
          />
        </div>
        {isWorked ? (
          <span className="text-[10px] font-medium uppercase text-muted-foreground">
            Auto
          </span>
        ) : null}
      </div>
    );
  }

  function refreshManagerDtrPage(
    payrollRecompute?: {
      status: string;
      payrollRunNumber?: number | null;
      message?: string | null;
    } | null
  ) {
    window.location.assign(
      buildManagerDtrFilesHref({
        year,
        periodId: selectedPeriodId,
        employeeId: selectedEmployee?.employeeId ?? null,
        holdEditEmployeeId: null,
        payrollRecomputeStatus: payrollRecompute?.status ?? null,
        payrollRunNumber: payrollRecompute?.payrollRunNumber ?? null,
        payrollRecomputeMessage: payrollRecompute?.message ?? null,
      })
    );
  }

  function handleEditDtrMetricRow(
    row: AttendanceDtrView["employees"][number]["rows"][number]
  ) {
    if (!selectedEmployee) return;

    setEditingDtrMetricKey(
      getManagerDtrMetricDraftKey(selectedEmployee.employeeId, row.attendanceDate)
    );
    setDtrMetricDraft(createManagerDtrMetricDraft(row));
    setDtrMetricError(null);
  }

  function handleCancelDtrMetricRow() {
    setEditingDtrMetricKey(null);
    setDtrMetricDraft(null);
    setDtrMetricError(null);
  }

  function updateDtrMetricDraft(
    field: ManagerDtrMetricDraftField,
    value: string
  ) {
    if (!isAttendanceHoldDraftTimeInput(value)) return;
    setDtrMetricDraft((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current
    );
  }

  async function handleSaveDtrMetricRow(
    row: AttendanceDtrView["employees"][number]["rows"][number]
  ) {
    if (!selectedPeriodId || !selectedEmployee || !dtrMetricDraft) return;

    const minutes = getManagerDtrMetricDraftMinutes(dtrMetricDraft);
    if (!minutes) {
      setDtrMetricError("Enter non-negative whole-number hours and minutes from 0 to 59.");
      return;
    }

    const rowKey = getManagerDtrMetricDraftKey(
      selectedEmployee.employeeId,
      row.attendanceDate
    );
    setSavingDtrMetricKey(rowKey);
    setDtrMetricError(null);

    try {
      const result = await saveManagerAttendanceDtrDayMetricOverrideAction({
        payrollPeriodId: selectedPeriodId,
        employeeId: selectedEmployee.employeeId,
        attendanceDate: row.attendanceDate,
        ...minutes,
      });
      refreshManagerDtrPage(result.payrollRecompute);
    } catch (error) {
      setDtrMetricError(
        getErrorMessage(error, "Unable to save the DTR row override.")
      );
      setSavingDtrMetricKey(null);
    }
  }

  async function handleResetDtrMetricRow(
    row: AttendanceDtrView["employees"][number]["rows"][number]
  ) {
    if (!selectedPeriodId || !selectedEmployee) return;

    const rowKey = getManagerDtrMetricDraftKey(
      selectedEmployee.employeeId,
      row.attendanceDate
    );
    setSavingDtrMetricKey(rowKey);
    setDtrMetricError(null);

    try {
      const result = await saveManagerAttendanceDtrDayMetricOverrideAction({
        payrollPeriodId: selectedPeriodId,
        employeeId: selectedEmployee.employeeId,
        attendanceDate: row.attendanceDate,
        lateMinutes: null,
        undertimeMinutes: null,
        overtimeMinutes: null,
      });
      refreshManagerDtrPage(result.payrollRecompute);
    } catch (error) {
      setDtrMetricError(
        getErrorMessage(error, "Unable to reset the DTR row override.")
      );
      setSavingDtrMetricKey(null);
    }
  }

  function renderDtrMetricDraftInputs(
    row: AttendanceDtrView["employees"][number]["rows"][number],
    metric: "late" | "undertime" | "overtime",
    label: string
  ) {
    if (!dtrMetricDraft) return null;

    const hoursKey = `${metric}Hours` as ManagerDtrMetricDraftField;
    const minutesKey = `${metric}Minutes` as ManagerDtrMetricDraftField;
    const rowKey = selectedEmployee
      ? getManagerDtrMetricDraftKey(selectedEmployee.employeeId, row.attendanceDate)
      : "";
    const disabled = savingDtrMetricKey === rowKey;

    return (
      <div className="grid min-w-[120px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
        <Input
          type="text"
          inputMode="numeric"
          value={dtrMetricDraft[hoursKey]}
          onChange={(event) => updateDtrMetricDraft(hoursKey, event.target.value)}
          placeholder="h"
          className="h-8 w-14"
          aria-label={`${label} hours for ${row.attendanceDate}`}
          disabled={disabled}
        />
        <span className="text-center text-xs font-medium text-muted-foreground">
          :
        </span>
        <Input
          type="text"
          inputMode="numeric"
          value={dtrMetricDraft[minutesKey]}
          onChange={(event) => updateDtrMetricDraft(minutesKey, event.target.value)}
          placeholder="m"
          className="h-8 w-14"
          aria-label={`${label} minutes for ${row.attendanceDate}`}
          disabled={disabled}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Payroll Period</CardTitle>
          <CardDescription>
            DTR imports are limited to {managerEmployeeCount} employee
            {managerEmployeeCount === 1 ? "" : "s"} in your assigned departments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action="/managerDtrFiles"
            className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end"
          >
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="dtr-year">
                Year
              </label>
              <Input
                id="dtr-year"
                type="number"
                min={2000}
                max={2100}
                name="year"
                defaultValue={year}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="dtr-period">
                Period
              </label>
              <select
                id="dtr-period"
                name="periodId"
                defaultValue={selectedPeriodId ?? ""}
                className="flex h-11 w-full rounded-md border bg-background px-3 py-2 text-base md:h-9 md:py-1 md:text-sm"
              >
                {periods.length === 0 ? (
                  <option value="">No payroll periods available</option>
                ) : null}
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.code} | {period.startDate} to {period.endDate} |{" "}
                    {period.attendanceBatchCount} file
                    {period.attendanceBatchCount === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </div>

            <Button type="submit" variant="outline" size="sm" className="min-h-11 md:min-h-8">
              Apply
            </Button>
          </form>
          {periods.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No payroll periods are available for {year}.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Import DTR</CardTitle>
          <CardDescription>
            Upload biometric DTR files for the selected payroll period. Only rows
            matching your assigned departments are saved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            action="/managerDtrFiles/import"
            method="post"
            encType="multipart/form-data"
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]"
          >
            <input type="hidden" name="year" value={year} />
            <input type="hidden" name="periodId" value={selectedPeriodId ?? ""} />
            <input
              type="hidden"
              name="employeeId"
              value={selectedEmployee?.employeeId ?? ""}
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="dtr-files">
                DTR Files
              </label>
              <Input
                id="dtr-files"
                name="files"
                type="file"
                multiple
                accept=".csv,.txt,text/plain"
                disabled={!selectedPeriod}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={!selectedPeriod} className="min-h-11 w-full md:w-auto">
                <Upload className="h-4 w-4" />
                Import DTR
              </Button>
            </div>
          </form>
          <form
            action="/managerDtrFiles/refresh-summaries"
            method="post"
            className="flex justify-stretch md:justify-end"
          >
            <input type="hidden" name="year" value={year} />
            <input type="hidden" name="periodId" value={selectedPeriodId ?? ""} />
            <input
              type="hidden"
              name="employeeId"
              value={selectedEmployee?.employeeId ?? ""}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!selectedPeriod}
              className="min-h-11 w-full md:w-auto"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Stored Summaries
            </Button>
          </form>

          {resultLabel ? (
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                importSucceeded
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              {resultLabel}
            </div>
          ) : null}
          {refreshLabel ? (
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                refreshSucceeded
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              {refreshLabel}
            </div>
          ) : null}
          {removeLabel ? (
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                removeSucceeded
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              {removeLabel}
            </div>
          ) : null}
          {payrollRecomputeLabel ? (
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                payrollRecomputeSucceeded
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : payrollRecomputeFailed
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-amber-300 bg-amber-50 text-amber-900",
              )}
            >
              {payrollRecomputeLabel}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Imported Files</CardTitle>
          <CardDescription>
            Branch-visible DTR batches for this period.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {batches.map((batch) => {
            const canRemove = batch.status === "Processed";
            const isBatchExpanded = expandedAttendanceBatchIds.has(batch.id);
            const diagnosticsState = attendanceBatchDiagnosticsById[batch.id];
            const unmatchedGroups = diagnosticsState?.data?.groups ?? [];
            const totalUnmatchedRows =
              diagnosticsState?.data?.totalUnmatchedRows ?? 0;
            const detailId = `manager-attendance-batch-${batch.id}-diagnostics`;

            return (
              <div key={batch.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-medium">{batch.sourceFileName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(batch.importedAt)} | {batch.status}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    {batch.canViewUnmatchedDiagnostics ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-10"
                        onClick={() => handleToggleAttendanceBatch(batch)}
                        aria-expanded={isBatchExpanded}
                        aria-controls={detailId}
                        title={`${
                          isBatchExpanded ? "Collapse" : "Expand"
                        } unmatched rows for ${batch.sourceFileName}`}
                      >
                        {isBatchExpanded ? (
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        )}
                        Unmatched
                      </Button>
                    ) : null}
                    <form action="/managerDtrFiles/remove" method="post">
                      <input type="hidden" name="year" value={year} />
                      <input
                        type="hidden"
                        name="periodId"
                        value={selectedPeriodId ?? ""}
                      />
                      <input
                        type="hidden"
                        name="employeeId"
                        value={selectedEmployee?.employeeId ?? ""}
                      />
                      <input type="hidden" name="batchId" value={batch.id} />
                      <Button
                        type="submit"
                        variant="destructive"
                        size="sm"
                        className="min-h-10 w-full sm:w-auto"
                        disabled={!canRemove}
                        title={
                          canRemove
                            ? `Remove ${batch.sourceFileName}`
                            : "Only processed DTR files can be removed."
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </Button>
                    </form>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
                  <span>Total: {batch.totalRows}</span>
                  <span>Matched: {batch.matchedRows}</span>
                  <span>Unmatched: {batch.unmatchedRows}</span>
                  <span>Branch rows: {batch.scopedMatchedRows}</span>
                  <span>Duplicates: {batch.duplicateRows}</span>
                </div>
                {batch.notes ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {batch.notes}
                  </p>
                ) : null}
                {isBatchExpanded ? (
                  <div id={detailId} className="mt-3 border-t pt-3">
                    {diagnosticsState?.status === "error" ? (
                      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {diagnosticsState.error ?? "Unable to load unmatched rows."}
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
                              const groupKey = `${batch.id}:${group.employeeNo}:${group.reason}`;
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
                                        group.employeeNo,
                                        group.reason
                                      )
                                    }
                                    aria-expanded={isGroupExpanded}
                                    title={`${
                                      isGroupExpanded ? "Collapse" : "Expand"
                                    } rows for ${
                                      formatEmployeeNoDisplay(group.employeeNo) ||
                                      group.employeeNo
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
                                          {group.reason}
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
                                      {group.sampleRawText ? (
                                        <span className="mt-1 block whitespace-normal break-words text-xs text-muted-foreground">
                                          {group.sampleRawText}
                                        </span>
                                      ) : null}
                                    </span>
                                  </button>
                                  {isGroupExpanded ? (
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
                                              <TableCell>{row.logDate}</TableCell>
                                              <TableCell>{row.logTime}</TableCell>
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
                                  ) : null}
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
                ) : null}
              </div>
            );
          })}
          {batches.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No branch-visible DTR files imported for this period.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
          <CardHeader className="pb-3">
            <CardTitle>Semimonthly DTR</CardTitle>
            <CardDescription>
              Review DTR summaries and override row Late, Undertime, and OT for
              employees in your assigned departments.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              <form action="/managerDtrFiles" className="space-y-2">
                <input type="hidden" name="year" value={year} />
                {selectedPeriodId ? (
                  <input type="hidden" name="periodId" value={selectedPeriodId} />
                ) : null}
                <label
                  className="block text-sm font-medium"
                  htmlFor="dtr-employee"
                >
                  Employee
                </label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    id="dtr-employee"
                    name="employeeId"
                    defaultValue={selectedEmployee?.employeeId ?? ""}
                    className="flex h-11 w-full rounded-md border bg-background px-3 py-2 text-base md:h-9 md:py-1 md:text-sm"
                  >
                    {employees.map((employee) => (
                      <option key={employee.employeeId} value={employee.employeeId}>
                        {formatEmployeeNoDisplay(employee.employeeNo)} |{" "}
                        {employee.employeeName}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="outline" size="sm" className="min-h-11 md:min-h-8">
                    Apply
                  </Button>
                </div>
              </form>
            </div>

            {selectedEmployee ? (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">
                      Present Days
                    </div>
                    <div className="mt-1 font-semibold">
                      {formatDays(selectedEmployee.totals.presentDays)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">
                      Worked
                    </div>
                    <div className="mt-1 font-semibold">
                      {formatMinutes(selectedEmployee.totals.workedMinutes)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">
                      Late / UT
                    </div>
                    <div className="mt-1 font-semibold">
                      {formatMinutes(selectedEmployee.totals.lateMinutes)} /{" "}
                      {formatMinutes(selectedEmployee.totals.undertimeMinutes)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">
                      Computed Overtime
                    </div>
                    <div className="mt-1 font-semibold">
                      {formatMinutes(
                        selectedEmployee.totals.computed.overtimeMinutes
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">
                      Hold Rows
                    </div>
                    <div className="mt-1 font-semibold">
                      {
                        selectedEmployee.rows.filter(
                          (row) => row.effectiveStatus === "Hold",
                        ).length
                      }
                    </div>
                  </div>
                </div>

                <div className="rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileText className="h-4 w-4" />
                    Source file(s)
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedEmployee.sourceFiles.map((sourceFile) => (
                      <span
                        key={sourceFile.batchId}
                        className="rounded-md border bg-background px-2 py-1 text-xs"
                      >
                        {sourceFile.sourceFileName} ({sourceFile.punchCount})
                      </span>
                    ))}
                    {selectedEmployee.sourceFiles.length === 0 ? (
                      <span className="text-sm text-muted-foreground">
                        No source files for this period.
                      </span>
                    ) : null}
                  </div>
                </div>

                {dtrMetricError ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {dtrMetricError}
                  </div>
                ) : null}

                <div className="grid gap-2 md:hidden">
                  {selectedEmployee.rows.map((row) => {
                    const rowKey = getManagerDtrMetricDraftKey(
                      selectedEmployee.employeeId,
                      row.attendanceDate
                    );
                    const isEditing = editingDtrMetricKey === rowKey;
                    const isSaving = savingDtrMetricKey === rowKey;
                    const draftMinutes =
                      isEditing && dtrMetricDraft
                        ? getManagerDtrMetricDraftMinutes(dtrMetricDraft)
                        : null;
                    const displayLateMinutes =
                      draftMinutes?.lateMinutes ?? row.lateMinutes;
                    const displayUndertimeMinutes =
                      draftMinutes?.undertimeMinutes ?? row.undertimeMinutes;
                    const displayOvertimeMinutes =
                      draftMinutes?.overtimeMinutes ?? row.overtimeMinutes;
                    const displayWorkedMinutes =
                      draftMinutes != null
                        ? getManagerDtrMetricComputedWorkedMinutes({
                            row,
                            lateMinutes: draftMinutes.lateMinutes,
                            undertimeMinutes: draftMinutes.undertimeMinutes,
                          })
                        : getDisplayedDtrWorkedMinutes(row);
                    const hasMetricOverride =
                      row.isLateOverridden ||
                      row.isUndertimeOverridden ||
                      row.isOvertimeOverridden;

                    return (
                      <div key={`mobile-${row.attendanceDate}`} className="rounded-md border p-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{row.attendanceDate}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.dayName}
                            </div>
                          </div>
                          <span className="rounded-full bg-muted px-2 py-1 text-xs">
                            {row.effectiveStatus}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="text-muted-foreground">Punches</div>
                            <div className="break-words">
                              {row.rawPunches.length > 0
                                ? row.rawPunches.join(", ")
                                : "-"}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Schedule</div>
                            <div>
                              {row.scheduledInTime ?? "-"} -{" "}
                              {row.scheduledOutTime ?? "-"}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Worked</div>
                            <div className="font-medium">
                              {formatMinutes(displayWorkedMinutes)}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">OT</div>
                            <div className="font-medium">
                              {formatMinutes(displayOvertimeMinutes)}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2">
                          {isEditing ? (
                            <div className="grid gap-3">
                              <div>
                                <div className="mb-1 text-xs font-medium text-muted-foreground">
                                  Late
                                </div>
                                {renderDtrMetricDraftInputs(row, "late", "Late")}
                              </div>
                              <div>
                                <div className="mb-1 text-xs font-medium text-muted-foreground">
                                  Undertime
                                </div>
                                {renderDtrMetricDraftInputs(
                                  row,
                                  "undertime",
                                  "Undertime"
                                )}
                              </div>
                              <div>
                                <div className="mb-1 text-xs font-medium text-muted-foreground">
                                  Overtime
                                </div>
                                {renderDtrMetricDraftInputs(row, "overtime", "OT")}
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <div className="text-muted-foreground">Late</div>
                                <div>{formatMinutes(displayLateMinutes)}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground">UT</div>
                                <div>{formatMinutes(displayUndertimeMinutes)}</div>
                              </div>
                            </div>
                          )}
                          {row.anomalyFlags.length > 0 ? (
                            <div className="text-xs text-muted-foreground">
                              {row.anomalyFlags.join(", ")}
                            </div>
                          ) : null}
                          <div className="grid grid-cols-2 gap-2">
                            {isEditing ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="min-h-10"
                                  onClick={() => void handleSaveDtrMetricRow(row)}
                                  disabled={isSaving || draftMinutes == null}
                                >
                                  <Save className="h-4 w-4" />
                                  Save
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="min-h-10"
                                  onClick={handleCancelDtrMetricRow}
                                  disabled={isSaving}
                                >
                                  <X className="h-4 w-4" />
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="min-h-10"
                                  onClick={() => handleEditDtrMetricRow(row)}
                                  disabled={savingDtrMetricKey != null}
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </Button>
                                {hasMetricOverride ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="min-h-10"
                                    onClick={() => void handleResetDtrMetricRow(row)}
                                    disabled={savingDtrMetricKey != null}
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                    Reset
                                  </Button>
                                ) : null}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {selectedEmployee.rows.length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                      No DTR summary rows for this employee and period.
                    </div>
                  ) : null}
                </div>

                <div className="hidden max-h-[520px] overflow-auto rounded-md border md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Punches</TableHead>
                        <TableHead>Schedule</TableHead>
                        <TableHead>Worked</TableHead>
                        <TableHead>Late</TableHead>
                        <TableHead>UT</TableHead>
                        <TableHead>OT</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedEmployee.rows.map((row) => {
                        const rowKey = getManagerDtrMetricDraftKey(
                          selectedEmployee.employeeId,
                          row.attendanceDate
                        );
                        const isEditing = editingDtrMetricKey === rowKey;
                        const isSaving = savingDtrMetricKey === rowKey;
                        const draftMinutes =
                          isEditing && dtrMetricDraft
                            ? getManagerDtrMetricDraftMinutes(dtrMetricDraft)
                            : null;
                        const displayLateMinutes =
                          draftMinutes?.lateMinutes ?? row.lateMinutes;
                        const displayUndertimeMinutes =
                          draftMinutes?.undertimeMinutes ?? row.undertimeMinutes;
                        const displayOvertimeMinutes =
                          draftMinutes?.overtimeMinutes ?? row.overtimeMinutes;
                        const displayWorkedMinutes =
                          draftMinutes != null
                            ? getManagerDtrMetricComputedWorkedMinutes({
                                row,
                                lateMinutes: draftMinutes.lateMinutes,
                                undertimeMinutes: draftMinutes.undertimeMinutes,
                              })
                            : getDisplayedDtrWorkedMinutes(row);
                        const hasMetricOverride =
                          row.isLateOverridden ||
                          row.isUndertimeOverridden ||
                          row.isOvertimeOverridden;

                        return (
                        <TableRow key={row.attendanceDate}>
                          <TableCell>
                            <div className="font-medium">{row.attendanceDate}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.dayName}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[220px] whitespace-normal text-xs">
                            {row.rawPunches.length > 0
                              ? row.rawPunches.join(", ")
                              : "-"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {row.scheduledInTime ?? "-"} -{" "}
                            {row.scheduledOutTime ?? "-"}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">
                              {formatMinutes(displayWorkedMinutes)}
                            </div>
                            {isEditing ? (
                              <div className="text-[10px] font-medium uppercase text-muted-foreground">
                                Auto
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {isEditing
                              ? renderDtrMetricDraftInputs(row, "late", "Late")
                              : (
                                  <div>
                                    {formatMinutes(displayLateMinutes)}
                                    {row.isLateOverridden ? (
                                      <div className="text-[10px] font-medium uppercase text-sky-700">
                                        Edited
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                          </TableCell>
                          <TableCell>
                            {isEditing
                              ? renderDtrMetricDraftInputs(
                                  row,
                                  "undertime",
                                  "Undertime"
                                )
                              : (
                                  <div>
                                    {formatMinutes(displayUndertimeMinutes)}
                                    {row.isUndertimeOverridden ? (
                                      <div className="text-[10px] font-medium uppercase text-sky-700">
                                        Edited
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                          </TableCell>
                          <TableCell>
                            {isEditing
                              ? renderDtrMetricDraftInputs(row, "overtime", "OT")
                              : (
                                  <div>
                                    {formatMinutes(displayOvertimeMinutes)}
                                    {row.isOvertimeOverridden ? (
                                      <div className="text-[10px] font-medium uppercase text-sky-700">
                                        Edited
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{row.effectiveStatus}</div>
                            {row.anomalyFlags.length > 0 ? (
                              <div className="text-xs text-muted-foreground">
                                {row.anomalyFlags.join(", ")}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {isEditing ? (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-8 px-2"
                                    onClick={() => void handleSaveDtrMetricRow(row)}
                                    disabled={isSaving || draftMinutes == null}
                                    aria-label={`Save DTR override for ${row.attendanceDate}`}
                                  >
                                    <Save className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2"
                                    onClick={handleCancelDtrMetricRow}
                                    disabled={isSaving}
                                    aria-label={`Cancel DTR override for ${row.attendanceDate}`}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2"
                                    onClick={() => handleEditDtrMetricRow(row)}
                                    disabled={savingDtrMetricKey != null}
                                    aria-label={`Edit DTR override for ${row.attendanceDate}`}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  {hasMetricOverride ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-2"
                                      onClick={() => void handleResetDtrMetricRow(row)}
                                      disabled={savingDtrMetricKey != null}
                                      aria-label={`Reset DTR override for ${row.attendanceDate}`}
                                    >
                                      <RotateCcw className="h-4 w-4" />
                                    </Button>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        );
                      })}
                      {selectedEmployee.rows.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={9}
                            className="py-8 text-center text-muted-foreground"
                          >
                            No DTR summary rows for this employee and period.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No employees are available for the selected period and department.
              </div>
            )}
          </CardContent>
        </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Attendance Hold</CardTitle>
          <CardDescription>
            Enter Held DTR values and save them as approved for the selected payroll period.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {holdResultMessage ? (
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                holdResultSucceeded
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              )}
            >
              {holdResultMessage}
            </div>
          ) : null}

          {groupedAttendanceHoldEmployees.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No Attendance Hold rows for the selected period.
            </div>
          ) : (
            <>
            <div className="grid gap-2 md:hidden">
              {groupedAttendanceHoldEmployees.map((employee) => {
                const statusClass =
                  employee.status === "Approved"
                    ? "bg-emerald-100 text-emerald-700"
                    : employee.status === "Pending"
                      ? "bg-violet-100 text-violet-700"
                      : employee.status === "Partial"
                        ? "bg-sky-100 text-sky-700"
                        : "bg-amber-100 text-amber-700";

                return (
                  <div key={`mobile-hold-${employee.employeeId}`} className="rounded-md border p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="break-words font-medium">
                          {employee.employeeName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatEmployeeNoDisplay(employee.employeeNo)}
                          {employee.departmentName
                            ? ` / ${employee.departmentName}`
                            : ""}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-1 text-xs font-medium",
                          statusClass
                        )}
                      >
                        {employee.status}
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">
                      {employee.heldDates.join(", ")}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Worked</div>
                        <div className="font-medium">
                          {formatMinutes(employee.workedMinutes)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Late</div>
                        <div>{formatMinutes(employee.lateMinutes)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">UT</div>
                        <div>{formatMinutes(employee.undertimeMinutes)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">OT</div>
                        <div>{formatMinutes(employee.overtimeMinutes)}</div>
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">
                      Scroll the details table below to edit held values.
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[220px]">Employee</TableHead>
                    <TableHead className="min-w-[160px]">Dates</TableHead>
                    <TableHead className="min-w-[100px]">Worked</TableHead>
                    <TableHead className="min-w-[100px]">Late</TableHead>
                    <TableHead className="min-w-[100px]">UT</TableHead>
                    <TableHead className="min-w-[100px]">OT</TableHead>
                    <TableHead className="min-w-[90px]">Status</TableHead>
                    <TableHead className="min-w-[120px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedAttendanceHoldEmployees.map((employee) => {
                    const isExpanded =
                      expandedAttendanceHoldEmployeeIds.has(
                        employee.employeeId
                      ) || holdEditEmployeeId === employee.employeeId;
                    const draft =
                      attendanceHoldDrafts[employee.employeeId] ??
                      (holdEditEmployeeId === employee.employeeId &&
                      employee.editableDates.length > 0
                        ? createAttendanceHoldDraft(employee)
                        : null);
                    const isSaving = false;
                    const formId = `attendance-hold-form-${employee.employeeId}`;
                    const detailsId = `attendance-hold-details-${employee.employeeId}`;
                    const detailsOpen = isExpanded || Boolean(draft);
                    const editHref = buildManagerDtrFilesHref({
                      year,
                      periodId: selectedPeriodId,
                      employeeId: selectedEmployee?.employeeId ?? null,
                      holdEditEmployeeId: employee.employeeId,
                    });
                    const cancelHref = buildManagerDtrFilesHref({
                      year,
                      periodId: selectedPeriodId,
                      employeeId: selectedEmployee?.employeeId ?? null,
                    });
                    const statusClass =
                      employee.status === "Approved"
                        ? "bg-emerald-100 text-emerald-700"
                        : employee.status === "Pending"
                          ? "bg-violet-100 text-violet-700"
                          : employee.status === "Partial"
                            ? "bg-sky-100 text-sky-700"
                            : "bg-amber-100 text-amber-700";

                    return (
                      <Fragment key={employee.employeeId}>
                        {/* Summary row */}
                        <TableRow>
                          <TableCell className="align-top pt-2">
                            <div className="flex items-start">
                              <span>
                                <span className="block font-medium">
                                  {employee.employeeName}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  {formatEmployeeNoDisplay(employee.employeeNo)}
                                  {employee.departmentName
                                    ? ` / ${employee.departmentName}`
                                    : ""}
                                </span>
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="align-top pt-2.5 text-xs text-muted-foreground">
                            {employee.heldDates.join(", ")}
                          </TableCell>
                          <TableCell className="align-top pt-2.5 font-medium tabular-nums">
                            {formatMinutes(employee.workedMinutes)}
                          </TableCell>
                          <TableCell className="align-top pt-2.5 tabular-nums">
                            {formatMinutes(employee.lateMinutes)}
                          </TableCell>
                          <TableCell className="align-top pt-2.5 tabular-nums">
                            {formatMinutes(employee.undertimeMinutes)}
                          </TableCell>
                          <TableCell className="align-top pt-2.5 tabular-nums">
                            {formatMinutes(employee.overtimeMinutes)}
                          </TableCell>
                          <TableCell className="align-top pt-2.5">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                                statusClass
                              )}
                            >
                              {employee.status}
                            </span>
                          </TableCell>
                          <TableCell className="align-top pt-2">
                            <div className="flex items-center gap-2">
                              {isSaving ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled
                                >
                                  {draft ? "Editing..." : "Edit"}
                                </Button>
                              ) : (
                                <Button asChild variant="outline" size="sm">
                                  <a
                                    href={editHref}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      handleEditAttendanceHoldEmployee(employee);
                                    }}
                                    aria-controls={detailsId}
                                    aria-expanded={detailsOpen}
                                  >
                                    {draft ? "Editing..." : "Edit"}
                                  </a>
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>

                        <TableRow>
                          <TableCell colSpan={8} className="p-0">
                            <details
                              id={detailsId}
                              open={detailsOpen || undefined}
                              className="group/attendance-hold"
                            >
                              <summary
                                className="flex cursor-pointer list-none items-center gap-2 border-t bg-muted/10 px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30 [&::-webkit-details-marker]:hidden"
                                onClick={() =>
                                  toggleAttendanceHoldExpanded(
                                    employee.employeeId
                                  )
                                }
                              >
                                <ChevronRight className="h-4 w-4 group-open/attendance-hold:hidden" />
                                <ChevronDown className="hidden h-4 w-4 group-open/attendance-hold:block" />
                                <span>
                                  {detailsOpen ? "Hide" : "Show"} details for{" "}
                                  {employee.employeeName}
                                </span>
                              </summary>

                              <div className="space-y-4 border-t bg-muted/20 px-4 py-4">
                                {draft ? (
                                  <div className="space-y-4 rounded-md border bg-background p-4">
                                    <div className="text-sm font-medium">
                                      Edit Attendance Hold Values
                                    </div>

                                    <form
                                      id={formId}
                                      action="/managerDtrFiles/attendance-hold"
                                      method="post"
                                    >
                                      <input
                                        type="hidden"
                                        name="year"
                                        value={year}
                                      />
                                      <input
                                        type="hidden"
                                        name="periodId"
                                        value={selectedPeriodId ?? ""}
                                      />
                                      <input
                                        type="hidden"
                                        name="selectedEmployeeId"
                                        value={
                                          selectedEmployee?.employeeId ?? ""
                                        }
                                      />
                                      <input
                                        type="hidden"
                                        name="employeeId"
                                        value={employee.employeeId}
                                      />
                                      {employee.editableDates.map(
                                        (attendanceDate) => (
                                          <input
                                            key={attendanceDate}
                                            type="hidden"
                                            name="attendanceDates"
                                            value={attendanceDate}
                                          />
                                        )
                                      )}
                                    </form>

                                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                      <div className="space-y-1.5">
                                        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                          Worked
                                        </label>
                                        {renderAttendanceHoldDraftTimeInputs(
                                          employee,
                                          draft,
                                          "worked",
                                          "Worked",
                                          isSaving,
                                          formId
                                        )}
                                      </div>
                                      <div className="space-y-1.5">
                                        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                          Late
                                        </label>
                                        {renderAttendanceHoldDraftTimeInputs(
                                          employee,
                                          draft,
                                          "late",
                                          "Late",
                                          isSaving,
                                          formId
                                        )}
                                      </div>
                                      <div className="space-y-1.5">
                                        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                          Undertime
                                        </label>
                                        {renderAttendanceHoldDraftTimeInputs(
                                          employee,
                                          draft,
                                          "undertime",
                                          "Undertime",
                                          isSaving,
                                          formId
                                        )}
                                      </div>
                                      <div className="space-y-1.5">
                                        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                          Overtime
                                        </label>
                                        {renderAttendanceHoldDraftTimeInputs(
                                          employee,
                                          draft,
                                          "overtime",
                                          "Overtime",
                                          isSaving,
                                          formId
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex flex-wrap items-end gap-3">
                                      <div className="space-y-1">
                                        <label
                                          className="block text-xs font-medium text-muted-foreground"
                                          htmlFor={`${formId}-target-period`}
                                        >
                                          Target Payroll Period
                                        </label>
                                        <select
                                          id={`${formId}-target-period`}
                                          name="targetPayrollPeriodId"
                                          form={formId}
                                          value={
                                            draft.targetPayrollPeriodId ||
                                            selectedPeriodId ||
                                            ""
                                          }
                                          onChange={(event) =>
                                            updateAttendanceHoldDraft(
                                              employee.employeeId,
                                              {
                                                targetPayrollPeriodId:
                                                  event.target.value,
                                              }
                                            )
                                          }
                                          disabled={
                                            isSaving ||
                                            attendanceHoldTargetPeriods.length === 0
                                          }
                                          className="flex h-9 w-64 rounded-md border bg-background px-3 py-1 text-sm"
                                        >
                                          {attendanceHoldTargetPeriods.length ===
                                          0 ? (
                                            <option value="">
                                              No target periods available
                                            </option>
                                          ) : null}
                                          {attendanceHoldTargetPeriods.map(
                                            (period) => (
                                              <option
                                                key={period.id}
                                                value={period.id}
                                              >
                                                {period.code} (
                                                {period.startDate} -{" "}
                                                {period.endDate})
                                              </option>
                                            )
                                          )}
                                        </select>
                                      </div>

                                      <div className="flex items-center gap-2">
                                        <Button
                                          type="submit"
                                          form={formId}
                                          size="sm"
                                          disabled={isSaving || !draft}
                                        >
                                          {isSaving ? "Saving..." : "Save"}
                                        </Button>
                                        <Button
                                          asChild
                                          variant="ghost"
                                          size="sm"
                                        >
                                          <a href={cancelHref}>Cancel</a>
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}

                                <div className="overflow-x-auto rounded-md border">
                                  <table className="w-full caption-bottom text-sm">
                                    <thead>
                                      <tr className="border-b">
                                        <th className="h-8 px-3 py-1 text-left text-xs font-medium text-muted-foreground">
                                          Date
                                        </th>
                                        <th className="h-8 px-3 py-1 text-left text-xs font-medium text-muted-foreground">
                                          Day
                                        </th>
                                        <th className="h-8 px-3 py-1 text-left text-xs font-medium text-muted-foreground">
                                          Punches
                                        </th>
                                        <th className="h-8 px-3 py-1 text-left text-xs font-medium text-muted-foreground">
                                          Schedule
                                        </th>
                                        <th className="h-8 px-3 py-1 text-left text-xs font-medium text-muted-foreground">
                                          Worked
                                        </th>
                                        <th className="h-8 px-3 py-1 text-left text-xs font-medium text-muted-foreground">
                                          Late
                                        </th>
                                        <th className="h-8 px-3 py-1 text-left text-xs font-medium text-muted-foreground">
                                          UT
                                        </th>
                                        <th className="h-8 px-3 py-1 text-left text-xs font-medium text-muted-foreground">
                                          OT
                                        </th>
                                        <th className="h-8 px-3 py-1 text-left text-xs font-medium text-muted-foreground">
                                          Status
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {employee.rows.map((row) => {
                                        const displayMinutes =
                                          getAttendanceHoldRowDisplayMinutes(
                                            row
                                          );
                                        const rowStatusClass =
                                          row.approvalStatus === "Approved"
                                            ? "bg-emerald-100 text-emerald-700"
                                            : row.approvalStatus === "Pending"
                                              ? "bg-violet-100 text-violet-700"
                                              : "bg-amber-100 text-amber-700";
                                        return (
                                          <tr
                                            key={`${row.employeeId}-${row.attendanceDate}`}
                                            className="border-b transition-colors hover:bg-muted/50 last:border-0"
                                          >
                                            <td className="px-3 py-2 align-middle text-xs font-medium">
                                              {row.attendanceDate}
                                            </td>
                                            <td className="px-3 py-2 align-middle text-xs text-muted-foreground">
                                              {row.dayName}
                                            </td>
                                            <td className="max-w-[180px] whitespace-normal px-3 py-2 align-middle text-xs">
                                              {row.rawPunches.length > 0 ? (
                                                row.rawPunches.join(", ")
                                              ) : (
                                                <span className="text-muted-foreground">
                                                  -
                                                </span>
                                              )}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 align-middle text-xs">
                                              {row.scheduledInTime ?? "-"} -{" "}
                                              {row.scheduledOutTime ?? "-"}
                                            </td>
                                            <td className="px-3 py-2 align-middle text-xs tabular-nums">
                                              {formatMinutes(
                                                displayMinutes.workedMinutes
                                              )}
                                            </td>
                                            <td className="px-3 py-2 align-middle text-xs tabular-nums">
                                              {formatMinutes(
                                                displayMinutes.lateMinutes
                                              )}
                                            </td>
                                            <td className="px-3 py-2 align-middle text-xs tabular-nums">
                                              {formatMinutes(
                                                displayMinutes.undertimeMinutes
                                              )}
                                            </td>
                                            <td className="px-3 py-2 align-middle text-xs tabular-nums">
                                              {formatMinutes(
                                                displayMinutes.overtimeMinutes
                                              )}
                                            </td>
                                            <td className="px-3 py-2 align-middle">
                                              <div className="flex flex-col gap-1">
                                                <span
                                                  className={cn(
                                                    "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                                                    rowStatusClass
                                                  )}
                                                >
                                                  {row.approvalStatus}
                                                  {row.targetPayrollPeriodCode
                                                    ? ` -> ${row.targetPayrollPeriodCode}`
                                                    : ""}
                                                </span>
                                                {row.anomalyFlags.length > 0 ? (
                                                  <span className="text-[10px] text-muted-foreground">
                                                    {row.anomalyFlags.join(
                                                      ", "
                                                    )}
                                                  </span>
                                                ) : null}
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </details>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

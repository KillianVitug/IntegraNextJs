"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Upload } from "lucide-react";
import type {
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
  holdEditEmployeeId?: string;
  holdStatus?: string;
  holdMessage?: string;
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

function isFixedScheduleAttendanceHoldRow(
  row: AttendanceDtrHeldRowsView["rows"][number]
) {
  return row.workedBaselineSource === "schedule" || row.scheduledMinutes > 0;
}

function getAttendanceHoldRowDisplayMinutes(
  row: AttendanceDtrHeldRowsView["rows"][number]
): AttendanceHoldDisplayMinutes {
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

function importResultLabel(args: {
  importStatus?: string;
  imported?: number;
  denied?: number;
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
  if (denied > 0) {
    return `${imported} DTR file(s) imported. ${denied} file(s) could not be imported.`;
  }
  return `${imported} DTR file(s) imported.`;
}

function buildManagerDtrFilesHref(args: {
  year: number;
  periodId: string | null;
  employeeId: string | null;
  holdEditEmployeeId?: string | null;
}) {
  const params = new URLSearchParams();
  params.set("year", String(args.year));
  if (args.periodId) params.set("periodId", args.periodId);
  if (args.employeeId) params.set("employeeId", args.employeeId);
  if (args.holdEditEmployeeId) {
    params.set("holdEditEmployeeId", args.holdEditEmployeeId);
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
  holdEditEmployeeId = "",
  holdStatus,
  holdMessage,
}: Props) {
  const [heldRowsState, setHeldRowsState] =
    useState<AttendanceDtrHeldRowsView | null>(heldRows);
  const [expandedAttendanceHoldEmployeeIds, setExpandedAttendanceHoldEmployeeIds] =
    useState<Set<string>>(new Set());
  const [attendanceHoldDrafts, setAttendanceHoldDrafts] = useState<
    Record<string, AttendanceHoldDraft>
  >({});
  const selectedPeriod =
    periods.find((period) => period.id === selectedPeriodId) ?? null;
  const employees = dtr?.employees ?? [];
  const selectedEmployee =
    employees.find((employee) => employee.employeeId === employeeId) ??
    employees[0] ??
    null;
  const visibleHeldRows = useMemo(
    () => heldRowsState?.rows ?? [],
    [heldRowsState]
  );
  const resultLabel = importResultLabel({ importStatus, imported, denied });
  const importSucceeded = importStatus === "success";
  const holdResultMessage =
    holdMessage ??
    (holdStatus === "submitted"
      ? "Attendance Hold submitted to admin."
      : holdStatus === "failed"
        ? "Unable to submit Attendance Hold."
        : null);
  const holdResultSucceeded = holdStatus === "submitted";
  const groupedAttendanceHoldEmployees = useMemo<AttendanceHoldEmployeeGroup[]>(() => {
    const groupsByEmployeeId = new Map<string, AttendanceHoldEmployeeGroup>();

    for (const row of visibleHeldRows) {
      const displayMinutes = getAttendanceHoldRowDisplayMinutes(row);
      const isEditable = row.approvalStatus !== "Approved";
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
  }, [heldRows, selectedPeriodId]);

  function createAttendanceHoldDraft(
    employee: AttendanceHoldEmployeeGroup
  ): AttendanceHoldDraft {
    const worked = splitAttendanceHoldDraftMinutes(employee.editableWorkedMinutes);
    const late = splitAttendanceHoldDraftMinutes(employee.editableLateMinutes);
    const undertime = splitAttendanceHoldDraftMinutes(
      employee.editableUndertimeMinutes
    );
    const overtime = splitAttendanceHoldDraftMinutes(employee.editableOvertimeMinutes);
    const targetPayrollPeriodId =
      employee.rows.find(
        (row) => row.approvalStatus !== "Approved" && row.targetPayrollPeriodId
      )?.targetPayrollPeriodId ?? "";

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
    if (employee.editableDates.length === 0) return;

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
      employee.editableIntendedWorkedMinutes - lateMinutes - undertimeMinutes
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
                className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
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

            <Button type="submit" variant="outline" size="sm">
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
              <Button type="submit" disabled={!selectedPeriod}>
                <Upload className="h-4 w-4" />
                Import DTR
              </Button>
            </div>
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
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Semimonthly DTR</CardTitle>
            <CardDescription>
              Read-only DTR summaries for employees in your assigned departments.
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
                    className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
                  >
                    {employees.map((employee) => (
                      <option key={employee.employeeId} value={employee.employeeId}>
                        {formatEmployeeNoDisplay(employee.employeeNo)} |{" "}
                        {employee.employeeName}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="outline" size="sm">
                    Apply
                  </Button>
                </div>
              </form>
            </div>

            {selectedEmployee ? (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

                <div className="max-h-[520px] overflow-auto rounded-md border">
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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedEmployee.rows.map((row) => (
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
                          <TableCell>{formatMinutes(row.workedMinutes)}</TableCell>
                          <TableCell>{formatMinutes(row.lateMinutes)}</TableCell>
                          <TableCell>{formatMinutes(row.undertimeMinutes)}</TableCell>
                          <TableCell>{formatMinutes(row.overtimeMinutes)}</TableCell>
                          <TableCell>
                            <div className="font-medium">{row.effectiveStatus}</div>
                            {row.anomalyFlags.length > 0 ? (
                              <div className="text-xs text-muted-foreground">
                                {row.anomalyFlags.join(", ")}
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                      {selectedEmployee.rows.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={8}
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

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Imported Files</CardTitle>
              <CardDescription>
                Branch-visible DTR batches for this period.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {batches.map((batch) => (
                <div key={batch.id} className="rounded-md border p-3 text-sm">
                  <div className="font-medium">{batch.sourceFileName}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(batch.importedAt)} | {batch.status}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <span>Branch rows: {batch.scopedMatchedRows}</span>
                    <span>Duplicates: {batch.duplicateRows}</span>
                  </div>
                  {batch.notes ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {batch.notes}
                    </p>
                  ) : null}
                </div>
              ))}
              {batches.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No branch-visible DTR files imported for this period.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Attendance Hold</CardTitle>
          <CardDescription>
            Enter Held DTR values and submit them to admin for approval.
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
                    const isApproved = employee.editableDates.length === 0;
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
                              {isSaving || isApproved ? (
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
                                          value={draft.targetPayrollPeriodId}
                                          name="targetPayrollPeriodId"
                                          form={formId}
                                          onChange={(event) =>
                                            updateAttendanceHoldDraft(
                                              employee.employeeId,
                                              {
                                                targetPayrollPeriodId:
                                                  event.target.value,
                                              }
                                            )
                                          }
                                          disabled={isSaving}
                                          className="flex h-9 w-52 rounded-md border bg-background px-3 py-1 text-sm"
                                          aria-label={`Target payroll period for ${employee.employeeName}`}
                                        >
                                          <option value="">
                                            Select target period...
                                          </option>
                                          {periods.map((period) => (
                                            <option
                                              key={period.id}
                                              value={period.id}
                                            >
                                              {period.code} ({period.startDate}{" "}
                                              - {period.endDate})
                                            </option>
                                          ))}
                                        </select>
                                      </div>

                                      <div className="flex items-center gap-2">
                                        <Button
                                          type="submit"
                                          form={formId}
                                          size="sm"
                                          disabled={
                                            isSaving || isApproved || !draft
                                          }
                                        >
                                          {isSaving ? "Submitting..." : "Submit"}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

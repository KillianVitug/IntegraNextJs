"use client";

import { useEffect, useMemo, useState } from "react";
import {
  listSalaryAdjustmentPeriods,
  listSalaryChanges,
  type SalaryChangeHistoryResultsType,
} from "@/app/actions/salaryAdjustAction";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import EmployeeSalaryEditor from "./form/EmployeeSalaryEditor";
import type {
  SalaryChangeHistoryRead,
  SalaryChangeMode,
  SalaryChangeStatus,
} from "@/zod-schemas/salaryChange";
import {
  formatEmployeeNoDisplay,
  formatEmployeePickerLabel,
  getEmployeeTypeDisplay,
  sortEmployeesByLastName,
} from "@/utils/employeeDisplay";

type EmployeeOption = {
  id: string;
  employeeNo: string;
  employeeType?: string | null;
  firstName: string;
  middleName?: string | null;
  lastName: string;
};

type PayrollPeriodOption = {
  id: string;
  code: string;
  payrollTerms: string;
  year: number;
  startDate: string;
  endDate: string;
  adjustedPayDate: string;
  cycle: "A" | "B";
  status: string;
};

type Props = {
  initialData: SalaryChangeHistoryResultsType;
  initialEmployees: EmployeeOption[];
  initialPeriods: PayrollPeriodOption[];
  initialYear: number;
};

function formatDateTime(value: Date | string) {
  return new Date(value).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pickDefaultPeriodId(periods: PayrollPeriodOption[]) {
  if (periods.length === 0) return "";

  const today = new Date().toISOString().slice(0, 10);
  const currentPeriod = periods.find(
    (period) => period.startDate <= today && period.endDate >= today
  );

  if (currentPeriod) return currentPeriod.id;
  return periods[periods.length - 1]?.id ?? periods[0]?.id ?? "";
}

function getStatusClass(status: SalaryChangeStatus) {
  if (status === "Active") return "bg-emerald-100 text-emerald-700";
  if (status === "AppliedPermanent") return "bg-sky-100 text-sky-700";
  if (status === "Superseded") return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function formatMode(mode: SalaryChangeMode) {
  if (mode === "OnePeriodOverride") return "One-period";
  if (mode === "ForwardEffective") return "Forward-effective";
  return "Multi-period";
}

export default function SalaryAdjustTable({
  initialData,
  initialEmployees,
  initialPeriods,
  initialYear,
}: Props) {
  const [allChanges, setAllChanges] = useState<SalaryChangeHistoryRead[]>(initialData);
  const [employees] = useState(initialEmployees);
  const [periods, setPeriods] = useState(initialPeriods);
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedPeriodId, setSelectedPeriodId] = useState(
    pickDefaultPeriodId(initialPeriods)
  );
  const [selectedMode, setSelectedMode] =
    useState<SalaryChangeMode>("OnePeriodOverride");
  const [selectedStatus, setSelectedStatus] = useState<SalaryChangeStatus | "">("");
  const [isReloading, setIsReloading] = useState(false);

  useEffect(() => {
    if (!periods.some((period) => period.id === selectedPeriodId)) {
      setSelectedPeriodId(pickDefaultPeriodId(periods));
    }
  }, [periods, selectedPeriodId]);

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId]
  );

  const visibleChanges = useMemo(
    () =>
      allChanges.filter((change) => {
        if (selectedEmployeeId && change.employeeId !== selectedEmployeeId) return false;
        if (selectedPeriodId && change.payrollPeriodId !== selectedPeriodId) {
          if (change.mode !== "MultiPeriodOverride") return false;
          if (!change.endPeriodStartDate) return false;
          if (!selectedPeriod) return false;
          if (
            selectedPeriod.startDate < change.periodStartDate ||
            selectedPeriod.startDate > change.endPeriodStartDate
          ) {
            return false;
          }
        }
        if (selectedStatus && change.status !== selectedStatus) return false;
        return true;
      }),
    [allChanges, selectedEmployeeId, selectedPeriod, selectedPeriodId, selectedStatus]
  );

  const activeChangeForSelection = useMemo(
    () =>
      allChanges.find((change) => {
        if (change.employeeId !== selectedEmployeeId) return false;
        if (change.mode !== selectedMode) return false;
        if (change.status !== "Active") return false;

        if (change.mode === "MultiPeriodOverride") {
          if (!selectedPeriod || !change.endPeriodStartDate) return false;
          return (
            selectedPeriod.startDate >= change.periodStartDate &&
            selectedPeriod.startDate <= change.endPeriodStartDate
          );
        }

        return change.payrollPeriodId === selectedPeriodId;
      }) ?? null,
    [allChanges, selectedEmployeeId, selectedMode, selectedPeriod, selectedPeriodId]
  );

  const employeeOptions = sortEmployeesByLastName(employees).map((employee) => ({
    id: employee.id,
    name: formatEmployeePickerLabel(employee),
  }));

  const periodOptions = periods.map((period) => ({
    id: period.id,
    name: `${period.code} | ${period.startDate} to ${period.endDate} | Pay ${period.adjustedPayDate}`,
  }));

  const statusOptions = [
    { id: "Active", name: "Active" },
    { id: "AppliedPermanent", name: "Applied Permanent" },
    { id: "Superseded", name: "Superseded" },
    { id: "Canceled", name: "Canceled" },
  ];

  const yearOptions = Array.from({ length: 7 }, (_, index) => {
    const year = initialYear - 3 + index;
    return { id: String(year), name: String(year) };
  });

  async function reloadYear(year: number) {
    setIsReloading(true);
    try {
      const [nextPeriods, nextChanges] = await Promise.all([
        listSalaryAdjustmentPeriods(year),
        listSalaryChanges({ year }),
      ]);
      setPeriods(nextPeriods);
      setAllChanges(nextChanges);
    } finally {
      setIsReloading(false);
    }
  }

  async function refreshChanges() {
    setIsReloading(true);
    try {
      setAllChanges(await listSalaryChanges({ year: selectedYear }));
    } finally {
      setIsReloading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Salary Adjustment"
        description="Apply and audit one-period, forward-effective, and multi-period salary changes."
      />
      <div className="flex flex-wrap items-end gap-3">
        <SelectWithLabel
          fieldTitle="Year"
          nameInSchema="selectedYear"
          data={yearOptions}
          value={String(selectedYear)}
          onChange={async (value) => {
            const nextYear = Number(value);
            setSelectedYear(nextYear);
            setSelectedEmployeeId("");
            await reloadYear(nextYear);
          }}
        />
        <SelectWithLabel
          fieldTitle="Payroll Period"
          nameInSchema="selectedPeriodId"
          data={periodOptions}
          value={selectedPeriodId}
          onChange={setSelectedPeriodId}
          className="max-w-md"
        />
        <SelectWithLabel
          fieldTitle="Employee"
          nameInSchema="selectedEmployeeId"
          data={employeeOptions}
          value={selectedEmployeeId}
          onChange={setSelectedEmployeeId}
          className="max-w-md"
        />
        <SelectWithLabel
          fieldTitle="History Status"
          nameInSchema="selectedStatus"
          data={[{ id: "__all__", name: "All" }, ...statusOptions]}
          value={selectedStatus || "__all__"}
          onChange={(value) =>
            setSelectedStatus(
              value === "__all__" ? "" : ((value || "") as SalaryChangeStatus | "")
            )
          }
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSelectedEmployeeId("");
            setSelectedStatus("");
            setSelectedMode("OnePeriodOverride");
          }}
        >
          Reset Filters
        </Button>
        <Button type="button" variant="outline" onClick={refreshChanges}>
          {isReloading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {selectedEmployeeId && selectedPeriod ? (
        <EmployeeSalaryEditor
          key={`${selectedEmployeeId}-${selectedPeriod.id}`}
          selectedEmployeeId={selectedEmployeeId}
          payrollPeriod={selectedPeriod}
          periods={periods}
          mode={selectedMode}
          onModeChange={setSelectedMode}
          activeChange={activeChangeForSelection}
          onCommitted={refreshChanges}
        />
      ) : (
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Select a payroll period and employee to create or cancel a salary change.
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Employee No</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Applied Permanent</TableHead>
              <TableHead>Before Monthly</TableHead>
              <TableHead>After Monthly</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleChanges.map((change) => (
              <TableRow
                key={change.id}
                className="cursor-pointer hover:bg-muted/40"
                onClick={() => {
                  setSelectedEmployeeId(change.employeeId);
                  setSelectedPeriodId(change.payrollPeriodId);
                  setSelectedMode(change.mode);
                }}
              >
                <TableCell>{formatDateTime(change.createdAt)}</TableCell>
                <TableCell>{change.createdByUserId}</TableCell>
                <TableCell>
                  <div className="font-medium">
                    {change.endPayrollCode
                      ? `${change.payrollCode} to ${change.endPayrollCode}`
                      : change.payrollCode}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {change.periodStartDate} to{" "}
                    {change.endPeriodEndDate ?? change.periodEndDate}
                  </div>
                </TableCell>
                <TableCell>
                  {formatEmployeeNoDisplay(change.employeeNo)}
                </TableCell>
                <TableCell>
                  {getEmployeeTypeDisplay({
                    employeeType: change.employeeType,
                    employeeNo: change.employeeNo,
                  }) || "-"}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{change.fullName}</div>
                </TableCell>
                <TableCell>{formatMode(change.mode)}</TableCell>
                <TableCell>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${getStatusClass(change.status)}`}>
                    {change.status === "AppliedPermanent"
                      ? "Applied Permanent"
                      : change.status}
                  </span>
                </TableCell>
                <TableCell>
                  {change.appliedPermanentAt
                    ? formatDateTime(change.appliedPermanentAt)
                    : "-"}
                </TableCell>
                <TableCell>{change.before.monthlyRate ?? "-"}</TableCell>
                <TableCell>{change.after.monthlyRate ?? "-"}</TableCell>
                <TableCell>
                  <div>{change.reason}</div>
                  {change.notes ? (
                    <div className="text-xs text-muted-foreground">{change.notes}</div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {visibleChanges.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center text-muted-foreground">
                  No salary changes match the current filters.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

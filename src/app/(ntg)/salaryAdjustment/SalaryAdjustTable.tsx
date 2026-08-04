"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type Column,
  type ColumnFiltersState,
  type SortingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import {
  bulkCancelSalaryChanges,
  createSalaryRateSalaryChanges,
  listDailyRateSalaryAdjustmentRows,
  type SalaryAdjustmentEmployeesResultsType,
  listSalaryAdjustmentPeriods,
  listSalaryChanges,
  type SalaryChangeHistoryResultsType,
} from "@/app/actions/salaryAdjustAction";
import { PageHeader } from "@/components/layout/page-layout";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import Filter from "@/components/react-table/Filter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type {
  DailyRateSalaryAdjustmentRow,
  SalaryChangeHistoryRead,
  SalaryRateType,
} from "@/zod-schemas/salaryChange";
import { formatRateDisplay } from "@/lib/number";
import {
  formatEmployeeNoDisplay,
  formatEmployeePickerLabel,
} from "@/utils/employeeDisplay";

type EmployeeOption = SalaryAdjustmentEmployeesResultsType[number];

type PayrollPeriodOption = {
  id: string;
  code: string;
  payrollTerms: string;
  year: number;
  month: number;
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

type SalaryAdjustmentTableRow = {
  employeeId: string;
  employeeLabel: string;
  employeeNoDisplay: string;
  previousRate: string;
  department: string;
  position: string;
  customPayrollCode: string;
};

const salaryAdjustmentColumnHelper =
  createColumnHelper<SalaryAdjustmentTableRow>();

const SALARY_RATE_OPTIONS = [
  { id: "DailyRate", name: "Daily Rate" },
  { id: "MonthlyRate", name: "Monthly Rate" },
] as const;

function SortableHeader<TData, TValue>({
  column,
  label,
}: {
  column: Column<TData, TValue>;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      className="flex w-full justify-between pl-1"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {label}
      {column.getIsSorted() === "asc" ? (
        <ArrowUp className="ml-2 h-4 w-4" />
      ) : null}
      {column.getIsSorted() === "desc" ? (
        <ArrowDown className="ml-2 h-4 w-4" />
      ) : null}
      {column.getIsSorted() !== "desc" && column.getIsSorted() !== "asc" ? (
        <ArrowUpDown className="ml-2 h-4 w-4" />
      ) : null}
    </Button>
  );
}

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

function normalizeDecimalInput(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  if (normalized === "" || normalized === ".") return "";
  if (!/^\d*\.?\d*$/.test(normalized)) return null;
  if ((normalized.split(".")[1]?.length ?? 0) > 4) return null;
  return normalized;
}

function normalizeComparableRate(value: string) {
  const normalized = normalizeDecimalInput(value);
  if (normalized == null || normalized === "") return null;

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue)) return null;

  return numericValue.toFixed(4);
}

function formatPreviousRate(value: string) {
  const normalized = normalizeComparableRate(value);
  if (!normalized || Number(normalized) <= 0) return "-";
  return formatRateDisplay(value, { zeroValue: "-" });
}

function isPositiveRate(value: string) {
  const normalized = normalizeComparableRate(value);
  return normalized != null && Number(normalized) > 0;
}

function getRateLabel(salaryRateType: SalaryRateType) {
  return salaryRateType === "MonthlyRate" ? "Monthly Rate" : "Daily Rate";
}

function getPreviousRate(row: DailyRateSalaryAdjustmentRow, salaryRateType: SalaryRateType) {
  return salaryRateType === "MonthlyRate"
    ? row.previousMonthlyRate
    : row.previousDailyRate;
}

function getHistoryRatePair(change: SalaryChangeHistoryRead) {
  const beforeMonthlyRate = normalizeComparableRate(change.before.monthlyRate ?? "");
  const afterMonthlyRate = normalizeComparableRate(change.after.monthlyRate ?? "");

  if (beforeMonthlyRate !== afterMonthlyRate) {
    return {
      before: formatPreviousRate(change.before.monthlyRate ?? ""),
      after: formatPreviousRate(change.after.monthlyRate ?? ""),
    };
  }

  return {
    before: formatPreviousRate(change.before.dailyRate ?? ""),
    after: formatPreviousRate(change.after.dailyRate ?? ""),
  };
}

function buildPeriodLabel(period: PayrollPeriodOption) {
  return `${period.year}-${String(period.month).padStart(2, "0")}-${period.cycle}`;
}

export default function SalaryAdjustTable({
  initialData,
  initialEmployees,
  initialPeriods,
  initialYear,
}: Props) {
  const [allChanges, setAllChanges] =
    useState<SalaryChangeHistoryRead[]>(initialData);
  const [employees] = useState(initialEmployees);
  const [periods, setPeriods] = useState(initialPeriods);
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [selectedPeriodId, setSelectedPeriodId] = useState(
    pickDefaultPeriodId(initialPeriods)
  );
  const [rows, setRows] = useState<DailyRateSalaryAdjustmentRow[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(
    () => new Set()
  );
  const [salaryRateType, setSalaryRateType] =
    useState<SalaryRateType>("DailyRate");
  const [reason, setReason] = useState("");
  const [rate, setRate] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "employee", desc: false },
  ]);
  const [isReloading, setIsReloading] = useState(false);
  const [isRowsLoading, setIsRowsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedHistoryChangeIds, setSelectedHistoryChangeIds] = useState<
    Set<number>
  >(() => new Set());
  const [voidReason, setVoidReason] = useState("");
  const [isVoidDialogOpen, setIsVoidDialogOpen] = useState(false);
  const [isVoiding, setIsVoiding] = useState(false);

  useEffect(() => {
    if (!periods.some((period) => period.id === selectedPeriodId)) {
      setSelectedPeriodId(pickDefaultPeriodId(periods));
    }
  }, [periods, selectedPeriodId]);

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId]
  );

  const employeesById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees]
  );

  const periodOptions = useMemo(
    () =>
      periods.map((period) => ({
        id: period.id,
        name: buildPeriodLabel(period),
      })),
    [periods]
  );

  const yearOptions = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const year = initialYear - 3 + index;
        return { id: String(year), name: String(year) };
      }),
    [initialYear]
  );

  const rateLabel = getRateLabel(salaryRateType);
  const eligibleRows = useMemo(
    () =>
      rows.filter((row) =>
        salaryRateType === "MonthlyRate"
          ? isPositiveRate(row.previousMonthlyRate)
          : isPositiveRate(row.previousDailyRate) &&
            !isPositiveRate(row.previousMonthlyRate)
      ),
    [rows, salaryRateType]
  );
  const selectedRows = eligibleRows.filter((row) =>
    selectedEmployeeIds.has(row.employeeId)
  );
  const normalizedSharedRate = normalizeComparableRate(rate);
  const hasInvalidRate =
    normalizeDecimalInput(rate) == null || rate.trim() === "";
  const changedSelectedRows = selectedRows.filter(
    (row) =>
      normalizedSharedRate !== normalizeComparableRate(getPreviousRate(row, salaryRateType))
  );
  const allRowsSelected =
    eligibleRows.length > 0 &&
    eligibleRows.every((row) => selectedEmployeeIds.has(row.employeeId));
  const hasUnchangedSelection =
    selectedRows.length > 0 && !hasInvalidRate && changedSelectedRows.length === 0;
  const tableData = useMemo(
    () =>
      eligibleRows.map((row) => {
        const employee = employeesById.get(row.employeeId);
        return {
          employeeId: row.employeeId,
          employeeLabel: employee ? formatEmployeePickerLabel(employee) : "-",
          employeeNoDisplay: employee
            ? formatEmployeeNoDisplay(employee.employeeNo)
            : "-",
          previousRate: formatPreviousRate(getPreviousRate(row, salaryRateType)),
          department: employee?.department ?? "-",
          position: employee?.position ?? "-",
          customPayrollCode: employee?.customPayrollCode ?? "-",
        };
      }),
    [eligibleRows, employeesById, salaryRateType]
  );

  const columns = useMemo(
    () => [
      salaryAdjustmentColumnHelper.display({
        id: "select",
        enableSorting: false,
        enableColumnFilter: false,
        header: ({ table }) => {
          const pageRows = table.getRowModel().rows;
          const pageEmployeeIds = pageRows.map(
            (row) => row.original.employeeId
          );
          const allPageSelected =
            pageEmployeeIds.length > 0 &&
            pageEmployeeIds.every((employeeId) =>
              selectedEmployeeIds.has(employeeId)
            );
          const somePageSelected =
            !allPageSelected &&
            pageEmployeeIds.some((employeeId) =>
              selectedEmployeeIds.has(employeeId)
            );

          return (
            <Checkbox
              checked={
                allPageSelected
                  ? true
                  : somePageSelected
                    ? "indeterminate"
                    : false
              }
              onCheckedChange={(checked) =>
                toggleEmployeeIds(pageEmployeeIds, checked === true)
              }
              aria-label="Select visible employees"
            />
          );
        },
        cell: ({ row }) => (
          <Checkbox
            checked={selectedEmployeeIds.has(row.original.employeeId)}
            onCheckedChange={(checked) =>
              toggleEmployee(row.original.employeeId, checked === true)
            }
            aria-label={`Select ${row.original.employeeLabel}`}
          />
        ),
      }),
      salaryAdjustmentColumnHelper.accessor(
        (row) => `${row.employeeLabel} ${row.employeeNoDisplay}`,
        {
          id: "employee",
          header: ({ column }) => (
            <SortableHeader column={column} label="Employee" />
          ),
          cell: ({ row }) => (
            <div className="space-y-1">
              <div className="font-medium">{row.original.employeeLabel}</div>
              <div className="text-xs text-muted-foreground">
                {row.original.employeeNoDisplay}
              </div>
            </div>
          ),
        }
      ),
      salaryAdjustmentColumnHelper.accessor("previousRate", {
        id: "previousRate",
        header: ({ column }) => (
          <SortableHeader column={column} label={`Previous ${rateLabel}`} />
        ),
      }),
      salaryAdjustmentColumnHelper.accessor("department", {
        id: "department",
        header: ({ column }) => (
          <SortableHeader column={column} label="Department" />
        ),
      }),
      salaryAdjustmentColumnHelper.accessor("position", {
        id: "position",
        header: ({ column }) => (
          <SortableHeader column={column} label="Position" />
        ),
      }),
      salaryAdjustmentColumnHelper.accessor("customPayrollCode", {
        id: "customPayrollCode",
        header: ({ column }) => (
          <SortableHeader column={column} label="Custom Payroll Code" />
        ),
      }),
    ],
    [rateLabel, selectedEmployeeIds]
  );

  const table = useReactTable({
    data: tableData,
    columns,
    state: {
      sorting,
      columnFilters,
    },
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: 25,
      },
    },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const visibleHistoryChanges = useMemo(
    () => allChanges.filter((change) => change.status !== "Canceled"),
    [allChanges]
  );
  const visibleActiveHistoryChangeIds = useMemo(
    () =>
      visibleHistoryChanges
        .filter((change) => change.status === "Active")
        .map((change) => change.id),
    [visibleHistoryChanges]
  );
  const selectedHistoryChanges = useMemo(
    () =>
      visibleHistoryChanges.filter(
        (change) =>
          change.status === "Active" && selectedHistoryChangeIds.has(change.id)
      ),
    [selectedHistoryChangeIds, visibleHistoryChanges]
  );
  const allVisibleHistorySelected =
    visibleActiveHistoryChangeIds.length > 0 &&
    visibleActiveHistoryChangeIds.every((changeId) =>
      selectedHistoryChangeIds.has(changeId)
    );
  const someVisibleHistorySelected =
    !allVisibleHistorySelected &&
    visibleActiveHistoryChangeIds.some((changeId) =>
      selectedHistoryChangeIds.has(changeId)
    );

  useEffect(() => {
    table.setPageIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilters, salaryRateType, eligibleRows.length]);

  async function loadDailyRateRows(payrollPeriodId: string) {
    if (!payrollPeriodId) {
      setRows([]);
      return;
    }

    setIsRowsLoading(true);
    try {
      const nextRows = await listDailyRateSalaryAdjustmentRows({
        payrollPeriodId,
      });
      const rowsByEmployeeId = new Map(
        nextRows.map((row) => [row.employeeId, row])
      );

      setRows(
        employees.map((employee) => {
          const row = rowsByEmployeeId.get(employee.id);
          return {
            employeeId: employee.id,
            previousDailyRate: row?.previousDailyRate ?? "0",
            previousMonthlyRate: row?.previousMonthlyRate ?? "0",
          };
        })
      );
      setSelectedEmployeeIds(new Set());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load daily rates."
      );
    } finally {
      setIsRowsLoading(false);
    }
  }

  useEffect(() => {
    void loadDailyRateRows(selectedPeriodId);
    // Employees are intentionally stable after initial active-employee load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId]);

  async function reloadYear(year: number) {
    setIsReloading(true);
    try {
      const [nextPeriods, nextChanges] = await Promise.all([
        listSalaryAdjustmentPeriods(year),
        listSalaryChanges({ year }),
      ]);
      setPeriods(nextPeriods);
      setAllChanges(nextChanges);
      setSelectedHistoryChangeIds(new Set());
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

  function toggleEmployee(employeeId: string, checked: boolean) {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(employeeId);
      } else {
        next.delete(employeeId);
      }
      return next;
    });
  }

  function toggleEmployeeIds(employeeIds: string[], checked: boolean) {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      for (const employeeId of employeeIds) {
        if (checked) {
          next.add(employeeId);
        } else {
          next.delete(employeeId);
        }
      }
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedEmployeeIds(
      checked ? new Set(eligibleRows.map((row) => row.employeeId)) : new Set()
    );
  }

  function toggleHistoryChange(changeId: number, checked: boolean) {
    setSelectedHistoryChangeIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(changeId);
      } else {
        next.delete(changeId);
      }
      return next;
    });
  }

  function toggleVisibleHistoryChanges(checked: boolean) {
    setSelectedHistoryChangeIds((current) => {
      const next = new Set(current);
      for (const changeId of visibleActiveHistoryChangeIds) {
        if (checked) {
          next.add(changeId);
        } else {
          next.delete(changeId);
        }
      }
      return next;
    });
  }

  function updateSharedRate(value: string) {
    const normalized = normalizeDecimalInput(value);
    if (normalized == null) return;
    setRate(value);
  }

  function handleSalaryRateTypeChange(value: string) {
    setSalaryRateType(value as SalaryRateType);
    setSelectedEmployeeIds(new Set());
    setRate("");
  }

  function resetValues() {
    setSelectedEmployeeIds(new Set());
    setReason("");
    setRate("");
  }

  async function handleSave() {
    if (!selectedPeriod) return;

    if (!reason.trim()) {
      toast.error("Reason is required.");
      return;
    }

    if (selectedRows.length === 0) {
      toast.error("Select at least one employee.");
      return;
    }

    if (hasInvalidRate) {
      toast.error(`Enter a valid ${rateLabel}.`);
      return;
    }

    if (changedSelectedRows.length === 0) {
      toast.info("No salary rates changed.");
      return;
    }

    try {
      setIsSaving(true);
      const result = await createSalaryRateSalaryChanges({
        payrollPeriodId: selectedPeriod.id,
        salaryRateType,
        reason,
        rows: changedSelectedRows.map((row) => ({
          employeeId: row.employeeId,
          rate,
        })),
      });

      toast.success(`${result.createdCount} salary changes saved.`);
      setReason("");
      setRate("");
      setSelectedEmployeeIds(new Set());
      await Promise.all([loadDailyRateRows(selectedPeriod.id), refreshChanges()]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save salary changes."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleBulkVoid() {
    if (selectedHistoryChanges.length === 0) {
      toast.error("Select at least one active salary change.");
      return;
    }

    if (!voidReason.trim()) {
      toast.error("Void reason is required.");
      return;
    }

    try {
      setIsVoiding(true);
      const result = await bulkCancelSalaryChanges({
        changeIds: selectedHistoryChanges.map((change) => change.id),
        reason: voidReason,
      });

      toast.success(
        `${result.voidedCount} salary changes voided and removed from history.`
      );
      setSelectedHistoryChangeIds(new Set());
      setVoidReason("");
      setIsVoidDialogOpen(false);
      await Promise.all([
        selectedPeriodId ? loadDailyRateRows(selectedPeriodId) : undefined,
        refreshChanges(),
      ]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to void selected salary changes."
      );
    } finally {
      setIsVoiding(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Salary Adjustment"
        description="Update employee daily rates from a selected payroll period onward."
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
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void Promise.all([
              selectedPeriodId ? loadDailyRateRows(selectedPeriodId) : undefined,
              refreshChanges(),
            ]);
          }}
        >
          {isReloading || isRowsLoading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="space-y-4 rounded-md border p-4">
        <div className="space-y-1">
          <div className="text-lg font-semibold">Salary Change Editor</div>
          <div className="text-sm text-muted-foreground">
            {selectedPeriod
              ? `Daily rate changes apply from ${buildPeriodLabel(selectedPeriod)} onward until the next adjustment.`
              : "Select a payroll period to update daily rates."}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[220px_220px_1fr]">
          <SelectWithLabel
            fieldTitle="Salary Rate"
            nameInSchema="salaryRateType"
            data={[...SALARY_RATE_OPTIONS]}
            value={salaryRateType}
            onChange={handleSalaryRateTypeChange}
          />
          <label className="space-y-1.5">
            <span className="text-sm font-medium">{rateLabel}</span>
            <Input
              value={rate}
              inputMode="decimal"
              placeholder="0.0000"
              disabled={isRowsLoading || isSaving}
              onChange={(event) => updateSharedRate(event.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Reason</span>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="Explain why this salary change is needed."
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {selectedEmployeeIds.size} selected, {changedSelectedRows.length} changed
            {hasUnchangedSelection ? " | No salary rates changed" : ""}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={rows.length === 0 || isRowsLoading || isSaving}
              onClick={() => toggleAll(!allRowsSelected)}
            >
              {allRowsSelected ? "Clear Selection" : "Select All"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isRowsLoading || isSaving}
              onClick={resetValues}
            >
              Reset Values
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isRowsLoading || isSaving}
              onClick={() => table.resetSorting()}
            >
              Reset Sorting
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isRowsLoading || isSaving}
              onClick={() => table.resetColumnFilters()}
            >
              Reset Filters
            </Button>
            <Button
              type="button"
              disabled={
                !selectedPeriod ||
                isRowsLoading ||
                isSaving ||
                selectedRows.length === 0 ||
                changedSelectedRows.length === 0 ||
                hasInvalidRate
              }
              onClick={() => void handleSave()}
            >
              {isSaving ? "Saving..." : "Save Salary Changes"}
            </Button>
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="bg-secondary p-1">
                      <div>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </div>
                      {header.column.getCanFilter() ? (
                        <div className="grid place-content-center">
                          <Filter column={header.column} />
                        </div>
                      ) : null}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.original.employeeId}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="border">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {isRowsLoading
                      ? "Loading daily rates..."
                      : "No active employees are available."}
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.length > 0 && table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No employees match the current filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {Math.max(1, table.getPageCount())} |{" "}
            {table.getFilteredRowModel().rows.length} filtered employees
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!table.getCanPreviousPage() || isRowsLoading || isSaving}
              onClick={() => table.previousPage()}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!table.getCanNextPage() || isRowsLoading || isSaving}
              onClick={() => table.nextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-lg font-semibold">Salary Change History</div>
          <div className="text-sm text-muted-foreground">
            Audit trail for salary changes in {selectedYear}.
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {selectedHistoryChanges.length} selected for void/remove
          </div>
          <Button
            type="button"
            variant="destructive"
            disabled={selectedHistoryChanges.length === 0 || isVoiding}
            onClick={() => setIsVoidDialogOpen(true)}
          >
            Void / Remove Selected
          </Button>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Checkbox
                    checked={
                      allVisibleHistorySelected
                        ? true
                        : someVisibleHistorySelected
                          ? "indeterminate"
                          : false
                    }
                    disabled={
                      visibleActiveHistoryChangeIds.length === 0 || isVoiding
                    }
                    onCheckedChange={(checked) =>
                      toggleVisibleHistoryChanges(checked === true)
                    }
                    aria-label="Select visible salary changes"
                  />
                </TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Employee No</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Before Rate</TableHead>
                <TableHead>After Rate</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleHistoryChanges.map((change) => {
                const historyRate = getHistoryRatePair(change);

                return (
                  <TableRow key={change.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedHistoryChangeIds.has(change.id)}
                        disabled={change.status !== "Active" || isVoiding}
                        onCheckedChange={(checked) =>
                          toggleHistoryChange(change.id, checked === true)
                        }
                        aria-label={`Select salary change for ${change.fullName}`}
                      />
                    </TableCell>
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
                    <TableCell>{formatEmployeeNoDisplay(change.employeeNo)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{change.fullName}</div>
                    </TableCell>
                    <TableCell>{historyRate.before}</TableCell>
                    <TableCell>{historyRate.after}</TableCell>
                    <TableCell>
                      <div>{change.reason}</div>
                      {change.notes ? (
                        <div className="text-xs text-muted-foreground">
                          {change.notes}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
              {visibleHistoryChanges.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No salary changes found for this year.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog
        open={isVoidDialogOpen}
        onOpenChange={(open) => {
          if (!isVoiding) {
            setIsVoidDialogOpen(open);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void / Remove Salary Changes</DialogTitle>
            <DialogDescription>
              Selected salary changes will be canceled and hidden from the default
              history list. Payroll runs affected by these changes may be marked stale.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Void Reason</span>
            <Textarea
              value={voidReason}
              disabled={isVoiding}
              rows={3}
              placeholder="Explain why these salary changes are being voided."
              onChange={(event) => setVoidReason(event.target.value)}
            />
          </label>
          <div className="text-sm text-muted-foreground">
            {selectedHistoryChanges.length} salary changes selected.
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isVoiding}
              onClick={() => setIsVoidDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                isVoiding ||
                selectedHistoryChanges.length === 0 ||
                !voidReason.trim()
              }
              onClick={() => void handleBulkVoid()}
            >
              {isVoiding ? "Voiding..." : "Void / Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

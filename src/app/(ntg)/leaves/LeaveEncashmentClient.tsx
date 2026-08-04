"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  getLeaveEncashmentSnapshot,
  listLeaveEncashmentsForEmployee,
  listLeaveEncashmentPayrollPeriods,
  submitLeaveEncashmentBatch,
  voidLeaveEncashment,
  type LeaveEncashmentListItem,
  type LeaveEncashmentSnapshot,
} from "@/app/actions/leaveAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import Filter from "@/components/react-table/Filter";
import { useServerTableUrlState } from "@/components/react-table/useServerTableUrlState";
import { useToast } from "@/hooks/use-toast";
import type { SickAndLeaveResultsType } from "@/lib/queries/getSickAndLeave";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";

type LeaveEncashmentRow = SickAndLeaveResultsType[number];
type LeaveTypeSelection = "" | "SL" | "VL";

type PayrollPeriodOption = {
  id: string;
  code: string;
  year: number;
  startDate: string;
  endDate: string;
  adjustedPayDate: string;
  status: string;
};

type Props = {
  data: SickAndLeaveResultsType;
  total: number;
  pageSize: number;
  initialPeriods: PayrollPeriodOption[];
  initialYear: number;
  initialLeaveYear: number;
};

const currencyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

function formatDays(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function formatMoney(value: number | null | undefined) {
  return currencyFormatter.format(Number(value ?? 0));
}

function pickDefaultPeriodId(periods: PayrollPeriodOption[]) {
  if (periods.length === 0) return "";

  const today = new Date().toISOString().slice(0, 10);
  const currentPeriod = periods.find(
    (period) => period.startDate <= today && period.endDate >= today
  );

  return currentPeriod?.id ?? periods[periods.length - 1]?.id ?? periods[0]?.id ?? "";
}

function getPeriodLabel(period: PayrollPeriodOption) {
  return `${period.code} | ${period.startDate} to ${period.endDate} | Pay ${period.adjustedPayDate}`;
}

function getFullName(row: LeaveEncashmentRow | null) {
  return row?.fullName ?? "";
}

function getLeaveTypeLabel(value: LeaveTypeSelection) {
  if (value === "SL") return "Sick Leave";
  if (value === "VL") return "Vacation Leave";
  return "Type of Leave";
}

export default function LeaveEncashmentClient({
  data,
  total,
  pageSize,
  initialPeriods,
  initialYear,
  initialLeaveYear,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedRow, setSelectedRow] = useState<LeaveEncashmentRow | null>(null);
  const [periods, setPeriods] = useState(initialPeriods);
  const [selectedPayrollYear, setSelectedPayrollYear] = useState(initialYear);
  const [selectedLeaveYear, setSelectedLeaveYear] = useState(initialLeaveYear);
  const [selectedPeriodId, setSelectedPeriodId] = useState(
    pickDefaultPeriodId(initialPeriods)
  );
  const [snapshot, setSnapshot] = useState<LeaveEncashmentSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [encashments, setEncashments] = useState<LeaveEncashmentListItem[]>([]);
  const [loadingEncashments, setLoadingEncashments] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [selectedLeaveType, setSelectedLeaveType] =
    useState<LeaveTypeSelection>("");

  useEffect(() => {
    if (!periods.some((period) => period.id === selectedPeriodId)) {
      setSelectedPeriodId(pickDefaultPeriodId(periods));
    }
  }, [periods, selectedPeriodId]);

  useEffect(() => {
    setSelectedLeaveYear(initialLeaveYear);
  }, [initialLeaveYear]);

  useEffect(() => {
    if (!selectedRow) return;

    const refreshedRow = data.find((row) => row.id === selectedRow.id);
    setSelectedRow(refreshedRow ?? null);
  }, [data, selectedRow]);

  useEffect(() => {
    let active = true;

    async function loadSnapshot() {
      if (!selectedRow || !selectedPeriodId) {
        setSnapshot(null);
        return;
      }

      setLoadingSnapshot(true);
      const result = await getLeaveEncashmentSnapshot({
        employeeId: selectedRow.id,
        payrollPeriodId: selectedPeriodId,
        leaveYear: selectedLeaveYear,
      });

      if (!active) return;

      if (result.error) {
        setSnapshot(null);
        toast({
          title: "Unable to load encashment",
          description: result.error,
          variant: "destructive",
        });
      } else {
        setSnapshot(result.data ?? null);
      }

      setLoadingSnapshot(false);
    }

    void loadSnapshot();

    return () => {
      active = false;
    };
  }, [selectedLeaveYear, selectedPeriodId, selectedRow, toast]);

  useEffect(() => {
    let active = true;

    async function loadEncashments() {
      if (!selectedRow) {
        setEncashments([]);
        return;
      }

      setLoadingEncashments(true);
      const result = await listLeaveEncashmentsForEmployee({
        employeeId: selectedRow.id,
        leaveYear: selectedLeaveYear,
      });

      if (!active) return;

      if (result.error) {
        setEncashments([]);
        toast({
          title: "Unable to load saved encashments",
          description: result.error,
          variant: "destructive",
        });
      } else {
        setEncashments(result.data ?? []);
      }

      setLoadingEncashments(false);
    }

    void loadEncashments();

    return () => {
      active = false;
    };
  }, [selectedLeaveYear, selectedRow, toast]);

  const selectedLeaveBalance = selectedLeaveType
    ? snapshot?.balances[selectedLeaveType]
    : null;
  const displayedRemainingLeave = selectedLeaveBalance
    ? selectedLeaveBalance.balance
    : snapshot
      ? Object.values(snapshot.balances).reduce(
          (total, balance) => total + Number(balance.balance ?? 0),
          0
        )
      : null;
  const displayedAmount = selectedLeaveBalance
    ? selectedLeaveBalance.amount
    : snapshot
      ? Object.values(snapshot.balances).reduce(
          (total, balance) => total + Number(balance.amount ?? 0),
          0
        )
      : null;
  const submitBlockReason = (() => {
    if (submitting) return "Saving leave encashment...";
    if (!selectedRow) return "Select an employee row first.";
    if (!selectedPeriodId) return "Select a payroll period.";
    if (loadingSnapshot) return "Loading employee leave details.";
    if (!snapshot) return "Leave encashment details are not loaded yet.";
    if (snapshot.blockReason) return snapshot.blockReason;
    if (!selectedLeaveType) return "Select the type of leave to encash.";
    if (!selectedLeaveBalance?.encashmentEnabled) {
      return `${getLeaveTypeLabel(selectedLeaveType)} is not enabled for encashment.`;
    }
    if (Number(selectedLeaveBalance.balance ?? 0) <= 0) {
      return `${getLeaveTypeLabel(selectedLeaveType)} has no available balance to encash.`;
    }
    return null;
  })();
  const canSubmit =
    Boolean(selectedRow) && Boolean(selectedPeriodId) && !submitBlockReason;

  async function handlePayrollYearChange(value: string) {
    const nextYear = Number(value);
    setSelectedPayrollYear(nextYear);
    setLoadingPeriods(true);
    setSnapshot(null);

    try {
      const result = await listLeaveEncashmentPayrollPeriods(nextYear);
      if (result.error) {
        toast({
          title: "Unable to load periods",
          description: result.error,
          variant: "destructive",
        });
        return;
      }

      const nextPeriods = result.data ?? [];
      setPeriods(nextPeriods);
      setSelectedPeriodId(pickDefaultPeriodId(nextPeriods));
    } finally {
      setLoadingPeriods(false);
    }
  }

  function handleLeaveYearChange(value: string) {
    const nextYear = Number(value);
    setSelectedLeaveYear(nextYear);
    setSnapshot(null);

    const params = new URLSearchParams(window.location.search);
    params.set("tab", "encashment");
    params.set("year", String(nextYear));
    params.set("page", "1");
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  async function refreshSnapshot() {
    if (!selectedRow || !selectedPeriodId) return;

    const result = await getLeaveEncashmentSnapshot({
      employeeId: selectedRow.id,
      payrollPeriodId: selectedPeriodId,
      leaveYear: selectedLeaveYear,
    });

    if (result.data) {
      setSnapshot(result.data);
    }
  }

  async function refreshEncashments() {
    if (!selectedRow) return;

    const result = await listLeaveEncashmentsForEmployee({
      employeeId: selectedRow.id,
      leaveYear: selectedLeaveYear,
    });

    if (result.data) {
      setEncashments(result.data);
    }
  }

  async function handleSubmit() {
    if (!selectedRow || !selectedPeriodId || !canSubmit) return;

    setSubmitting(true);
    try {
      const result = await submitLeaveEncashmentBatch({
        employeeId: selectedRow.id,
        payrollPeriodId: selectedPeriodId,
        leaveYear: selectedLeaveYear,
        useSickLeave: selectedLeaveType === "SL",
        useVacationLeave: selectedLeaveType === "VL",
        decisionNote: null,
      });

      if (result.error) {
        toast({
          title: "Leave encashment failed",
          description: result.error,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Leave encashment saved",
        description: `${result.data?.encashmentCount ?? 0} encashment record(s), ${formatMoney(
          result.data?.totalAmount ?? 0
        )}.`,
      });
      await refreshSnapshot();
      await refreshEncashments();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevertEncashment(encashmentId: string) {
    const reason = window.prompt("Revert reason");
    if (!reason?.trim()) {
      toast({
        title: "Revert reason required",
        description: "Enter a reason before reverting this encashment.",
        variant: "destructive",
      });
      return;
    }

    if (!window.confirm("Revert this leave encashment?")) return;

    setRevertingId(encashmentId);
    try {
      const result = await voidLeaveEncashment({
        encashmentId,
        reason: reason.trim(),
      });

      if (result.error) {
        toast({
          title: "Revert failed",
          description: result.error,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Leave encashment reverted",
        description: "The leave balance and payroll entry were updated.",
      });
      await refreshSnapshot();
      await refreshEncashments();
      router.refresh();
    } finally {
      setRevertingId(null);
    }
  }

  const currentYear = new Date().getFullYear();
  const payrollYearOptions = Array.from(
    { length: 7 },
    (_, index) => currentYear - 3 + index
  );
  const leaveYearOptions = Array.from({ length: 5 }, (_, index) => currentYear - index);

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4">
        <div className="mb-3">
          <div>
            <h2 className="text-lg font-semibold">Leave Encashment</h2>
            <p className="text-sm text-muted-foreground">
              Select an employee below, then choose the payroll period to apply the
              cash conversion.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ReadonlyField
            label="Employee No"
            value={formatEmployeeNoDisplay(selectedRow?.employeeNo ?? "")}
          />
          <ReadonlyField label="Full Name" value={getFullName(selectedRow)} />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium">Leaves Per Year</label>
            <Select
              value={String(selectedLeaveYear)}
              onValueChange={handleLeaveYearChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {leaveYearOptions.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium">Payroll Year</label>
            <Select value={String(selectedPayrollYear)} onValueChange={handlePayrollYearChange}>
              <SelectTrigger disabled={loadingPeriods}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {payrollYearOptions.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium">Payroll Period</label>
            <Select
              value={selectedPeriodId}
              onValueChange={setSelectedPeriodId}
              disabled={loadingPeriods || periods.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select payroll period" />
              </SelectTrigger>
              <SelectContent>
                {periods.map((period) => (
                  <SelectItem key={period.id} value={period.id}>
                    {getPeriodLabel(period)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium">Type of Leave</label>
            <Select
              value={selectedLeaveType}
              onValueChange={(value) =>
                setSelectedLeaveType(value as LeaveTypeSelection)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type of leave" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SL">Sick Leave</SelectItem>
                <SelectItem value="VL">Vacation Leave</SelectItem>
              </SelectContent>
            </Select>
            {submitBlockReason ? (
              <p className="text-sm text-muted-foreground">{submitBlockReason}</p>
            ) : null}
          </div>

          <ReadonlyField
            label="Remaining Leave"
            value={
              displayedRemainingLeave == null
                ? "-"
                : formatDays(displayedRemainingLeave)
            }
          />
          <ReadonlyField
            label="Amount"
            value={displayedAmount == null ? "-" : formatMoney(displayedAmount)}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "Saving..." : "Save Leave Encashment"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.refresh()}
          >
            Refresh Data
          </Button>
        </div>
      </div>

      <SavedEncashmentsTable
        rows={encashments}
        loading={loadingEncashments}
        selectedEmployeeName={getFullName(selectedRow)}
        revertingId={revertingId}
        onRevert={handleRevertEncashment}
      />

      <LeaveEncashmentTable
        data={data}
        total={total}
        pageSize={pageSize}
        selectedEmployeeId={selectedRow?.id ?? null}
        onRowSelect={setSelectedRow}
      />
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">{label}</label>
      <Input value={value || "-"} readOnly />
    </div>
  );
}

function SavedEncashmentsTable({
  rows,
  loading,
  selectedEmployeeName,
  revertingId,
  onRevert,
}: {
  rows: LeaveEncashmentListItem[];
  loading: boolean;
  selectedEmployeeName: string;
  revertingId: string | null;
  onRevert: (encashmentId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Saved Encashments</h3>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Leave Type</TableHead>
              <TableHead>Payroll Period</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center">
                  Loading saved encashments...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center">
                  {selectedEmployeeName
                    ? "No saved encashments for this employee and leave year."
                    : "Select an employee to view saved encashments."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{selectedEmployeeName || "-"}</TableCell>
                  <TableCell>
                    {row.leaveType} | {row.leaveTypeName}
                  </TableCell>
                  <TableCell>
                    {row.payrollPeriodCode}
                    <div className="text-xs text-muted-foreground">
                      {row.payrollPeriodStartDate} to {row.payrollPeriodEndDate}
                    </div>
                  </TableCell>
                  <TableCell>{formatDays(row.quantity)}</TableCell>
                  <TableCell>{formatMoney(row.rate)}</TableCell>
                  <TableCell>{formatMoney(row.amount)}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell>
                    {row.status === "Approved" ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => onRevert(row.id)}
                        disabled={revertingId === row.id}
                      >
                        {revertingId === row.id ? "Reverting..." : "Revert"}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Locked</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function LeaveEncashmentTable({
  data,
  total,
  pageSize,
  selectedEmployeeId,
  onRowSelect,
}: {
  data: SickAndLeaveResultsType;
  total: number;
  pageSize: number;
  selectedEmployeeId: string | null;
  onRowSelect: (row: LeaveEncashmentRow) => void;
}) {
  const columnHelper = createColumnHelper<LeaveEncashmentRow>();
  const columnIds: Array<keyof LeaveEncashmentRow> = [
    "employeeNo",
    "fullName",
    "sickLeave",
    "vacationLeave",
    "usedSickLeave",
    "usedVacationLeave",
  ];
  const serverBackedColumnIds: Array<keyof LeaveEncashmentRow> = [
    "employeeNo",
    "fullName",
    "sickLeave",
    "vacationLeave",
  ];
  const labels: Partial<Record<keyof LeaveEncashmentRow, string>> = {
    employeeNo: "Employee No",
    fullName: "Full Name",
    sickLeave: "Sick Leave",
    vacationLeave: "Vacation Leave",
    usedSickLeave: "Used/Encashed Sick Leave",
    usedVacationLeave: "Used/Encashed Vacation Leave",
  };

  const {
    router,
    pageIndex,
    sorting,
    columnFilters,
    getColumnFilterValue,
    setColumnFilterValue,
    onSortingChange,
    setPageIndex,
    resetSorting,
    resetColumnFilters,
  } = useServerTableUrlState({
    defaultSort: { id: "employeeNo", desc: false },
    filterColumnIds: serverBackedColumnIds.map(String),
  });

  const columns = columnIds.map((columnName) => {
    const isServerBackedColumn = serverBackedColumnIds.includes(columnName);

    return columnHelper.accessor(columnName, {
      id: String(columnName),
      enableColumnFilter: isServerBackedColumn,
      enableSorting: isServerBackedColumn,
      header: ({ column }) => {
        const label = labels[columnName] ?? String(columnName);

        if (!column.getCanSort()) {
          return <div className="pl-1 text-sm font-medium">{label}</div>;
        }

        return (
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-between pl-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {label}
            {column.getIsSorted() === "asc" ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : null}
            {column.getIsSorted() === "desc" ? (
              <ArrowDown className="ml-2 h-4 w-4" />
            ) : null}
            {column.getIsSorted() !== "asc" && column.getIsSorted() !== "desc" ? (
              <ArrowUpDown className="ml-2 h-4 w-4" />
            ) : null}
          </Button>
        );
      },
      cell: (info) => {
        const value = info.getValue();

        if (columnName === "employeeNo") {
          return formatEmployeeNoDisplay(value as string | null);
        }

        if (
          columnName === "sickLeave" ||
          columnName === "vacationLeave" ||
          columnName === "usedSickLeave" ||
          columnName === "usedVacationLeave"
        ) {
          return formatDays(value as string | number | null | undefined);
        }

        return value ?? "-";
      },
    });
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      pagination: {
        pageIndex,
        pageSize,
      },
    },
    pageCount,
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Employees</h3>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="bg-secondary p-1">
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                    {header.column.getCanFilter() ? (
                      <div className="grid place-content-center">
                        <Filter
                          column={header.column}
                          value={getColumnFilterValue(header.column.id)}
                          onValueChange={(value) =>
                            setColumnFilterValue(header.column.id, value)
                          }
                        />
                      </div>
                    ) : null}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center">
                  No employees found
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.original.id}
                  onClick={() => onRowSelect(row.original)}
                  className={
                    row.original.id === selectedEmployeeId
                      ? "cursor-pointer bg-muted hover:bg-muted"
                      : "cursor-pointer hover:bg-border/25 dark:hover:bg-ring/40"
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="border">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">
          Page {table.getState().pagination.pageIndex + 1} of {pageCount}{" "}
          [{total} {total === 1 ? "result" : "total results"}]
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => router.refresh()}>
            Refresh Data
          </Button>
          <Button type="button" variant="outline" onClick={resetSorting}>
            Reset Sorting
          </Button>
          <Button type="button" variant="outline" onClick={resetColumnFilters}>
            Reset Filters
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPageIndex(table.getState().pagination.pageIndex - 1)}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPageIndex(table.getState().pagination.pageIndex + 1)}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

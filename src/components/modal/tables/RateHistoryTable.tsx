"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Button } from "@/components/ui/button";
import type { EmployeeSalaryHistoryRow } from "@/zod-schemas/employeeSalary";

function formatMode(mode: EmployeeSalaryHistoryRow["mode"]) {
  if (mode === "OnePeriodOverride") return "One-period";
  if (mode === "ForwardEffective") return "Forward-effective";
  if (mode === "MultiPeriodOverride") return "Multi-period";
  return "Legacy";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusClass(status: EmployeeSalaryHistoryRow["status"]) {
  if (status === "Active") return "bg-emerald-100 text-emerald-700";
  if (status === "AppliedPermanent") return "bg-sky-100 text-sky-700";
  if (status === "Superseded") return "bg-amber-100 text-amber-700";
  if (status === "Canceled") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
}

const LEFT_ALIGNED_COLUMNS = new Set([
  "eventDate",
  "payrollPeriod",
  "mode",
  "status",
  "reason",
]);

export default function RateHistoryTable({
  employeeId,
}: {
  employeeId: string;
}) {
  const [data, setData] = useState<EmployeeSalaryHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/employees/${employeeId}/SalaryRateHistory`);
        const json = await res.json();
        setData(json.data ?? []);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [employeeId]);

  const columnHelper = createColumnHelper<EmployeeSalaryHistoryRow>();

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "eventDate",
        header: "Date",
        cell: (info) => formatDateTime(info.row.original.eventDate),
      }),
      columnHelper.display({
        id: "payrollPeriod",
        header: "Payroll Period / Code",
        cell: (info) => {
          const row = info.row.original;

          return (
            <div className="text-left">
              <div className="font-medium">
                {row.endPayrollCode
                  ? `${row.payrollCode} to ${row.endPayrollCode}`
                  : row.payrollCode}
              </div>
              <div className="text-xs text-muted-foreground">
                {row.periodStartDate && row.periodEndDate
                  ? `${row.periodStartDate} to ${
                      row.endPeriodEndDate ?? row.periodEndDate
                    }`
                  : "Legacy adjustment"}
              </div>
            </div>
          );
        },
      }),
      columnHelper.display({
        id: "mode",
        header: "Mode",
        cell: (info) => formatMode(info.row.original.mode),
      }),
      columnHelper.display({
        id: "status",
        header: "Status",
        cell: (info) => {
          const status = info.row.original.status;
          const label =
            status === "AppliedPermanent" ? "Applied Permanent" : status;

          return (
            <span
              className={`rounded-full px-2 py-1 text-xs font-medium ${getStatusClass(
                status
              )}`}
            >
              {label}
            </span>
          );
        },
      }),
      columnHelper.display({
        id: "oldDailyRate",
        header: "Old Daily",
        cell: (info) => info.row.original.before.dailyRate ?? "-",
      }),
      columnHelper.display({
        id: "newDailyRate",
        header: "New Daily",
        cell: (info) => info.row.original.after.dailyRate ?? "-",
      }),
      columnHelper.display({
        id: "oldMonthlyRate",
        header: "Old Monthly",
        cell: (info) => info.row.original.before.monthlyRate ?? "-",
      }),
      columnHelper.display({
        id: "newMonthlyRate",
        header: "New Monthly",
        cell: (info) => info.row.original.after.monthlyRate ?? "-",
      }),
      columnHelper.display({
        id: "oldDailyAllowance",
        header: "Old D-Allow",
        cell: (info) => info.row.original.before.dailyAllowance ?? "-",
      }),
      columnHelper.display({
        id: "newDailyAllowance",
        header: "New D-Allow",
        cell: (info) => info.row.original.after.dailyAllowance ?? "-",
      }),
      columnHelper.display({
        id: "oldMonthlyAllowance",
        header: "Old M-Allow",
        cell: (info) => info.row.original.before.monthlyAllowance ?? "-",
      }),
      columnHelper.display({
        id: "newMonthlyAllowance",
        header: "New M-Allow",
        cell: (info) => info.row.original.after.monthlyAllowance ?? "-",
      }),
      columnHelper.display({
        id: "oldCola",
        header: "Old COLA",
        cell: (info) => info.row.original.before.cola ?? "-",
      }),
      columnHelper.display({
        id: "newCola",
        header: "New COLA",
        cell: (info) => info.row.original.after.cola ?? "-",
      }),
      columnHelper.display({
        id: "oldRateDivisor",
        header: "Old Divisor",
        cell: (info) => info.row.original.before.rateDivisor ?? "-",
      }),
      columnHelper.display({
        id: "newRateDivisor",
        header: "New Divisor",
        cell: (info) => info.row.original.after.rateDivisor ?? "-",
      }),
      columnHelper.display({
        id: "oldBillingRate",
        header: "Old Billing",
        cell: (info) => info.row.original.before.billingRate ?? "-",
      }),
      columnHelper.display({
        id: "newBillingRate",
        header: "New Billing",
        cell: (info) => info.row.original.after.billingRate ?? "-",
      }),
      columnHelper.display({
        id: "reason",
        header: "Reason / Notes",
        cell: (info) => {
          const row = info.row.original;

          return (
            <div className="text-left">
              <div>{row.reason ?? "-"}</div>
              {row.notes ? (
                <div className="text-xs text-muted-foreground">{row.notes}</div>
              ) : null}
            </div>
          );
        },
      }),
    ],
    [columnHelper]
  );

  const table = useReactTable({
    data,
    columns,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  if (loading) return <p className="text-sm">Loading...</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border w-full overflow-x-auto scrollbar-thin scrollbar-thumb-rounded scrollbar-thumb-gray-300">
        <Table className="min-w-[2400px]">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="bg-secondary p-2">
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.original.historyId}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={`border px-3 py-2 whitespace-nowrap ${
                        LEFT_ALIGNED_COLUMNS.has(cell.column.id)
                          ? "text-left align-top"
                          : "text-right"
                      }`}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={19}
                  className="text-center py-6 text-muted-foreground"
                >
                  No rate history found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-between items-center">
        <p className="font-semibold">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {Math.max(1, table.getPageCount())}
        </p>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>

          <Button
            variant="outline"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

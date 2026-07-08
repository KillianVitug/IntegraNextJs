"use client";

import React, { useState, useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  ColumnFiltersState,
  SortingState,
  getPaginationRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getFacetedUniqueValues,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Button } from "@/components/ui/button";
import Filter from "@/components/react-table/Filter";
import { LeaveRecord } from "./types";
import {
  formatEmployeeNoDisplay,
  getEmployeeTypeDisplay,
} from "@/utils/employeeDisplay";

interface Props {
  records: LeaveRecord[];
  selectedYear: number;
  loading?: boolean;
  onYearChange: (year: number) => void;
  onRowClick: (record: LeaveRecord) => void;
}

function getStatusStyles(status: string) {
  switch (status) {
    case "Denied":
      return "bg-red-100 text-red-700 border-red-400";
    case "Pending":
      return "bg-yellow-100 text-yellow-700 border-yellow-400";
    case "Approved":
      return "bg-green-100 text-green-700 border-green-400";
    case "Cancelled":
      return "bg-gray-100 text-gray-700 border-gray-400";
    case "Voided":
      return "bg-slate-100 text-slate-700 border-slate-400";
    default:
      return "bg-gray-100 text-gray-700 border-gray-400";
  }
}

function getLeaveTypeDisplayName(type: string, name?: string | null) {
  if (name) return `${type} | ${name}`;
  return type === "VL" ? "Vacation Leave" : type === "SL" ? "Sick Leave" : type;
}

function formatLeaveDuration(start?: string | null, end?: string | null) {
  if (!start) return "-";
  const s = new Date(start);
  if (!end) return s.toLocaleDateString();
  const e = new Date(end);
  return start === end
    ? s.toLocaleDateString()
    : `${s.toLocaleDateString()} - ${e.toLocaleDateString()}`;
}

export function LeaveRecordsTable({
  records,
  selectedYear,
  onYearChange,
  onRowClick,
  loading,
}: Props) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const currentYear = new Date().getFullYear();
  const years = Array.from(
    { length: currentYear - 2000 + 1 },
    (_, i) => (2000 + i).toString()
  );

  const columnHelper = createColumnHelper<LeaveRecord>();

  const columns = useMemo(
    () => [
      columnHelper.accessor("employeeNo", {
        header: "Employee No",
        cell: (info) => formatEmployeeNoDisplay(info.getValue()) || "-",
      }),
      columnHelper.accessor(
        (row) =>
          getEmployeeTypeDisplay({
            employeeType: row.employeeType,
            employeeNo: row.employeeNo,
          }),
        {
          id: "employeeType",
          header: "Type",
          cell: (info) => info.getValue() || "-",
        }
      ),
      columnHelper.accessor(
        (row) => [row.lastName, row.firstName].filter(Boolean).join(", "),
        {
          id: "employee",
          header: "Employee",
          cell: (info) => info.getValue() || "Unknown employee",
        }
      ),
      columnHelper.accessor("dateFiled", {
        header: "Date Filed",
        cell: (info) => new Date(info.getValue()).toLocaleDateString(),
      }),
      columnHelper.accessor("leaveType", {
        header: "Leave Type",
        cell: (info) =>
          getLeaveTypeDisplayName(
            info.getValue(),
            info.row.original.leaveTypeName
          ),
      }),
      columnHelper.accessor("noOfDays", {
        header: "Days",
      }),
      columnHelper.accessor(
        (row) =>
          formatLeaveDuration(row.leaveStartDate, row.leaveEndDate),
        {
          id: "duration",
          header: "Duration",
        }
      ),
      columnHelper.accessor("reason", {
        header: "Reason",
        cell: (info) => (
          <div
            className="max-w-[200px] truncate cursor-pointer"
            title={info.getValue()}
          >
            {info.getValue()}
          </div>
        ),
      }),
      columnHelper.accessor("leaveStatus", {
        header: "Status",
        cell: (info) => (
          <span
            className={`px-3 py-1 rounded-full border text-xs font-semibold ${getStatusStyles(
              info.getValue()
            )}`}
          >
            {info.getValue()}
          </span>
        ),
      }),
    ],
    [columnHelper]
  );

  const table = useReactTable({
    data: records,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      pagination: {
        pageIndex: 0,
        pageSize: 10, // 👈 THIS is what you want
      },
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Leave Records</h2>

        <Select
          value={String(selectedYear)}
          onValueChange={(v) => onYearChange(Number(v))}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={y}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* GLOBAL SEARCH */}
      <input
        placeholder="Search..."
        className="border px-3 py-1 rounded-md w-full max-w-sm"
        value={globalFilter ?? ""}
        onChange={(e) => setGlobalFilter(e.target.value)}
      />

      {/* TABLE */}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}

                  {header.column.getCanFilter() && (
                    <Filter
                      column={header.column}
                      filteredRows={table
                        .getFilteredRowModel()
                        .rows.map((row) =>
                          row.getValue(header.column.id)
                        )}
                    />
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={9}>Loading...</TableCell>
            </TableRow>
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9}>No records</TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => onRowClick(row.original)}
                className="cursor-pointer hover:bg-muted"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* PAGINATION */}
      <div className="flex justify-between items-center">
        <p>
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {table.getPageCount()}
        </p>

        <div className="flex gap-2">
          <Button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
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

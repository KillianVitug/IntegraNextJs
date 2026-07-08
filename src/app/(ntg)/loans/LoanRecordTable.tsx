"use client";

// import type { getLoanRecordsTypes } from "@/lib/queries/getLoanRecords";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
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

import { /*CircleCheckIcon, CircleXIcon,*/ ArrowUpDown, ArrowDown, ArrowUp } from "lucide-react";

import { usePolling } from "@/hooks/usePolling";
import { Button } from "@/components/ui/button";
import Filter from "@/components/react-table/Filter";
import { useServerTableUrlState } from "@/components/react-table/useServerTableUrlState";
import type { getLoanRecordsTypes } from "@/lib/queries/getLoanRecords";
import {
  formatEmployeeNoDisplay,
  getEmployeeTypeDisplay,
} from "@/utils/employeeDisplay";

type Props = {
  data: getLoanRecordsTypes;
  total: number;
  pageSize: number;
};

type RowType = getLoanRecordsTypes[number];
type LoanStatus = RowType["status"];

function getLoanStatusClasses(status: LoanStatus) {
  if (status === "Paid" || status === "Paid With Reloan") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
  }

  if (status === "Active") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
  }

  return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300";
}

export default function LoanRecordTable({ data, total, pageSize }: Props) {
  const columnHeaderArray: Array<keyof RowType> = [
    "employeeNo",
    "employeeType",
    "employeeName",
    "accountCode",
    "accountCodeDescription",
    "loanReferenceNumber",
    "status",
  ];

  const {
    router,
    searchParams,
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
    defaultSort: { id: "employeeName", desc: false },
    filterColumnIds: columnHeaderArray.map(String),
  });

  usePolling(searchParams.get("search") ?? searchParams.get("searchText"), 300000)

  const columnHeaderLabels: Partial<Record<keyof RowType, string>> = {
    employeeNo: "Employee No",
    employeeType: "Type",
    status: "Status",
  };

  const columnHelper = createColumnHelper<RowType>();

  const columns = columnHeaderArray.map((columnName) => {
    return columnHelper.accessor(columnName, {
      // transformational of datatype
      id: columnName,
      header: ({ column }) => {
        return (
            <Button
                variant="ghost"
                className="pl-1 w-full flex justify-between"
                onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
                {columnHeaderLabels[columnName] ??
                  (columnName[0].toUpperCase() + columnName.slice(1))}

                {column.getIsSorted() === "asc" && (
                    <ArrowUp className="ml-2 h-4 w-4" />
                )}

                {column.getIsSorted() === "desc" && (
                    <ArrowDown className="ml-2 h-4 w-4" />
                )}

                {column.getIsSorted() !== "desc" && column.getIsSorted() !== "asc" && (
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                )}
            </Button>
            )
        },
      cell: ({ getValue, row }) => {
        if (columnName === "employeeNo") {
          return formatEmployeeNoDisplay(getValue() as string | null);
        }

        if (columnName === "employeeType") {
          return getEmployeeTypeDisplay({
            employeeType: getValue() as string | null,
            employeeNo: row.original.employeeNo,
          });
        }

        if (columnName === "status") {
          const status = getValue() as LoanStatus;

          return (
            <span
              className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${getLoanStatusClasses(
                status
              )}`}
            >
              {status}
            </span>
          );
        }

        return getValue();
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
    <div className="mt-6 flex flex-col gap-4">
      <div className="rounded-lg overflow-hidden border border-border">
        <Table className="border">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
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
                            <Filter
                              column={header.column}
                              value={getColumnFilterValue(header.column.id)}
                              onValueChange={(value) =>
                                setColumnFilterValue(header.column.id, value)
                              }
                            />
                        </div>
                      ): null }
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer hover:bg-border/25 dark:hover:bg-ring/40"
                onClick={() =>
                  router.push(
                    `/loans/form?loanId=${row.original.id}`
                  )
                }
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="border">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-between items-center gap-1 flex-wrap">
        <div>
          <p className="whitespace-nowrap font-bold">
            {`Page ${
              table.getState().pagination.pageIndex + 1
            } of ${pageCount}`}
            &nbsp;&nbsp;
            {`[${total} ${total !== 1 ? "total results" : "result"}]`}
          </p>
        </div>
        <div className="flex flex-row gap-1">
        <div className="flex flex-row gap-1">
          <Button
            variant="outline"
            onClick={() => router.refresh()}
          >
            Refresh Data
          </Button>
          <Button
            variant="outline"
            onClick={resetSorting}
          >
            Reset Sorting
          </Button>
          <Button
            variant="outline"
            onClick={resetColumnFilters}
          >
            Reset Filters
          </Button>
          </div>
          <div className="flex flex-row gap-1">
          <Button
            variant="outline"
            onClick={() => {
              const newIndex = table.getState().pagination.pageIndex - 1
              setPageIndex(newIndex)
          }}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const newIndex = table.getState().pagination.pageIndex + 1
              setPageIndex(newIndex)
          }}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
}

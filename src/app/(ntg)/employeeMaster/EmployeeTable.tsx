"use client";

import type { OpenEmployeesResult } from "@/lib/queries/getEmployee";

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
import {
  formatEmployeeNoDisplay,
  getEmployeeTypeDisplay,
} from "@/utils/employeeDisplay";

type Props = {
  data: OpenEmployeesResult["data"];
  total: number;
  pageSize: number;
};

type RowType = OpenEmployeesResult["data"][number];

export default function EmployeeTable({ data, total, pageSize }: Props) {
  const columnHeaderArray: Array<keyof RowType> = [
    "employeeNo",
    "firstName",
    "lastName",
    "middleName",
    "Department",
    "Status",
    "Position",
    "Address",
    "Telephone",
    "Email",
    "employeeType",
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
    defaultSort: { id: "employeeNo", desc: false },
    filterColumnIds: columnHeaderArray.map(String),
  });

  usePolling(searchParams.get("search") ?? searchParams.get("searchText"), 300000)

  const columnHeaderLabels: Partial<Record<keyof RowType, string>> = {
    employeeNo: "Employee No",
    employeeType: "Type",
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
                    `/employeeMaster/form?employeeId=${row.original.id}`
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

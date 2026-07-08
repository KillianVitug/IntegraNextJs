"use client";
import SickandLeaveFilter from "./SickandLeaveFilter";
import type { SickAndLeaveResultsType } from "@/lib/queries/getSickAndLeave"
// import type { SelectEmployeeLeaveSchemaType } from "@/zod-schemas/SickandLeaveSchema";

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

import { ArrowUpDown, ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { Button } from "@/components/ui/button";
import Filter from "@/components/react-table/Filter";
import { useServerTableUrlState } from "@/components/react-table/useServerTableUrlState";
import {
  formatEmployeeNoDisplay,
  getEmployeeTypeDisplay,
} from "@/utils/employeeDisplay";

type Props = {
  data: SickAndLeaveResultsType;
  total: number;
  pageSize: number;
};

type RowType = SickAndLeaveResultsType[0] & {
  yearsOfService: number;
  monthsOfService: number;
  usedSickLeave?: number;
  usedVacationLeave?: number;
};

// const PDFLink = dynamic(() => import("@/components/PDFLink"), { ssr: false });

export default function SickandLeaveTable({ data, total, pageSize }: Props) {
  const columnHeaderArray: Array<keyof RowType> = [
    "employeeNo",
    "employeeType",
    "fullName",
    "dateHired",
    "yearsOfService",
    "monthsOfService",
    "department",
    "sickLeave",
    "vacationLeave",
    "usedSickLeave",       
    "usedVacationLeave",   
  ];

  const serverBackedColumnIds: Array<keyof RowType> = [
    "employeeNo",
    "employeeType",
    "fullName",
    "dateHired",
    "department",
    "sickLeave",
    "vacationLeave",
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
    filterColumnIds: serverBackedColumnIds.map(String),
  });

  usePolling(searchParams.get("search") ?? searchParams.get("searchText"), 300000)
  const [asOfDate, setAsOfDate] = useState(new Date());

  const computedData = useMemo<RowType[]>(() => {
    return data.map(item => {
      const hiredDate = item.dateHired ? new Date(item.dateHired) : null;
      if (!hiredDate) return { ...item, yearsOfService: 0, monthsOfService: 0 };
  
      const totalMonths =
        (asOfDate.getTime() - hiredDate.getTime()) /
        (1000 * 60 * 60 * 24 * 30.44);
  
      return {
        ...item,
        yearsOfService: totalMonths / 12,
        monthsOfService: totalMonths,
      };
    });
  }, [data, asOfDate]);

  // Handle changes from the filter
  const handleFilterChange = (newAsOf: Date, newYear: string) => {
    setAsOfDate(newAsOf);

    const currentYear = searchParams.get("year") ?? String(new Date().getFullYear());

    if (newYear === currentYear) {
      return;
    }
  
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", newYear);
    params.set("page", "1");
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const columnHelper = createColumnHelper<RowType>();

  const columnHeaderLabels: Partial<Record<keyof RowType, string>> = {
    employeeNo: "Employee No",
    employeeType: "Type",
  };

  const columns = columnHeaderArray.map((columnName) => {
    const isServerBackedColumn = serverBackedColumnIds.includes(columnName);

    return columnHelper.accessor(columnName, {
      // transformational of datatype
      id: columnName,
      enableColumnFilter: isServerBackedColumn,
      enableSorting: isServerBackedColumn,
      header: ({ column }) => {
        const label = columnHeaderLabels[columnName as keyof RowType] ??
          (columnName[0].toUpperCase() + columnName.slice(1));

        if (!column.getCanSort()) {
          return (
            <div className="pl-1 w-full flex justify-between text-sm font-medium">
              {label}
            </div>
          );
        }

        return (
          <Button
            variant="ghost"
            className="pl-1 w-full flex justify-between"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {label}

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
      cell: (info) => {
      const value = info.getValue();
      // List all columns you want to show as integer
      if (columnName === "employeeNo") {
        return formatEmployeeNoDisplay(value as string | null);
      }

      if (columnName === "employeeType") {
        return getEmployeeTypeDisplay({
          employeeType: value as string | null,
          employeeNo: info.row.original.employeeNo,
        });
      }

      if (
        columnName === "sickLeave" ||
        columnName === "vacationLeave" ||
        columnName === "usedSickLeave" ||
        columnName === "usedVacationLeave"
      ) {
        // If value is not null/undefined, round and display as integer
        return value != null ? Math.round(Number(value)) : 0;
      }
      // Default rendering
      return typeof value === "number" ? value.toFixed(2) : value;
    }
  });
});

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const table = useReactTable({
    data: computedData,
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
    <div className="p-1 flex flex-col gap-2">
      {/* FILTER FORM */}
      <SickandLeaveFilter onFilterChange={handleFilterChange} />
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
                      ) : null}
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
            {`Page ${table.getState().pagination.pageIndex + 1} of ${pageCount}`}
            &nbsp;&nbsp;
            {`[${total} ${total !== 1 ? "total results" : "result"}]`}
          </p>
        </div>
        <div className="flex flex-row gap-1">
          <div className="flex flex-row gap-1">

            {/* <PDFLink data={filteredData} asOfDate={asOfDate} filterYear={filterYear} /> */}

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

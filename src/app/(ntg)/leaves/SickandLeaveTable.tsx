"use client";
import SickandLeaveFilter from "./SickandLeaveFilter";
import type { SickAndLeaveSearchResultsType } from "@/lib/queries/getEmployeeSearchResults"
import { getLeaveRecordsByYear, LeaveRecordWithEmployeeInfo } from "@/app/actions/leaveAction";
// import type { SelectEmployeeLeaveSchemaType } from "@/zod-schemas/SickandLeaveSchema";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  ColumnFiltersState,
  SortingState,
  getPaginationRowModel,
  getFilteredRowModel,
  getFacetedUniqueValues,
  getSortedRowModel,
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
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useMemo, useEffect } from "react";
import { usePolling } from "@/hooks/usePolling";
import { Button } from "@/components/ui/button";
import Filter from "@/components/react-table/Filter";

type Props = {
  data: SickAndLeaveSearchResultsType;
};

type RowType = SickAndLeaveSearchResultsType[0] & {
  yearsOfService: number;
  monthsOfService: number;
  usedSickLeave?: number;
  usedVacationLeave?: number;
};

// const PDFLink = dynamic(() => import("@/components/PDFLink"), { ssr: false });

export default function SickandLeaveTable({ data }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([
    {
      id: "employeeNo",
      desc: false //false for ascending
    }
  ])
  usePolling(searchParams.get("searchText"), 300000)
  const [asOfDate, setAsOfDate] = useState(new Date());
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [filteredData, setFilteredData] = useState<RowType[]>([]);

  const [leaveUsageMap, setLeaveUsageMap] = useState<Record<string, { usedSL: number; usedVL: number }>>({});

  // Fetch approved leave records for the selected year
  useEffect(() => {
    async function fetchLeaveUsage() {
      const result = await getLeaveRecordsByYear(Number(filterYear));
      if (!result.data) {
        setLeaveUsageMap({});
        return;
      }
      // Only "Approved" leaves
      const approved = result.data.filter((lr: LeaveRecordWithEmployeeInfo) => lr.leaveStatus === "Approved");
      // Aggregate by employeeId and leaveType
      const usage: Record<string, { usedSL: number; usedVL: number }> = {};
      approved.forEach((lr: LeaveRecordWithEmployeeInfo) => {
        if (!usage[lr.employeeId]) {
          usage[lr.employeeId] = { usedSL: 0, usedVL: 0 };
        }
        if (lr.leaveType === "SL") usage[lr.employeeId].usedSL += Number(lr.noOfDays);
        if (lr.leaveType === "VL") usage[lr.employeeId].usedVL += Number(lr.noOfDays);
      });
      setLeaveUsageMap(usage);
    }
    fetchLeaveUsage();
  }, [filterYear]);

  // Compute service years/months based on `asOfDate`
  useEffect(() => {
    const computed = data.map((item) => {
      const hiredDate = item.dateHired ? new Date(item.dateHired) : null;
      const totalMonths = (() => {
        if (!hiredDate) return 0;
        const totalDays = (asOfDate.getTime() - hiredDate.getTime()) / (1000 * 60 * 60 * 24);
        return totalDays / 30.44; // average days per month
      })();
      const yearsOfService = totalMonths / 12;
      const monthsOfService = totalMonths;    // total months

      return {
        ...item,
        yearsOfService,
        monthsOfService,
      };
    });
    const filteredByYear = computed.filter((item) => {
      if (!item.dateHired) return false;
      const hiredDate = new Date(item.dateHired);
      return hiredDate.getFullYear() <= parseInt(filterYear);
    });

    setFilteredData(filteredByYear);
  }, [data, asOfDate, filterYear]);

  // Handle changes from the filter
  const handleFilterChange = (newAsOf: Date, newYear: string) => {
    setAsOfDate(newAsOf);
    setFilterYear(newYear);
  };

  const pageIndex = useMemo(() => {
    const page = searchParams.get("page");
    return page ? parseInt(page) - 1 : 0;
  }, [searchParams]);

  const columnHeaderArray: Array<keyof RowType | "fullName"| "usedSickLeave" | "usedVacationLeave"> = [
    "employeeNo",
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
            {columnName[0].toUpperCase() + columnName.slice(1)}

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
      cell: ({ getValue }) => {
      const value = getValue();
      // List all columns you want to show as integer
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

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
      columnFilters,
      pagination: {
        pageIndex,
        pageSize: 10,
      },
    },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getSortedRowModel: getSortedRowModel(),
  });

  useEffect(() => {
    const currentPageIndex = table.getState().pagination.pageIndex
    const pageCount = table.getPageCount()

    if (pageCount <= currentPageIndex && currentPageIndex > 0) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('page', '1')
      router.replace(`?${params.toString()}`, { scroll: false })
    }
  }, [table.getState().columnFilters]) // eslint-disable-line react-hooks/exhaustive-deps


  return (
    <div className="mt-6 flex flex-col gap-4">
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
                            filteredRows={table.
                              getFilteredRowModel().rows.map(row => row.getValue(header.column.id))
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
            {`Page ${table.getState().pagination.pageIndex + 1
              } of ${Math.max(1, table.getPageCount())}`}
            &nbsp;&nbsp;
            {`[${table.getFilteredRowModel().rows.length} ${table.getFilteredRowModel().rows.length !== 1
                ? "total results"
                : "result"
              }]`}
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
              onClick={() => table.resetSorting()}
            >
              Reset Sorting
            </Button>
            <Button
              variant="outline"
              onClick={() => table.resetColumnFilters()}
            >
              Reset Filters
            </Button>
          </div>
          <div className="flex flex-row gap-1">
            <Button
              variant="outline"
              onClick={() => {
                const newIndex = table.getState().pagination.pageIndex - 1
                table.setPageIndex(newIndex)
                const params = new URLSearchParams(searchParams.toString())
                params.set("page", (newIndex + 1).toString())
                router.replace(`?${params.toString()}`, { scroll: false })
              }}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const newIndex = table.getState().pagination.pageIndex + 1
                table.setPageIndex(newIndex)
                const params = new URLSearchParams(searchParams.toString())
                params.set("page", (newIndex + 1).toString())
                router.replace(`?${params.toString()}`, { scroll: false })
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

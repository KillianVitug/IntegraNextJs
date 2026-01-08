"use client";

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
import { CircleCheckIcon, CircleXIcon, ArrowUpDown, ArrowDown, ArrowUp } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useMemo, useEffect } from "react";
import { usePolling } from "@/hooks/usePolling";
import { Button } from "@/components/ui/button";
import Filter from "@/components/react-table/Filter";
import PayrollCodeSearch from "./PayrollCodeSearch";
import EmployeeSalaryEditor from "./form/EmployeeSalaryEditor";
import { getAllEmployees, getSalaryAdjustmentHistory, getSalaryAdjustmentHistoryByYear } from "@/app/actions/salaryAdjustAction";
import type { SalaryAdjustmentResultsType } from "@/app/actions/salaryAdjustAction";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";

type Props = {
  data: SalaryAdjustmentResultsType;
};

type RowType = SalaryAdjustmentResultsType[0];

// Helper function to format date
const formatDate = (dateString: string | Date) => {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

export default function SalaryAdjustTable({ data }: Props) {
  const router = useRouter();
  const [payrollCode, setPayrollCode] = useState("");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [employees, setEmployees] = useState<Awaited<ReturnType<typeof getAllEmployees>>>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [tableData, setTableData] = useState<any[]>(data); // Initialize with the data prop
  const [loadingTableData, setLoadingTableData] = useState(false);
  const searchParams = useSearchParams();
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([
    {
      id: "employeeNo",
      desc: false //false for ascending
    }
  ])
  usePolling(searchParams.get("searchText"), 300000)
  const pageIndex = useMemo(() => {
    const page = searchParams.get("page")
    return page ? parseInt(page) - 1 : 0
  }, [searchParams.get("page")])
  const columnHeaderArray: Array<keyof RowType | 'payrollCode'> = [
    "payrollCode",
    "employeeNo",
    "fullName",
    "oldDailyRate",
    "oldMonthlyRate",
    "oldMonthlyAllowance",
    "oldDailyAllowance",
    "oldRateDivisor",
    "oldBillingRate",
    "newDailyRate",
    "newMonthlyRate",
    "newMonthlyAllowance",
    "newDailyAllowance",
    "newRateDivisor",
    "newBillingRate",
    "adjustmentDate"
  ];
  const columnHelper = createColumnHelper<RowType & { payrollCode?: string }>();
  const columns = columnHeaderArray.map((columnName) => {
    return columnHelper.accessor(columnName as any, {
      id: columnName,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            className="pl-1 w-full flex justify-between"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {columnName === 'payrollCode' ? 'Payroll Code' : columnName[0].toUpperCase() + columnName.slice(1)}

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

        // Format the adjustment date
        if (columnName === 'adjustmentDate' && value) {
          return formatDate(value);
        }

        // Return the original value for other columns
        return value;
      },
    });
  });
  const table = useReactTable({
    data: tableData, // Change this from 'data' to 'tableData'
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
  }, [table.getState().columnFilters]) // eslint-disable-line react/hooks/exhaustive-deps

  // Handle salary update completion
  const handleSalaryUpdate = async (updatedEmployee: any) => {
    if (payrollCode) {
      setLoadingTableData(true);
      const newData = await getSalaryAdjustmentHistory(payrollCode);
      setTableData(newData);
      setLoadingTableData(false);
    } else {
      setLoadingTableData(true);
      const newData = await getSalaryAdjustmentHistoryByYear(selectedYear);
      setTableData(newData);
      setLoadingTableData(false);
    }
    setSelectedEmployeeId(""); // Reset selected employee after update
  };

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    setPayrollCode(""); // Clear payroll code when year changes
  };

  // Load table data when payroll code or year changes
  useEffect(() => {
    if (payrollCode) {
      setLoadingTableData(true);
      getSalaryAdjustmentHistory(payrollCode)
        .then(setTableData)
        .finally(() => setLoadingTableData(false));
    } else {
      // If no payroll code is selected, show all records for the selected year
      setLoadingTableData(true);
      getSalaryAdjustmentHistoryByYear(selectedYear)
        .then(setTableData)
        .finally(() => setLoadingTableData(false));
    }
  }, [payrollCode, selectedYear]);

  useEffect(() => {
    if (employees.length === 0) {
      setLoadingEmployees(true);
      getAllEmployees()
        .then(setEmployees)
        .finally(() => setLoadingEmployees(false));
    }
  }, [employees.length]);

  // Handle row click to select employee for editing
  const handleRowClick = (employeeId: string, payrollCode: string) => {
    if (!employeeId || !payrollCode) {
      console.warn("Employee ID or Payroll Code is missing");
      return;
    }
    setSelectedEmployeeId(employeeId);
    setPayrollCode(payrollCode);
  };

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex flex-row gap-4 items-end">
        <PayrollCodeSearch
          value={payrollCode}
          onChange={setPayrollCode}
          onYearChange={handleYearChange}
          onResetSelectedEmployee={() => setSelectedEmployeeId("")}
        />
        <div className="flex flex-row gap-2 items-end">
        <SelectWithLabel
            fieldTitle="Search Employee"
            nameInSchema="selectedEmployeeId"
            data={employees.map((emp) => ({
              id: emp.id,
              name: `${emp.employeeNo} - ${emp.fullName}`,
            }))}
            value={selectedEmployeeId}
            onChange={(val) => setSelectedEmployeeId(val)}
            className="max-w-xs"
          />
        </div>
      </div>

      {/* Salary Editor - Only show if payroll code is selected */}
      {selectedEmployeeId && payrollCode && (
        <EmployeeSalaryEditor
          selectedEmployeeId={selectedEmployeeId}
          payrollCode={payrollCode}
          onUpdateComplete={handleSalaryUpdate}
          onCancel={() => setSelectedEmployeeId("")}
        />
      )}

      {/* Warning if no payroll code selected */}
      {selectedEmployeeId && !payrollCode && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
          Please select a Payroll Code before updating salary information.
        </div>
      )}

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
            {/* Render data rows */}
            {table.getRowModel().rows.map((row) => {
              const isSelected = row.original.employeeId === selectedEmployeeId && row.original.payrollCode === payrollCode;
              return (
                <TableRow
                  key={row.id}
                  className={`cursor-pointer hover:bg-border/25 dark:hover:bg-ring/40 ${
                    isSelected ? 'bg-blue-100 dark:bg-blue-900/20 border-blue-300' : ''
                  }`}
                  onClick={() => {
                    const employeeId = row.original.employeeId;
                    const payrollCode = row.original.payrollCode;
                    if (employeeId && payrollCode) {
                      handleRowClick(employeeId, payrollCode);
                    }
                  }}
                  title="Click to edit this employee's salary information"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="border">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}

            {/* Render empty rows if less than 10 */}
            {Array.from({ length: Math.max(0, 10 - table.getRowModel().rows.length) }).map((_, idx) => (
              <TableRow key={`empty-${idx}`}>
                {table.getAllLeafColumns().map((col) => (
                  <TableCell key={col.id} className="border">
                    &nbsp;
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

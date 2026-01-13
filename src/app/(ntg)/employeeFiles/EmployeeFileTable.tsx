"use client";

import type { EmployeeSearchFolderResultsType } from "@/lib/queries/getEmployeeSearchResults";

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

import {
  // CircleCheckIcon,
  // CircleXIcon,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
} from "lucide-react";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useMemo, useEffect } from "react";
import { usePolling } from "@/hooks/usePolling";
import { Button } from "@/components/ui/button";
import Filter from "@/components/react-table/Filter";
import React from "react";

type Props = {
  data: EmployeeSearchFolderResultsType;
};

type RowType = EmployeeSearchFolderResultsType[0];

export default function EmployeeTable({ data }: Props) {
  const router = useRouter();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {}
  );
  const searchParams = useSearchParams();

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  function toggleGroup(groupId: string) {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  }

  const [sorting, setSorting] = useState<SortingState>([
    {
      id: "createdAt",
      desc: true, //false for ascending
    },
  ]);

  usePolling(searchParams.get("searchText"), 300000);

  const pageIndex = useMemo(() => {
    const page = searchParams.get("page");
    return page ? parseInt(page) - 1 : 0;
  }, [searchParams.get("page")]); // eslint-disable-line react-hooks/exhaustive-deps

  const columnHeaderArray: Array<keyof RowType> = [
    "employeeNo",
    "employeeName",
    "folderType",
    "folderName",
    "description",
    "remarks",
    "createdAt",
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

            {column.getIsSorted() !== "desc" &&
              column.getIsSorted() !== "asc" && (
                <ArrowUpDown className="ml-2 h-4 w-4" />
              )}
          </Button>
        );
      },
      // cell: ({ getValue }) => { //presentational edit cells
      //     const value = getValue()
      // }
    });
  });

  const table = useReactTable({
    data,
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
    const currentPageIndex = table.getState().pagination.pageIndex;
    const pageCount = table.getPageCount();

    if (pageCount <= currentPageIndex && currentPageIndex > 0) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", "1");
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [table.getState().columnFilters]); // eslint-disable-line react-hooks/exhaustive-deps

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
                            filteredRows={table
                              .getFilteredRowModel()
                              .rows.map((row) =>
                                row.getValue(header.column.id)
                              )}
                          />
                        </div>
                      ) : null}
                    </TableHead>
                    
                  );
                })}
                <TableHead className="bg-secondary p-1 text-center">Action</TableHead>
              </TableRow>
            ))}
            
          </TableHeader>
          <TableBody>
          {table.getRowModel().rows.map((row) => {
            const folder = row.original;
            const isExpanded = expandedGroups[folder.id] ?? false;

            return (
              <React.Fragment key={folder.id}>
                <TableRow
                  className="cursor-pointer bg-muted/30 hover:bg-muted"
                  onClick={() => toggleGroup(folder.id)}
                >
                  <TableCell>{folder.employeeNo}</TableCell>
                  <TableCell>{folder.employeeName}</TableCell>
                  <TableCell>{folder.folderType}</TableCell>
                  <TableCell>{folder.folderName}</TableCell>
                  <TableCell>{folder.description}</TableCell>
                  <TableCell>{folder.remarks}</TableCell>
                  <TableCell>{folder.createdAt?.toLocaleDateString()}</TableCell>

                  <TableCell className="text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/employeeFiles/form?groupId=${folder.id}`);
                      }}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>

                {isExpanded &&
                  folder.files.map((file) => (
                    <TableRow
                      key={file.id}
                      className="bg-white dark:bg-black/20"
                      onClick={() =>
                        router.push(`/employeeFiles/form?groupId=${folder.id}`)
                      }
                    >
                      <TableCell>{file.fileName}</TableCell>
                      <TableCell></TableCell>
                      <TableCell>{file.fileExtension}</TableCell>
                      <TableCell>{file.mimeType}</TableCell>
                      <TableCell>{file.description}</TableCell>
                      <TableCell>{file.remarks}</TableCell>
                      <TableCell>{file.createdAt?.toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
              </React.Fragment>
            );
          })}
        </TableBody>

        </Table>
      </div>
      <div className="flex justify-between items-center gap-1 flex-wrap">
        <div>
          <p className="whitespace-nowrap font-bold">
            {`Page ${table.getState().pagination.pageIndex + 1} of ${Math.max(
              1,
              table.getPageCount()
            )}`}
            &nbsp;&nbsp;
            {`[${table.getFilteredRowModel().rows.length} ${
              table.getFilteredRowModel().rows.length !== 1
                ? "total results"
                : "result"
            }]`}
          </p>
        </div>
        <div className="flex flex-row gap-1">
          <div className="flex flex-row gap-1">
            <Button variant="outline" onClick={() => router.refresh()}>
              Refresh Data
            </Button>
            <Button variant="outline" onClick={() => table.resetSorting()}>
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
                const newIndex = table.getState().pagination.pageIndex - 1;
                table.setPageIndex(newIndex);
                const params = new URLSearchParams(searchParams.toString());
                params.set("page", (newIndex + 1).toString());
                router.replace(`?${params.toString()}`, { scroll: false });
              }}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const newIndex = table.getState().pagination.pageIndex + 1;
                table.setPageIndex(newIndex);
                const params = new URLSearchParams(searchParams.toString());
                params.set("page", (newIndex + 1).toString());
                router.replace(`?${params.toString()}`, { scroll: false });
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

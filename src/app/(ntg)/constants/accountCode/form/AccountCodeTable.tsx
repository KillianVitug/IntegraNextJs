"use client";

import { useState, useMemo, useEffect } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  SortingState,
  getPaginationRowModel,
  getSortedRowModel,
} from "@tanstack/react-table";
import { useRouter, useSearchParams } from "next/navigation";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

import { selectAccountCodeSchema } from "@/zod-schemas/accountCode";
import { z } from "zod";

type AccountCode = z.infer<typeof selectAccountCodeSchema>;

export default function AccountCodeTable({
  accountCode,
  onRowSelect,
}: {
  accountCode?: AccountCode[]; // ✅ make optional
  onRowSelect?: (accountCode: AccountCode) => void;
}) {
  const safeAccountCode = Array.isArray(accountCode) ? accountCode : []; // ✅ fallback
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sorting, setSorting] = useState<SortingState>([
    { id: "accountCode", desc: false },
  ]);

  const pageIndex = useMemo(() => {
    const page = searchParams.get("page");
    return page ? parseInt(page) - 1 : 0;
  }, [searchParams]);

  const columnHelper = createColumnHelper<AccountCode>();

  const columns = [
    columnHelper.accessor("accountCode", {
      id: "accountCode",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="pl-1 w-full flex justify-between"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Account Code
          {column.getIsSorted() === "asc" && <ArrowUp className="ml-2 h-4 w-4" />}
          {column.getIsSorted() === "desc" && <ArrowDown className="ml-2 h-4 w-4" />}
          {!column.getIsSorted() && <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
      ),
    }),
    columnHelper.accessor("description", {
      id: "description",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="pl-1 w-full flex justify-between"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Description
          {column.getIsSorted() === "asc" && <ArrowUp className="ml-2 h-4 w-4" />}
          {column.getIsSorted() === "desc" && <ArrowDown className="ml-2 h-4 w-4" />}
          {!column.getIsSorted() && <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
      ),
    }),
    columnHelper.accessor("accountType", {
      id: "accountType",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="pl-1 w-full flex justify-between"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Account Type
          {column.getIsSorted() === "asc" && <ArrowUp className="ml-2 h-4 w-4" />}
          {column.getIsSorted() === "desc" && <ArrowDown className="ml-2 h-4 w-4" />}
          {!column.getIsSorted() && <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
      ),
    }),
    columnHelper.accessor("dailyRate", {
      id: "dailyRate",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="pl-1 w-full flex justify-between"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Daily
          {column.getIsSorted() === "asc" && <ArrowUp className="ml-2 h-4 w-4" />}
          {column.getIsSorted() === "desc" && <ArrowDown className="ml-2 h-4 w-4" />}
          {!column.getIsSorted() && <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
      ),
    }),
    columnHelper.accessor("monthlyRate", {
      id: "monthlyRate",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="pl-1 w-full flex justify-between"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Monthly
          {column.getIsSorted() === "asc" && <ArrowUp className="ml-2 h-4 w-4" />}
          {column.getIsSorted() === "desc" && <ArrowDown className="ml-2 h-4 w-4" />}
          {!column.getIsSorted() && <ArrowUpDown className="ml-2 h-4 w-4" />}
        </Button>
      ),
    }),
  ];

  const table = useReactTable({
    data: safeAccountCode, // ✅ safe value
    columns,
    state: {
      sorting,
      pagination: {
        pageIndex,
        pageSize: 10,
      },
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
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
  }, [safeAccountCode]); // ✅ use safeAccountCode instead of Account Codes

  if (!safeAccountCode.length) {
    return <p className="text-center text-muted-foreground mt-4">No Account Codes found.</p>;
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="rounded-lg overflow-hidden border border-border">
        <Table className="border">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="bg-secondary p-1">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => onRowSelect?.(row.original)}
                className="cursor-pointer hover:bg-muted transition"
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
        <p className="whitespace-nowrap font-bold">
          {`Page ${table.getState().pagination.pageIndex + 1} of ${Math.max(
            1,
            table.getPageCount()
          )}`}
          &nbsp;&nbsp;
          {`[${safeAccountCode.length} ${
            safeAccountCode.length !== 1 ? "total results" : "result"
          }]`}
        </p>

        <div className="flex flex-row gap-1">
          <Button variant="outline" onClick={() => table.resetSorting()}>
            Reset Sorting
          </Button>
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
  );
}

"use client";

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { frequencyEnum, statusEnum } from "@/db/schema";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export type RecurringEntry = {
  id: number | undefined | "(New)";
  employeeId: string | null;
  accountCode: string | null;
  description: string | null;
  amount: string | null;
  frequency: (typeof frequencyEnum.enumValues)[number];
  status: (typeof statusEnum.enumValues)[number];
  startDate: string | null;
  endDate: string | null;
};

type Props = {
  entries: RecurringEntry[];
  onSelectEntry: (entry: RecurringEntry, index: number) => void;
};

const columnHelper = createColumnHelper<RecurringEntry>();

export default function RecurringEntriesTable({
  entries,
  onSelectEntry,
}: Props) {
  const columns = [
    columnHelper.accessor("accountCode", {
      header: "Account Code",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("amount", {
      header: "Amount",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("frequency", {
      header: "Frequency",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("startDate", {
      header: "Start Date",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("endDate", {
      header: "End Date",
      cell: (info) => info.getValue(),
    }),
  ];

  const table = useReactTable({
    data: entries,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="mt-4 border rounded-md overflow-auto">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className="cursor-pointer hover:bg-muted"
              onClick={() => onSelectEntry(row.original, row.index)}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

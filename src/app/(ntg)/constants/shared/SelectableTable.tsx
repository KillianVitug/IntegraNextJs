"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Column<T> = {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
};

type Props<T extends { id: string | number }> = {
  title: string;
  description?: string;
  rows: T[];
  columns: Column<T>[];
  selectedId?: string | number | null;
  onRowSelect?: (row: T) => void;
  emptyMessage: string;
};

export function SelectableTable<T extends { id: string | number }>({
  title,
  description,
  rows,
  columns,
  selectedId,
  onRowSelect,
  emptyMessage,
}: Props<T>) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-2xl font-bold">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  className={cn("px-3 py-2 text-left font-medium", column.className)}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-t transition-colors",
                  onRowSelect ? "cursor-pointer hover:bg-muted/40" : "",
                  selectedId === row.id ? "bg-muted/60" : ""
                )}
                onClick={() => onRowSelect?.(row)}
              >
                {columns.map((column) => (
                  <td key={column.header} className={cn("px-3 py-2", column.className)}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  className="px-3 py-6 text-center text-muted-foreground"
                  colSpan={Math.max(columns.length, 1)}
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

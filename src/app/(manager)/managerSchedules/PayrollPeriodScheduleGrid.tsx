"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  WeeklyScheduleGridSelect,
  type WeeklyScheduleShiftOption,
} from "./WeeklyScheduleGridSelect";

export type PayrollPeriodScheduleGridCell = {
  date: string;
  currentValue: string;
};

export type PayrollPeriodScheduleGridRow = {
  id: string;
  employeeLabel: string;
  departmentCode: string | null;
  departmentName: string | null;
  cells: PayrollPeriodScheduleGridCell[];
};

type Props = {
  dates: string[];
  rows: PayrollPeriodScheduleGridRow[];
  shiftTables: WeeklyScheduleShiftOption[];
};

function formatDateHeader(date: string) {
  const parsedDate = new Date(`${date}T00:00:00`);
  const shortDate = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(parsedDate);
  const weekday = new Intl.DateTimeFormat("en", {
    weekday: "long",
  }).format(parsedDate);

  return `${shortDate} - ${weekday}`;
}

function stickyEmployeeCellClass(isSelected = false) {
  return [
    "sticky left-0 z-20 min-w-64 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.2)]",
    isSelected ? "bg-sky-50" : "bg-background group-hover:bg-sky-50",
  ].join(" ");
}

export function PayrollPeriodScheduleGrid({
  dates,
  rows,
  shiftTables,
}: Props) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    null,
  );

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              className="sticky left-0 z-30 min-w-64 border-r bg-background shadow-[2px_0_4px_-2px_rgba(0,0,0,0.2)]"
              data-testid="period-schedule-employees-header"
            >
              Employees
            </TableHead>
            {dates.map((date) => (
              <TableHead key={date} className="min-w-44">
                <div>{formatDateHeader(date)}</div>
                <div className="text-xs font-normal text-muted-foreground">
                  {date}
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isSelected = selectedEmployeeId === row.id;

            return (
              <TableRow
                key={`${row.id}-period`}
                className="group hover:bg-sky-50 data-[state=selected]:bg-sky-50"
                data-employee-id={row.id}
                data-state={isSelected ? "selected" : undefined}
                onClick={() => setSelectedEmployeeId(row.id)}
                onFocusCapture={() => setSelectedEmployeeId(row.id)}
              >
                <TableCell
                  className={stickyEmployeeCellClass(isSelected)}
                  data-testid="period-schedule-employee-cell"
                >
                  <div className="font-medium">{row.employeeLabel}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.departmentCode ?? "-"} |{" "}
                    {row.departmentName ?? "No department"}
                  </div>
                </TableCell>
                {dates.map((date) => {
                  const cell = row.cells.find(
                    (periodCell) => periodCell.date === date,
                  );

                  return (
                    <TableCell key={`${row.id}-${date}`} className="align-top">
                      {cell ? (
                        <WeeklyScheduleGridSelect
                          name={`period-day-${row.id}-${date}`}
                          defaultValue={cell.currentValue}
                          shiftTables={shiftTables}
                          label={`${row.employeeLabel} ${date} schedule`}
                        />
                      ) : null}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={1 + dates.length}
                className="py-10 text-center text-muted-foreground"
              >
                No employees are available for your assigned departments.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}

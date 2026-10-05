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
  values: Record<string, string>;
  onValueChange: (employeeId: string, date: string, value: string) => void;
  resetVersion: number;
};

const MANILA_TIME_ZONE = "Asia/Manila";
const shortDateFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  timeZone: MANILA_TIME_ZONE,
});
const weekdayFormatter = new Intl.DateTimeFormat("en-PH", {
  weekday: "long",
  timeZone: MANILA_TIME_ZONE,
});

function parseDateKeyAsUtcDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  return new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0),
  );
}

function formatDateHeader(date: string) {
  const parsedDate = parseDateKeyAsUtcDate(date);

  if (!parsedDate) {
    return date;
  }

  const shortDate = shortDateFormatter.format(parsedDate);
  const weekday = weekdayFormatter.format(parsedDate);

  return `${shortDate} - ${weekday}`;
}

function stickyEmployeeCellClass(isSelected = false) {
  return [
    "block border-b pb-3 md:sticky md:left-0 md:z-20 md:min-w-64 md:border-b-0 md:border-r md:pb-1.5 md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.2)]",
    isSelected ? "bg-sky-50" : "bg-background md:group-hover:bg-sky-50",
  ].join(" ");
}

export function getPayrollPeriodScheduleFieldKey(
  employeeId: string,
  date: string,
) {
  return `${employeeId}:${date}`;
}

export function PayrollPeriodScheduleGrid({
  dates,
  rows,
  shiftTables,
  values,
  onValueChange,
  resetVersion,
}: Props) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    null,
  );

  return (
    <div className="rounded-md border md:overflow-x-auto">
      <Table className="block md:table">
        <TableHeader className="hidden md:table-header-group">
          <TableRow className="md:table-row">
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
        <TableBody className="block md:table-row-group">
          {rows.map((row) => {
            const isSelected = selectedEmployeeId === row.id;

            return (
              <TableRow
                key={`${row.id}-period`}
                className="group block border-b p-3 last:border-b-0 md:table-row md:p-0 md:hover:bg-sky-50 md:data-[state=selected]:bg-sky-50"
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
                    <TableCell
                      key={`${row.id}-${date}`}
                      className="block px-0 py-2 align-top md:table-cell md:px-2 md:py-1.5"
                    >
                      <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground md:hidden">
                        {formatDateHeader(date)}
                      </div>
                      {cell ? (
                        <WeeklyScheduleGridSelect
                          key={`${row.id}-${date}-${resetVersion}`}
                          name={`period-day-${row.id}-${date}`}
                          defaultValue={cell.currentValue}
                          shiftTables={shiftTables}
                          label={`${row.employeeLabel} ${date} schedule`}
                          selectedLabelMode="description"
                          value={
                            values[
                              getPayrollPeriodScheduleFieldKey(row.id, date)
                            ] ?? cell.currentValue
                          }
                          resetVersion={resetVersion}
                          onValueChange={(nextValue) =>
                            onValueChange(row.id, date, nextValue)
                          }
                        />
                      ) : null}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
          {rows.length === 0 ? (
            <TableRow className="block md:table-row">
              <TableCell
                colSpan={1 + dates.length}
                className="block py-10 text-center text-muted-foreground md:table-cell"
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

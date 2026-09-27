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
import {
  WEEKLY_BASE_SCHEDULE_WEEKDAYS,
  type WeeklyBaseScheduleWeekday,
} from "./weekdays";

export type WeeklyBaseScheduleGridDay = {
  weekday: WeeklyBaseScheduleWeekday;
  shiftTableId: number | null;
};

export type WeeklyBaseScheduleGridRow = {
  id: string;
  employeeLabel: string;
  departmentCode: string | null;
  departmentName: string | null;
  days: WeeklyBaseScheduleGridDay[];
};

type Props = {
  rows: WeeklyBaseScheduleGridRow[];
  shiftTables: WeeklyScheduleShiftOption[];
};

function stickyEmployeeCellClass(isSelected = false) {
  return [
    "sticky left-0 z-20 min-w-64 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.2)]",
    isSelected ? "bg-sky-50" : "bg-background group-hover:bg-sky-50",
  ].join(" ");
}

function getWeeklyGridDayValue(
  row: WeeklyBaseScheduleGridRow,
  weekday: WeeklyBaseScheduleWeekday,
) {
  const shiftTableId =
    row.days.find((day) => day.weekday === weekday)?.shiftTableId ?? null;

  return shiftTableId ? String(shiftTableId) : "0";
}

export function WeeklyBaseScheduleGrid({ rows, shiftTables }: Props) {
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
              data-testid="weekly-base-schedule-employees-header"
            >
              Employees
            </TableHead>
            {WEEKLY_BASE_SCHEDULE_WEEKDAYS.map((weekday) => (
              <TableHead key={weekday} className="min-w-44">
                {weekday}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isSelected = selectedEmployeeId === row.id;

            return (
              <TableRow
                key={`${row.id}-weekly-base`}
                className="group hover:bg-sky-50 data-[state=selected]:bg-sky-50"
                data-employee-id={row.id}
                data-state={isSelected ? "selected" : undefined}
                onClick={() => setSelectedEmployeeId(row.id)}
                onFocusCapture={() => setSelectedEmployeeId(row.id)}
              >
                <TableCell
                  className={stickyEmployeeCellClass(isSelected)}
                  data-testid="weekly-base-schedule-employee-cell"
                >
                  <input type="hidden" name="employeeId" value={row.id} />
                  <div className="font-medium">{row.employeeLabel}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.departmentCode ?? "-"} |{" "}
                    {row.departmentName ?? "No department"}
                  </div>
                </TableCell>
                {WEEKLY_BASE_SCHEDULE_WEEKDAYS.map((weekday) => (
                  <TableCell key={`${row.id}-${weekday}`} className="align-top">
                    <WeeklyScheduleGridSelect
                      name={`day-${row.id}-${weekday}`}
                      defaultValue={getWeeklyGridDayValue(row, weekday)}
                      shiftTables={shiftTables}
                      label={`${row.employeeLabel} ${weekday} schedule`}
                    />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={1 + WEEKLY_BASE_SCHEDULE_WEEKDAYS.length}
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

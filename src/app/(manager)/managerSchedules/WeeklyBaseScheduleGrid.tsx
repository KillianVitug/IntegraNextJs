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
  values: Record<string, string>;
  onValueChange: (
    employeeId: string,
    weekday: WeeklyBaseScheduleWeekday,
    value: string,
  ) => void;
  resetVersion: number;
};

function stickyEmployeeCellClass(isSelected = false) {
  return [
    "block border-b pb-3 md:sticky md:left-0 md:z-20 md:min-w-64 md:border-b-0 md:border-r md:pb-1.5 md:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.2)]",
    isSelected ? "bg-sky-50" : "bg-background md:group-hover:bg-sky-50",
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

export function getWeeklyBaseScheduleFieldKey(
  employeeId: string,
  weekday: WeeklyBaseScheduleWeekday,
) {
  return `${employeeId}:${weekday}`;
}

export function getWeeklyBaseScheduleDefaultValue(
  row: WeeklyBaseScheduleGridRow,
  weekday: WeeklyBaseScheduleWeekday,
) {
  return getWeeklyGridDayValue(row, weekday);
}

export function WeeklyBaseScheduleGrid({
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
        <TableBody className="block md:table-row-group">
          {rows.map((row) => {
            const isSelected = selectedEmployeeId === row.id;

            return (
              <TableRow
                key={`${row.id}-weekly-base`}
                className="group block border-b p-3 last:border-b-0 md:table-row md:p-0 md:hover:bg-sky-50 md:data-[state=selected]:bg-sky-50"
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
                {WEEKLY_BASE_SCHEDULE_WEEKDAYS.map((weekday) => {
                  const fieldKey = getWeeklyBaseScheduleFieldKey(
                    row.id,
                    weekday,
                  );
                  const defaultValue = getWeeklyBaseScheduleDefaultValue(
                    row,
                    weekday,
                  );
                  const value = values[fieldKey] ?? defaultValue;

                  return (
                    <TableCell
                      key={`${row.id}-${weekday}`}
                      className="block px-0 py-2 align-top md:table-cell md:px-2 md:py-1.5"
                    >
                      <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground md:hidden">
                        {weekday}
                      </div>
                      <WeeklyScheduleGridSelect
                        key={`${row.id}-${weekday}-${resetVersion}`}
                        name={`day-${row.id}-${weekday}`}
                        defaultValue={defaultValue}
                        shiftTables={shiftTables}
                        label={`${row.employeeLabel} ${weekday} schedule`}
                        selectedLabelMode="description"
                        value={value}
                        resetVersion={resetVersion}
                        onValueChange={(nextValue) =>
                          onValueChange(row.id, weekday, nextValue)
                        }
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
          {rows.length === 0 ? (
            <TableRow className="block md:table-row">
              <TableCell
                colSpan={1 + WEEKLY_BASE_SCHEDULE_WEEKDAYS.length}
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

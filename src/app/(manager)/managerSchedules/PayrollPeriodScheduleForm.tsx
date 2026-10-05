"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getPayrollPeriodScheduleFieldKey,
  PayrollPeriodScheduleGrid,
  type PayrollPeriodScheduleGridRow,
} from "./PayrollPeriodScheduleGrid";
import type { WeeklyScheduleShiftOption } from "./WeeklyScheduleGridSelect";

type Props = {
  periodId: string;
  periodLabel: string;
  dates: string[];
  rows: PayrollPeriodScheduleGridRow[];
  shiftTables: WeeklyScheduleShiftOption[];
};

function buildPayrollPeriodScheduleValues(rows: PayrollPeriodScheduleGridRow[]) {
  const values: Record<string, string> = {};

  for (const row of rows) {
    for (const cell of row.cells) {
      values[getPayrollPeriodScheduleFieldKey(row.id, cell.date)] =
        cell.currentValue;
    }
  }

  return values;
}

export function PayrollPeriodScheduleForm({
  periodId,
  periodLabel,
  dates,
  rows,
  shiftTables,
}: Props) {
  const baselineValues = useMemo(
    () => buildPayrollPeriodScheduleValues(rows),
    [rows],
  );
  const [values, setValues] = useState<Record<string, string>>(baselineValues);
  const resetVersion = 0;
  const saveDisabled =
    shiftTables.length === 0 || rows.length === 0 || dates.length === 0;

  useEffect(() => {
    setValues(baselineValues);
  }, [baselineValues]);

  function handleValueChange(employeeId: string, date: string, value: string) {
    const fieldKey = getPayrollPeriodScheduleFieldKey(employeeId, date);
    setValues((current) => {
      if (current[fieldKey] === value) return current;
      return {
        ...current,
        [fieldKey]: value,
      };
    });
  }

  function handleReset() {
    window.location.reload();
  }

  return (
    <form
      action="/managerSchedules/period-schedule"
      className="space-y-4"
      method="post"
    >
      <input type="hidden" name="periodId" value={periodId} />

      <div className="text-sm text-muted-foreground">{periodLabel}</div>

      <PayrollPeriodScheduleGrid
        dates={dates}
        rows={rows}
        shiftTables={shiftTables}
        values={values}
        onValueChange={handleValueChange}
        resetVersion={resetVersion}
      />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saveDisabled}>
          Save Payroll Period Schedule
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleReset}
        >
          Reset
        </Button>
      </div>
    </form>
  );
}

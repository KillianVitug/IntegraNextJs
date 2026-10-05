"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getWeeklyBaseScheduleDefaultValue,
  getWeeklyBaseScheduleFieldKey,
  WeeklyBaseScheduleGrid,
  type WeeklyBaseScheduleGridRow,
} from "./WeeklyBaseScheduleGrid";
import type { WeeklyScheduleShiftOption } from "./WeeklyScheduleGridSelect";
import {
  WEEKLY_BASE_SCHEDULE_WEEKDAYS,
  type WeeklyBaseScheduleWeekday,
} from "./weekdays";

type Props = {
  rows: WeeklyBaseScheduleGridRow[];
  shiftTables: WeeklyScheduleShiftOption[];
};

function buildWeeklyBaseScheduleValues(rows: WeeklyBaseScheduleGridRow[]) {
  const values: Record<string, string> = {};

  for (const row of rows) {
    for (const weekday of WEEKLY_BASE_SCHEDULE_WEEKDAYS) {
      values[getWeeklyBaseScheduleFieldKey(row.id, weekday)] =
        getWeeklyBaseScheduleDefaultValue(row, weekday);
    }
  }

  return values;
}

export function WeeklyBaseScheduleForm({ rows, shiftTables }: Props) {
  const baselineValues = useMemo(
    () => buildWeeklyBaseScheduleValues(rows),
    [rows],
  );
  const [values, setValues] = useState<Record<string, string>>(baselineValues);
  const resetVersion = 0;
  const saveDisabled = shiftTables.length === 0 || rows.length === 0;

  useEffect(() => {
    setValues(baselineValues);
  }, [baselineValues]);

  function handleValueChange(
    employeeId: string,
    weekday: WeeklyBaseScheduleWeekday,
    value: string,
  ) {
    const fieldKey = getWeeklyBaseScheduleFieldKey(employeeId, weekday);
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
      action="/managerSchedules/weekly-schedule/bulk"
      className="space-y-4"
      method="post"
    >
      <WeeklyBaseScheduleGrid
        rows={rows}
        shiftTables={shiftTables}
        values={values}
        onValueChange={handleValueChange}
        resetVersion={resetVersion}
      />

      {shiftTables.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Create shift tables first from Settings before saving a weekly
          schedule.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saveDisabled}>
          Save Weekly Base Schedule
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

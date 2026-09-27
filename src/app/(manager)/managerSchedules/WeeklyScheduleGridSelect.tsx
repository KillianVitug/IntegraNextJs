"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

export type WeeklyScheduleShiftOption = {
  id: number;
  code: string;
  description: string;
  regularStartTime: string;
  regularEndTime: string;
};

type Props = {
  name: string;
  defaultValue: string;
  shiftTables: WeeklyScheduleShiftOption[];
  label: string;
};

function formatAmPmTime(time: string) {
  const [rawHour, rawMinute] = time.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return time;
  }

  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;

  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}

function formatSelectedLabel(shiftTable: WeeklyScheduleShiftOption | undefined) {
  if (!shiftTable) return "Off / Rest Day";

  return `${formatAmPmTime(shiftTable.regularStartTime)} - ${formatAmPmTime(
    shiftTable.regularEndTime,
  )}`;
}

function formatOptionLabel(shiftTable: WeeklyScheduleShiftOption) {
  return `${shiftTable.code} | ${shiftTable.description} | ${shiftTable.regularStartTime} - ${shiftTable.regularEndTime}`;
}

export function WeeklyScheduleGridSelect({
  name,
  defaultValue,
  shiftTables,
  label,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const shiftTableMap = useMemo(
    () => new Map(shiftTables.map((shiftTable) => [String(shiftTable.id), shiftTable])),
    [shiftTables],
  );
  const selectedShiftTable = shiftTableMap.get(value);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <select
        aria-label={label}
        className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
        name={name}
        defaultValue={defaultValue}
      >
        <option value="0">Off / Rest Day</option>
        {shiftTables.map((shiftTable) => (
          <option key={shiftTable.id} value={shiftTable.id}>
            {formatOptionLabel(shiftTable)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div>
      <input type="hidden" name={name} value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger aria-label={label} className="h-9 min-w-40">
          <span className="truncate">{formatSelectedLabel(selectedShiftTable)}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="0">Off / Rest Day</SelectItem>
          {shiftTables.map((shiftTable) => (
            <SelectItem key={shiftTable.id} value={String(shiftTable.id)}>
              {formatOptionLabel(shiftTable)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

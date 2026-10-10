"use client";
import { shiftTableScheduleLabel } from "@/lib/scheduling/presentation";
import type { ShiftTableReadModel } from "@/lib/shifts";

import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

export type WeeklyScheduleShiftOption = ShiftTableReadModel;

type Props = {
  name: string;
  defaultValue: string;
  shiftTables: WeeklyScheduleShiftOption[];
  label: string;
  selectedLabelMode?: "time" | "description";
  value?: string;
  onValueChange?: (value: string) => void;
  resetVersion?: number;
};

function formatSelectedLabel(shiftTable: WeeklyScheduleShiftOption | undefined) {
 return shiftTable ? shiftTableScheduleLabel(shiftTable) : "Off / Rest Day";
}
const formatOptionLabel = shiftTableScheduleLabel;

export function WeeklyScheduleGridSelect({
  name,
  defaultValue,
  shiftTables,
  label,
  value,
  onValueChange,
  resetVersion = 0,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const shiftTableMap = useMemo(
    () => new Map(shiftTables.map((shiftTable) => [String(shiftTable.id), shiftTable])),
    [shiftTables],
  );
  const selectedValue = value ?? internalValue;
  const selectedShiftTable = shiftTableMap.get(selectedValue);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (value === undefined) {
      setInternalValue(defaultValue);
    }
  }, [defaultValue, resetVersion, value]);

  function handleValueChange(nextValue: string) {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  }

  if (!mounted) {
    return (
      <select
        aria-label={label}
        className="flex h-11 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-base md:h-9 md:min-w-56 md:py-1 md:text-sm"
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
      <input type="hidden" name={name} value={selectedValue} />
      <Select value={selectedValue} onValueChange={handleValueChange}>
        <SelectTrigger
          aria-label={label}
          className="h-11 min-w-0 text-base md:h-9 md:min-w-56 md:text-sm"
        >
          <span className="truncate">
            {formatSelectedLabel(selectedShiftTable)}
          </span>
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

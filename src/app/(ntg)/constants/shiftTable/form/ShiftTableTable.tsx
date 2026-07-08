"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import type { SelectShiftTableSchemaType } from "@/zod-schemas/shiftTable";

type Props = {
  rows: SelectShiftTableSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectShiftTableSchemaType) => void;
};

export default function ShiftTableTable({
  rows,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="Shift Table Entries"
      description="Select a shift table row to edit its working hours and break slots."
      rows={rows}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No shift table entries found."
      columns={[
        {
          header: "Code",
          render: (row) => row.code,
        },
        {
          header: "Description",
          render: (row) => row.description,
        },
        {
          header: "Regular Hours",
          render: (row) => `${row.regularStartTime} - ${row.regularEndTime}`,
        },
        {
          header: "Deduct Break",
          render: (row) => `${row.deductibleBreakMinutes} mins`,
        },
        {
          header: "Hours Per Day",
          render: (row) => row.hoursPerDay.toFixed(2),
        },
      ]}
    />
  );
}

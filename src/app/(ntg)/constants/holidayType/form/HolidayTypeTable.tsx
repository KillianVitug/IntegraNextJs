"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import type { SelectHolidayTypeAccountCodeSchemaType } from "@/zod-schemas/holidayTypeAccountCode";

type Props = {
  holidayTypeRows: SelectHolidayTypeAccountCodeSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectHolidayTypeAccountCodeSchemaType) => void;
};

export default function HolidayTypeTable({
  holidayTypeRows,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="Holiday Type Entries"
      description="Select a holiday type row to map its DTR worked holiday and holiday overtime account codes."
      rows={holidayTypeRows}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No holiday type rows found."
      columns={[
        {
          header: "Holiday Type",
          render: (row) => row.holidayType,
        },
        {
          header: "Regular Holiday Hours",
          render: (row) => row.accountDisplay ?? "-",
        },
        {
          header: "Holiday Overtime",
          render: (row) => row.overtimeAccountDisplay ?? "-",
        },
        {
          header: "Rest Day Holiday Hours",
          render: (row) => row.restDayAccountDisplay ?? "-",
        },
        {
          header: "Rest Day Holiday Overtime",
          render: (row) => row.restDayOvertimeAccountDisplay ?? "-",
        },
      ]}
    />
  );
}

"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import type { SelectHolidayCalendarSchemaType } from "@/zod-schemas/holidayCalendar";

type Props = {
  holidayRows: SelectHolidayCalendarSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectHolidayCalendarSchemaType) => void;
};

function formatDateRange(row: SelectHolidayCalendarSchemaType) {
  if (!row.holidayDate) return "-";
  if (!row.holidayDate2 || row.holidayDate2 === row.holidayDate) {
    return row.holidayDate;
  }

  return `${row.holidayDate} to ${row.holidayDate2}`;
}

export default function HolidayCodeTable({
  holidayRows,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="Generated Holidays"
      description="Confirmed rows are used by payroll. Draft rows stay editable until HR confirms the date."
      rows={holidayRows}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No generated holiday rows found for this year."
      columns={[
        {
          header: "Year",
          render: (row) => row.year,
        },
        {
          header: "Date Range",
          render: formatDateRange,
        },
        {
          header: "Name",
          render: (row) => row.name,
        },
        {
          header: "Type",
          render: (row) => String(row.holidayType),
        },
        {
          header: "Check Date 1",
          render: (row) =>
            row.requireCheckDate1
              ? row.checkDate1 ?? "Required"
              : row.checkDate1 ?? "-",
        },
        {
          header: "Check Date 2",
          render: (row) =>
            row.requireCheckDate2
              ? row.checkDate2 ?? "Required"
              : row.checkDate2 ?? "-",
        },
        {
          header: "Status",
          render: (row) => row.status,
        },
        {
          header: "Paid",
          render: (row) => (row.isPaid ? "Yes" : "No"),
        },
        {
          header: "Source",
          render: (row) => row.source,
        },
      ]}
    />
  );
}

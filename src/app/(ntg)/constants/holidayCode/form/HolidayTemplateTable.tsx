"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import type { SelectHolidayTemplateSchemaType } from "@/zod-schemas/holidayCalendar";

type Props = {
  templateRows: SelectHolidayTemplateSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectHolidayTemplateSchemaType) => void;
};

const monthNames = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const occurrences = new Map<number, string>([
  [1, "First"],
  [2, "Second"],
  [3, "Third"],
  [4, "Fourth"],
  [5, "Fifth"],
  [-1, "Last"],
]);

function renderRecurrence(row: SelectHolidayTemplateSchemaType) {
  if (row.recurrenceType === "ManualAnnual") return "Manual each year";

  if (row.recurrenceType === "FixedDate") {
    const month = row.fixedMonth ? monthNames[row.fixedMonth] : "-";
    const day = row.fixedDay ? String(row.fixedDay).padStart(2, "0") : "--";
    return `${month} ${day}`;
  }

  const occurrence = row.nthOccurrence
    ? occurrences.get(row.nthOccurrence)
    : null;
  const weekday = row.nthWeekday != null ? weekdays[row.nthWeekday] : null;
  const month = row.nthMonth ? monthNames[row.nthMonth] : null;

  return [occurrence, weekday, "of", month].filter(Boolean).join(" ");
}

export default function HolidayTemplateTable({
  templateRows,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="Template Entries"
      description="Templates generate annual holiday rows. Deactivate a template to exclude it from future years."
      rows={templateRows}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No holiday templates found."
      columns={[
        {
          header: "Name",
          render: (row) => row.name,
        },
        {
          header: "Type",
          render: (row) => row.holidayType,
        },
        {
          header: "Recurrence",
          render: renderRecurrence,
        },
        {
          header: "Duration",
          render: (row) => `${row.durationDays} day${row.durationDays === 1 ? "" : "s"}`,
        },
        {
          header: "Paid",
          render: (row) => (row.isPaid ? "Yes" : "No"),
        },
        {
          header: "Active",
          render: (row) => (row.isActive ? "Yes" : "No"),
        },
      ]}
    />
  );
}

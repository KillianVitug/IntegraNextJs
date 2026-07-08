"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import { OVERTIME_CATEGORY_LABELS } from "@/lib/payroll/overtime";
import type { SelectOvertimeRuleSchemaType } from "@/zod-schemas/overtimeRule";

type Props = {
  rows: SelectOvertimeRuleSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectOvertimeRuleSchemaType) => void;
};

export default function OvertimeRuleTable({
  rows,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="Overtime Entries"
      description="Select a row to edit the overtime rule values."
      rows={rows}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No overtime rules found."
      columns={[
        {
          header: "Category",
          render: (row) => OVERTIME_CATEGORY_LABELS[row.category],
        },
        {
          header: "Range",
          render: (row) =>
            `${row.minutesFrom} - ${row.minutesTo != null ? row.minutesTo : "Open"}`,
        },
        {
          header: "Rate Multiplier",
          render: (row) => row.rateMultiplier,
        },
      ]}
    />
  );
}

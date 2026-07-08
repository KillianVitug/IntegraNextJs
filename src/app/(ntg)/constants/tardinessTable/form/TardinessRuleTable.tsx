"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import type { SelectTardinessRuleSchemaType } from "@/zod-schemas/tardinessRule";

type Props = {
  rows: SelectTardinessRuleSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectTardinessRuleSchemaType) => void;
};

export default function TardinessRuleTable({
  rows,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="Tardiness Entries"
      description="Select a row to edit the tardiness rule values."
      rows={rows}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No tardiness rules found."
      columns={[
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

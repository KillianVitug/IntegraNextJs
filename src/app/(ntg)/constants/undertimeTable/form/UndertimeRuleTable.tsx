"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import type { SelectUndertimeRuleSchemaType } from "@/zod-schemas/undertimeRule";

type Props = {
  rows: SelectUndertimeRuleSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectUndertimeRuleSchemaType) => void;
};

export default function UndertimeRuleTable({
  rows,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="Undertime Entries"
      description="Select a row to edit the undertime rule values."
      rows={rows}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No undertime rules found."
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

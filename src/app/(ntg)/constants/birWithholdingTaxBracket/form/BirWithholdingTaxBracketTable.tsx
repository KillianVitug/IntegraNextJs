"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import type { SelectBirWithholdingTaxBracketSchemaType } from "@/zod-schemas/birWithholdingTaxBracket";

type Props = {
  rows: SelectBirWithholdingTaxBracketSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectBirWithholdingTaxBracketSchemaType) => void;
};

export default function BirWithholdingTaxBracketTable({
  rows,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="BIR Bracket Rows"
      description="Select a row to edit the withholding tax bracket values."
      rows={rows}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No BIR withholding tax brackets found for the selected version."
      columns={[
        {
          header: "Compensation Range",
          render: (row) =>
            `${row.compensationFrom} - ${row.compensationTo ?? "and above"}`,
        },
        {
          header: "Base Tax",
          render: (row) => row.baseTax,
        },
        {
          header: "Over %",
          render: (row) => row.overPercentage,
        },
      ]}
    />
  );
}

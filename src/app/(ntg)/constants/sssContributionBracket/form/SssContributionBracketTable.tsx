"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import type { SelectSssContributionBracketSchemaType } from "@/zod-schemas/sssContributionBracket";

type Props = {
  rows: SelectSssContributionBracketSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectSssContributionBracketSchemaType) => void;
};

export default function SssContributionBracketTable({
  rows,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="SSS Bracket Rows"
      description="Select a row to edit the contribution bracket values."
      rows={rows}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No SSS contribution brackets found for the selected version."
      columns={[
        {
          header: "Range",
          render: (row) => `${row.rangeFrom} - ${row.rangeTo}`,
        },
        {
          header: "Salary Credit",
          render: (row) => row.salaryCredit,
        },
        {
          header: "Employee Share",
          render: (row) => row.employeeShare,
        },
        {
          header: "Employer Share",
          render: (row) => row.employerShare,
        },
        {
          header: "EC Share",
          render: (row) => row.ecShare,
        },
      ]}
    />
  );
}

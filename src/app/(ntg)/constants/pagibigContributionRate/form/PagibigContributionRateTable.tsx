"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import type { SelectPagibigContributionRateSchemaType } from "@/zod-schemas/pagibigContributionRate";

type Props = {
  rows: SelectPagibigContributionRateSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectPagibigContributionRateSchemaType) => void;
};

export default function PagibigContributionRateTable({
  rows,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="Pag-IBIG Rate Rows"
      description="Select a row to edit the Pag-IBIG contribution rate values."
      rows={rows}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No Pag-IBIG contribution rates found for the selected version."
      columns={[
        {
          header: "Range",
          render: (row) => `${row.rangeFrom} - ${row.rangeTo}`,
        },
        {
          header: "Employee Rate",
          render: (row) => row.employeeRate,
        },
        {
          header: "Employer Rate",
          render: (row) => row.employerRate,
        },
        {
          header: "Max Base",
          render: (row) => row.maxCompensationBase ?? "-",
        },
      ]}
    />
  );
}

"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import type { SelectPhilhealthContributionRateSchemaType } from "@/zod-schemas/philhealthContributionRate";

type Props = {
  rows: SelectPhilhealthContributionRateSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectPhilhealthContributionRateSchemaType) => void;
};

export default function PhilhealthContributionRateTable({
  rows,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="PhilHealth Rate Rows"
      description="Each version supports only one PhilHealth rate row."
      rows={rows}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No PhilHealth contribution rate found for the selected version."
      columns={[
        {
          header: "Salary Floor",
          render: (row) => row.monthlyBasicSalaryFloor,
        },
        {
          header: "Salary Ceiling",
          render: (row) => row.monthlyBasicSalaryCeiling,
        },
        {
          header: "Premium Rate",
          render: (row) => row.premiumRate,
        },
        {
          header: "Employee Rate",
          render: (row) => row.employeeShareRate,
        },
        {
          header: "Employer Rate",
          render: (row) => row.employerShareRate,
        },
      ]}
    />
  );
}

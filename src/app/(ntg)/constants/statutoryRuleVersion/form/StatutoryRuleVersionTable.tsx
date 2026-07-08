"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import type { SelectStatutoryRuleVersionSchemaType } from "@/zod-schemas/statutoryRuleVersion";

type Props = {
  versions: SelectStatutoryRuleVersionSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectStatutoryRuleVersionSchemaType) => void;
};

export default function StatutoryRuleVersionTable({
  versions,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="Statutory Rule Version List"
      description="Select a version row to edit it or to review which rule set is active."
      rows={versions}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No statutory rule versions found."
      columns={[
        {
          header: "Rule Type",
          render: (row) => row.ruleType,
        },
        {
          header: "Code",
          render: (row) => row.code,
        },
        {
          header: "Effective Window",
          render: (row) =>
            `${row.effectiveFrom} to ${row.effectiveTo ?? "onward"}`,
        },
        {
          header: "Terms",
          render: (row) => row.payrollTerms,
        },
        {
          header: "Default",
          render: (row) => (row.isDefault ? "Yes" : "No"),
        },
      ]}
    />
  );
}

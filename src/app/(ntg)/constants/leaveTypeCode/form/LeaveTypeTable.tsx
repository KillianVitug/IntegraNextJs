"use client";

import { SelectableTable } from "@/app/(ntg)/constants/shared/SelectableTable";
import type { SelectLeaveTypeSchemaType } from "@/zod-schemas/leaveType";

type Props = {
  leaveTypeRows: SelectLeaveTypeSchemaType[];
  selectedId?: number | null;
  onRowSelect?: (row: SelectLeaveTypeSchemaType) => void;
};

export default function LeaveTypeTable({
  leaveTypeRows,
  selectedId,
  onRowSelect,
}: Props) {
  return (
    <SelectableTable
      title="Leave Type Entries"
      description="Select a leave type row to edit its values."
      rows={leaveTypeRows}
      selectedId={selectedId}
      onRowSelect={onRowSelect}
      emptyMessage="No leave types found."
      columns={[
        {
          header: "Code",
          render: (row) => row.code,
        },
        {
          header: "Name",
          render: (row) => row.name,
        },
        {
          header: "Payroll Account Code",
          render: (row) => row.payrollAccountDisplay ?? "-",
        },
        {
          header: "Paid",
          render: (row) => (row.isPaid ? "Yes" : "No"),
        },
        {
          header: "Uses Balance",
          render: (row) => (row.requiresBalance ? "Yes" : "No"),
        },
        {
          header: "Annual Entitlement",
          render: (row) => row.annualEntitlement,
        },
      ]}
    />
  );
}

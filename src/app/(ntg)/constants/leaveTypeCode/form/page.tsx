"use client";

import { useCallback, useEffect, useState } from "react";
import type { SelectLeaveTypeSchemaType } from "@/zod-schemas/leaveType";
import LeaveTypeCodeForm from "./LeaveTypeCodeForm";
import LeaveTypeTable from "./LeaveTypeTable";

export default function LeaveTypeCodePage() {
  const [leaveTypeRows, setLeaveTypeRows] = useState<SelectLeaveTypeSchemaType[]>([]);
  const [selectedLeaveType, setSelectedLeaveType] =
    useState<SelectLeaveTypeSchemaType | null>(null);

  const loadLeaveTypeRows = useCallback(async () => {
    const response = await fetch("/api/constants/leaveType");
    const data = await response.json();
    setLeaveTypeRows(data);
  }, []);

  useEffect(() => {
    loadLeaveTypeRows();
  }, [loadLeaveTypeRows]);

  return (
    <div className="flex flex-col gap-4">
      <LeaveTypeCodeForm
        selectedLeaveType={selectedLeaveType}
        onResetSelection={() => setSelectedLeaveType(null)}
        onRefresh={loadLeaveTypeRows}
      />
      <LeaveTypeTable
        leaveTypeRows={leaveTypeRows}
        selectedId={selectedLeaveType?.id ?? null}
        onRowSelect={(row) => setSelectedLeaveType(row)}
      />
    </div>
  );
}

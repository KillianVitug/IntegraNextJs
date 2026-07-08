"use client";

import { useCallback, useEffect, useState } from "react";
import type { SelectOvertimeRuleSchemaType } from "@/zod-schemas/overtimeRule";
import OvertimeRuleForm from "./OvertimeRuleForm";
import OvertimeRuleTable from "./OvertimeRuleTable";

export default function OvertimeTablePage() {
  const [rows, setRows] = useState<SelectOvertimeRuleSchemaType[]>([]);
  const [selectedRow, setSelectedRow] = useState<SelectOvertimeRuleSchemaType | null>(
    null
  );

  const loadRows = useCallback(async () => {
    const response = await fetch("/api/constants/overtimeTable");
    const data = await response.json();
    setRows(data);
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  return (
    <div className="flex flex-col gap-4">
      <OvertimeRuleForm
        selectedRow={selectedRow}
        onResetSelection={() => setSelectedRow(null)}
        onRefresh={loadRows}
      />
      <OvertimeRuleTable
        rows={rows}
        selectedId={selectedRow?.id ?? null}
        onRowSelect={(row) => setSelectedRow(row)}
      />
    </div>
  );
}

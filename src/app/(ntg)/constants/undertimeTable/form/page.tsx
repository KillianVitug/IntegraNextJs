"use client";

import { useCallback, useEffect, useState } from "react";
import type { SelectUndertimeRuleSchemaType } from "@/zod-schemas/undertimeRule";
import UndertimeRuleForm from "./UndertimeRuleForm";
import UndertimeRuleTable from "./UndertimeRuleTable";

export default function UndertimeTablePage() {
  const [rows, setRows] = useState<SelectUndertimeRuleSchemaType[]>([]);
  const [selectedRow, setSelectedRow] = useState<SelectUndertimeRuleSchemaType | null>(
    null
  );

  const loadRows = useCallback(async () => {
    const response = await fetch("/api/constants/undertimeTable");
    const data = await response.json();
    setRows(data);
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  return (
    <div className="flex flex-col gap-4">
      <UndertimeRuleForm
        selectedRow={selectedRow}
        onResetSelection={() => setSelectedRow(null)}
        onRefresh={loadRows}
      />
      <UndertimeRuleTable
        rows={rows}
        selectedId={selectedRow?.id ?? null}
        onRowSelect={(row) => setSelectedRow(row)}
      />
    </div>
  );
}

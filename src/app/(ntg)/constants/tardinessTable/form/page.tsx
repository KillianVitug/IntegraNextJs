"use client";

import { useCallback, useEffect, useState } from "react";
import type { SelectTardinessRuleSchemaType } from "@/zod-schemas/tardinessRule";
import TardinessRuleForm from "./TardinessRuleForm";
import TardinessRuleTable from "./TardinessRuleTable";

export default function TardinessTablePage() {
  const [rows, setRows] = useState<SelectTardinessRuleSchemaType[]>([]);
  const [selectedRow, setSelectedRow] = useState<SelectTardinessRuleSchemaType | null>(
    null
  );

  const loadRows = useCallback(async () => {
    const response = await fetch("/api/constants/tardinessTable");
    const data = await response.json();
    setRows(data);
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  return (
    <div className="flex flex-col gap-4">
      <TardinessRuleForm
        selectedRow={selectedRow}
        onResetSelection={() => setSelectedRow(null)}
        onRefresh={loadRows}
      />
      <TardinessRuleTable
        rows={rows}
        selectedId={selectedRow?.id ?? null}
        onRowSelect={(row) => setSelectedRow(row)}
      />
    </div>
  );
}

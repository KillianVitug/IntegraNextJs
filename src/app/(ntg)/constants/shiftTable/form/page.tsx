"use client";

import { useCallback, useEffect, useState } from "react";
import type { SelectShiftTableSchemaType } from "@/zod-schemas/shiftTable";
import ShiftTableForm from "./ShiftTableForm";
import ShiftTableTable from "./ShiftTableTable";

export default function ShiftTablePage() {
  const [rows, setRows] = useState<SelectShiftTableSchemaType[]>([]);
  const [selectedRow, setSelectedRow] = useState<SelectShiftTableSchemaType | null>(null);

  const loadRows = useCallback(async () => {
    const response = await fetch("/api/constants/shiftTable");
    const data = await response.json();
    setRows(data);
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  return (
    <div className="flex flex-col gap-4">
      <ShiftTableForm
        selectedRow={selectedRow}
        onResetSelection={() => setSelectedRow(null)}
        onRefresh={loadRows}
      />
      <ShiftTableTable
        rows={rows}
        selectedId={selectedRow?.id ?? null}
        onRowSelect={(row) => setSelectedRow(row)}
      />
    </div>
  );
}

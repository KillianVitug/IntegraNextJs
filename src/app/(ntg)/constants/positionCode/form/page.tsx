"use client";

import { useState, useEffect, useCallback } from "react";
import PositionCodeForm from "./PositionCodeForm";
import PositionTable from "@/app/(ntg)/constants/positionCode/form/PositionTable";
import { SelectPositionSchemaType } from "@/zod-schemas/position";

export default function PositionPage() {
  const [positions, setPositions] = useState<SelectPositionSchemaType[]>([]);
  const [selected, setSelected] = useState<SelectPositionSchemaType | null>(null);
  

  // 🔹 Fetcher function
  const loadPositions = useCallback(async () => {
    const res = await fetch("/api/constants/position");
    const data = await res.json();
    setPositions(data);
  }, []);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  return (
    <div className="flex flex-col gap-8">
      <PositionCodeForm
        selectedPosition={selected}
        onResetSelection={() => setSelected(null)}
        onRefresh={loadPositions} // 🔹 new
      />
      <PositionTable
        positions={positions}
        onRowSelect={(pos) => setSelected(pos)}
      />
    </div>
  );
}

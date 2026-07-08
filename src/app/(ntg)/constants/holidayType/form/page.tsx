"use client";

import { useCallback, useEffect, useState } from "react";
import HolidayTypeForm from "./HolidayTypeForm";
import HolidayTypeTable from "./HolidayTypeTable";
import type { SelectHolidayTypeAccountCodeSchemaType } from "@/zod-schemas/holidayTypeAccountCode";

export default function HolidayTypePage() {
  const [holidayTypeRows, setHolidayTypeRows] = useState<
    SelectHolidayTypeAccountCodeSchemaType[]
  >([]);
  const [selectedHolidayType, setSelectedHolidayType] =
    useState<SelectHolidayTypeAccountCodeSchemaType | null>(null);

  const loadHolidayTypeRows = useCallback(async () => {
    const response = await fetch("/api/constants/holidayType");
    const data = await response.json();
    setHolidayTypeRows(data);
  }, []);

  useEffect(() => {
    loadHolidayTypeRows();
  }, [loadHolidayTypeRows]);

  return (
    <div className="flex flex-col gap-4">
      <HolidayTypeForm
        selectedHolidayType={selectedHolidayType}
        onResetSelection={() => setSelectedHolidayType(null)}
        onRefresh={loadHolidayTypeRows}
      />
      <HolidayTypeTable
        holidayTypeRows={holidayTypeRows}
        selectedId={selectedHolidayType?.id ?? null}
        onRowSelect={(row) => setSelectedHolidayType(row)}
      />
    </div>
  );
}

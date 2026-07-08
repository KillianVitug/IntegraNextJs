"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import type {
  SelectHolidayCalendarSchemaType,
  SelectHolidayTemplateSchemaType,
} from "@/zod-schemas/holidayCalendar";
import { generateHolidayYearAction } from "@/app/actions/payrollConfigAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import HolidayCodeForm from "./HolidayCodeForm";
import HolidayCodeTable from "./HolidayCodeTable";
import HolidayTemplateForm from "./HolidayTemplateForm";
import HolidayTemplateTable from "./HolidayTemplateTable";

type HolidayCalendarResponse = {
  holidayRows: SelectHolidayCalendarSchemaType[];
  templateRows: SelectHolidayTemplateSchemaType[];
};

export default function HolidayCodePage() {
  const initialYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [yearInput, setYearInput] = useState(String(initialYear));
  const [holidayRows, setHolidayRows] = useState<SelectHolidayCalendarSchemaType[]>([]);
  const [templateRows, setTemplateRows] = useState<SelectHolidayTemplateSchemaType[]>([]);
  const [selectedHoliday, setSelectedHoliday] =
    useState<SelectHolidayCalendarSchemaType | null>(null);
  const [selectedTemplate, setSelectedTemplate] =
    useState<SelectHolidayTemplateSchemaType | null>(null);

  const loadHolidayRows = useCallback(async () => {
    const response = await fetch(
      `/api/constants/holidayCalendar?year=${selectedYear}`,
      { cache: "no-store" }
    );
    const data = (await response.json()) as HolidayCalendarResponse;
    setHolidayRows(data.holidayRows);
    setTemplateRows(data.templateRows);
  }, [selectedYear]);

  const { execute: generateHolidayYear, isExecuting: generating } = useAction(
    generateHolidayYearAction,
    {
      onSuccess: (result) => {
        const data = result?.data;
        toast.success(data?.message ?? "Holiday year generated.");
        setSelectedHoliday(null);
        loadHolidayRows();
      },
      onError: () => {
        toast.error("Unable to generate holiday year.");
      },
    }
  );

  useEffect(() => {
    loadHolidayRows();
  }, [loadHolidayRows]);

  function parseYear() {
    const year = Number(yearInput);
    return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
  }

  function handleOpenYear() {
    const year = parseYear();
    if (!year) {
      toast.error("Enter a valid 4-digit year first.");
      return;
    }
    setSelectedYear(year);
    setSelectedHoliday(null);
  }

  function handleGenerateYear() {
    const year = parseYear();
    if (!year) {
      toast.error("Enter a valid 4-digit year first.");
      return;
    }
    generateHolidayYear({ year });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 sm:px-8">
        <div className="min-w-32">
          <label className="mb-2 block text-sm font-medium">Holiday Year</label>
          <Input
            value={yearInput}
            onChange={(event) => setYearInput(event.target.value)}
            inputMode="numeric"
            placeholder="2026"
          />
        </div>
        <Button type="button" variant="outline" onClick={handleOpenYear}>
          Open Year
        </Button>
        <Button
          type="button"
          onClick={handleGenerateYear}
          disabled={generating}
          className="gap-2"
        >
          <CalendarPlus className="h-4 w-4" />
          {generating ? "Generating..." : "Generate Holiday Year"}
        </Button>
      </div>

      <HolidayCodeForm
        selectedHoliday={selectedHoliday}
        selectedYear={selectedYear}
        onResetSelection={() => setSelectedHoliday(null)}
        onRefresh={loadHolidayRows}
      />
      <HolidayCodeTable
        holidayRows={holidayRows}
        selectedId={selectedHoliday?.id ?? null}
        onRowSelect={(row) => setSelectedHoliday(row)}
      />
      <HolidayTemplateForm
        selectedTemplate={selectedTemplate}
        onResetSelection={() => setSelectedTemplate(null)}
        onRefresh={loadHolidayRows}
      />
      <HolidayTemplateTable
        templateRows={templateRows}
        selectedId={selectedTemplate?.id ?? null}
        onRowSelect={(row) => setSelectedTemplate(row)}
      />
    </div>
  );
}

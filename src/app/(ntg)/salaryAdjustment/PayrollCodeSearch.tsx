// src/app/(ntg)/salaryAdjustment/PayrollCodeSearch.tsx
"use client";
import { useState } from "react";
import { generatePayrollCodes } from "@/lib/utils";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { useForm } from "react-hook-form";

type PayrollCodeSearchProps = {
  year?: number;
  value?: string;
  onChange?: (code: string) => void;
  onYearChange?: (year: number) => void;
  onResetSelectedEmployee?: () => void;
};

export default function PayrollCodeSearch({
  year: initialYear,
  value,
  onChange,
  onYearChange,
  onResetSelectedEmployee,
}: PayrollCodeSearchProps) {
  const today = new Date();
  const [year, setYear] = useState(initialYear ?? today.getFullYear());
  const form = useForm();

  const extractYearFromPayrollCode = (code?: string) => {
    if (!code) return null;
    const year = parseInt(code.split("-")[0]);
    return isNaN(year) ? null : year;
  };

  // Generate all months from January to current month for the selected year
  const generateAllMonths = (selectedYear: number) => {
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    
    const months = [];
    
    // If selected year is current year, only show months up to current month
    // If selected year is past year, show all 12 months
    const maxMonth = selectedYear === currentYear ? currentMonth : 12;
    
    for (let m = 1; m <= maxMonth; m++) {
      const codes = generatePayrollCodes(selectedYear, m);
      months.push(...codes);
    }
    
    return months;
  };

  const effectiveYear = extractYearFromPayrollCode(value) ?? year;
  const allPayrollCodes = generateAllMonths(effectiveYear);
  const selected = allPayrollCodes.find((c) => c.code === value);

  // Generate year options (from 2020 to current year + 1)
  const generateYearOptions = () => {
    const currentYear = today.getFullYear();
    const years = [];
    for (let y = 2020; y <= currentYear + 1; y++) {
      years.push({
        id: y.toString(),
        name: y.toString(),
      });
    }
    return years;
  };

  const yearOptions = generateYearOptions();

  // Handle year change
  const handleYearChange = (newYear: string) => {
    const yearNum = parseInt(newYear);
    setYear(yearNum);
    onYearChange?.(yearNum);
    
    // Clear the selected payroll code when year changes
    onChange?.("");
  };

  // Handle payroll code change
  const handlePayrollCodeChange = (code: string) => {
    onChange?.(code);
  };

  return (
    <Form {...form}>
      <div className="flex w-full flex-wrap items-end gap-3">
        <SelectWithLabel
          fieldTitle="Year"
          nameInSchema="year"
          data={yearOptions}
          value={year.toString()}
          onChange={handleYearChange}
        />
        <SelectWithLabel
          fieldTitle="Payroll Code"
          nameInSchema="payrollCode"
          data={allPayrollCodes.map((code) => ({
            id: code.code,
            name: code.displayText,
          }))}
          value={value}
          onChange={handlePayrollCodeChange}
        />
        <div>
          <label className="text-sm font-medium">Start Date</label>
          <input
            type="date"
            value={selected?.start ?? ""}
            readOnly
            className="h-9 w-full min-w-0 rounded-md border px-2 text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium">End Date</label>
          <input
            type="date"
            value={selected?.end ?? ""}
            readOnly
            className="h-9 w-full min-w-0 rounded-md border px-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Pay Date</label>
          <input
            type="date"
            value={selected?.adjustedPayDate ?? ""}
            readOnly
            className="h-9 w-full min-w-0 rounded-md border px-2 text-sm"
          />
        </div>
          <Button
          type="button"
          variant="outline"
          onClick={() => {
            onChange?.("");                
            onResetSelectedEmployee?.();    
          }}
          className="h-9"
        >
          Reset Payroll Code
        </Button>
      </div>
    </Form>
  );
}

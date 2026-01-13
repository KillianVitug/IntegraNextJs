// src/app/(ntg)/salaryAdjustment/PayrollCodeSearch.tsx
"use client";
import React, { useState } from "react";
import { generatePayrollCodes } from "@/lib/utils";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { useForm } from "react-hook-form";

type PayrollCodeSearchProps = {
  year?: number;
  month?: number;
  value?: string;
  onChange?: (code: string) => void;
  onYearChange?: (year: number) => void;
  onResetSelectedEmployee?: () => void;
};

export default function PayrollCodeSearch({
  year: initialYear,
  month: initialMonth,
  value,
  onChange,
  onYearChange,
  onResetSelectedEmployee,
}: PayrollCodeSearchProps) {
  const today = new Date();
  const [year, setYear] = useState(initialYear ?? today.getFullYear());
  const [month, setMonth] = useState(initialMonth ?? today.getMonth() + 1);
  const form = useForm();

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

  const allPayrollCodes = generateAllMonths(year);
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
    setMonth(1); // Reset to January when year changes
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
      <div className="flex flex-row gap-4 w-full max-w-4xl items-end">
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
            name: `${code.code}`,
          }))}
          value={value}
          onChange={handlePayrollCodeChange}
        />
        <InputWithLabel
          fieldTitle="Start Date"
          nameInSchema="startDate"
          type="date"
          value={selected?.start ?? ""}
          readOnly
        />
        <InputWithLabel
          fieldTitle="End Date"
          nameInSchema="endDate"
          type="date"
          value={selected?.end ?? ""}
          readOnly
        />
          <Button
          type="button"
          variant="outline"
          onClick={() => {
            onChange?.("");                
            onResetSelectedEmployee?.();    
          }}
          className="h-10"
        >
          Reset Payroll Code
        </Button>
      </div>
    </Form>
  );
}
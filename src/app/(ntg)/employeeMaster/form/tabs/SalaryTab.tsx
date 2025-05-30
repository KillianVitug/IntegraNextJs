"use client";

import React from "react";
import { useFormContext } from "react-hook-form";

import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";

import { InsertEmployeeSchemaType } from "@/zod-schemas/employee";

type Props = {
  slvlGroups: { id: number; name: string }[];
};

export default function SalaryTab({ slvlGroups }: Props) {
  const { register, control } = useFormContext<InsertEmployeeSchemaType>(); // Use useFormContext() to access the form instance
  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-3">
        <InputWithLabel
          fieldTitle="Daily Rate"
          nameInSchema="salary.dailyRate"
          placeholder="0.00"
          register={register}
          type="number" // Change to "number" type
          step="any" // Allow decimal inputs
        />
        <InputWithLabel
          fieldTitle="Monthly Rate"
          nameInSchema="salary.monthlyRate"
          placeholder="0.00"
          register={register}
          type="number" // Change to "number" type
          step="any" // Allow decimal inputs
        />
        <InputWithLabel
          fieldTitle="Monthly Allowance"
          nameInSchema="salary.monthlyAllowance"
          placeholder="0.00"
          register={register}
          type="number" // Change to "number" type
          step="any"
        />
        <InputWithLabel
          fieldTitle="Daily Allowance"
          nameInSchema="salary.dailyAllowance"
          placeholder="0.00"
          register={register}
          type="number" // Change to "number" type
          step="any"
        />
        <InputWithLabel
          fieldTitle="COLA"
          nameInSchema="salary.cola"
          placeholder="0.00"
          register={register}
          type="number" // Change to "number" type
          step="any"
        />
        <InputWithLabel
          fieldTitle="Rate Divisor"
          nameInSchema="salary.rateDivisor"
          placeholder="Enter divisor"
          register={register}
          type="number"
          step="any"
        />
        <InputWithLabel
          fieldTitle="Billing Rate"
          nameInSchema="salary.billingRate"
          placeholder="0.00"
          register={register}
          type="number" // Change to "number" type
          step="any"
        />

        <SelectWithLabel
          fieldTitle="SLVL Group"
          nameInSchema="salary.slvlGroupId"
          control={control}
          data={slvlGroups.map((group) => ({
            id: String(group.id), // Convert id to string
            name: group.name,
          }))}
        />

        <InputWithLabel
          fieldTitle="Custom Payroll Code"
          nameInSchema="salary.customPayrollCode"
          placeholder="Enter code"
          register={register}
        />
        <InputWithLabel
          fieldTitle="Custom Payroll Description"
          nameInSchema="salary.customPayrollDescription"
          placeholder="Enter description"
          register={register}
        />
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { useFormContext } from "react-hook-form";

import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { Button } from "@/components/ui/button";
import { InsertEmployeeSchemaType } from "@/zod-schemas/employee";

type Props = {
  slvlGroups: { id: number; name: string }[];
};

export default function SalaryTab({ slvlGroups }: Props) {
  const { register, control } = useFormContext<InsertEmployeeSchemaType>(); // Use useFormContext() to access the form instance
  return (
    <div className="p-4">
      <div className="grid grid-cols-3 gap-3 mb-6">
        <InputWithLabel
          fieldTitle="Daily Rate"
          nameInSchema="salary.dailyRate"
          placeholder="0.00"
          register={register}
          format="money" // Change to "number" type
          step="any" // Allow decimal inputs
        />
        <InputWithLabel
          fieldTitle="Monthly Rate"
          nameInSchema="salary.monthlyRate"
          placeholder="0.00"
          register={register}
          format="money" // Change to "number" type
          step="any" // Allow decimal inputs
        />
        <InputWithLabel
          fieldTitle="Rate Divisor"
          nameInSchema="salary.rateDivisor"
          placeholder="Enter divisor"
          register={register}
          format="money"
          step="any"
        />
        </div>
        <hr className="p-2"></hr>
        <div className="grid grid-cols-3 gap-3 mb-6">
          <InputWithLabel
            fieldTitle="Daily Allowance"
            nameInSchema="salary.dailyAllowance"
            placeholder="0.00"
            register={register}
            format="money" // Change to "number" type
            step="any"
          />
        <InputWithLabel
          fieldTitle="Monthly Allowance"
          nameInSchema="salary.monthlyAllowance"
          placeholder="0.00"
          register={register}
          format="money" // Change to "number" type
          step="any"
        />
        <InputWithLabel
          fieldTitle="Billing Rate"
          nameInSchema="salary.billingRate"
          placeholder="0.00"
          register={register}
          format="money" // Change to "number" type
          step="any"
        />

        <InputWithLabel
          fieldTitle="COLA"
          nameInSchema="salary.cola"
          placeholder="0.00"
          register={register}
          format="money" // Change to "number" type
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
        <div className="grid grid-cols-2 mt-8 gap-3">
        <Button
              type="button"
              
              variant="default"
              title="SL/VL"
            >
              Create SL/VL
            </Button>
          <Button
              type="button"
              
              variant="default"
              title="rateHistory"
            >
             Show Rate History
            </Button>
        </div>

        </div>
        <hr className="p-2"></hr>
        <div className="grid grid-cols-3 gap-3">
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
            <Button
              type="button"
              className="mt-8"
              variant="default"
              title="Payroll History"
            >
             Custom Payroll History
            </Button>
      </div>
    </div>
  );
}

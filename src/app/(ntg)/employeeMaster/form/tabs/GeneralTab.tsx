"use client";

import React from "react";
import { useFormContext } from "react-hook-form";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import {
  payrollModeEnum,
  payrollTermsEnum,
  categoryEnum,
  employmentStatusEnum,
  confidentialityLevelEnum,
  taxStatusEnum,
} from "@/db/schema";

import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { DateWithLabel } from "@/components/inputs/DateWithLabel";

import { InsertEmployeeSchemaType } from "@/zod-schemas/employee";

type Props = {
  departments: { id: number; name: string }[];
};

export default function GeneralTab({ departments }: Props) {
  const { register, control } = useFormContext<InsertEmployeeSchemaType>();
  return (
    <div className="p-4">
      <div className="grid grid-cols-3 gap-3 mb-6">
        <DateWithLabel
          fieldTitle="Date Hired"
          nameInSchema="generalInfo.dateHired"
          control={control}
        />
        <DateWithLabel
          fieldTitle="Separation Date"
          nameInSchema="generalInfo.separationDate"
          control={control}
        />
        <SelectWithLabel
          fieldTitle="Payroll Mode"
          nameInSchema="generalInfo.payrollMode"
          control={control}
          data={enumToSelectOptions(payrollModeEnum.enumValues)}
        />
        <SelectWithLabel
          fieldTitle="Payroll Terms"
          nameInSchema="generalInfo.payrollTerms"
          control={control}
          data={enumToSelectOptions(payrollTermsEnum.enumValues)}
        />
        <SelectWithLabel
          fieldTitle="Category"
          nameInSchema="generalInfo.category"
          control={control}
          data={enumToSelectOptions(categoryEnum.enumValues)}
        />
        <SelectWithLabel
          fieldTitle="Department"
          nameInSchema="generalInfo.departmentId"
          control={control}
          data={departments.map((dept) => ({
            id: String(dept.id),
            name: dept.name,
          }))}
        />
        <SelectWithLabel
          fieldTitle="Employment Status"
          nameInSchema="generalInfo.employmentStatus"
          control={control}
          data={enumToSelectOptions(employmentStatusEnum.enumValues)}
        />
        <SelectWithLabel
          fieldTitle="Confidentiality Level"
          nameInSchema="generalInfo.confidentialityLevel"
          control={control}
          data={enumToSelectOptions(confidentialityLevelEnum.enumValues)}
        />

        <DateWithLabel
          fieldTitle="Clearance Date"
          nameInSchema="generalInfo.clearanceDate"
          control={control}
        />
      </div>
      <hr className="p-2"></hr>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Block 1: The first group of inputs */}
        {/* We keep this as its own grid to manage internal column layout */}
        <div className="grid grid-cols-1 gap-3">
          <InputWithLabel
            fieldTitle="SSS No."
            nameInSchema="generalInfo.sssNumber"
            placeholder="XX-XXXXXXX-X"
            register={register}
          />
          <InputWithLabel
            fieldTitle="Tax ID No."
            nameInSchema="generalInfo.taxIdNumber"
            placeholder="XXX-XXX-XXX"
            register={register}
          />
          <InputWithLabel
            fieldTitle="Pag-Ibig No."
            nameInSchema="generalInfo.pagIbigNumber"
            placeholder="XXXX-XXXX-XXXX"
            register={register}
          />
        </div>

        {/* Block 2: The second group of inputs/selects */}
        {/* We keep this as its own grid to manage internal column layout */}
        <div className="grid grid-cols-1 gap-3">
          <SelectWithLabel
            fieldTitle="Tax Status"
            nameInSchema="generalInfo.taxStatus"
            control={control}
            data={enumToSelectOptions(taxStatusEnum.enumValues)}
          />
          <InputWithLabel
            fieldTitle="Phil-Health No."
            nameInSchema="generalInfo.philhealthNumber"
            placeholder="XX-XXXXXXX-XX"
            register={register}
          />
          <InputWithLabel
            fieldTitle="PERRA ID No."
            nameInSchema="generalInfo.perraIdNumber"
            register={register}
          />
        </div>
      </div>
    </div>
  );
}

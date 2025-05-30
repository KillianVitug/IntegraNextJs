"use client";

import React, { useEffect } from "react";
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
      <div className="grid grid-cols-2 gap-3">
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
            id: dept.id.toString(),
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
  );
}

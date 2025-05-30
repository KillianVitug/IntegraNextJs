"use client";

import React from "react";
import { useFormContext } from "react-hook-form";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import { civilStatusEnum, genderEnum } from "@/db/schema";

import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { DateWithLabel } from "@/components/inputs/DateWithLabel";

import { InsertEmployeeSchemaType } from "@/zod-schemas/employee";

type Props = {
  positions: { id: number; name: string }[];
};

export default function ReferencesTab({ positions }: Props) {
  const { register, control } = useFormContext<InsertEmployeeSchemaType>();

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-3">
        <InputWithLabel
          fieldTitle="Bank Code"
          nameInSchema="otherReferences.bankCode"
          register={register}
          placeholder=""
        />
        <InputWithLabel
          fieldTitle="Bank Account No."
          nameInSchema="otherReferences.bankAccountNo"
          register={register}
          placeholder=""
        />
        <SelectWithLabel
          fieldTitle="Position"
          nameInSchema="otherReferences.positionId"
          control={control}
          data={positions.map((pos) => ({
            id: pos.id.toString(),
            name: pos.name,
          }))}
        />
        <InputWithLabel
          fieldTitle="Address"
          nameInSchema="otherReferences.address"
          register={register}
          placeholder="Enter Address"
        />
        <InputWithLabel
          fieldTitle="Telephone No."
          nameInSchema="otherReferences.telephoneNo"
          register={register}
          placeholder=""
        />
        <DateWithLabel
          fieldTitle="Birthday"
          nameInSchema="otherReferences.birthday"
          control={control}
        />
        <InputWithLabel
          fieldTitle="Age"
          nameInSchema="otherReferences.age"
          register={register}
          placeholder=""
          type="number" // Ensure input is numeric
          {...register("otherReferences.age", { valueAsNumber: true })}
        />
        <SelectWithLabel
          fieldTitle="Civil Status"
          nameInSchema="otherReferences.civilStatus"
          control={control}
          data={enumToSelectOptions(civilStatusEnum.enumValues)}
        />
        <SelectWithLabel
          fieldTitle="Gender"
          nameInSchema="otherReferences.gender"
          control={control}
          data={enumToSelectOptions(genderEnum.enumValues)}
        />
      </div>
    </div>
  );
}

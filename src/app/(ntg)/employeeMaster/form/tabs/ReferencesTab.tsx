"use client";

import React, { useEffect } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import { bankCodeTypeEnum, civilStatusEnum, genderEnum } from "@/db/schema";

import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { DateWithLabel } from "@/components/inputs/DateWithLabel";

import { InsertEmployeeSchemaType } from "@/zod-schemas/employee";

type Props = {
  positions: { id: number; name: string }[];
};

export default function ReferencesTab({ positions }: Props) {
  const { register, control, setValue } = useFormContext<InsertEmployeeSchemaType>();

  // Watch the birthday field
  const birthday = useWatch({
    control,
    name: "otherReferences.birthday",
  });

  useEffect(() => {
    if (birthday) {
      const birthDate = new Date(birthday);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      setValue("otherReferences.age", isNaN(age) ? undefined : age);
    } else {
      setValue("otherReferences.age", undefined);
    }
  }, [birthday, setValue]);

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-3">
        <SelectWithLabel
          fieldTitle="Bank Code"
          nameInSchema="otherReferences.bankCode"
          control={control}
          data={enumToSelectOptions(bankCodeTypeEnum.enumValues)}
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
          fieldTitle="Email"
          nameInSchema="otherReferences.email"
          register={register}
          placeholder="Enter Email"
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
          type="number"
          disabled
          
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

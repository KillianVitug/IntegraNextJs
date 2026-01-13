"use client";

import React from "react";
import { useFormContext } from "react-hook-form";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import { shiftScheduleEnum, restDayEnum } from "@/db/schema";

import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { TimeWithLabel } from "@/components/inputs/TimeWithLabel";

import { InsertEmployeeSchemaType } from "@/zod-schemas/employee";


export default function TimekeepingTab() {
  const { control, register } = useFormContext<InsertEmployeeSchemaType>();

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-3">
        <InputWithLabel
          fieldTitle="Timekeeping ID No."
          nameInSchema="timekeeping.timekeepingId"
          register={register}
        />
        <SelectWithLabel
          fieldTitle="Shift/Schedule"
          nameInSchema="timekeeping.shiftSchedule"
          control={control}
          data={enumToSelectOptions(shiftScheduleEnum.enumValues)}
        />
        <TimeWithLabel
          fieldTitle="Check-In Time"
          nameInSchema="timekeeping.checkInTime"
          control={control}
        />
        <TimeWithLabel
          fieldTitle="Check-Out Time"
          nameInSchema="timekeeping.checkOutTime"
          control={control}
        />
        <SelectWithLabel
          fieldTitle="Rest Day"
          nameInSchema="timekeeping.restDay"
          control={control}
          data={enumToSelectOptions(restDayEnum.enumValues)}
        />
        <InputWithLabel
          fieldTitle="Total Hours"
          nameInSchema="timekeeping.hoursWorked"
          register={register}
          placeholder="0"
          type="number"
          step="any"
        />
        <InputWithLabel
          fieldTitle="Total Minutes"
          nameInSchema="timekeeping.minutesWorked"
          register={register}
          placeholder="0"
          type="number"
          step="any"
        />
      </div>
    </div>
  );
}

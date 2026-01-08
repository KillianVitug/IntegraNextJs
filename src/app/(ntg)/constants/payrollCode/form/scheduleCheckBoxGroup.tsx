"use client";

import { CheckboxWithLabel } from "@/components/inputs/CheckboxWithLabel";
import { useFormContext } from "react-hook-form";

type Props = {
  basePath: string; // e.g. contributions.SSS.scheduleFlags
};

export function ScheduleCheckboxGroup({ basePath }: Props) {
  const { watch, setValue } = useFormContext();

  const flags = watch(basePath);

  const setExclusive = (key: string) => {
    Object.keys(flags).forEach((k) => {
      setValue(`${basePath}.${k}`, k === key);
    });
  };

  const setPayroll = (key: string, value: boolean) => {
    setValue(`${basePath}.always`, false);
    setValue(`${basePath}.endOfMonth`, false);
    setValue(`${basePath}.${key}`, value);
  };

  return (
    <div className="space-y-2 border rounded-md p-3">
      <h3 className="font-semibold">Schedule</h3>
    <div className="grid grid-cols-3 gap-3">
      <CheckboxWithLabel
        fieldTitle="Always"
        nameInSchema={`${basePath}.always`}
        onCheckedChange={(v) => v && setExclusive("always")}
      />

      <CheckboxWithLabel
        fieldTitle="First Payroll"
        nameInSchema={`${basePath}.firstPayroll`}
        onCheckedChange={(v) => setPayroll("firstPayroll", v)}
      />

      <CheckboxWithLabel
        fieldTitle="Second Payroll"
        nameInSchema={`${basePath}.secondPayroll`}
        onCheckedChange={(v) => setPayroll("secondPayroll", v)}
      />
            <CheckboxWithLabel
        fieldTitle="End of the Month"
        nameInSchema={`${basePath}.endOfMonth`}
        onCheckedChange={(v) => v && setExclusive("endOfMonth")}
      />

      <CheckboxWithLabel
        fieldTitle="Third Payroll"
        nameInSchema={`${basePath}.thirdPayroll`}
        onCheckedChange={(v) => setPayroll("thirdPayroll", v)}
      />
      <CheckboxWithLabel
        fieldTitle="Forth Payroll"
        nameInSchema={`${basePath}.forthPayroll`}
        onCheckedChange={(v) => setPayroll("forthPayroll", v)}
      />
      </div>
    </div>
  );
}

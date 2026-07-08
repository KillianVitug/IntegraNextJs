"use client";

import { CheckboxWithLabel } from "@/components/inputs/CheckboxWithLabel";
import { useFormContext } from "react-hook-form";
import { useCallback, useEffect } from "react";

type Props = {
  basePath: string; // e.g. contributions.SSS.scheduleFlags
  forceEndOfMonth?: boolean;
};

export function ScheduleCheckboxGroup({ basePath, forceEndOfMonth }: Props) {
  const { watch, setValue } = useFormContext();

  const flags = watch(basePath);

  const setExclusive = useCallback((key: string) => {
    Object.keys(flags).forEach((k) => {
      setValue(`${basePath}.${k}`, k === key);
    });
  }, [basePath, flags, setValue]);

  const setPayroll = (key: string, value: boolean) => {
    setValue(`${basePath}.always`, false);
    setValue(`${basePath}.endOfMonth`, false);
    setValue(`${basePath}.${key}`, value);
  };
  
    // ✅ TAX rule enforcement lives HERE now
    useEffect(() => {
      if (!forceEndOfMonth) return;
      setExclusive("endOfMonth");
    }, [forceEndOfMonth, setExclusive]);

  return (
    <div className="space-y-2 border rounded-md p-3">
      <h3 className="font-semibold">Schedule</h3>
    <div className="grid grid-cols-3 gap-3">
      <CheckboxWithLabel
        fieldTitle="Always"
        nameInSchema={`${basePath}.always`}
        onCheckedChange={(v) => v && setExclusive("always")}
        disabled={forceEndOfMonth}
      />

      <CheckboxWithLabel
        fieldTitle="First Payroll"
        nameInSchema={`${basePath}.firstPayroll`}
        onCheckedChange={(v) => setPayroll("firstPayroll", v)}
        disabled={forceEndOfMonth}
      />

      <CheckboxWithLabel
        fieldTitle="Second Payroll"
        nameInSchema={`${basePath}.secondPayroll`}
        onCheckedChange={(v) => setPayroll("secondPayroll", v)}
        disabled={forceEndOfMonth}
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
        disabled={forceEndOfMonth}
      />
      <CheckboxWithLabel
        fieldTitle="Forth Payroll"
        nameInSchema={`${basePath}.forthPayroll`}
        onCheckedChange={(v) => setPayroll("forthPayroll", v)}
        disabled={forceEndOfMonth}
      />
      </div>
    </div>
  );
}

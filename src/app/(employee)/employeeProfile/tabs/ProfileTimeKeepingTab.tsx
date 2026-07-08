"use client";

import type { SelectEmployeeWithRelationsSchemaType } from "@/zod-schemas/employee";
import { ProfileField } from "../components/ProfileField";
import { displayValue, formatTimeValue } from "../utils";

type Props = {
  employee: SelectEmployeeWithRelationsSchemaType;
};

export default function ProfileTimeKeepingTab({ employee }: Props) {
  const timekeeping = employee.timekeeping;

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-3">
        <ProfileField
          label="Timekeeping ID No."
          value={displayValue(timekeeping?.timekeepingId)}
        />
        <ProfileField
          label="Shift/Schedule"
          value={displayValue(timekeeping?.shiftSchedule)}
        />
        <ProfileField
          label="Check-In Time"
          value={formatTimeValue(timekeeping?.checkInTime)}
        />
        <ProfileField
          label="Check-Out Time"
          value={formatTimeValue(timekeeping?.checkOutTime)}
        />
        <ProfileField
          label="Rest Day"
          value={displayValue(timekeeping?.restDay)}
        />
        <ProfileField
          label="Total Hours"
          value={displayValue(timekeeping?.hoursWorked)}
        />
        <ProfileField
          label="Total Minutes"
          value={displayValue(timekeeping?.minutesWorked)}
        />
      </div>
    </div>
  );
}

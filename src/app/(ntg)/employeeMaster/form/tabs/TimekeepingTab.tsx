"use client";

import React from "react";
import Link from "next/link";
import { useFormContext } from "react-hook-form";

import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { Button } from "@/components/ui/button";

import { InsertEmployeeSchemaType } from "@/zod-schemas/employee";


export default function TimekeepingTab({ employeeId }: { employeeId?: string }) {
  const { register, watch } = useFormContext<InsertEmployeeSchemaType>();
  const profile = watch("timekeeping");
  const hasSavedSchedule = Boolean(profile?.shiftSchedule || profile?.checkInTime || profile?.checkOutTime || profile?.restDay || Number(profile?.hoursWorked) || Number(profile?.minutesWorked));

  return (
    <div className="p-4">
      <h3 className="font-semibold">Attendance identification</h3>
      <p className="mb-4 text-sm text-muted-foreground">Use Schedules to set working times, breaks and rest days for this employee.</p>
      <div className="max-w-sm">
        <InputWithLabel
          fieldTitle="Timekeeping ID No."
          nameInSchema="timekeeping.timekeepingId"
          register={register}
        />
      </div>
      {hasSavedSchedule ? <details className="mt-4 text-sm text-muted-foreground">
        <summary className="cursor-pointer">Saved profile values</summary>
        <p className="mt-2">Retained for schedule history. Current schedules are managed using the links below.</p>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <dt>Schedule</dt><dd>{profile?.shiftSchedule || "—"}</dd>
          <dt>Times</dt><dd>{profile?.checkInTime || "—"} – {profile?.checkOutTime || "—"}</dd>
          <dt>Rest day</dt><dd>{profile?.restDay || "—"}</dd>
          <dt>Duration</dt><dd>{Number(profile?.hoursWorked) || 0}h {Number(profile?.minutesWorked) || 0}m</dd>
        </dl>
      </details> : null}
      {employeeId ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Set the normal week in Weekly defaults, then review the dates in Period schedule.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild type="button" variant="outline">
              <Link href={`/schedules?view=weekly&employeeId=${employeeId}`}>
                Weekly defaults
              </Link>
            </Button>
            <Button asChild type="button" variant="outline">
              <Link href={`/schedules?view=period&employeeId=${employeeId}`}>
                Period schedule
              </Link>
            </Button>
          </div>
        </div>
      ) : <p className="mt-4 text-sm text-muted-foreground">Save the employee first, then open Schedules to assign shifts.</p>}
    </div>
  );
}

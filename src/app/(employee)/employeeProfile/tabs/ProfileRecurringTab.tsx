"use client";

import type { EmployeeRecurringEntryFormType } from "@/zod-schemas/employeeRecurringEntries";
import ProfileRecurringTable from "./ProfileRecurringTable";

type Props = {
  entries: EmployeeRecurringEntryFormType[];
};

export default function ProfileRecurringTab({ entries }: Props) {
  return (
    <div className="p-4">
      <ProfileRecurringTable entries={entries} />
    </div>
  );
}

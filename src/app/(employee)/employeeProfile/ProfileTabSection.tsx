"use client";

import type { SelectEmployeeWithRelationsSchemaType } from "@/zod-schemas/employee";
import type { EmployeeRecurringEntryFormType } from "@/zod-schemas/employeeRecurringEntries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProfileGeneralTab from "./tabs/ProfileGeneralTab";
import ProfileSalaryTab from "./tabs/ProfileSalaryTab";
import ProfileReferenceTab from "./tabs/ProfileReferenceTab";
import ProfileTimeKeepingTab from "./tabs/ProfileTimeKeepingTab";
import ProfileRecurringTab from "./tabs/ProfileRecurringTab";

type Props = {
  employee: SelectEmployeeWithRelationsSchemaType;
  departments: { id: number; name: string }[];
  positions: { id: number; name: string }[];
  slvlGroups: { id: number; name: string }[];
  customPayrollCodes: {
    id: number;
    code: string;
    description: string | null;
    rateDivisor: string | null;
  }[];
};

export default function ProfileTabSection({
  employee,
  departments,
  positions,
  slvlGroups,
  customPayrollCodes,
}: Props) {
  const recurringEntries: EmployeeRecurringEntryFormType[] =
    employee.recurringEntries?.map((entry) => ({
      id: entry.id,
      employeeId: entry.employeeId,
      accountCode: entry.accountCode ?? "",
      description: entry.description ?? "",
      amount: entry.amount ?? "",
      frequency: entry.frequency,
      status: entry.status,
      startDate: entry.startDate ?? "",
      endDate: entry.endDate ?? "",
    })) ?? [];

  return (
    <Tabs defaultValue="general">
      <TabsList>
        <TabsTrigger value="general">General Info</TabsTrigger>
        <TabsTrigger value="salary">Salary</TabsTrigger>
        <TabsTrigger value="references">Other References</TabsTrigger>
        <TabsTrigger value="timekeeping">Timekeeping</TabsTrigger>
        <TabsTrigger value="recurring">Recurring Entries</TabsTrigger>
      </TabsList>

      <TabsContent value="general">
        <ProfileGeneralTab employee={employee} departments={departments} />
      </TabsContent>

      <TabsContent value="salary">
        <ProfileSalaryTab
          employee={employee}
          slvlGroups={slvlGroups}
          customPayrollCodes={customPayrollCodes}
        />
      </TabsContent>

      <TabsContent value="references">
        <ProfileReferenceTab employee={employee} positions={positions} />
      </TabsContent>

      <TabsContent value="timekeeping">
        <ProfileTimeKeepingTab employee={employee} />
      </TabsContent>

      <TabsContent value="recurring">
        <ProfileRecurringTab entries={recurringEntries} />
      </TabsContent>
    </Tabs>
  );
}

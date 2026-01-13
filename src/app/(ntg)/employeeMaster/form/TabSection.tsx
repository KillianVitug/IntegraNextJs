"use client";

import { UseFormReturn } from "react-hook-form";
import { InsertEmployeeSchemaType, SelectEmployeeWithRelationsSchemaType } from "@/zod-schemas/employee";
// import { useForm, FormProvider } from "react-hook-form";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import GeneralTab from "./tabs/GeneralTab";
import SalaryTab from "./tabs/SalaryTab";
import ReferencesTab from "./tabs/ReferencesTab";
import RecurringEntriesTab from "./tabs/RecurringEntriesTab";
import TimekeepingTab from "./tabs/TimekeepingTab";

export default function TabsSection({
  form,
  employee,
  departments,
  positions,
  slvlGroups,
}: {
  form: UseFormReturn<InsertEmployeeSchemaType>;
  employee?: SelectEmployeeWithRelationsSchemaType; // ✅ optional now
  departments: { id: number; name: string }[];
  positions: { id: number; name: string }[];
  slvlGroups: { id: number; name: string }[];
}) {
  return (
    <Tabs defaultValue="general">
      <TabsList>
        <TabsTrigger value="general">General Info</TabsTrigger>
        <TabsTrigger value="salary">Salary</TabsTrigger>
        <TabsTrigger value="references">Other References</TabsTrigger>
        <TabsTrigger value="timekeeping">Timekeeping</TabsTrigger>
        <TabsTrigger value="recurring" disabled={!employee}>Recurring Entries</TabsTrigger>
      </TabsList>

      <TabsContent value="general">
        <GeneralTab departments={departments} />
      </TabsContent>

      <TabsContent value="salary">
        <SalaryTab slvlGroups={slvlGroups} />
      </TabsContent>

      <TabsContent value="references">
        <ReferencesTab positions={positions} />
      </TabsContent>

      <TabsContent value="timekeeping">
        <TimekeepingTab />
      </TabsContent>

      {employee && (
        <TabsContent value="recurring">
          <RecurringEntriesTab employee={employee} />
        </TabsContent>
      )}
    </Tabs>
  );
}


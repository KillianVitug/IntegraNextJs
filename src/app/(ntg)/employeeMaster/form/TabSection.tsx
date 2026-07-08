"use client";

import { SelectEmployeeWithRelationsSchemaType } from "@/zod-schemas/employee";
import type { EmployeeSalaryTabView } from "@/zod-schemas/employeeSalary";
// import { useForm, FormProvider } from "react-hook-form";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import GeneralTab from "./tabs/GeneralTab";
import SalaryTab from "./tabs/SalaryTab";
import ReferencesTab from "./tabs/ReferencesTab";
import RecurringEntriesTab from "./tabs/RecurringEntriesTab";
import TimekeepingTab from "./tabs/TimekeepingTab";
import {
  type EmployeeRecurringAccountCodeOption,
  type EmployeeRecurringEntryFormType,
} from "@/zod-schemas/employeeRecurringEntries";

export default function TabsSection({
  employee,
  departments,
  positions,
  slvlGroups,
  customPayrollCodes,
  recurringEntries,
  recurringAccountCodeOptions,
  salaryTabView,
}: {
  employee?: SelectEmployeeWithRelationsSchemaType; // ✅ optional now
  departments: { id: number; name: string }[];
  positions: { id: number; name: string }[];
  slvlGroups: { id: number; name: string }[];
  customPayrollCodes: {
    id: number;
    code: string;
    description: string | null;
    rateDivisor: string | null;
  }[];
  recurringEntries: EmployeeRecurringEntryFormType[];
  recurringAccountCodeOptions: EmployeeRecurringAccountCodeOption[];
  salaryTabView?: EmployeeSalaryTabView | null;
}) {
  return (
    <Tabs defaultValue="general">
      <TabsList className="h-auto flex-wrap justify-start">
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
        <SalaryTab 
        employeeId={employee?.id}
        slvlGroups={slvlGroups}
        customPayrollCodes={customPayrollCodes}
        salaryTabView={salaryTabView}
         />
      </TabsContent>

      <TabsContent value="references">
        <ReferencesTab positions={positions} />
      </TabsContent>

      <TabsContent value="timekeeping">
        <TimekeepingTab employeeId={employee?.id} />
      </TabsContent>

      {employee && (
      <TabsContent value="recurring">
        <RecurringEntriesTab
          employee={employee}
          initialEntries={recurringEntries}
          accountCodeOptions={recurringAccountCodeOptions}
        />
      </TabsContent>
    )}
    </Tabs>
  );
}


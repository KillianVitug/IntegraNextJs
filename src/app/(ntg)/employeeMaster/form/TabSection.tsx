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
import { Button } from "@/components/ui/button";
import { EmployeeAccountAccess } from "@/components/access/EmployeeAccountAccess";
import type { EmployeeAccountAccessData } from "@/lib/auth/employee-access-types";
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
  canManageAccess = false,
  activeTab,
  onTabChange,
  employeeDirty,
  isSaving,
  onSaveEmployee,
  onAccessSaved,
  accountPending,
  onAccountPendingChange,
  accessRefreshKey,
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
  canManageAccess?: boolean;
  activeTab: string;
  onTabChange: (tab: string) => void;
  employeeDirty: boolean;
  isSaving: boolean;
  onSaveEmployee: () => void;
  onAccessSaved: (data: EmployeeAccountAccessData) => void;
  accountPending: boolean;
  onAccountPendingChange: (pending: boolean) => void;
  accessRefreshKey: number;
}) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange}>
      <TabsList className="h-auto flex-wrap justify-start">
        <TabsTrigger value="general" disabled={accountPending}>General Info</TabsTrigger>
        <TabsTrigger value="salary" disabled={accountPending}>Salary</TabsTrigger>
        <TabsTrigger value="references" disabled={accountPending}>Other References</TabsTrigger>
        <TabsTrigger value="timekeeping" disabled={accountPending}>Timekeeping</TabsTrigger>
        <TabsTrigger value="recurring" disabled={!employee || accountPending}>Recurring Entries</TabsTrigger>
        {canManageAccess && <TabsTrigger value="access">Account access</TabsTrigger>}
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
      {canManageAccess && (
        <TabsContent value="access" className="space-y-4">
          {(!employee || employeeDirty) && (
            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm">
                {employee
                  ? "Save your employee changes before updating account access. Account actions use the saved employee details and email."
                  : "Save this employee first, then set up their login using the saved email."}
              </p>
              <Button type="button" disabled={isSaving || accountPending} onClick={onSaveEmployee}>
                {isSaving ? "Saving employee…" : "Save employee & continue"}
              </Button>
            </div>
          )}
          {employee && (
            <EmployeeAccountAccess
              key={`${employee.id}:${accessRefreshKey}`}
              employeeId={employee.id}
              disabledReason={employeeDirty || isSaving ? "Save employee changes before updating account access." : undefined}
              onAccessSaved={onAccessSaved}
              onPendingChange={onAccountPendingChange}
            />
          )}
        </TabsContent>
      )}
    </Tabs>
  );
}


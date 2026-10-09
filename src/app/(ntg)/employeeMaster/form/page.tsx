"use server";

import { getEmployee } from "@/lib/queries/getEmployee";
import { BackButton } from "@/components/BackButton";
import EmployeeForm from "@/app/(ntg)/employeeMaster/form/EmployeeForm";
import {
    fetchAccountCode,
    fetchDepartments,
    fetchSlVl,
    fetchPositions,
    fetchCustomPayrollCodes,
} from "@/lib/queries/fetchLookupData";
import { getNextEmployeeNoPreview } from "@/lib/queries/getNextEmployeeNoPreview";
import { getRecurringEntriesByEmployee } from "@/app/actions/recurrigEntryAction";
import { getEmployeeSalaryTabView } from "@/lib/payroll/salaryResolver";
import { hasPermission, requireAdmin } from "@/lib/auth/server";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";
import type { EmployeeRecurringAccountCodeOption } from "@/zod-schemas/employeeRecurringEntries";
import {
    DEFAULT_EMPLOYEE_TYPE,
    isManagerialConfidentialityLevel,
} from "@/utils/employeeCode";

export async function generateMetadata({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const { employeeId } = await searchParams;

    if (!employeeId) return { title: "New Employee" };

    return { title: `Edit Employee #${employeeId}` };
}

export default async function EmployeeFormPage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    try {
        const auth = await requireAdmin();
        const { employeeId, employeeType } = await searchParams;
        const canManageEmployeeType = isManagerialConfidentialityLevel(auth.confidentialityLevel);
        const initialEmployeeType = canManageEmployeeType && employeeType === "ADMIN" ? "ADMIN" : DEFAULT_EMPLOYEE_TYPE;
        let employee = undefined;
        let salaryTabView = null;
        const nextEmployeeNo = !employeeId
            ? await getNextEmployeeNoPreview(initialEmployeeType)
            : undefined;

        if (employeeId) {
            employee = await getEmployee(employeeId);
            if (employee) {
                salaryTabView = await getEmployeeSalaryTabView(employeeId);
            }
        }

        const recurringEntries =
        employeeId && employee
          ? (await getRecurringEntriesByEmployee({ employeeId }))
              ?.data?.entries ?? []
          : [];

        // ? Fetch Lookup Data on the Server
        const [departments, positions, slvlGroups, customPayrollCodes, accountCodes] = await Promise.all([
            fetchDepartments(),
            fetchPositions(),
            fetchSlVl(),
            fetchCustomPayrollCodes(),
            fetchAccountCode(),
        ]);
        const recurringAccountCodeOptions = accountCodes
            .flatMap((item): EmployeeRecurringAccountCodeOption[] => {
                if (
                    item.accountType !== "Other Income" &&
                    item.accountType !== "Other Deduction"
                ) {
                    return [];
                }

                return [{
                    id: item.id,
                    code: item.accountCode,
                    accountType: item.accountType,
                    description: item.description,
                    dailyRate: item.dailyRate,
                    monthlyRate: item.monthlyRate,
                }];
            })
            .sort((left, right) => left.code.localeCompare(right.code));

        return (
            <div className="p-6">
                {employeeId && !employee ? (
                    <>
                        <h2 className="text-2xl mb-2">Employee ID #{employeeId} Not Found.</h2>
                        <BackButton title="Go Back" variant="default" />
                    </>
                ) : (
                    <>
                        <EmployeeForm 
                        key={employeeId}
                        employee={employee}
                        departments={departments} 
                        positions={positions} 
                        slvlGroups={slvlGroups} 
                        nextEmployeeNo={nextEmployeeNo} 
                        canManageEmployeeType={canManageEmployeeType}
                        canManageAccess={hasPermission(auth, AUTH_PERMISSIONS.ACCESS_MANAGE)}
                        initialEmployeeType={initialEmployeeType}
                        customPayrollCodes={customPayrollCodes}
                        recurringEntries={recurringEntries}
                        recurringAccountCodeOptions={recurringAccountCodeOptions}
                        salaryTabView={salaryTabView}
                        />
                    </>
                )}
            </div>
        );
    } catch (e) {
        if (e instanceof Error) {
            throw e;
        }
    }
}

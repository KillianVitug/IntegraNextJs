"use server";

import { getEmployee } from "@/lib/queries/getEmployee";
import { BackButton } from "@/components/BackButton";
import EmployeeForm from "@/app/(ntg)/employeeMaster/form/EmployeeForm";
import { fetchDepartments, fetchSlVl, fetchPositions } from "@/lib/queries/fetchLookupData";

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
        const { employeeId } = await searchParams;
        let employee = undefined;

        if (employeeId) {
            employee = await getEmployee(employeeId);
        }

        // ? Fetch Lookup Data on the Server
        const [departments, positions, slvlGroups] = await Promise.all([
            fetchDepartments(),
            fetchPositions(),
            fetchSlVl(),
        ]);

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

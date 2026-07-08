import { getEmployeeFolder } from "@/lib/queries/getEmployeeFiles";
import { BackButton } from "@/components/BackButton";
import { PageHeader } from "@/components/layout/page-layout";
import FileForm from "@/app/(ntg)/employeeFiles/form/EmployeeFileForm";
import EmployeeFileFormTable from "./EmployeeFileFormTable";
import { getActiveEmployees } from "@/app/actions/employeeAction";

export async function generateMetadata({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const { groupId } = await searchParams;

    if (!groupId) return { title: "Employee Files" };

    return { title: `Edit File #${groupId}` };
}

export default async function EmployeeFilePage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    try {

        const employees = await getActiveEmployees();
        const { groupId } = await searchParams;
        let employeeFile = undefined;

        if (groupId) {
            employeeFile = await getEmployeeFolder(groupId);
        }

        return (
            <div className="space-y-4">
                {groupId && !employeeFile ? (
                    <>
                        <PageHeader title={`Employee File ID #${groupId} Not Found`} />
                        <BackButton title="Go Back" variant="default" />
                    </>
                ) : (
                    <>
                        <FileForm 
                        key={groupId}
                        employeeFolder={employeeFile}
                        employees={employees.data ?? []} 
                        />

                        {groupId && <EmployeeFileFormTable groupId={groupId} />}
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

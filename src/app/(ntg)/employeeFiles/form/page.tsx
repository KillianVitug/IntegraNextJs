import { getEmployeeFile, getEmployeeFolder } from "@/lib/queries/getEmployeeFiles";
import { BackButton } from "@/components/BackButton";
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
            <div className="p-6">
                {groupId && !employeeFile ? (
                    <>
                        <h2 className="text-2xl mb-2">Employee File ID #{groupId} Not Found.</h2>
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

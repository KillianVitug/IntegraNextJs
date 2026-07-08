 import EmployeeFileSearch from "@/app/(ntg)/employeeFiles/EmployeeFileSearch";
 import { getFolderSearchResults } from "@/lib/queries/getEmployeeSearchResults";
 import EmployeeFileTable from "@/app/(ntg)/employeeFiles/EmployeeFileTable";
import { PageHeader } from "@/components/layout/page-layout";
import { /*getEmployeeFiles,*/ getAllFoldersWithFiles } from "@/lib/queries/getEmployeeFiles";

export const metadata = {
    title: "Employee Files",
}

export default async function EmployeeFiles({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const { searchText } = await searchParams

    if (!searchText) {
         const results = await getAllFoldersWithFiles()
        return (
            <div className="space-y-4">
                <PageHeader
                    title="Employee Files"
                    description="Search employee folders and uploaded files."
                />
                <EmployeeFileSearch />
                {results.length ? <EmployeeFileTable data={results} /> : <p className="mt-4">No Employee Folder</p>}
            </div>
        )
    }

    const results = await getFolderSearchResults(searchText)
    return (
        <div className="space-y-4">
            <PageHeader
                title="Employee Files"
                description="Search employee folders and uploaded files."
            />
            <EmployeeFileSearch />
            {results.length ? <EmployeeFileTable data={results}/> : (
                <p className="mt-4"> No results found.</p>
            )}
        </div>
    )
}

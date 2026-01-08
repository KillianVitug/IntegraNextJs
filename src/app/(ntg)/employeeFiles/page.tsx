 import EmployeeFileSearch from "@/app/(ntg)/employeeFiles/EmployeeFileSearch";
 import { getFolderSearchResults } from "@/lib/queries/getEmployeeSearchResults";
 import EmployeeFileTable from "@/app/(ntg)/employeeFiles/EmployeeFileTable";
import { getEmployeeFiles, getAllFoldersWithFiles } from "@/lib/queries/getEmployeeFiles";

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
            <>
                <EmployeeFileSearch />
                {results.length ? <EmployeeFileTable data={results} /> : <p className="mt-4">No Employee Folder</p>}
            </>
        )
    }

    const results = await getFolderSearchResults(searchText)
    return (
        <>
            <EmployeeFileSearch />
            {results.length ? <EmployeeFileTable data={results}/> : (
                <p className="mt-4"> No results found.</p>
            )}
        </>
    )
}
import EmployeeSearch from "@/app/(ntg)/employeeMaster/EmployeeSearch";
import { getEmployeeSearchResults } from "@/lib/queries/getEmployeeSearchResults";
import EmployeeTable from "@/app/(ntg)/employeeMaster/EmployeeTable";
import { getOpenEmployees } from "@/lib/queries/getOpenEmployees";

export const metadata = {
    title: "Employee Master",
}

export default async function EmployeeMaster({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const { searchText } = await searchParams

    if (!searchText) {
        const results = await getOpenEmployees()
        return (
            <>
                <EmployeeSearch />
                {results.length ? <EmployeeTable data={results} /> : <p className="mt-4">No employee found</p>}
            </>
        )
    }

    const results = await getEmployeeSearchResults(searchText)


    return (
        <>
            <EmployeeSearch />
            {results.length ? <EmployeeTable data={results}/> : (
                <p className="mt-4"> No results found.</p>
            )}
        </>
    )
}
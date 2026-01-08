import PayrollCodeSearch from "@/app/(ntg)/constants/payrollCode/payrollCodeSearch";
import { getCustomPayrollSearchResults } from "@/lib/queries/getEmployeeSearchResults";
import PayrollCodeTable from "@/app/(ntg)/constants/payrollCode/payrollCodeTable";
import { fetchCustomPayroll } from "@/lib/queries/fetchLookupData";

export const metadata = {
    title: "Employee Master",
}

export default async function payrollCodeMaster({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const { searchText } = await searchParams

    if (!searchText) {
        const results = await fetchCustomPayroll()
        return (
            <>
                <PayrollCodeSearch />
                {results.length ? <PayrollCodeTable data={results} /> : <p className="mt-4">No Custom Payroll found</p>}
            </>
        )
    }

    const results = await getCustomPayrollSearchResults(searchText)
    return (
        <>
            <PayrollCodeSearch />
            {results.length ? <PayrollCodeTable data={results}/> : (
                <p className="mt-4"> No results found.</p>
            )}
        </>
    )
}
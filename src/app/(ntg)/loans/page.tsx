import LoanSearch from "@/app/(ntg)/loans/LoanSearch";
 import { getEmployeeLoanSearchResults } from "@/lib/queries/getEmployeeSearchResults";
import LoanRecordTable from "@/app/(ntg)/loans/LoanRecordTable";
import { getLoanRecords } from "@/lib/queries/getLoanRecords";

export const metadata = {
    title: "Loan Files",
}

export default async function LoanMaster({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const { searchText } = await searchParams

    if (!searchText) {
         const results = await getLoanRecords()
        return (    
            <>
                <LoanSearch />
                {results.length ? <LoanRecordTable data={results} /> : <p className="mt-4">No loan record found</p>}
            </>
        )
    }

     const results = await getEmployeeLoanSearchResults(searchText)
    return (
        <>
            <LoanSearch />
            {results.length ? <LoanRecordTable data={results}/> : (
                <p className="mt-4"> No results found.</p>
            )}
        </>
    )
}
import { getSalaryAdjustmentHistory } from "@/app/actions/salaryAdjustAction";
import SalaryAdjustTable from "./SalaryAdjustTable"

export const metadata = {
    title: "Salary Adjustment",
}

export default async function SalaryAdjustment({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const { searchText } = await searchParams

    if (!searchText) {
        const results = await getSalaryAdjustmentHistory(searchText as string)
        return (
            <>
                <SalaryAdjustTable data={results} />
            </>
        )
    }

    // const results = await getEmployeeSearchResults(searchText)
    return (
        <>
            {/* {results.length ? <SalaryAdjustTable data={results}/> : (
                <p className="mt-4"> No results found.</p>
            )} */}
        </>
    )
}
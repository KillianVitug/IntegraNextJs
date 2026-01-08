import { getSickAndLeave, getSickAndLeaveWithUsage } from "@/lib/queries/getSickAndLeave";
import SickandLeaveTable from "./SickandLeaveTable";
import { getSickAndLeaveSearchResults } from "@/lib/queries/getEmployeeSearchResults";
import SickandLeaveSearch from "./SickandLeaveSearch";
import { getLeaveUsageByEmployeeIds } from "@/lib/queries/getLeaveUsageByEmployeeIds";

export const metadata = {
    title: "Sick & Vacation Leaves",
}

export default async function Leaves({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const { searchText } = await searchParams

     if (!searchText) {
        const results = await getSickAndLeaveWithUsage()
        return (
            <>
                <SickandLeaveSearch />
                {results.length ? <SickandLeaveTable data={results} /> : <p className="mt-4">No employee found</p>}
            </>
        )
    }

    const rawResults = await getSickAndLeaveSearchResults(searchText);
    const employeeIds = rawResults.map((emp) => emp.id);
  
    const usageMap = await getLeaveUsageByEmployeeIds(employeeIds);
  
    const results = rawResults.map((item) => ({
      ...item,
      fullName: `${item.lastName}, ${item.firstName} ${item.middleName ?? ""}`.trim(),
      usedSickLeave: usageMap[item.id]?.usedSickLeave || 0,
      usedVacationLeave: usageMap[item.id]?.usedVacationLeave || 0,
    }));
    
    return (
        <>
            <SickandLeaveSearch />
            {results.length ? <SickandLeaveTable data={results}/> : (
                <p className="mt-4"> No results found.</p>
            )}
        </>
    )

}
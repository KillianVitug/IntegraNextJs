import { getSickAndLeave } from "@/lib/queries/getSickAndLeave";
import SickandLeaveTable from "./SickandLeaveTable";


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
        const results = await getSickAndLeave()
        return (
            <>
                {results.length ? <SickandLeaveTable data={results} /> : <p className="mt-4">No employee found</p>}
            </>
        )
    }

}
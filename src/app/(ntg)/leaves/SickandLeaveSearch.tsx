import Form from "next/form"
import { Input } from "@/components/ui/input"
import SearchButton from "@/components/SearchButton"

export default function SickandLeaveSearch({
    tab,
    year,
}: {
    tab?: string;
    year?: number;
}) {
    return (
        <Form
            action="/leaves"
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
            {tab ? <input type="hidden" name="tab" value={tab} /> : null}
            {year ? <input type="hidden" name="year" value={year} /> : null}
            <Input 
                name="search"
                type="text"
                placeholder="Search Employee"
                className="min-w-0 sm:max-w-md"
                autoFocus
            />
            <SearchButton />
        </Form>
    )
}

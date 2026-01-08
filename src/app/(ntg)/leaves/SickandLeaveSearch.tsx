import Form from "next/form"
import { Input } from "@/components/ui/input"
import SearchButton from "@/components/SearchButton"

export default function SickandLeaveSearch() {
    return (
        <Form
            action="/leaves"
            className="flex gap-2 items-center"
        >
            <Input 
                name="searchText"
                type="text"
                placeholder="Search Employee"
                className="w-full"
                autoFocus
            />
            <SearchButton />
        </Form>
    )
}
import Form from "next/form"
import { Input } from "@/components/ui/input"
import SearchButton from "@/components/SearchButton"

export default function EmployeeFileSearch() {
    return (
        <Form
            action="/employeeFiles"
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
            <Input 
                name="searchText"
                type="text"
                placeholder="Search Employee"
                className="min-w-0 sm:max-w-md"
                autoFocus
            />
            <SearchButton />
        </Form>
    )
}

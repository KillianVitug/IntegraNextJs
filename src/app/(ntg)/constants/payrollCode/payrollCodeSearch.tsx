import Form from "next/form"
import { Input } from "@/components/ui/input"
import SearchButton from "@/components/SearchButton"

export default function PayrollCodeSearch() {
    return (
        <Form
            action="/payrollMaster"
            className="flex gap-2 items-center"
        >
            <Input 
                name="searchText"
                type="text"
                placeholder="Search Payroll Code"
                className="w-full"
                autoFocus
            />
            <SearchButton />
        </Form>
    )
}
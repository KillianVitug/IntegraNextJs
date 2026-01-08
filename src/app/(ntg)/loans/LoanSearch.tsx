import Form from "next/form"
import { Input } from "@/components/ui/input"
import SearchButton from "@/components/SearchButton"

export default function LoanSearch() {
    return (
        <Form
            action="/loans"
            className="flex gap-2 items-center"
        >
            <Input 
                name="searchText"
                type="text"
                placeholder="Search Loan Record"
                className="w-full"
                autoFocus
            />
            <SearchButton />
        </Form>
    )
}
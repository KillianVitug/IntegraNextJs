"use client"

import Form from "next/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import SearchButton from "@/components/SearchButton"
import { useRouter } from "next/navigation"

export default function EmployeeSearch() {
    const router = useRouter();
    return (
        <Form
            action="/employeeMaster"
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
            <Input 
                name="search"
                type="text"
                placeholder="Search Employee"
                className="min-w-0 sm:max-w-md"
                autoFocus
            />
            <SearchButton />
            
            <Button
                type="button"
                variant="secondary"
                onClick={() => router.push("/employeeMaster/form")}
              >
                Create
              </Button>
        </Form>
    )
}

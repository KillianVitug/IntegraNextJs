"use client"

import Form from "next/form"
import { Input } from "@/components/ui/input"
import SearchButton from "@/components/SearchButton"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

export default function PayrollCodeSearch() {
    const router = useRouter();
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

            <Button
                type="button"
                variant="secondary"
                onClick={() => router.push("/constants/payrollCode/form")}
              >
                Create
              </Button>
        </Form>
    )
}
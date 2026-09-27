"use client"

import Form from "next/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import SearchButton from "@/components/SearchButton"
import { TABLE_PAGE_PARAM, TABLE_SEARCH_PARAM } from "@/lib/queries/tableQuery"
import { useRouter, useSearchParams } from "next/navigation"

const SHOW_ADMIN_PARAM = "showAdmin";

type Props = {
    showAdmin: boolean;
};

export default function EmployeeSearch({ showAdmin }: Props) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const handleShowAdminChange = (checked: boolean) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set(TABLE_PAGE_PARAM, "1");

        if (checked) {
            params.set(SHOW_ADMIN_PARAM, "true");
        } else {
            params.delete(SHOW_ADMIN_PARAM);
        }

        const nextQuery = params.toString();
        router.replace(nextQuery ? `/employeeMaster?${nextQuery}` : "/employeeMaster", {
            scroll: false,
        });
    };

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
                defaultValue={searchParams.get(TABLE_SEARCH_PARAM) ?? ""}
                autoFocus
            />
            {showAdmin ? (
                <input type="hidden" name={SHOW_ADMIN_PARAM} value="true" />
            ) : null}
            <SearchButton />
            
            <Button
                type="button"
                variant="secondary"
                onClick={() => router.push("/employeeMaster/form")}
              >
                Create
              </Button>
            <div className="flex items-center gap-2 sm:ml-auto">
                <Switch
                    id="show-admin"
                    checked={showAdmin}
                    onCheckedChange={handleShowAdminChange}
                />
                <Label htmlFor="show-admin" className="whitespace-nowrap">
                    Show Admin
                </Label>
            </div>
        </Form>
    )
}

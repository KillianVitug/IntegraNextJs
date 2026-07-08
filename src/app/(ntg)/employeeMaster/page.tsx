import EmployeeSearch from "@/app/(ntg)/employeeMaster/EmployeeSearch";
import EmployeeTable from "@/app/(ntg)/employeeMaster/EmployeeTable";
import { PageHeader } from "@/components/layout/page-layout";
import { getOpenEmployees } from "@/lib/queries/getEmployee";
import { parseTableQueryParams } from "@/lib/queries/tableQuery";

export const metadata = {
    title: "Employee Master",
}

const PAGE_SIZE = 50;

export default async function EmployeeMaster({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const params = await searchParams;
    const query = parseTableQueryParams(params, { id: "employeeNo", desc: false });

    const { data, total } = await getOpenEmployees({
        page: query.page,
        pageSize: PAGE_SIZE,
        search: query.search,
        filters: query.filters,
        sort: query.sort,
    });
    const hasActiveFilters = Object.keys(query.filters).length > 0;
    const shouldShowTable = data.length > 0 || total > 0 || query.search || hasActiveFilters;

    return (
        <div className="space-y-4">
            <PageHeader
                title="Employee Master"
                description="Search, review, and maintain employee records."
            />
            <EmployeeSearch />
            {shouldShowTable
                ? (
                    <>
                        {!data.length ? <p className="mt-4">No results found.</p> : null}
                        <EmployeeTable data={data} total={total} pageSize={PAGE_SIZE} />
                    </>
                )
                : <p className="mt-4">No employee found</p>
            }
        </div>
    );
}

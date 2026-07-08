import { getSickAndLeaveWithUsage } from "@/lib/queries/getSickAndLeave";
import { parseTableQueryParams } from "@/lib/queries/tableQuery";
import { PageHeader } from "@/components/layout/page-layout";
import SickandLeaveSearch from "./SickandLeaveSearch";
import SickandLeaveTable from "./SickandLeaveTable";

export const metadata = {
    title: "Sick & Vacation Leaves",
};

const PAGE_SIZE = 50;

export default async function Leaves({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const params = await searchParams;
    const currentYear = new Date().getFullYear();
    const parsedYear = Number(params.year ?? currentYear);
    const year = Number.isFinite(parsedYear) ? parsedYear : currentYear;
    const query = parseTableQueryParams(params, { id: "employeeNo", desc: false });
    const { data, total } = await getSickAndLeaveWithUsage(year, {
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
                title="Used Leaves and Services"
                description="Review leave balances and service usage by employee."
            />
            <SickandLeaveSearch />
            {shouldShowTable ? (
                <>
                    {!data.length ? <p className="mt-4">No results found.</p> : null}
                    <SickandLeaveTable data={data} total={total} pageSize={PAGE_SIZE} />
                </>
            ) : (
                <p className="mt-4">No employee found</p>
            )}
        </div>
    );
}

import { getSickAndLeaveWithUsage } from "@/lib/queries/getSickAndLeave";
import { parseTableQueryParams } from "@/lib/queries/tableQuery";
import { PageHeader } from "@/components/layout/page-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { listLeaveEncashmentPayrollPeriods } from "@/app/actions/leaveAction";
import LeaveEncashmentClient from "./LeaveEncashmentClient";
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
    const activeTab = params.tab === "encashment" ? "encashment" : "used";
    const query = parseTableQueryParams(params, { id: "employeeNo", desc: false });
    const [{ data, total }, periodsResult] = await Promise.all([
        getSickAndLeaveWithUsage(year, {
            page: query.page,
            pageSize: PAGE_SIZE,
            search: query.search,
            filters: query.filters,
            sort: query.sort,
        }),
        listLeaveEncashmentPayrollPeriods(currentYear),
    ]);
    const hasActiveFilters = Object.keys(query.filters).length > 0;
    const shouldShowTable = data.length > 0 || total > 0 || query.search || hasActiveFilters;

    return (
        <div className="space-y-4">
            <PageHeader
                title="Leaves"
                description="Review leave balances, service usage, and leave encashments."
            />
            <Tabs value={activeTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="used" asChild>
                        <Link href="/leaves">Used Leaves and Services</Link>
                    </TabsTrigger>
                    <TabsTrigger value="encashment" asChild>
                        <Link href="/leaves?tab=encashment">Leave Encashment</Link>
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="used" className="space-y-4">
                    <SickandLeaveSearch year={year} />
                    {shouldShowTable ? (
                        <>
                            {!data.length ? <p className="mt-4">No results found.</p> : null}
                            <SickandLeaveTable data={data} total={total} pageSize={PAGE_SIZE} />
                        </>
                    ) : (
                        <p className="mt-4">No employee found</p>
                    )}
                </TabsContent>
                <TabsContent value="encashment" className="space-y-4">
                    <SickandLeaveSearch tab="encashment" year={year} />
                    {shouldShowTable ? (
                        <>
                            {!data.length ? <p className="mt-4">No results found.</p> : null}
                            <LeaveEncashmentClient
                                data={data}
                                total={total}
                                pageSize={PAGE_SIZE}
                                initialPeriods={periodsResult.data ?? []}
                                initialYear={currentYear}
                                initialLeaveYear={year}
                            />
                        </>
                    ) : (
                        <p className="mt-4">No employee found</p>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}

import LoanSearch from "@/app/(ntg)/loans/LoanSearch";
import LoanRecordTable from "@/app/(ntg)/loans/LoanRecordTable";
import { PageHeader } from "@/components/layout/page-layout";
import { getLoanRecords } from "@/lib/queries/getLoanRecords";
import { parseTableQueryParams } from "@/lib/queries/tableQuery";

export const metadata = {
    title: "Loan Files",
};

const PAGE_SIZE = 50;

export default async function LoanMaster({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const params = await searchParams;
    const query = parseTableQueryParams(params, { id: "employeeName", desc: false });

    const { data, total } = await getLoanRecords({
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
                title="Employee Loans"
                description="Search, review, and maintain employee loan records."
            />
            <LoanSearch />
            {shouldShowTable
                ? (
                    <>
                        {!data.length ? <p className="mt-4">No results found.</p> : null}
                        <LoanRecordTable data={data} total={total} pageSize={PAGE_SIZE} />
                    </>
                )
                : <p className="mt-4">No loan record found</p>
            }
        </div>
    );
}

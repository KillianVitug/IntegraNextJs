import { getEmployeeMasterDataSummary } from "@/app/actions/employeeMasterDataAction";
import { PageHeader } from "@/components/layout/page-layout";
import EmployeeMasterDataClient from "./EmployeeMasterDataClient";

export const metadata = {
  title: "Employee Master Data",
};

export default async function EmployeeMasterDataPage() {
  const summary = await getEmployeeMasterDataSummary();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Employee Master Data"
        description="Reset regular employee records before importing a refreshed employee list."
      />
      <EmployeeMasterDataClient
        regularEmployeeCount={summary.regularEmployeeCount}
      />
    </div>
  );
}

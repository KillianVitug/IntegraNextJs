import { loadPayrollPageContext } from "../page-loader";
import { PayrollReportPageClient } from "./PayrollReportPageClient";

export const metadata = {
  title: "Payroll Report",
};

export default async function PayrollReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { selectedYear, snapshot } = await loadPayrollPageContext({
    searchParams,
  });
  const selectedPeriod =
    snapshot.periods.find((period) => period.id === snapshot.selectedPeriodId) ??
    null;

  return (
    <PayrollReportPageClient
      selectedYear={selectedYear}
      selectedPeriod={selectedPeriod}
      selectedRun={snapshot.selectedRun}
    />
  );
}

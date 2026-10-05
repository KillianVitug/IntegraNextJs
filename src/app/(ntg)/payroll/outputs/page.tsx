import { loadPayrollPageContext } from "../page-loader";
import { PayrollOutputsPageClient } from "./PayrollOutputsPageClient";

export const metadata = {
  title: "Payroll Outputs",
};

export default async function PayrollOutputsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { snapshot } = await loadPayrollPageContext({ searchParams });
  const selectedPeriod =
    snapshot.periods.find((period) => period.id === snapshot.selectedPeriodId) ??
    null;

  return (
    <PayrollOutputsPageClient
      selectedPeriod={selectedPeriod}
      selectedRun={snapshot.selectedRun}
    />
  );
}

import { loadPayrollPageContext } from "../page-loader";
import { PayrollSpecialRunPageClient } from "./PayrollSpecialRunPageClient";

export const metadata = {
  title: "Special Run",
};

export default async function PayrollSpecialRunPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { snapshot } = await loadPayrollPageContext({ searchParams });
  const selectedPeriod =
    snapshot.periods.find((period) => period.id === snapshot.selectedPeriodId) ??
    null;

  return (
    <PayrollSpecialRunPageClient
      selectedPeriod={selectedPeriod}
      selectedRun={snapshot.selectedRun}
    />
  );
}

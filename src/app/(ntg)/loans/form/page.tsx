"use server";

import { BackButton } from "@/components/BackButton";
import { PageHeader } from "@/components/layout/page-layout";
import LoanForm from "@/app/(ntg)/loans/form/LoanForm";
import { LoanFormTable } from "./LoanFormTable";
import { getEmployeeLoanFormData } from "@/app/actions/loanAction";
import { fetchAccountCode } from "@/lib/queries/fetchLookupData";
import type { EmployeeLoanList } from "@/zod-schemas/employeeLoan";

export default async function LoanFilePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { loanId } = await searchParams; // 🟢 use loanId instead of employeeId

  if (!loanId) {
    const accountCodes = (await fetchAccountCode()).filter(
      (account) =>
        account.accountType === "Loan" || account.accountType === "Other Deduction"
    );

    return (
      <div className="space-y-4">
        <LoanForm key="new" initialAccountCodes={accountCodes} />
      </div>
    );
  }

  const { loanRecord, loanSummary } = await getEmployeeLoanFormData(loanId);

  if (!loanRecord) {
    return (
      <div className="space-y-3">
        <PageHeader title={`Loan ID #${loanId} not found`} />
        <BackButton title="Go Back" variant="default" />
      </div>
    );
  }

  const validStatuses = ["Active", "Paid", "Paid With Reloan", "Inactive"] as const;
  
  // Type helpers
  type StatusType = typeof validStatuses[number];
  
  const mappedLoanRecord: Partial<EmployeeLoanList> | undefined =
    loanRecord
      ? {
          ...loanRecord,
          status: validStatuses.includes(loanRecord.status as StatusType)
            ? (loanRecord.status as StatusType)
            : "Active",
          paymentTerms: "Always",
        }
      : undefined;

return (
  <div className="space-y-4">
    <LoanForm employeeLoan={mappedLoanRecord} loanSummary={loanSummary} />
    <LoanFormTable reloadFlag={0} loanId={loanId} />
  </div>
);
}

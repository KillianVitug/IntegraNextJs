"use server";

import { BackButton } from "@/components/BackButton";
import LoanForm from "@/app/(ntg)/loans/form/LoanForm";
import { LoanFormTable } from "./LoanFormTable";
import { getEmployeeLoan } from "@/app/actions/loanAction";
import { SelectEmployeeLoanSchemaType } from "@/zod-schemas/employeeLoan"

export default async function LoanFilePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { loanId } = await searchParams; // 🟢 use loanId instead of employeeId

  if (!loanId) {
    return (
      <>
        <LoanForm key="new" />
      </>
    );
  }

  const loanRecordArray = await getEmployeeLoan(loanId);
  const loanRecord = loanRecordArray[0]; // first (and only) record

  if (!loanRecord) {
    return (
      <>
        <h2 className="text-2xl mb-2">Loan ID #{loanId} not found</h2>
        <BackButton title="Go Back" variant="default" />
      </>
    );
  }

  const validStatuses = ["Active", "Paid", "Inactive"] as const;
  const validPaymentTerms = [
    "Always",
    "First Payroll",
    "Second Payroll",
    "Third Payroll",
    "Fourth Payroll",
  ] as const;
  
  // Type helpers
  type StatusType = typeof validStatuses[number];
  type PaymentTermsType = typeof validPaymentTerms[number];
  
  const mappedLoanRecord: Partial<SelectEmployeeLoanSchemaType> | undefined =
    loanRecord
      ? {
          ...loanRecord,
          status: validStatuses.includes(loanRecord.status as StatusType)
            ? (loanRecord.status as StatusType)
            : "Active",
          paymentTerms: validPaymentTerms.includes(
            loanRecord.paymentTerms as PaymentTermsType
          )
            ? (loanRecord.paymentTerms as PaymentTermsType)
            : "Always",
        }
      : undefined;

return (
  <>
    <LoanForm employeeLoan={mappedLoanRecord} />
    <LoanFormTable reloadFlag={0} loanId={loanId} />
  </>
);
}

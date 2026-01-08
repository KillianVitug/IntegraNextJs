"use server";

import { BackButton } from "@/components/BackButton";
import LoanForm from "@/app/(ntg)/loans/form/LoanForm";
import { LoanFormTable } from "./LoanFormTable";
import { getEmployeeLoan } from "@/app/actions/loanAction";

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

  return (
    <>
      <LoanForm employeeLoan={loanRecord} />
      <LoanFormTable reloadFlag={0} loanId={loanId} />
    </>
  );
}

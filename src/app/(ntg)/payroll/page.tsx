import Link from "next/link";
import { PayrollWorkspace } from "./PayrollWorkspace";
import { requireAdminActor } from "@/lib/admin";
import {
  isValidPayrollYear,
  loadPayrollAccountCodeEmployees,
  loadPayrollWorkspaceSnapshot,
} from "@/lib/payroll/workspaceSnapshot";

export const metadata = {
  title: "Payroll Workspace",
};

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  await requireAdminActor();
  const params = await searchParams;
  const selectedYear = isValidPayrollYear(params.year)
    ? Number(params.year)
    : new Date().getFullYear();

  const [snapshot, payrollAccountCodeEmployees] = await Promise.all([
    loadPayrollWorkspaceSnapshot({
      year: selectedYear,
      periodId: params.periodId,
    }),
    loadPayrollAccountCodeEmployees(),
  ]);

  return (
    <>
    {process.env.ATTENDANCE_SOURCE_ENABLED === "true" && <div className="px-6 pt-4"><Link href="/payroll/attendance-source">Attendance connection / Sync attendance now</Link></div>}
    <PayrollWorkspace
      initialYear={selectedYear}
      periods={snapshot.periods}
      selectedPeriodId={snapshot.selectedPeriodId}
      selectedRun={snapshot.selectedRun}
      payrollAccountCodeEmployees={payrollAccountCodeEmployees}
      attendanceBatches={snapshot.attendanceBatches}
    />
    </>
  );
}

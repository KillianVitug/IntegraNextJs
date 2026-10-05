import Link from "next/link";
import { requireAdminActor } from "@/lib/admin";
import { attendancePeriodUrl } from "@/lib/payroll/attendanceSourcePeriods";
import {
  isValidPayrollYear,
  loadPayrollAccountCodeEmployees,
  loadPayrollWorkspaceSnapshot,
} from "@/lib/payroll/workspaceSnapshot";
import { PayrollWorkspace } from "./PayrollWorkspace";
import type { PayrollSection } from "./sections";

type PayrollSearchParams = { [key: string]: string | undefined };

export async function loadPayrollPageContext({
  searchParams,
}: {
  searchParams: Promise<PayrollSearchParams>;
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

  return {
    selectedYear,
    snapshot,
    payrollAccountCodeEmployees,
  };
}

export async function renderPayrollWorkspacePage({
  activeSection,
  searchParams,
}: {
  activeSection: PayrollSection;
  searchParams: Promise<PayrollSearchParams>;
}) {
  const { selectedYear, snapshot, payrollAccountCodeEmployees } =
    await loadPayrollPageContext({ searchParams });

  return (
    <>
      {process.env.ATTENDANCE_SOURCE_ENABLED === "true" && (
        <div className="px-6 pt-4">
          <Link
            href={attendancePeriodUrl(
              "/payroll/attendance-source",
              selectedYear,
              snapshot.selectedPeriodId ?? ""
            )}
          >
            Attendance connection / Sync attendance now
          </Link>
        </div>
      )}
      <PayrollWorkspace
        activeSection={activeSection}
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

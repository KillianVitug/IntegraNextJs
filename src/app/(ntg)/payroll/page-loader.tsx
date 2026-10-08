import Link from "next/link";
import { requireAdminActor } from "@/lib/admin";
import { attendancePeriodUrl } from "@/lib/payroll/attendanceSourcePeriods";
import {
  isValidPayrollYear,
  loadPayrollAccountCodeEmployees,
  loadPayrollWorkspaceSnapshot,
} from "@/lib/payroll/workspaceSnapshot";
import { PayrollGroups } from "./PayrollGroups";
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
      runId:params.runId,
      payrollGroup:params.group==="Monthly"?"Monthly":"Daily",
    }),
    loadPayrollAccountCodeEmployees(),
  ]);

  return {
    selectedYear,
    payrollGroup:params.group==="Monthly"?"Monthly" as const:"Daily" as const,
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
  const { selectedYear, payrollGroup, snapshot, payrollAccountCodeEmployees } =
    await loadPayrollPageContext({ searchParams });

  return (
    <>
        <nav aria-label="Payroll workspaces" className="flex flex-wrap gap-3 px-6 pt-4">
          <Link className="inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-sm font-semibold" href={`/payroll/provisional?${new URLSearchParams({year:String(selectedYear),group:payrollGroup,...(snapshot.selectedPeriodId?{periodId:snapshot.selectedPeriodId}:{})})}`}>Provisional payroll</Link>
          {process.env.ATTENDANCE_SOURCE_ENABLED === "true" && <Link
            className="inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-sm font-semibold"
            href={attendancePeriodUrl(
              "/payroll/attendance-source",
              selectedYear,
              snapshot.selectedPeriodId ?? ""
            )}
          >
            Attendance review & sync
          </Link>}
        </nav>
      {snapshot.selectedPeriodId&&<PayrollGroups periodId={snapshot.selectedPeriodId} year={selectedYear} group={payrollGroup}/>}
      <PayrollWorkspace
        key={payrollGroup}
        payrollGroup={payrollGroup}
        attendanceEnabled={process.env.ATTENDANCE_SOURCE_ENABLED === "true"}
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

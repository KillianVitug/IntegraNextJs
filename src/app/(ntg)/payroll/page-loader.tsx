import { requireAdminActor } from "@/lib/admin";
import {
  isValidPayrollYear,
  loadPayrollAccountCodeEmployees,
  loadPayrollWorkspaceSnapshot,
} from "@/lib/payroll/workspaceSnapshot";
import { PayrollGroups } from "./PayrollGroups";
import { PayrollWorkspace } from "./PayrollWorkspace";
import { PayrollWorkspaceNav } from "./PayrollPageNav";
import type { PayrollSection } from "./sections";

type PayrollSearchParams = { [key: string]: string | undefined };

export async function loadPayrollPageContext({
  searchParams,
  activeSection = "run",
}: {
  searchParams: Promise<PayrollSearchParams>;
  activeSection?: PayrollSection;
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
      includeRunDetails: ["run", "report", "specialRun"].includes(activeSection),
      includeAttendanceBatches: activeSection === "attendanceSources",
    }),
    ["manual", "accountCodes", "attendance"].includes(activeSection) ? loadPayrollAccountCodeEmployees() : Promise.resolve([]),
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
  embedded = false,
}: {
  activeSection: PayrollSection;
  searchParams: Promise<PayrollSearchParams>;
  embedded?: boolean;
}) {
  const { selectedYear, payrollGroup, snapshot, payrollAccountCodeEmployees } =
    await loadPayrollPageContext({ searchParams, activeSection });

  return (
    <>
      {!embedded && <PayrollWorkspaceNav activeSection={activeSection} context={{year:String(selectedYear),periodId:snapshot.selectedPeriodId??undefined,group:payrollGroup,runId:snapshot.selectedRun?.id}}/>}
      {!embedded && activeSection === "run" && snapshot.selectedPeriodId&&<PayrollGroups periodId={snapshot.selectedPeriodId} year={selectedYear} group={payrollGroup}/>}
      <PayrollWorkspace
        key={payrollGroup}
        payrollGroup={payrollGroup}
        attendanceEnabled={process.env.ATTENDANCE_SOURCE_ENABLED === "true"}
        activeSection={activeSection}
        embedded={embedded}
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

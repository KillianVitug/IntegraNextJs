import {
  getManagerAttendanceDtrHeldRowsAction,
  getManagerAttendancePeriodDtrAction,
  listManagerDtrImportBatchesAction,
  listManagerDtrPayrollPeriodsAction,
} from "@/app/actions/attendanceImportAction";
import { PageHeader } from "@/components/layout/page-layout";
import { ManagerDtrFilesClient } from "./ManagerDtrFilesClient";

export const metadata = {
  title: "Manager Attendance",
};

function readYear(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : fallback;
}

export default async function ManagerDtrFilesPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    periodId?: string;
    employeeId?: string;
  }>;
}) {
  const params = await searchParams;
  const now = new Date();
  const year = readYear(params.year, now.getFullYear());
  const employeeId = params.employeeId?.trim() || "";
  const periodWorkspace = await listManagerDtrPayrollPeriodsAction({
    year,
    periodId: params.periodId,
  });
  const selectedPeriodId = periodWorkspace.selectedPeriodId;

  const [batches, dtr, heldRows] = selectedPeriodId
    ? await Promise.all([
        listManagerDtrImportBatchesAction(selectedPeriodId),
        getManagerAttendancePeriodDtrAction(selectedPeriodId),
        getManagerAttendanceDtrHeldRowsAction(selectedPeriodId),
      ])
    : [[], null, null];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance"
        description="Review attendance evidence for employees in your assigned departments."
      />

      <ManagerDtrFilesClient
        year={periodWorkspace.year}
        periods={periodWorkspace.periods}
        selectedPeriodId={selectedPeriodId}
        managerEmployeeCount={periodWorkspace.managerEmployeeCount}
        batches={batches}
        dtr={dtr}
        heldRows={heldRows}
        employeeId={employeeId}
      />
    </div>
  );
}

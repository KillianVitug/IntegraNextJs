import {
  getManagerAttendanceDtrHeldRowsAction,
  getManagerAttendancePeriodDtrAction,
  listManagerDtrImportBatchesAction,
  listManagerDtrPayrollPeriodsAction,
} from "@/app/actions/attendanceImportAction";
import { PageHeader } from "@/components/layout/page-layout";
import { ManagerDtrFilesClient } from "./ManagerDtrFilesClient";

export const metadata = {
  title: "Manager DTR Files",
};

function readYear(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100
    ? parsed
    : fallback;
}

function readCount(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export default async function ManagerDtrFilesPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    periodId?: string;
    employeeId?: string;
    importStatus?: string;
    imported?: string;
    denied?: string;
    holdEditEmployeeId?: string;
    holdStatus?: string;
    holdMessage?: string;
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
        title="DTR Files"
        description="Import branch DTR files and review read-only attendance summaries for your assigned departments."
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
        importStatus={params.importStatus}
        imported={readCount(params.imported)}
        denied={readCount(params.denied)}
        holdEditEmployeeId={params.holdEditEmployeeId?.trim() || ""}
        holdStatus={params.holdStatus}
        holdMessage={params.holdMessage}
      />
    </div>
  );
}

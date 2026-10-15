import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getManagerAttendanceOverview, ManagerOverviewError } from "@/lib/manager/oversight";
import { ManagerProvisionalWorkspace } from "./workspace";

export const metadata = { title: "Provisional payroll — attendance oversight" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export default async function ManagerProvisionalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  try {
    const data = await getManagerAttendanceOverview({ departmentId: params.departmentId ? Number(params.departmentId) : undefined, periodId: params.periodId, asOfDate: params.asOfDate, employeeId: params.employeeId });
    return <ManagerProvisionalWorkspace data={data} initialDay={params.day} initialView={params.view} focusedEmployeeId={params.employeeId} />;
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof ManagerOverviewError ? error.message : "Attendance oversight is temporarily unavailable. We cannot confirm attendance completeness while this read is unavailable.";
    const retry = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    return <section className="space-y-4 rounded-xl border p-5"><h1 className="text-2xl font-semibold">Provisional payroll — attendance oversight</h1><p role="alert">{message}</p><p className="text-sm text-muted-foreground">No attendance or payroll was changed.</p><div className="flex flex-wrap gap-3"><Link className="inline-flex min-h-11 items-center rounded border px-4" href={`/managerProvisional?${retry}`}>Retry this selection</Link><Link className="inline-flex min-h-11 items-center rounded border px-4" href="/managerProvisional">Choose another selection</Link><Link className="inline-flex min-h-11 items-center rounded border px-4" href="/managerHome">Manager home</Link></div></section>;
  }
}

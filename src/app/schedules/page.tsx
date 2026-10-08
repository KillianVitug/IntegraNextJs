import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getScheduleWorkspace } from "@/app/actions/scheduleWorkspaceAction";
import { requireAuthenticatedUser } from "@/lib/auth/server";
import { Header } from "@/components/Header";
import { ScheduleWorkspaceEditor } from "./schedule-workspace";

export const metadata = { title: "Schedules" };
export const maxDuration = 60;

export default async function SchedulesPage({ searchParams }: { searchParams: Promise<{ departmentId?: string; branchId?: string; periodId?: string; effectiveDate?: string; view?: string; employeeId?: string; day?: string }> }) {
  await connection();
  const auth = await requireAuthenticatedUser({ redirectTo: "/" });
  if (auth.role !== "ADMIN" && auth.role !== "MANAGER") redirect("/employeeHome");
  const params = await searchParams;
  const parsedDepartment = Number(params.departmentId ?? params.branchId);
  const workspace = await getScheduleWorkspace({ departmentId: Number.isInteger(parsedDepartment) && parsedDepartment > 0 ? parsedDepartment : undefined, periodId: params.periodId, effectiveDate: params.effectiveDate ?? params.day, employeeId: params.employeeId, day: params.day });
  return <div className="w-full min-w-0">
    {auth.role === "ADMIN" ? <Header /> : <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><Link href="/managerHome" className="font-semibold">Integra · Manager</Link><nav aria-label="Manager navigation" className="flex gap-4 text-sm"><Link href="/managerHome">Home</Link><Link href="/managerCalendar">Calendar</Link><Link href="/managerLeaves">Leave</Link></nav></header>}
    {process.env.NEXT_PUBLIC_PAYROLL_ACCEPTANCE === "true" && <p className="bg-amber-100 p-3 text-center text-sm font-semibold text-slate-900">LOCAL ACCEPTANCE COPY · Restored database</p>}
    <main className="mx-auto w-full min-w-0 max-w-[1600px] p-3 sm:p-5 lg:p-6"><ScheduleWorkspaceEditor initialWorkspace={workspace} initialView={params.view === "weekly" ? "weekly" : "period"} employeeId={params.employeeId} day={params.day} /></main>
  </div>;
}

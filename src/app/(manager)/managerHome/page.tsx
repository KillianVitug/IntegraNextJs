import { getManagerAttendanceOverview } from "@/lib/manager/oversight";
import { getManagerPendingRequests } from "@/lib/manager/pendingRequests";
import { ManagerDashboard } from "./dashboard";

export const metadata = { title: "Manager Dashboard" };

export default async function ManagerHomePage({ searchParams }: {
  searchParams: Promise<{ departmentId?: string; periodId?: string }>;
}) {
  const params = await searchParams;
  const overview = await getManagerAttendanceOverview({
    departmentId: params.departmentId === undefined ? undefined : Number(params.departmentId),
    periodId: params.periodId,
  });
  const requests = await getManagerPendingRequests(overview.departmentId);
  return <ManagerDashboard overview={overview} requests={requests} />;
}

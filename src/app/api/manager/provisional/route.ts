import { getCurrentAuthContext } from "@/lib/auth/server";
import { ManagerOverviewError, readManagerAttendanceOverview } from "@/lib/manager/oversight";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const auth = await getCurrentAuthContext();
    if (!auth) return Response.json({ error: "Sign in again to view attendance oversight." }, { status: 401, headers });
    if (auth.role !== "MANAGER") return Response.json({ error: "Manager access is required." }, { status: 403, headers });
    const query = new URL(request.url).searchParams;
    const data = await readManagerAttendanceOverview({ accountId: auth.accountId, role: auth.role }, {
      departmentId: query.has("departmentId") ? Number(query.get("departmentId")) : undefined,
      periodId: query.get("periodId") || undefined, asOfDate: query.get("asOfDate") || undefined, employeeId: query.get("employeeId") || undefined,
    });
    return Response.json(data, { headers });
  } catch (error) {
    if (error instanceof ManagerOverviewError) return Response.json({ error: error.message }, { status: 400, headers });
    // Never forward database errors, connection details or arbitrary source text.
    return Response.json({ error: "Attendance oversight is unavailable. No completeness result can be confirmed. Retry this read." }, { status: 503, headers });
  }
}

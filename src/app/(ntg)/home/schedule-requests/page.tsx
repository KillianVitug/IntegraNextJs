import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listAdminScheduleChangeRequests } from "@/app/actions/managerScheduleApprovalAction";
import { fetchShiftTables } from "@/lib/queries/fetchLookupData";
import { ScheduleRequestQueue } from "./ScheduleRequestQueue";

export const metadata = {
  title: "Schedule Request",
};

export default async function ScheduleRequestsPage() {
  const [requests, shiftTables] = await Promise.all([
    listAdminScheduleChangeRequests(),
    fetchShiftTables(),
  ]);
  const pendingCount = requests.filter((request) => request.status === "Pending").length;
  const voidedCount = requests.filter((request) => request.status === "Voided").length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          Schedule Request
        </h1>
        <p className="text-sm text-muted-foreground">
          Review manager-submitted sudden schedule requests, approve or deny
          pending changes, and void approved created overrides when needed.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending Schedule Requests</CardDescription>
            <CardTitle className="text-3xl">{pendingCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Requests waiting for Admin review before shift overrides are applied.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Voided Overrides</CardDescription>
            <CardTitle className="text-3xl">{voidedCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Approved created overrides that were later removed by Admin.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Requests</CardDescription>
            <CardTitle className="text-3xl">{requests.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Includes pending, approved, denied, cancelled, and voided requests.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Schedule Request Queue</CardTitle>
          <CardDescription>
            Approving a request updates the employee shift override using the
            existing schedule approval flow. Approved created overrides can be
            voided from this queue.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScheduleRequestQueue requests={requests} shiftTables={shiftTables} />
        </CardContent>
      </Card>
    </div>
  );
}


import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getHomeLeavePageData } from "@/lib/queries/home";
import { PendingLeaveTable } from "./PendingLeaveTable";

export const metadata = {
  title: "Leaves",
};

export default async function Leaves() {
  const data = await getHomeLeavePageData();

  const stats = [
    {
      label: "Leaves This Week",
      value: data.leavesThisWeek,
      description:
        "Approved leave records overlapping the current Monday to Sunday week.",
    },
    {
      label: "Leaves Next Month",
      value: data.leavesNextMonth,
      description:
        "Approved leave records overlapping the next calendar month.",
    },
    {
      label: "Pending Leaves",
      value: data.pendingLeaves,
      description:
        "Pending requests waiting for review in the admin leave workspace.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          Leave Requests
        </h1>
        <p className="text-sm text-muted-foreground">
          Review near-term absences and move directly into the admin leave
          workflow for pending requests.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl">{stat.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Pending Leave Queue</CardTitle>
          <CardDescription>
            Open any row to continue review in the existing leave management
            page.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <PendingLeaveTable rows={data.pendingRows} />
        </CardContent>
      </Card>
    </div>
  );
}

import { CalendarDays, Clock3, UsersRound } from "lucide-react";
import { getManagerDashboardData } from "@/app/actions/managerAction";
import { PageHeader } from "@/components/layout/page-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";

export const metadata = {
  title: "Manager Dashboard",
};

export default async function ManagerHomePage() {
  const data = await getManagerDashboardData();

  const stats = [
    {
      label: "Assigned Employees",
      value: data.employeeCount,
      description: "Employees in your assigned departments.",
      icon: UsersRound,
    },
    {
      label: "Departments",
      value: data.departmentCount,
      description: "Departments currently attached to your manager account.",
      icon: CalendarDays,
    },
    {
      label: "Pending Schedule Requests",
      value: data.pendingScheduleRequests,
      description: "Sudden schedule changes waiting for Admin action.",
      icon: Clock3,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Manager Dashboard"
        description="Department-scoped leave and schedule activity."
      />

      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;

          return (
            <Card key={stat.label}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription>{stat.label}</CardDescription>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <CardTitle className="text-2xl">{stat.value}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{stat.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Department Employees</CardTitle>
          <CardDescription>Recent employees available in your workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {data.employees.map((employee) => (
              <div key={employee.id} className="rounded-md border p-3">
                <div className="font-medium">
                  {employee.lastName}, {employee.firstName}
                </div>
                <div className="text-sm text-muted-foreground">
                  {formatEmployeeNoDisplay(employee.employeeNo)} |{" "}
                  {employee.departmentCode ?? "-"} {employee.departmentName ?? ""}
                </div>
              </div>
            ))}
            {data.employees.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No employees are available for your assigned departments.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

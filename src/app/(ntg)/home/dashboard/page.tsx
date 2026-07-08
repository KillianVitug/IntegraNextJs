
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getHomeDashboardData } from "@/lib/queries/home";

export const metadata = {
  title: "Dashboard",
};

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

function getStatusTone(status: string) {
  if (status === "Processed" || status === "Posted" || status === "Approved") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }

  if (status === "Pending" || status === "Open" || status === "Draft") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  }

  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

export default async function Dashboard() {
  const data = await getHomeDashboardData();

  const stats = [
    {
      label: "Employee Records",
      value: data.employeeRecordCount,
      description: "Non-deleted employee records currently tracked in Integra.",
    },
    {
      label: "Departments",
      value: data.departmentCount,
      description: "Configured department masters available for assignment.",
    },
    {
      label: "Pending Leave Requests",
      value: data.pendingLeaveRequestCount,
      description: "Requests waiting for admin review or status updates.",
    },
    {
      label: "Open Payroll Periods",
      value: data.openPayrollPeriodCount,
      description: "Payroll periods that are still marked open in the workspace.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Operational visibility across payroll readiness, leave activity, and
          attendance imports.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

      <div className="grid gap-6 xl:grid-cols-[1.05fr_1.2fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Upcoming Payroll Periods</CardTitle>
            <CardDescription>
              The next four payroll periods ordered by adjusted pay date.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Covered Period</TableHead>
                    <TableHead>Pay Date</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.upcomingPayrollPeriods.map((period) => (
                    <TableRow key={period.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/payroll?year=${period.year}&periodId=${period.id}`}
                          className="text-sky-700 hover:underline dark:text-sky-300"
                        >
                          {period.code}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {formatDate(period.startDate)} to{" "}
                        {formatDate(period.endDate)}
                      </TableCell>
                      <TableCell>{formatDate(period.adjustedPayDate)}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${getStatusTone(
                            period.status
                          )}`}
                        >
                          {period.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.upcomingPayrollPeriods.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-10 text-center text-muted-foreground"
                      >
                        No upcoming payroll periods are currently available.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Recent Attendance Imports</CardTitle>
            <CardDescription>
              The latest attendance files imported into the payroll workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payroll Period</TableHead>
                    <TableHead>Imported</TableHead>
                    <TableHead>Matched</TableHead>
                    <TableHead>Unmatched</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentAttendanceImports.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell>
                        <div className="font-medium">{batch.sourceFileName}</div>
                        <div className="text-xs text-muted-foreground">
                          {batch.sourceFormat}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${getStatusTone(
                            batch.status
                          )}`}
                        >
                          {batch.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        {batch.payrollPeriodId && batch.payrollPeriodYear ? (
                          <Link
                            href={`/payroll?year=${batch.payrollPeriodYear}&periodId=${batch.payrollPeriodId}`}
                            className="text-sky-700 hover:underline dark:text-sky-300"
                          >
                            {batch.payrollPeriodCode}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            Not linked
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{formatDateTime(batch.importedAt)}</TableCell>
                      <TableCell>{batch.matchedRows}</TableCell>
                      <TableCell>{batch.unmatchedRows}</TableCell>
                    </TableRow>
                  ))}
                  {data.recentAttendanceImports.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-10 text-center text-muted-foreground"
                      >
                        No attendance import batches have been recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

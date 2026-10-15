import Link from "next/link";
import type {
  getManagerAttendanceDtrHeldRowsAction,
  getManagerAttendancePeriodDtrAction,
  listManagerDtrImportBatchesAction,
  listManagerDtrPayrollPeriodsAction,
} from "@/app/actions/attendanceImportAction";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";

type Props = {
  year: number;
  periods: Awaited<ReturnType<typeof listManagerDtrPayrollPeriodsAction>>["periods"];
  selectedPeriodId: string | null;
  managerEmployeeCount: number;
  batches: Awaited<ReturnType<typeof listManagerDtrImportBatchesAction>>;
  dtr: Awaited<ReturnType<typeof getManagerAttendancePeriodDtrAction>> | null;
  heldRows: Awaited<ReturnType<typeof getManagerAttendanceDtrHeldRowsAction>> | null;
  employeeId: string;
};

function minutes(value: number) {
  return `${Math.floor(value / 60)}h ${value % 60}m`;
}

function importDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila",
  }).format(date);
}

function recordedStatus(value: string) {
  const known: Record<string, string> = {
    Present: "Present", Absent: "Absent — review evidence", "Rest Day": "Rest day",
    "Rest Day Work": "Rest day work", "No Logs": "No logs — review evidence", Hold: "Needs review",
    "Paid Leave": "Approved paid leave", "Unpaid Leave": "Approved unpaid leave",
  };
  return known[value] ?? "Review attendance details";
}

/** Server-rendered evidence view: only GET navigation, no financial write controls. */
export function ManagerDtrFilesClient({
  year, periods, selectedPeriodId, managerEmployeeCount, batches, dtr, heldRows, employeeId,
}: Props) {
  const employees = dtr?.employees ?? [];
  const employee = employeeId ? employees.find((item) => item.employeeId === employeeId) : employees[0];
  const period = periods.find((item) => item.id === selectedPeriodId);
  const reviewRows = heldRows?.rows ?? [];
  const oversightParams = new URLSearchParams();
  if (selectedPeriodId) oversightParams.set("periodId", selectedPeriodId);
  if (employee?.departmentId != null) oversightParams.set("departmentId", String(employee.departmentId));
  if (employee) oversightParams.set("employeeId", employee.employeeId);

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-medium">Attendance evidence · read-only</p>
        <p className="mt-1 text-muted-foreground">
          Share the employee, work dates and supporting evidence with Payroll Admin for corrections or Hold review.
          Opening this page does not approve attendance or calculate payroll. Missing punches and unresolved Holds do not determine whether time is unpaid.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3 min-h-11">
          <Link href={`/managerProvisional?${oversightParams.toString()}`}>Open provisional review</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Attendance period</CardTitle>
          <CardDescription>{managerEmployeeCount} employees in your assigned departments. Times are Philippine time.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/managerDtrFiles" method="get" className="grid gap-3 sm:grid-cols-[100px_minmax(0,1fr)_auto] sm:items-end">
            <div><label className="mb-1 block text-sm font-medium" htmlFor="dtr-year">Year</label><Input id="dtr-year" name="year" type="number" min={2000} max={2100} defaultValue={year} /></div>
            <div className="min-w-0">
              <label className="mb-1 block text-sm font-medium" htmlFor="dtr-period">Period</label>
              <select id="dtr-period" name="periodId" defaultValue={selectedPeriodId ?? ""} className="h-11 w-full rounded-md border bg-background px-2 text-sm">
                {periods.length === 0 ? <option value="">No periods available</option> : null}
                {periods.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.startDate} to {item.endDate}</option>)}
              </select>
            </div>
            <Button type="submit" variant="outline" className="min-h-11">View period</Button>
          </form>
          {period ? <p className="mt-3 text-sm text-muted-foreground">{period.startDate} to {period.endDate}. Stored attendance summaries may lag newly received phone records; use provisional review for current findings.</p> : <p className="mt-3 text-sm text-muted-foreground">No attendance period is available for this year.</p>}
          {managerEmployeeCount === 0 ? <p className="mt-3 text-sm">No employees are assigned to your department scope. Ask your administrator to check access.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle>Daily attendance evidence</CardTitle><CardDescription>Stored punches, schedules and recorded totals. These are evidence for review, not a pay decision.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {employees.length ? (
            <form action="/managerDtrFiles" method="get" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <input type="hidden" name="year" value={year} />
              <input type="hidden" name="periodId" value={selectedPeriodId ?? ""} />
              <div className="min-w-0">
                <label className="mb-1 block text-sm font-medium" htmlFor="dtr-employee">Employee</label>
                <select id="dtr-employee" name="employeeId" defaultValue={employee?.employeeId ?? ""} className="h-11 w-full rounded-md border bg-background px-2 text-sm">
                  {!employee ? <option value="">Select an employee</option> : null}
                  {employees.map((item) => <option key={item.employeeId} value={item.employeeId}>{item.employeeName} · {formatEmployeeNoDisplay(item.employeeNo)} · {item.departmentName ?? "No department"}</option>)}
                </select>
              </div>
              <Button type="submit" variant="outline" className="min-h-11">View employee</Button>
            </form>
          ) : <p className="text-sm text-muted-foreground">No attendance summaries are available in your assigned scope for this period. This does not establish absence.</p>}
          {employeeId && !employee ? <p className="text-sm text-muted-foreground">The requested employee is unavailable in this period and your assigned scope. Select an employee to continue.</p> : null}
          {employee ? (
            <div>
              <h2 className="font-semibold">{employee.employeeName}</h2>
              <p className="text-sm text-muted-foreground">{employee.departmentName ?? "No department"} · {formatEmployeeNoDisplay(employee.employeeNo)}</p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {employee.rows.map((row) => (
                  <article key={row.attendanceDate} id={`attendance-${row.attendanceDate}`} className="min-w-0 rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-medium">{row.attendanceDate} · {row.dayName}</h3><span className="rounded bg-muted px-2 py-1 text-xs">{recordedStatus(row.effectiveStatus)}</span></div>
                    <dl className="mt-3 grid grid-cols-2 gap-3">
                      <div><dt className="text-muted-foreground">Scheduled</dt><dd>{row.scheduledInTime && row.scheduledOutTime ? `${row.scheduledInTime} – ${row.scheduledOutTime}` : row.isRestDay ? "Rest day" : "No time configured"}</dd></div>
                      <div><dt className="text-muted-foreground">Recorded worked</dt><dd>{minutes(row.biometricWorkedMinutes)}</dd></div>
                      <div><dt className="text-muted-foreground">Effective first in / last out</dt><dd>{row.firstInAt ?? "—"} / {row.lastOutAt ?? "—"}</dd></div>
                      <div><dt className="text-muted-foreground">Recorded late / undertime</dt><dd>{minutes(row.lateMinutes)} / {minutes(row.undertimeMinutes)}</dd></div>
                      <div><dt className="text-muted-foreground">Recorded overtime</dt><dd>{minutes(row.overtimeMinutes)} · subject to review</dd></div>
                    </dl>
                    <div className="mt-3 border-t pt-2"><p className="text-xs font-medium text-muted-foreground">Punch evidence</p><p className="mt-1 break-words">{row.rawPunches.length ? row.rawPunches.join(" · ") : "No punches recorded"}</p></div>
                    {row.anomalyFlags.length ? <p className="mt-2 text-xs text-amber-800">Attendance evidence needs review. Open provisional review for the current findings.</p> : null}
                    {row.isLateOverridden || row.isUndertimeOverridden || row.isOvertimeOverridden || row.isStatusOverridden ? <p className="mt-2 text-xs text-muted-foreground">An existing saved adjustment is reflected in the recorded totals or status.</p> : null}
                    {row.holdApprovalStatus === "Approved" ? <p className="mt-2 text-xs text-muted-foreground">A prior Hold decision is recorded. This does not indicate payroll approval or payment.</p> : null}
                    <Link className="mt-3 inline-flex min-h-11 items-center text-sm underline" href={`/managerProvisional?${oversightParams.toString()}&day=${row.attendanceDate}#day-${employee?.employeeId}-${row.attendanceDate}`}>Review this work date</Link>
                  </article>
                ))}
              </div>
              {!employee.rows.length ? <p className="mt-3 text-sm text-muted-foreground">No daily records are available for this employee.</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle>Hold review and history</CardTitle><CardDescription>Existing Hold records for your assigned departments. Payroll Admin reviews unresolved evidence.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {reviewRows.map((row) => <div key={`${row.employeeId}:${row.attendanceDate}`} className="min-w-0 rounded-md border p-3 text-sm"><p className="font-medium">{row.employeeName}</p><p className="text-muted-foreground">{row.attendanceDate} · {row.departmentName ?? "No department"}</p><p className="mt-2">{row.approvalStatus === "Approved" ? "Prior Hold decision recorded" : "Needs Payroll Admin review"}</p><p className="mt-2 break-words">{row.rawPunches.length ? row.rawPunches.join(" · ") : "No punches recorded"}</p></div>)}
          {!reviewRows.length ? <p className="text-sm text-muted-foreground">No stored Hold rows for this period. Check provisional review for other attendance findings.</p> : null}
        </CardContent>
      </Card>

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer font-medium">Source processing history ({batches.length})</summary>
        <p className="mt-2 text-sm text-muted-foreground">Processing timestamps do not establish the latest phone receipt or synchronization health. Original records and detailed import diagnostics remain with Payroll Admin.</p>
        <div className="mt-3 space-y-2">
          {batches.map((batch) => <div key={batch.id} className="rounded-md border p-3 text-sm"><p className="font-medium">{batch.kind === "Admin correction" ? "Admin attendance correction" : batch.kind === "Phone sync" ? "Phone synchronization" : "Attendance import"}</p><p className="text-muted-foreground">{importDate(batch.importedAt)} · {batch.scopedMatchedRows} rows in your scope</p></div>)}
          {!batches.length ? <p className="text-sm text-muted-foreground">No source processing history is visible for this period.</p> : null}
        </div>
      </details>
    </div>
  );
}

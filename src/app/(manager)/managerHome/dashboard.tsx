import Link from "next/link";
import { PageHeader } from "@/components/layout/page-layout";
import type { getManagerAttendanceOverview } from "@/lib/manager/oversight";
import type { getManagerPendingRequests } from "@/lib/manager/pendingRequests";

type Overview = Awaited<ReturnType<typeof getManagerAttendanceOverview>>;
type Requests = Awaited<ReturnType<typeof getManagerPendingRequests>>;
const linkStyle = "inline-flex min-h-11 items-center justify-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ManagerDashboard({ overview, requests }: { overview: Overview; requests: Requests }) {
  const branch = overview.departments.find(item => item.id === overview.departmentId);
  const base = new URLSearchParams();
  if (overview.departmentId !== null) base.set("departmentId", String(overview.departmentId));
  if (overview.period) base.set("periodId", overview.period.id);
  const periodLink = (extra: Record<string, string> = {}) => {
    const query = new URLSearchParams(base);
    for (const [key, value] of Object.entries(extra)) query.set(key, value);
    return `/managerProvisional?${query.toString()}${extra.employeeId && extra.day ? `#day-${extra.employeeId}-${extra.day}` : ""}`;
  };
  const pending = requests.leaves.length + requests.schedules.length;
  const attention = [
    { label: "Days needing attention", count: overview.counts.actionDays, href: periodLink({ view: "attention" }), detail: `${overview.counts.actionEmployees} employees with unresolved attendance or schedule findings` },
    { label: "Scheduled, no attendance", count: overview.counts.scheduledNoAttendanceDays, href: periodLink({ view: "scheduled-no-attendance" }), detail: "Check received evidence; missing records do not establish absence" },
    { label: "Awaiting Admin decisions", count: pending, href: "#pending-requests", detail: "Pending leave and your schedule requests, across all dates" },
  ];

  return <div className="space-y-5">
    <PageHeader title="Manager dashboard" description="Review attendance, follow up on requests, and prepare your team's period inputs." />
    {overview.departments.length === 0 ? <section className="rounded-lg border p-4">
      <h2 className="font-semibold">No branches assigned</h2>
      <p className="mt-1 text-sm text-muted-foreground">Ask your administrator to assign your branch. Team records will appear when access is available.</p>
    </section> : <>
      <form action="/managerHome" method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-4" aria-label="Dashboard scope">
        <label className="min-w-0 flex-1 basis-48 space-y-1 text-sm font-medium">Branch
          <select name="departmentId" defaultValue={overview.departmentId ?? ""} className="block min-h-11 w-full rounded-md border bg-background px-2">
            {overview.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="min-w-0 flex-1 basis-56 space-y-1 text-sm font-medium">Payroll period
          <select name="periodId" defaultValue={overview.period?.id ?? ""} className="block min-h-11 w-full rounded-md border bg-background px-2" disabled={overview.periods.length === 0}>
            {overview.periods.length === 0 && <option value="">No payroll periods available</option>}
            {overview.periods.map(item => <option key={item.id} value={item.id}>{item.code} · {item.startDate} – {item.endDate}</option>)}
          </select>
        </label>
        <button className={linkStyle} type="submit">Open dashboard</button>
      </form>
      <div className="space-y-1 text-sm">
        <p className="font-medium">{branch?.name} · {overview.counts.employees} employees · Today {overview.today} (Philippine time)</p>
        <details className="rounded-md border px-3">
          <summary className="min-h-11 cursor-pointer py-3">Delivery completeness is unverified</summary>
          <div className="space-y-2 pb-3"><p>{overview.freshness.message}</p><p className="text-muted-foreground">{overview.scopeNotice}</p></div>
        </details>
        {overview.freshness.lastSourceSeenAt && <p className="text-xs text-muted-foreground">Latest source received: {new Date(overview.freshness.lastSourceSeenAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })} (Philippine time)</p>}
      </div>
      {!overview.period ? <section className="rounded-lg border p-4"><h2 className="font-semibold">No payroll period available</h2><p className="mt-1 text-sm">Ask Payroll Admin to prepare a period before reviewing attendance inputs.</p></section> : <>
        <section aria-labelledby="attention-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="attention-heading" className="text-lg font-semibold">Needs attention</h2><p className="text-sm text-muted-foreground">{overview.period.code} · evaluated through {overview.asOfDate}</p></div>
          <div className="grid gap-3 sm:grid-cols-3">
            {attention.map(item => <Link key={item.label} href={item.href} className="rounded-lg border p-4 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <p className="text-sm font-medium">{item.label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{item.count}</p><p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
            </Link>)}
          </div>
          <p className="text-xs text-muted-foreground">Attendance categories can overlap. Counts cover received records and configured schedules; they do not confirm every phone has synced.</p>
          {overview.issues.length > 0 ? <ul className="divide-y rounded-lg border">
            {overview.issues.slice(0, 6).map((issue, index) => <li key={`${issue.employeeId}-${issue.date}-${issue.code}-${index}`}>
              <Link className="flex min-h-14 flex-wrap items-center justify-between gap-2 p-3 hover:bg-muted" href={periodLink({ employeeId: issue.employeeId, day: issue.date })}>
                <span className="min-w-0"><span className="block break-words font-medium">{issue.name}</span><span className="block text-sm text-muted-foreground">{issue.date} · {issue.label}</span></span><span className="text-sm font-medium">Review day →</span>
              </Link>
            </li>)}
          </ul> : <p className="rounded-lg border p-4 text-sm">No unresolved attendance or schedule findings in the available inputs for this scope. Confirm source freshness before treating the period as reviewed.</p>}
          <Link href={periodLink({ view: "attention" })} className={linkStyle}>Open all attendance findings</Link>
        </section>
        <section className="rounded-lg border p-4">
          <h2 className="font-semibold">Provisional payroll — attendance review</h2>
          <p className="mt-1 text-sm text-muted-foreground">Inspect your team's recorded time, schedules and unresolved days. Financial figures are restricted. Final payroll review remains with Payroll Admin.</p>
          <Link href={periodLink()} className={`${linkStyle} mt-3`}>Open provisional review</Link>
        </section>
      </>}
      <section id="pending-requests" className="scroll-mt-4 space-y-3 rounded-lg border p-4" aria-labelledby="requests-heading">
        <h2 id="requests-heading" className="font-semibold">Awaiting Admin decisions</h2>
        <p className="text-sm text-muted-foreground">{branch?.name} · all pending dates, including older requests. Pending requests are not approved leave or confirmed schedule changes.</p>
        {pending === 0 ? <p className="text-sm">No pending requests in this branch.</p> : <ul className="divide-y">
          {requests.leaves.map(request => <li key={`leave-${request.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span className="min-w-0 break-words text-sm"><strong>{request.lastName}, {request.firstName}</strong><br />Leave · {request.startDate ?? request.dateFiled}{request.endDate ? ` – ${request.endDate}` : ""} · Pending</span>
            <Link className={linkStyle} href={`/managerLeaves?${new URLSearchParams({ year: request.dateFiled.slice(0, 4), employeeId: request.employeeId })}#leave-requests`}>Open leave requests</Link>
          </li>)}
          {requests.schedules.map(request => <li key={`schedule-${request.id}`} className="py-3 text-sm"><strong>{request.lastName}, {request.firstName}</strong><p>Your schedule {request.action.toLowerCase()} request · Pending</p><p className="break-all text-muted-foreground">Ask Payroll Admin to review this request. Reference {request.id}</p></li>)}
        </ul>}
      </section>
    </>}
    <nav aria-label="Manager workspaces" className="flex flex-wrap gap-2">
      <Link className={linkStyle} href={`/schedules?${base}`}>Schedules</Link>
      <Link className={linkStyle} href="/managerLeaves">Leave requests</Link>
      <Link className={linkStyle} href="/managerDtrFiles">Attendance history</Link>
      <Link className={linkStyle} href="/managerCalendar">Planning calendar</Link>
    </nav>
  </div>;
}

import { ensureDefaultLeaveTypes } from "@/lib/payroll/leave";
import { fetchLeaveTypes } from "@/lib/queries/fetchLookupData";
import {
  getManagerEmployees,
  getManagerLeaveBalanceSummary,
  getManagerLeaveRecordsByYear,
} from "@/app/actions/managerAction";
import { PageHeader } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";

export const metadata = {
  title: "Manager Leave Requests",
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readYear(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2100
    ? parsed
    : new Date().getFullYear();
}

function estimateDays(startDate: string, endDate: string) {
  if (!startDate) return 1;
  const start = new Date(`${startDate}T00:00:00`);
  const end = endDate ? new Date(`${endDate}T00:00:00`) : start;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;

  const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return diff > 0 ? diff : 1;
}

function statusMessage(status: string | undefined) {
  if (status === "created") return "Leave request submitted.";
  if (status === "updated") return "Leave request updated.";
  if (status === "cancelled") return "Leave request cancelled.";
  return null;
}

function employeeLabel(employee: {
  employeeNo: string;
  firstName: string;
  lastName: string;
}) {
  return `${employee.lastName}, ${employee.firstName} (${formatEmployeeNoDisplay(
    employee.employeeNo,
  )})`;
}

function leaveTypeLabel(leaveType: { code: string; name: string }) {
  return `${leaveType.code} | ${leaveType.name}`;
}

export default async function ManagerLeavesPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    employeeId?: string;
    leaveType?: string;
    leaveStartDate?: string;
    leaveEndDate?: string;
    reason?: string;
    editLeaveId?: string;
    status?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const year = readYear(params.year);
  await ensureDefaultLeaveTypes();
  const [employees, leaveTypes, records] = await Promise.all([
    getManagerEmployees(),
    fetchLeaveTypes(),
    getManagerLeaveRecordsByYear(year),
  ]);
  const editRecordId = Number(params.editLeaveId);
  const editRecord = Number.isInteger(editRecordId)
    ? records.find((record) => record.id === editRecordId) ?? null
    : null;
  const defaultEmployeeId =
    editRecord?.employeeId ?? params.employeeId ?? employees[0]?.id ?? "";
  const defaultLeaveType =
    editRecord?.leaveType ?? params.leaveType ?? leaveTypes[0]?.code ?? "";
  const selectedEmployee = employees.find(
    (employee) => employee.id === defaultEmployeeId,
  );
  const selectedLeaveType = leaveTypes.find(
    (leaveType) => leaveType.code === defaultLeaveType,
  );
  const defaultStartDate =
    editRecord?.leaveStartDate ?? params.leaveStartDate ?? todayKey();
  const defaultEndDate =
    editRecord?.leaveEndDate ?? params.leaveEndDate ?? "";
  const defaultReason = editRecord?.reason ?? params.reason ?? "";
  const dateFiled = editRecord?.dateFiled ?? todayKey();
  const noOfDays = estimateDays(defaultStartDate, defaultEndDate);
  const selectedYear = defaultStartDate
    ? new Date(`${defaultStartDate}T00:00:00`).getFullYear()
    : year;
  const balanceSummary =
    defaultEmployeeId && defaultLeaveType
      ? await getManagerLeaveBalanceSummary(defaultEmployeeId, selectedYear)
      : null;
  const availableBalance =
    balanceSummary?.data?.find((item) => item.code === defaultLeaveType)
      ?.balance ?? 0;
  const message = statusMessage(params.status);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Manager Leave Requests"
        description="File pending leave requests for employees in your assigned departments."
      />

      {message ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {params.error}
        </div>
      ) : null}

      <form
        action="/managerLeaves"
        className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
        method="get"
      >
        <input type="hidden" name="year" value={year} />
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="balance-employee">
            Employee
          </label>
          <select
            id="balance-employee"
            name="employeeId"
            defaultValue={defaultEmployeeId}
            className="flex h-11 w-full rounded-md border bg-background px-3 py-2 text-base md:h-9 md:py-1 md:text-sm"
          >
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employeeLabel(employee)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="balance-type">
            Leave Type
          </label>
          <select
            id="balance-type"
            name="leaveType"
            defaultValue={defaultLeaveType}
            className="flex h-11 w-full rounded-md border bg-background px-3 py-2 text-base md:h-9 md:py-1 md:text-sm"
          >
            {leaveTypes.map((leaveType) => (
              <option key={leaveType.id} value={leaveType.code}>
                {leaveType.code} | {leaveType.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm" className="min-h-11 md:min-h-8">
          Check Balance
        </Button>
      </form>

      <form
        action="/managerLeaves/request"
        className="space-y-3 rounded-md border p-3"
        method="post"
      >
        <input type="hidden" name="year" value={year} />
        {editRecord ? <input type="hidden" name="id" value={editRecord.id} /> : null}
        <input type="hidden" name="employeeId" value={defaultEmployeeId} />
        <input type="hidden" name="leaveType" value={defaultLeaveType} />
        <div>
          <h2 className="text-lg font-semibold">
            {editRecord ? "Edit Leave Request" : "New Leave Request"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Pending leave requests can be updated or cancelled before approval.
          </p>
        </div>
        <div className="grid items-start gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-employee">
              Employee
            </label>
            <Input
              id="leave-employee"
              value={selectedEmployee ? employeeLabel(selectedEmployee) : ""}
              readOnly
              className="cursor-not-allowed bg-muted text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-date-filed">
              Date Filed
            </label>
            <Input
              id="leave-date-filed"
              name="dateFiled"
              type="date"
              defaultValue={dateFiled}
              readOnly
              className="cursor-not-allowed bg-muted text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-type">
              Leave Type
            </label>
            <Input
              id="leave-type"
              value={selectedLeaveType ? leaveTypeLabel(selectedLeaveType) : defaultLeaveType}
              readOnly
              className="cursor-not-allowed bg-muted text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-start">
              Leave Start
            </label>
            <Input
              id="leave-start"
              name="leaveStartDate"
              type="date"
              defaultValue={defaultStartDate}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-end">
              Leave End
            </label>
            <Input
              id="leave-end"
              name="leaveEndDate"
              type="date"
              defaultValue={defaultEndDate}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-days">
              Chargeable Days
            </label>
            <Input id="leave-days" value={noOfDays} readOnly />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Available Balance</label>
            <Input value={availableBalance.toFixed(2)} readOnly />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-reason">
              Reason
            </label>
            <Textarea
              id="leave-reason"
              name="reason"
              defaultValue={defaultReason}
              required
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button type="submit" disabled={employees.length === 0} className="min-h-11">
            {editRecord ? "Update Request" : "Submit Request"}
          </Button>
          {editRecord ? (
            <>
              <Button asChild type="button" variant="outline" className="min-h-11">
                <a href={`/managerLeaves?year=${year}`}>Cancel Edit</a>
              </Button>
              <Button
                formAction="/managerLeaves/request/cancel"
                type="submit"
                variant="destructive"
                className="min-h-11"
              >
                Cancel Request
              </Button>
            </>
            ) : null}
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  function parseDateKey(value) {
    var parts;
    if (!value || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return null;
    parts = value.split("-");
    return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  }

  function estimateDays(startValue, endValue) {
    var start = parseDateKey(startValue);
    var end = endValue ? parseDateKey(endValue) : start;
    var diff;
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return 1;
    diff = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    return diff > 0 ? diff : 1;
  }

  function updateChargeableDays() {
    var start = document.getElementById("leave-start");
    var end = document.getElementById("leave-end");
    var days = document.getElementById("leave-days");
    if (!start || !end || !days) return;
    days.value = String(estimateDays(start.value, end.value));
  }

  function bind() {
    var start = document.getElementById("leave-start");
    var end = document.getElementById("leave-end");
    if (!start || !end) return;
    start.addEventListener("change", updateChargeableDays, false);
    start.addEventListener("input", updateChargeableDays, false);
    end.addEventListener("change", updateChargeableDays, false);
    end.addEventListener("input", updateChargeableDays, false);
    updateChargeableDays();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind, false);
  } else {
    bind();
  }
})();`,
          }}
        />
      </form>

      <div className="rounded-md border">
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">Department Leave Requests</h2>
          <form
            action="/managerLeaves"
            className="flex w-full items-end gap-2 sm:w-auto"
            method="get"
          >
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="leave-year">
                Year
              </label>
              <Input
                id="leave-year"
                name="year"
                type="number"
                min={1900}
                max={2100}
                defaultValue={year}
                className="w-full sm:w-28"
              />
            </div>
            <Button type="submit" variant="outline" size="sm" className="min-h-11 md:min-h-8">
              Apply
            </Button>
          </form>
        </div>
        <div className="grid gap-2 p-3 md:hidden">
          {records.map((record) => (
            <div key={record.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="break-words font-medium">
                    {record.lastName}, {record.firstName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatEmployeeNoDisplay(record.employeeNo)}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs">
                  {record.leaveStatus}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Type</div>
                  <div className="font-medium">
                    {record.leaveTypeName ?? record.leaveType}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Days</div>
                  <div className="font-medium">{record.noOfDays}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground">Dates</div>
                  <div className="font-medium">
                    {record.leaveStartDate}
                    {record.leaveEndDate ? ` to ${record.leaveEndDate}` : ""}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground">Reason</div>
                  <div className="break-words">{record.reason || "-"}</div>
                </div>
              </div>
              <div className="mt-3">
                {record.leaveStatus === "Pending" ? (
                  <Button asChild variant="outline" size="sm" className="min-h-10 w-full">
                    <a href={`/managerLeaves?year=${year}&editLeaveId=${record.id}`}>
                      Edit
                    </a>
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Locked</span>
                )}
              </div>
            </div>
          ))}
          {records.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No leave requests found for this year.
            </div>
          ) : null}
        </div>
        <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.id}>
                <TableCell>
                  {record.lastName}, {record.firstName}
                  <div className="text-xs text-muted-foreground">
                    {formatEmployeeNoDisplay(record.employeeNo)}
                  </div>
                </TableCell>
                <TableCell>{record.leaveTypeName ?? record.leaveType}</TableCell>
                <TableCell>
                  {record.leaveStartDate}
                  {record.leaveEndDate ? ` to ${record.leaveEndDate}` : ""}
                </TableCell>
                <TableCell>{record.noOfDays}</TableCell>
                <TableCell>{record.leaveStatus}</TableCell>
                <TableCell>{record.reason || "-"}</TableCell>
                <TableCell>
                  {record.leaveStatus === "Pending" ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={`/managerLeaves?year=${year}&editLeaveId=${record.id}`}>
                        Edit
                      </a>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Locked</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No leave requests found for this year.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import {
  getManagerEmployees,
  getManagerScheduleRequests,
  listManagerWeeklyShiftPatterns,
} from "@/app/actions/managerAction";
import { fetchShiftTables } from "@/lib/queries/fetchLookupData";
import { buildShiftAssignmentSnapshotFromTable } from "@/lib/shifts";
import { PageHeader } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  cancelManagerScheduleRequestFromForm,
  deleteManagerWeeklyPatternFromForm,
  saveManagerWeeklyPatternFromForm,
  submitManagerScheduleRequestFromForm,
  updateManagerScheduleRequestFromForm,
} from "./actions";

export const metadata = {
  title: "Manager Schedules",
};

const WEEKDAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function buildEmployeeLabel(employee: {
  employeeNo: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
}) {
  return `${formatEmployeeNoDisplay(employee.employeeNo)} | ${employee.lastName}, ${
    employee.firstName
  }${employee.middleName ? ` ${employee.middleName}` : ""}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function statusMessage(status: string | undefined) {
  if (status === "weekly-saved") return "Weekly schedule saved.";
  if (status === "weekly-deleted") return "Weekly schedule deleted.";
  if (status === "request-created") return "Schedule request submitted.";
  if (status === "request-updated") return "Schedule request updated.";
  if (status === "request-cancelled") return "Schedule request cancelled.";
  return null;
}

function formatDaySummary(day: {
  shiftTableId: number | null;
  shiftCode: string | null;
  shiftName: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
} | undefined) {
  if (!day) return "Off";
  if (!day.shiftTableId && !day.checkInTime && !day.checkOutTime) return "Off";
  if (day.shiftCode && day.checkInTime && day.checkOutTime) {
    return `${day.shiftCode} ${day.checkInTime}-${day.checkOutTime}`;
  }
  if (day.shiftName) return day.shiftName;
  if (day.checkInTime && day.checkOutTime) {
    return `${day.checkInTime}-${day.checkOutTime}`;
  }
  return "Off";
}

function normalizeDateKeys(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

function expandDateRange(startDate: string, endDate: string | null | undefined) {
  if (!endDate || endDate <= startDate) return [startDate];

  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (current <= end && dates.length < 370) {
    dates.push(
      `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(
        2,
        "0",
      )}-${String(current.getDate()).padStart(2, "0")}`,
    );
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function getRequestEffectiveDates(request: {
  payload: {
    effectiveDates?: string[];
    effectiveFrom: string;
    effectiveTo?: string | null;
  };
}) {
  return normalizeDateKeys(
    request.payload.effectiveDates?.length
      ? request.payload.effectiveDates
      : expandDateRange(request.payload.effectiveFrom, request.payload.effectiveTo),
  );
}

function formatEffectiveDateSummary(dates: string[]) {
  if (dates.length === 0) return "No dates selected";
  if (dates.length === 1) return dates[0];
  if (dates.length <= 4) return dates.join(", ");
  return `${dates.length} dates: ${dates.slice(0, 3).join(", ")}...`;
}

function isEditableRequest(request: {
  status: string;
  action: string;
}) {
  return request.status === "Pending" && request.action === "Create";
}

export default async function ManagerSchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{
    employeeId?: string;
    editPatternId?: string;
    editRequestId?: string;
    status?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const [employees, shiftTables] = await Promise.all([
    getManagerEmployees(),
    fetchShiftTables(),
  ]);
  const selectedEmployee =
    employees.find((employee) => employee.id === params.employeeId) ??
    employees[0] ??
    null;

  const [patterns, requests] = selectedEmployee
    ? await Promise.all([
        listManagerWeeklyShiftPatterns(selectedEmployee.id),
        getManagerScheduleRequests(),
      ])
    : [[], []];
  const selectedPatternId = Number(params.editPatternId);
  const selectedPattern = Number.isInteger(selectedPatternId)
    ? patterns.find((pattern) => pattern.id === selectedPatternId) ?? null
    : null;
  const selectedRequest =
    params.editRequestId
      ? requests.find(
          (request) =>
            request.id === params.editRequestId &&
            request.employeeId === selectedEmployee?.id &&
            isEditableRequest(request),
        ) ?? null
      : null;
  const patternDayMap = new Map(
    selectedPattern?.days.map((day) => [
      day.weekday,
      day.shiftTableId ? String(day.shiftTableId) : "0",
    ]) ?? [],
  );
  const requestEffectiveDates = selectedRequest
    ? getRequestEffectiveDates(selectedRequest)
    : [todayKey()];
  const message = statusMessage(params.status);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Manager Schedules"
        description="Manage fixed weekly schedules directly and submit sudden schedule changes for Admin approval."
      />

      <Card>
        <CardHeader>
          <CardTitle>Employee Selection</CardTitle>
          <CardDescription>
            Choose an employee from your assigned departments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {employees.map((employee) => (
              <Button
                key={employee.id}
                asChild
                variant={selectedEmployee?.id === employee.id ? "default" : "outline"}
                size="sm"
              >
                <Link href={`/managerSchedules?employeeId=${employee.id}`}>
                  {employee.lastName}, {employee.firstName}
                </Link>
              </Button>
            ))}
            {employees.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No employees are available for your assigned departments.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

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

      {selectedEmployee ? (
        <>
          <div>
            <h2 className="text-base font-semibold">
              {buildEmployeeLabel(selectedEmployee)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {selectedEmployee.departmentCode ?? "-"} |{" "}
              {selectedEmployee.departmentName ?? "No department"}
            </p>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Weekly Schedule Manager</CardTitle>
              <CardDescription>
                Base repeating Monday-Sunday schedule for{" "}
                {buildEmployeeLabel(selectedEmployee)}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                action={saveManagerWeeklyPatternFromForm}
                className="space-y-4"
              >
                <input type="hidden" name="employeeId" value={selectedEmployee.id} />
                {selectedPattern ? (
                  <input type="hidden" name="id" value={selectedPattern.id} />
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label
                      className="mb-2 block text-sm font-medium"
                      htmlFor="weekly-effective-from"
                    >
                      Effective From
                    </label>
                    <Input
                      id="weekly-effective-from"
                      name="effectiveFrom"
                      type="date"
                      defaultValue={selectedPattern?.effectiveFrom ?? ""}
                      required
                    />
                  </div>
                  <div>
                    <label
                      className="mb-2 block text-sm font-medium"
                      htmlFor="weekly-effective-to"
                    >
                      Effective To
                    </label>
                    <Input
                      id="weekly-effective-to"
                      name="effectiveTo"
                      type="date"
                      defaultValue={selectedPattern?.effectiveTo ?? ""}
                    />
                  </div>
                </div>

                <div className="space-y-3 rounded-md border p-4">
                  {WEEKDAY_ORDER.map((weekday) => (
                    <div
                      key={weekday}
                      className="grid gap-3 border-b pb-3 last:border-b-0 last:pb-0 md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1.2fr)]"
                    >
                      <div className="font-medium">{weekday}</div>
                      <div>
                        <select
                          className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                          name={`day-${weekday}`}
                          defaultValue={patternDayMap.get(weekday) ?? "0"}
                        >
                          <option value="0">Off / Rest Day</option>
                          {shiftTables.map((shiftTable) => (
                            <option key={`${weekday}-${shiftTable.id}`} value={shiftTable.id}>
                              {shiftTable.code} | {shiftTable.description}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {shiftTables.length === 0
                          ? "Create shift tables first from Settings before saving a weekly schedule."
                          : "Select the normal recurring shift for this weekday."}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={shiftTables.length === 0}>
                    {selectedPattern ? "Update Weekly Schedule" : "Save Weekly Schedule"}
                  </Button>
                  {selectedPattern ? (
                    <Button asChild variant="outline">
                      <Link href={`/managerSchedules?employeeId=${selectedEmployee.id}`}>
                        Cancel Edit
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Existing Weekly Schedules</CardTitle>
              <CardDescription>
                Weekly schedules provide the normal recurring pattern.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Coverage</TableHead>
                      <TableHead>Mon</TableHead>
                      <TableHead>Tue</TableHead>
                      <TableHead>Wed</TableHead>
                      <TableHead>Thu</TableHead>
                      <TableHead>Fri</TableHead>
                      <TableHead>Sat</TableHead>
                      <TableHead>Sun</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patterns.map((pattern) => {
                      const dayMap = new Map(
                        pattern.days.map((day) => [day.weekday, day]),
                      );

                      return (
                        <TableRow key={pattern.id}>
                          <TableCell className="align-top">
                            <div>{pattern.effectiveFrom}</div>
                            <div className="text-xs text-muted-foreground">
                              to {pattern.effectiveTo || "open"}
                            </div>
                          </TableCell>
                          {WEEKDAY_ORDER.map((weekday) => (
                            <TableCell
                              key={`${pattern.id}-${weekday}`}
                              className="align-top text-sm"
                            >
                              {formatDaySummary(dayMap.get(weekday))}
                            </TableCell>
                          ))}
                          <TableCell className="align-top">
                            <div className="flex flex-wrap gap-2">
                              <Button asChild variant="outline" size="sm">
                                <Link
                                  href={`/managerSchedules?employeeId=${selectedEmployee.id}&editPatternId=${pattern.id}`}
                                >
                                  Edit
                                </Link>
                              </Button>
                              <form action={deleteManagerWeeklyPatternFromForm}>
                                <input
                                  type="hidden"
                                  name="employeeId"
                                  value={selectedEmployee.id}
                                />
                                <input type="hidden" name="id" value={pattern.id} />
                                <Button type="submit" variant="destructive" size="sm">
                                  Delete
                                </Button>
                              </form>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {patterns.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                          No weekly schedules recorded for this employee.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <form
            action={
              selectedRequest
                ? updateManagerScheduleRequestFromForm
                : submitManagerScheduleRequestFromForm
            }
            className="space-y-3 rounded-md border p-3"
          >
            <input type="hidden" name="employeeId" value={selectedEmployee.id} />
            {selectedRequest ? (
              <input type="hidden" name="requestId" value={selectedRequest.id} />
            ) : null}
            <div>
              <h2 className="text-lg font-semibold">
                Sudden Schedule Change Request
              </h2>
              <p className="text-sm text-muted-foreground">
                Requests stay pending until Admin approval.
              </p>
            </div>
            <div className="grid items-start gap-x-4 gap-y-3 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="request-shift-table">
                  Shift Table
                </label>
                <select
                  id="request-shift-table"
                  name="shiftTableId"
                  defaultValue={selectedRequest?.payload.shiftTableId ?? 0}
                  required
                  className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
                >
                  <option value={0}>Select shift table</option>
                  {shiftTables.map((shiftTable) => {
                    const metrics = buildShiftAssignmentSnapshotFromTable(shiftTable);

                    return (
                      <option key={shiftTable.id} value={shiftTable.id}>
                        {shiftTable.code} | {shiftTable.description} |{" "}
                        {metrics.checkInTime ?? "-"}-{metrics.checkOutTime ?? "-"} |{" "}
                        {metrics.hoursPerDay.toFixed(2)} hrs
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="request-dates">
                  Effective Date/s
                </label>
                <Textarea
                  id="request-dates"
                  name="effectiveDates"
                  defaultValue={requestEffectiveDates.join(", ")}
                  required
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Use YYYY-MM-DD dates separated by commas, spaces, or new lines.
                </p>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="request-reason">
                Reason
              </label>
              <Textarea
                id="request-reason"
                name="reason"
                defaultValue={selectedRequest?.reason ?? ""}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button type="submit" disabled={shiftTables.length === 0}>
                {selectedRequest ? "Update Request" : "Submit Request"}
              </Button>
              {selectedRequest ? (
                <>
                  <Button asChild variant="outline">
                    <Link href={`/managerSchedules?employeeId=${selectedEmployee.id}`}>
                      Cancel Edit
                    </Link>
                  </Button>
                  <Button
                    formAction={cancelManagerScheduleRequestFromForm}
                    type="submit"
                    variant="destructive"
                  >
                    Cancel Request
                  </Button>
                </>
              ) : null}
            </div>
          </form>

          <div className="rounded-md border p-3">
            <div>
              <h2 className="text-lg font-semibold">Submitted Schedule Requests</h2>
              <p className="text-sm text-muted-foreground">
                Pending created requests can be edited before Admin approval.
              </p>
            </div>
            <div className="mt-3 space-y-2">
              {requests
                .filter((request) => request.employeeId === selectedEmployee.id)
                .map((request) => {
                  const editable = isEditableRequest(request);
                  const effectiveDates = getRequestEffectiveDates(request);

                  return (
                    <div
                      key={request.id}
                      className="rounded-md border p-3 text-sm"
                    >
                      <div className="font-medium">
                        {request.action} | {request.status}
                      </div>
                      <div>Shift Table: #{request.payload.shiftTableId}</div>
                      <div className="text-muted-foreground">
                        Effective Date/s: {formatEffectiveDateSummary(effectiveDates)}
                      </div>
                      {request.reason ? <div>Reason: {request.reason}</div> : null}
                      {request.decisionNote ? (
                        <div>Decision: {request.decisionNote}</div>
                      ) : null}
                      {editable ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button asChild variant="outline" size="sm">
                            <Link
                              href={`/managerSchedules?employeeId=${selectedEmployee.id}&editRequestId=${request.id}`}
                            >
                              Edit
                            </Link>
                          </Button>
                          <form action={cancelManagerScheduleRequestFromForm}>
                            <input
                              type="hidden"
                              name="employeeId"
                              value={selectedEmployee.id}
                            />
                            <input
                              type="hidden"
                              name="requestId"
                              value={request.id}
                            />
                            <Button type="submit" variant="destructive" size="sm">
                              Cancel
                            </Button>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              {requests.filter((request) => request.employeeId === selectedEmployee.id)
                .length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No schedule requests submitted yet.
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

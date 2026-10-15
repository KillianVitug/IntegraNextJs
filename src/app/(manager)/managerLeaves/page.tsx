import { asc } from "drizzle-orm";
import { db } from "@/db";
import { leaveTypes } from "@/db/schema";
import { getManagerEmployees, getManagerLeaveRecordsByYear } from "@/app/actions/managerAction";
import { PageHeader } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";
import { ManagerLeaveForm } from "./ManagerLeaveForm";
import { manilaToday, type LeaveFormState } from "./form-state";

export const metadata = { title: "Manager Leave Requests" };

export default async function ManagerLeavesPage({ searchParams }: {
  searchParams: Promise<{ year?: string; employeeId?: string; editLeaveId?: string; error?: string }>;
}) {
  const params = await searchParams;
  const today = manilaToday();
  const parsedYear = Number(params.year);
  const year = Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100 ? parsedYear : Number(today.slice(0, 4));
  // Authenticate and derive the team before loading page data. Browsing never seeds leave policies.
  const employees = await getManagerEmployees();
  const [types, allRecords] = await Promise.all([
    db.select({ id: leaveTypes.id, code: leaveTypes.code, name: leaveTypes.name }).from(leaveTypes).orderBy(asc(leaveTypes.code)),
    getManagerLeaveRecordsByYear(year),
  ]);
  const selectedEmployee = employees.find((employee) => employee.id === params.employeeId);
  const records = params.employeeId ? allRecords.filter((record) => record.employeeId === selectedEmployee?.id) : allRecords;
  const editRecord = allRecords.find((record) => record.id === Number(params.editLeaveId) && record.leaveStatus === "Pending" && record.canEdit);
  const initialState: LeaveFormState = { revision: 0, values: {
    id: editRecord ? String(editRecord.id) : "", year: String(year),
    employeeId: editRecord?.employeeId ?? selectedEmployee?.id ?? "",
    leaveType: editRecord?.leaveType ?? "", dateFiled: editRecord?.dateFiled ?? today,
    leaveStartDate: editRecord?.leaveStartDate ?? today, leaveEndDate: editRecord?.leaveEndDate ?? "",
    dayPart: editRecord?.dayPart ?? "FullDay", reason: editRecord?.reason ?? "",
  } };
  return (
    <div className="space-y-4">
      <PageHeader title="Manager Leave Requests" description="File pending leave requests for employees in your assigned departments." />
      {params.editLeaveId && !editRecord ? <p role="alert" className="rounded-md border p-3 text-sm">This request is unavailable for editing. It may no longer be pending or may be outside your current authority.</p> : null}
      {params.employeeId ? <p className="text-sm">{selectedEmployee ? "Showing requests for the selected employee." : "The selected employee is outside your current team."} <a className="underline" href={`/managerLeaves?year=${year}#leave-requests`}>Show all team requests</a></p> : null}
      {params.error ? <p role="alert" className="rounded-md border p-3 text-sm">The earlier form could not be saved. Use the current form below.</p> : null}
      <ManagerLeaveForm key={params.editLeaveId ?? `new-${selectedEmployee?.id ?? ""}`} employees={employees} leaveTypes={types} initialState={initialState} permalink={`/managerLeaves?year=${year}${params.editLeaveId ? `&editLeaveId=${encodeURIComponent(params.editLeaveId)}` : ""}`} />
      <div id="leave-requests" className="rounded-md border">
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">{selectedEmployee ? `${selectedEmployee.lastName}, ${selectedEmployee.firstName} - leave requests` : "Department leave requests"}</h2>
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
                {record.leaveStatus === "Pending" && record.canEdit ? (
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
                  {record.leaveStatus === "Pending" && record.canEdit ? (
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

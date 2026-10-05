import {
  getManagerEmployees,
  getManagerPayrollPeriodScheduleGridData,
  getManagerWeeklyScheduleGridData,
  listManagerWeeklyShiftPatterns,
} from "@/app/actions/managerAction";
import { fetchShiftTables } from "@/lib/queries/fetchLookupData";
import { PageHeader } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
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
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";
import { PayrollPeriodScheduleForm } from "./PayrollPeriodScheduleForm";
import { WeeklyBaseScheduleForm } from "./WeeklyBaseScheduleForm";
import type { WeeklyBaseScheduleGridRow } from "./WeeklyBaseScheduleGrid";
import type { WeeklyScheduleShiftOption } from "./WeeklyScheduleGridSelect";
import {
  WEEKLY_BASE_SCHEDULE_WEEKDAYS,
  type WeeklyBaseScheduleWeekday,
} from "./weekdays";

export const metadata = {
  title: "Manager Schedules",
};

const WEEKDAY_ORDER = WEEKLY_BASE_SCHEDULE_WEEKDAYS;
type WeekdayName = WeeklyBaseScheduleWeekday;

type PayrollPeriodScheduleGridData = Awaited<
  ReturnType<typeof getManagerPayrollPeriodScheduleGridData>
>;

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

function statusMessage(status: string | undefined) {
  if (status === "weekly-saved") return "Weekly schedule saved.";
  if (status === "weekly-grid-saved") return "Weekly base schedule saved.";
  if (status === "period-grid-saved") return "Payroll period schedule saved.";
  if (status === "period-grid-unchanged") return "No payroll period schedule changes to save.";
  if (status === "weekly-deleted") return "Weekly schedule deleted.";
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

export default async function ManagerSchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{
    employeeId?: string;
    editPatternId?: string;
    status?: string;
    error?: string;
    tab?: string;
    periodId?: string;
  }>;
}) {
  const params = await searchParams;
  const activeTab = params.tab === "weeklySchedule" ? "weeklySchedule" : "schedules";
  const [employees, shiftTables] = await Promise.all([
    getManagerEmployees(),
    fetchShiftTables(),
  ]);
  const selectedEmployee =
    employees.find((employee) => employee.id === params.employeeId) ??
    employees[0] ??
    null;

  let patterns: Awaited<ReturnType<typeof listManagerWeeklyShiftPatterns>> = [];
  let weeklyScheduleRows: Awaited<
    ReturnType<typeof getManagerWeeklyScheduleGridData>
  > = [];
  let periodScheduleGrid: PayrollPeriodScheduleGridData | null = null;

  if (activeTab === "schedules" && selectedEmployee) {
    patterns = await listManagerWeeklyShiftPatterns(selectedEmployee.id);
  } else if (activeTab === "weeklySchedule") {
    [weeklyScheduleRows, periodScheduleGrid] = await Promise.all([
      getManagerWeeklyScheduleGridData(),
      getManagerPayrollPeriodScheduleGridData({ periodId: params.periodId }),
    ]);
  }

  const selectedPatternId = Number(params.editPatternId);
  const selectedPattern = Number.isInteger(selectedPatternId)
    ? patterns.find((pattern) => pattern.id === selectedPatternId) ?? null
    : patterns[0] ?? null;
  const isEditingPattern = Boolean(params.editPatternId && selectedPattern);
  const patternDayMap = new Map(
    selectedPattern?.days.map((day) => [
      day.weekday,
      day.shiftTableId ? String(day.shiftTableId) : "0",
    ]) ?? [],
  );
  const message = statusMessage(params.status);
  const weeklyScheduleShiftOptions: WeeklyScheduleShiftOption[] = shiftTables.map(
    (shiftTable) => ({
      id: shiftTable.id,
      code: shiftTable.code,
      description: shiftTable.description,
      regularStartTime: shiftTable.regularStartTime,
      regularEndTime: shiftTable.regularEndTime,
    }),
  );
  const periodGridDates = periodScheduleGrid?.dates ?? [];
  const periodGridRows =
    periodScheduleGrid?.rows.map((row) => ({
      id: row.id,
      employeeLabel: buildEmployeeLabel(row),
      departmentCode: row.departmentCode,
      departmentName: row.departmentName,
      cells: row.cells.map((cell) => ({
        date: cell.date,
        currentValue: cell.currentValue,
      })),
    })) ?? [];
  const weeklyBaseScheduleRows: WeeklyBaseScheduleGridRow[] =
    weeklyScheduleRows.map((row) => ({
      id: row.id,
      employeeLabel: buildEmployeeLabel(row),
      departmentCode: row.departmentCode,
      departmentName: row.departmentName,
      days:
        row.weeklyPattern?.days.map((day) => ({
          weekday: day.weekday as WeekdayName,
          shiftTableId: day.shiftTableId,
        })) ?? [],
    }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Manager Schedules"
        description="Manage fixed weekly schedules directly and submit sudden schedule changes for Admin approval."
      />

      <div className="grid gap-2 border-b pb-2 sm:flex sm:flex-wrap">
        <Button
          asChild
          variant={activeTab === "schedules" ? "default" : "ghost"}
          size="sm"
          className="min-h-11 justify-center sm:min-h-8"
        >
          <a
            href={
              selectedEmployee
                ? `/managerSchedules?employeeId=${selectedEmployee.id}`
                : "/managerSchedules"
            }
          >
            Individual Employee Schedules
          </a>
        </Button>
        <Button
          asChild
          variant={activeTab === "weeklySchedule" ? "default" : "ghost"}
          size="sm"
          className="min-h-11 justify-center sm:min-h-8"
        >
          <a href="/managerSchedules?tab=weeklySchedule">Weekly Base Schedule</a>
        </Button>
      </div>

      {activeTab === "schedules" ? (
        <Card>
        <CardHeader>
          <CardTitle>Employee Selection</CardTitle>
          <CardDescription>
            Choose an employee from your assigned departments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            {employees.map((employee) => (
              <Button
                key={employee.id}
                asChild
                variant={selectedEmployee?.id === employee.id ? "default" : "outline"}
                size="sm"
                className="min-h-10 justify-center"
              >
                <a href={`/managerSchedules?employeeId=${employee.id}`}>
                  {employee.lastName}, {employee.firstName}
                </a>
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
      ) : null}

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

      {activeTab === "weeklySchedule" ? (
        <>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Weekly Base Schedule</CardTitle>
            <CardDescription>
              Set the base Monday-Sunday schedule for employees in your assigned
              departments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WeeklyBaseScheduleForm
              rows={weeklyBaseScheduleRows}
              shiftTables={weeklyScheduleShiftOptions}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Payroll Period Schedule</CardTitle>
            <CardDescription>
              Review and adjust date-specific schedules using the weekly schedule
              grid as the base.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form action="/managerSchedules" method="get" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="tab" value="weeklySchedule" />
              <div className="min-w-0 sm:min-w-72">
                <label
                  className="mb-1.5 block text-sm font-medium"
                  htmlFor="weekly-period"
                >
                  Payroll Period
                </label>
                <select
                  id="weekly-period"
                  name="periodId"
                  defaultValue={periodScheduleGrid?.selectedPeriodId ?? ""}
                  className="flex h-11 w-full rounded-md border bg-background px-3 py-2 text-base md:h-9 md:py-1 md:text-sm"
                >
                  {periodScheduleGrid?.periods.length ? (
                    periodScheduleGrid.periods.map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.code} | {period.startDate} to {period.endDate}
                      </option>
                    ))
                  ) : (
                    <option value="">No payroll periods available</option>
                  )}
                </select>
              </div>
                <Button
                type="submit"
                disabled={!periodScheduleGrid?.periods.length}
                className="min-h-11 md:min-h-9"
              >
                Apply
              </Button>
            </form>

            {periodScheduleGrid?.selectedPeriod ? (
              <PayrollPeriodScheduleForm
                periodId={periodScheduleGrid.selectedPeriod.id}
                periodLabel={`${periodScheduleGrid.selectedPeriod.code} | ${periodScheduleGrid.selectedPeriod.startDate} to ${periodScheduleGrid.selectedPeriod.endDate}`}
                dates={periodGridDates}
                rows={periodGridRows}
                shiftTables={weeklyScheduleShiftOptions}
              />
            ) : (
              <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                No payroll periods are available for {periodScheduleGrid?.year ?? new Date().getFullYear()}.
              </div>
            )}
          </CardContent>
        </Card>
        </>
      ) : null}

      {activeTab === "schedules" && selectedEmployee ? (
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
                action="/managerSchedules/weekly-schedule"
                className="space-y-4"
                method="post"
              >
                <input type="hidden" name="employeeId" value={selectedEmployee.id} />
                {selectedPattern ? (
                  <input type="hidden" name="id" value={selectedPattern.id} />
                ) : null}
                <div className="space-y-3 rounded-md border p-3 sm:p-4">
                  {WEEKDAY_ORDER.map((weekday) => (
                    <div
                      key={weekday}
                    className="grid gap-2 border-b pb-3 last:border-b-0 last:pb-0 md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1.2fr)] md:gap-3"
                    >
                      <div className="font-medium">{weekday}</div>
                      <div>
                        <select
                          className="flex h-11 w-full rounded-md border bg-background px-3 py-2 text-base md:h-10 md:text-sm"
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

                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <Button type="submit" disabled={shiftTables.length === 0} className="min-h-11">
                    {selectedPattern ? "Update Weekly Schedule" : "Save Weekly Schedule"}
                  </Button>
                  {isEditingPattern ? (
                    <Button asChild variant="outline" className="min-h-11">
                      <a href={`/managerSchedules?employeeId=${selectedEmployee.id}`}>
                        Cancel Edit
                      </a>
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
              <div className="grid gap-2 p-4 md:hidden">
                {patterns.map((pattern) => {
                  const dayMap = new Map(
                    pattern.days.map((day) => [day.weekday, day]),
                  );

                  return (
                    <div key={`mobile-${pattern.id}`} className="rounded-md border p-3 text-sm">
                      <div className="font-medium">
                        {pattern.effectiveFrom} to {pattern.effectiveTo || "open"}
                      </div>
                      <div className="mt-3 grid gap-2">
                        {WEEKDAY_ORDER.map((weekday) => (
                          <div
                            key={`${pattern.id}-mobile-${weekday}`}
                            className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0"
                          >
                            <span className="font-medium">{weekday}</span>
                            <span className="text-right text-muted-foreground">
                              {formatDaySummary(dayMap.get(weekday))}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button asChild variant="outline" size="sm" className="min-h-10">
                          <a
                            href={`/managerSchedules?employeeId=${selectedEmployee.id}&editPatternId=${pattern.id}`}
                          >
                            Edit
                          </a>
                        </Button>
                        <form
                          action="/managerSchedules/weekly-schedule/delete"
                          method="post"
                        >
                          <input
                            type="hidden"
                            name="employeeId"
                            value={selectedEmployee.id}
                          />
                          <input type="hidden" name="id" value={pattern.id} />
                          <Button
                            type="submit"
                            variant="destructive"
                            size="sm"
                            className="min-h-10 w-full"
                          >
                            Delete
                          </Button>
                        </form>
                      </div>
                    </div>
                  );
                })}
                {patterns.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No weekly schedules recorded for this employee.
                  </div>
                ) : null}
              </div>
              <div className="hidden overflow-x-auto md:block">
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
                                <a
                                  href={`/managerSchedules?employeeId=${selectedEmployee.id}&editPatternId=${pattern.id}`}
                                >
                                  Edit
                                </a>
                              </Button>
                              <form
                                action="/managerSchedules/weekly-schedule/delete"
                                method="post"
                              >
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

        </>
      ) : null}
    </div>
  );
}

import type { getManagerCalendarMonth } from "@/app/actions/managerAction";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ClipboardCheck,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";

type ManagerCalendarMonth = Awaited<
  ReturnType<typeof getManagerCalendarMonth>
>;
type CalendarDay = ManagerCalendarMonth["days"][number];
type CalendarEmployee = CalendarDay["employees"][number];

type Props = {
  data: ManagerCalendarMonth;
  initialSelectedDate: string;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildCalendarHref(args: {
  year: number;
  month: number;
  day?: string;
}) {
  const params = new URLSearchParams({
    year: String(args.year),
    month: String(args.month),
  });

  if (args.day) {
    params.set("day", args.day);
  }

  return `/managerCalendar?${params.toString()}`;
}

function getMonthOffset(year: number, month: number, offset: number) {
  const next = new Date(year, month - 1 + offset, 1);
  return {
    year: next.getFullYear(),
    month: next.getMonth() + 1,
  };
}

function getLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatEmployeeName(employee: CalendarEmployee) {
  return `${employee.lastName}, ${employee.firstName}${
    employee.middleName ? ` ${employee.middleName}` : ""
  }`;
}

function formatTimeRange(employee: CalendarEmployee) {
  if (employee.isRestDay) return "Rest / Off";
  if (employee.checkInTime && employee.checkOutTime) {
    return `${employee.checkInTime} - ${employee.checkOutTime}`;
  }

  return "No time set";
}

function formatScheduleLabel(employee: CalendarEmployee) {
  if (employee.isRestDay) return "Rest / Off day";
  if (employee.shiftCode && employee.shiftName) {
    return `${employee.shiftCode} | ${employee.shiftName}`;
  }
  if (employee.shiftCode) return employee.shiftCode;
  if (employee.shiftName) return employee.shiftName;
  if (employee.source === "LEGACY") return "Legacy timekeeping";
  return "Scheduled";
}

function formatHours(value: number) {
  return `${value.toFixed(2)} h`;
}

function sourceLabel(source: CalendarEmployee["source"]) {
  if (source === "OVERRIDE") return "Approved Override";
  if (source === "WEEKLY_PATTERN") return "Weekly Schedule";
  return "Legacy";
}

function sourceClassName(source: CalendarEmployee["source"]) {
  if (source === "OVERRIDE") {
    return "border-amber-300 bg-amber-50 text-amber-900";
  }
  if (source === "WEEKLY_PATTERN") {
    return "border-sky-300 bg-sky-50 text-sky-900";
  }
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function formatLeaveQuantity(value: number) {
  return `${value.toFixed(2)} day${value === 1 ? "" : "s"}`;
}

function formatDayDescription(day: CalendarDay | null) {
  if (!day) return "Select a day to view schedules.";

  const parts = [`${day.date} | ${day.employeeCount} employees`];
  if (day.approvedLeaveEmployeeCount > 0) {
    parts.push(`${day.approvedLeaveEmployeeCount} on approved leave`);
  }

  return parts.join(" | ");
}

export function ManagerCalendarClient({ data, initialSelectedDate }: Props) {
  const selectedDate = initialSelectedDate;
  const todayKey = getLocalDateKey(new Date());
  const dayMap = new Map(data.days.map((day) => [day.date, day]));
  const selectedDay = dayMap.get(selectedDate) ?? data.days[0] ?? null;
  const leadingBlankCount = data.startDate
    ? new Date(`${data.startDate}T00:00:00`).getDay()
    : 0;
  const previousMonth = getMonthOffset(data.year, data.month, -1);
  const nextMonth = getMonthOffset(data.year, data.month, 1);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarDays className="h-5 w-5" />
                {data.monthLabel}
              </CardTitle>
              <CardDescription>
                {data.employeeCount} employees covered from {data.startDate} to{" "}
                {data.endDate}.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="icon" asChild>
                <Link
                  aria-label="Previous month"
                  href={buildCalendarHref(previousMonth)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Link>
              </Button>

              <form action="/managerCalendar" className="flex items-center gap-2">
                <input type="hidden" name="month" value={data.month} />
                <Input
                  aria-label="Calendar year"
                  className="w-24 text-center font-semibold"
                  inputMode="numeric"
                  max={2100}
                  min={1900}
                  name="year"
                  type="number"
                  defaultValue={data.year}
                />
                <Button type="submit" variant="outline" size="sm">
                  Go
                </Button>
              </form>

              <Button variant="outline" size="icon" asChild>
                <Link aria-label="Next month" href={buildCalendarHref(nextMonth)}>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-7 gap-1.5 pb-2">
                {WEEKDAY_LABELS.map((weekday) => (
                  <div
                    key={weekday}
                    className="px-2 text-center text-xs font-semibold uppercase text-muted-foreground"
                  >
                    {weekday}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: leadingBlankCount }, (_, index) => (
                  <div
                    key={`blank-${index}`}
                    className="min-h-28 rounded-md border border-dashed bg-muted/20"
                  />
                ))}

                {data.days.map((day) => {
                  const isSelected = selectedDate === day.date;
                  const isToday = todayKey === day.date;

                  return (
                    <Link
                      key={day.date}
                      aria-pressed={isSelected}
                      href={buildCalendarHref({
                        year: data.year,
                        month: data.month,
                        day: day.date,
                      })}
                      className={cn(
                        "block min-h-28 rounded-md border bg-background p-2.5 text-left transition hover:border-primary hover:bg-accent/40",
                        isSelected &&
                          "border-primary bg-primary text-primary-foreground hover:bg-primary",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-base font-semibold">
                          {day.dayOfMonth}
                        </span>
                        {isToday ? (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              isSelected
                                ? "bg-primary-foreground text-primary"
                                : "bg-emerald-100 text-emerald-800",
                            )}
                          >
                            Today
                          </span>
                        ) : null}
                      </div>

                      <div
                        className={cn(
                          "mt-3 space-y-0.5 text-xs",
                          isSelected
                            ? "text-primary-foreground/90"
                            : "text-muted-foreground",
                        )}
                      >
                        <div className="flex items-center gap-1">
                          <UsersRound className="h-3.5 w-3.5" />
                          {day.employeeCount} covered
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {day.workingCount} working
                        </div>
                        <div>{day.overrideCount} overrides</div>
                        <div>{day.restDayCount} rest/off</div>
                        <div className="flex items-center gap-1">
                          <ClipboardCheck className="h-3.5 w-3.5" />
                          {day.approvedLeaveEmployeeCount} leaves
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Day Schedule</CardTitle>
          <CardDescription>{formatDayDescription(selectedDay)}</CardDescription>
        </CardHeader>
        <CardContent>
          {selectedDay ? (
            <div className="space-y-2">
              {selectedDay.employees.map((employee) => (
                <div
                  key={employee.employeeId}
                  className="rounded-md border p-2.5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {formatEmployeeName(employee)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatEmployeeNoDisplay(employee.employeeNo)} |{" "}
                        {employee.departmentCode ?? "-"}{" "}
                        {employee.departmentName ?? "No department"}
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                      {employee.hasApprovedLeave ? (
                        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900">
                          Approved Leave
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs font-medium",
                          sourceClassName(employee.source),
                        )}
                      >
                        {sourceLabel(employee.source)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Schedule</div>
                      <div className="font-medium">
                        {formatScheduleLabel(employee)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Time</div>
                      <div className="font-medium">{formatTimeRange(employee)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Hours</div>
                      <div className="font-medium">
                        {formatHours(employee.hoursPerDay)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Status</div>
                      <div className="font-medium">
                        {employee.isRestDay ? "Rest / Off" : "Working"}
                      </div>
                    </div>
                  </div>

                  {employee.source === "OVERRIDE" ? (
                    <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Effective {employee.overrideEffectiveFrom} to{" "}
                      {employee.overrideEffectiveTo ?? "ongoing"}
                    </div>
                  ) : null}

                  {employee.approvedLeaves.length > 0 ? (
                    <div className="mt-2 space-y-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-950">
                      {employee.approvedLeaves.map((leave) => (
                        <div key={leave.leaveRecordId}>
                          <div className="font-medium">
                            {leave.leaveTypeName ?? leave.leaveType} |{" "}
                            {leave.dayPart} | {formatLeaveQuantity(leave.quantity)}
                          </div>
                          {leave.reason ? (
                            <div className="mt-1 text-emerald-900">
                              Reason: {leave.reason}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}

              {selectedDay.employees.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No employees are available for this manager workspace.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No calendar dates are available.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

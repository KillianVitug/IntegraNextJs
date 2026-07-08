"use client";

import type { getBranchCalendarMonth } from "@/lib/queries/branchCalendar";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ClipboardCheck,
  Save,
  Search,
  Trash2,
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
import {
  clearBranchCalendarAccountCodeOverrideAction,
  saveBranchCalendarHolidayCheckDatesAction,
  saveBranchCalendarAccountCodeOverrideAction,
} from "./actions";

type BranchCalendarMonth = Awaited<
  ReturnType<typeof getBranchCalendarMonth>
>;
type CalendarDay = BranchCalendarMonth["days"][number];
type CalendarEmployee = CalendarDay["employees"][number];
type CalendarHoliday = CalendarDay["holidays"][number];

type Props = {
  data: BranchCalendarMonth;
  initialSelectedDate: string;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildCalendarHref(args: {
  year: number;
  month: number;
  day?: string;
  departmentId?: number | null;
}) {
  const params = new URLSearchParams({
    year: String(args.year),
    month: String(args.month),
  });

  if (args.day) {
    params.set("day", args.day);
  }

  if (args.departmentId) {
    params.set("departmentId", String(args.departmentId));
  }

  return `/branchCalendar?${params.toString()}`;
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

function formatHolidayDateRange(holiday: CalendarHoliday) {
  if (!holiday.holidayDate2 || holiday.holidayDate2 === holiday.holidayDate) {
    return holiday.holidayDate;
  }

  return `${holiday.holidayDate} to ${holiday.holidayDate2}`;
}

function formatHolidayCheckDateLabel(holiday: CalendarHoliday) {
  const labels = [
    holiday.requireCheckDate1
      ? `Check 1: ${holiday.checkDate1 ?? "Required"}`
      : null,
    holiday.requireCheckDate2
      ? `Check 2: ${holiday.checkDate2 ?? "Required"}`
      : null,
  ].filter(Boolean);

  return labels.length > 0 ? labels.join(" | ") : "No required check dates";
}

function formatDayDescription(day: CalendarDay | null) {
  if (!day) return "Select a day to view schedules and holidays.";

  const parts = [`${day.date} | ${day.employeeCount} employees`];
  if (day.holidays.length > 0) {
    parts.push(
      `${day.holidays.length} holiday${day.holidays.length === 1 ? "" : "s"}`,
    );
  }
  if (day.approvedLeaveEmployeeCount > 0) {
    parts.push(`${day.approvedLeaveEmployeeCount} on approved leave`);
  }

  return parts.join(" | ");
}

function submitSelectForm(form: HTMLFormElement | null) {
  if (!form) return;

  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
    return;
  }

  form.submit();
}

function formatAccountOptionLabel(
  option: { code: string; accountType?: string | null; description: string | null },
) {
  return [
    option.code,
    option.accountType,
    option.description,
  ].filter(Boolean).join(" | ");
}

function HolidayCheckDateEditor({
  holiday,
  onSaved,
}: {
  holiday: CalendarHoliday;
  onSaved: () => void;
}) {
  const [isSaving, startTransition] = useTransition();
  const [checkDate1, setCheckDate1] = useState(holiday.checkDate1 ?? "");
  const [checkDate2, setCheckDate2] = useState(holiday.checkDate2 ?? "");
  const [requireCheckDate1, setRequireCheckDate1] = useState(
    holiday.requireCheckDate1,
  );
  const [requireCheckDate2, setRequireCheckDate2] = useState(
    holiday.requireCheckDate2,
  );

  useEffect(() => {
    setCheckDate1(holiday.checkDate1 ?? "");
    setCheckDate2(holiday.checkDate2 ?? "");
    setRequireCheckDate1(holiday.requireCheckDate1);
    setRequireCheckDate2(holiday.requireCheckDate2);
  }, [
    holiday.id,
    holiday.checkDate1,
    holiday.checkDate2,
    holiday.requireCheckDate1,
    holiday.requireCheckDate2,
  ]);

  function handleSave() {
    if (requireCheckDate1 && !checkDate1) {
      toast.error("Enter Check Date 1.");
      return;
    }
    if (requireCheckDate2 && !checkDate2) {
      toast.error("Enter Check Date 2.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await saveBranchCalendarHolidayCheckDatesAction({
          id: holiday.id,
          checkDate1,
          checkDate2,
          requireCheckDate1,
          requireCheckDate2,
        });
        toast.success(result.message);
        onSaved();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to save holiday check dates.",
        );
      }
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-rose-200 bg-white/70 p-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">
          <span>Check Date 1</span>
          <Input
            type="date"
            value={checkDate1}
            onChange={(event) => setCheckDate1(event.currentTarget.value)}
            disabled={isSaving}
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          <span>Check Date 2</span>
          <Input
            type="date"
            value={checkDate2}
            onChange={(event) => setCheckDate2(event.currentTarget.value)}
            disabled={isSaving}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3 text-xs font-medium">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={requireCheckDate1}
            onChange={(event) => setRequireCheckDate1(event.currentTarget.checked)}
            disabled={isSaving}
          />
          Require Check Date 1
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={requireCheckDate2}
            onChange={(event) => setRequireCheckDate2(event.currentTarget.checked)}
            disabled={isSaving}
          />
          Require Check Date 2
        </label>
      </div>

      <Button type="button" size="sm" onClick={handleSave} disabled={isSaving}>
        <Save className="mr-2 h-4 w-4" />
        {isSaving ? "Saving..." : "Save Check Dates"}
      </Button>
    </div>
  );
}

export function BranchCalendarClient({ data, initialSelectedDate }: Props) {
  const router = useRouter();
  const [isSavingAccountCodes, startAccountCodeTransition] = useTransition();
  const selectedDate = initialSelectedDate;
  const todayKey = getLocalDateKey(new Date());
  const dayMap = new Map(data.days.map((day) => [day.date, day]));
  const selectedDay = dayMap.get(selectedDate) ?? data.days[0] ?? null;
  const leadingBlankCount = data.startDate
    ? new Date(`${data.startDate}T00:00:00`).getDay()
    : 0;
  const previousMonth = getMonthOffset(data.year, data.month, -1);
  const nextMonth = getMonthOffset(data.year, data.month, 1);
  const selectedDepartment = data.departments.find(
    (department) => department.id === data.selectedDepartmentId,
  );
  const departmentLabel = selectedDepartment
    ? `${selectedDepartment.code} | ${selectedDepartment.name}`
    : "All Departments";

  const [employeeQuery, setEmployeeQuery] = useState("");
  useEffect(() => setEmployeeQuery(""), [selectedDate]);

  const effectiveAccountCodeOverride =
    selectedDay?.accountCodeOverride.effective ?? null;
  const directAccountCodeOverride = selectedDay?.accountCodeOverride.direct ?? null;
  const inheritedAccountCodeOverride =
    selectedDay?.accountCodeOverride.inherited ?? null;
  const [regularAccountCodeId, setRegularAccountCodeId] = useState("");
  const [overtimeAccountCodeId, setOvertimeAccountCodeId] = useState("");

  useEffect(() => {
    setRegularAccountCodeId(
      effectiveAccountCodeOverride?.regularAccountCodeId
        ? String(effectiveAccountCodeOverride.regularAccountCodeId)
        : "",
    );
    setOvertimeAccountCodeId(
      effectiveAccountCodeOverride?.overtimeAccountCodeId
        ? String(effectiveAccountCodeOverride.overtimeAccountCodeId)
        : "",
    );
  }, [
    selectedDate,
    effectiveAccountCodeOverride?.regularAccountCodeId,
    effectiveAccountCodeOverride?.overtimeAccountCodeId,
  ]);

  function handleSaveAccountCodes() {
    if (!selectedDay) return;
    const regularId = Number(regularAccountCodeId);
    const overtimeId = Number(overtimeAccountCodeId);

    if (!Number.isInteger(regularId) || regularId <= 0) {
      toast.error("Select a Regular Hours account code.");
      return;
    }
    if (!Number.isInteger(overtimeId) || overtimeId <= 0) {
      toast.error("Select an Overtime account code.");
      return;
    }

    startAccountCodeTransition(async () => {
      try {
        const result = await saveBranchCalendarAccountCodeOverrideAction({
          attendanceDate: selectedDay.date,
          departmentId: data.selectedDepartmentId,
          regularAccountCodeId: regularId,
          overtimeAccountCodeId: overtimeId,
        });
        toast.success(result.message);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to save day account codes.",
        );
      }
    });
  }

  function handleClearAccountCodes() {
    if (!selectedDay || !directAccountCodeOverride) return;

    startAccountCodeTransition(async () => {
      try {
        const result = await clearBranchCalendarAccountCodeOverrideAction({
          attendanceDate: selectedDay.date,
          departmentId: data.selectedDepartmentId,
        });
        toast.success(result.message);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to clear day account codes.",
        );
      }
    });
  }

  const normalizedEmployeeQuery = employeeQuery.trim().toLowerCase();
  const filteredEmployees = selectedDay
    ? selectedDay.employees.filter((employee) => {
        if (!normalizedEmployeeQuery) return true;
        const haystack = [
          formatEmployeeName(employee),
          employee.employeeNo,
          formatEmployeeNoDisplay(employee.employeeNo),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedEmployeeQuery);
      })
    : [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarDays className="h-5 w-5" />
                {data.monthLabel}
              </CardTitle>
              <CardDescription>
                {data.employeeCount} employees covered from {data.startDate} to{" "}
                {data.endDate} in {departmentLabel}.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="icon" asChild>
                <Link
                  aria-label="Previous month"
                  href={buildCalendarHref({
                    ...previousMonth,
                    departmentId: data.selectedDepartmentId,
                  })}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Link>
              </Button>

              <form action="/branchCalendar" className="flex items-center gap-2">
                <input type="hidden" name="month" value={data.month} />
                {data.selectedDepartmentId ? (
                  <input
                    type="hidden"
                    name="departmentId"
                    value={data.selectedDepartmentId}
                  />
                ) : null}
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
                <Link
                  aria-label="Next month"
                  href={buildCalendarHref({
                    ...nextMonth,
                    departmentId: data.selectedDepartmentId,
                  })}
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>

              <form action="/branchCalendar" className="flex items-center gap-2">
                <input type="hidden" name="year" value={data.year} />
                <input type="hidden" name="month" value={data.month} />
                {selectedDate ? (
                  <input type="hidden" name="day" value={selectedDate} />
                ) : null}
                <select
                  aria-label="Filter by department"
                  className="h-9 min-w-52 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
                  name="departmentId"
                  defaultValue={data.selectedDepartmentId ?? ""}
                  onChange={(event) => submitSelectForm(event.currentTarget.form)}
                >
                  <option value="">All Departments</option>
                  {data.departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.code} | {department.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline" size="sm">
                  Apply
                </Button>
              </form>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
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
                    className="min-h-32 rounded-md border border-dashed bg-muted/20"
                  />
                ))}

                {data.days.map((day) => {
                  const isSelected = selectedDate === day.date;
                  const isToday = todayKey === day.date;
                  const firstHoliday = day.holidays[0] ?? null;
                  const firstCheckDate = day.holidayCheckDates[0] ?? null;

                  return (
                    <Link
                      key={day.date}
                      aria-pressed={isSelected}
                      href={buildCalendarHref({
                        year: data.year,
                        month: data.month,
                        day: day.date,
                        departmentId: data.selectedDepartmentId,
                      })}
                      className={cn(
                        "block min-h-32 rounded-md border bg-background p-2.5 text-left transition hover:border-primary hover:bg-accent/40",
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

                      {firstHoliday ? (
                        <div
                          className={cn(
                            "mt-2 rounded-md px-2 py-1 text-xs font-medium",
                            isSelected
                              ? "bg-primary-foreground/15 text-primary-foreground"
                              : "bg-rose-50 text-rose-900",
                          )}
                        >
                          <div className="flex items-center gap-1">
                            <CalendarCheck className="h-3.5 w-3.5" />
                            <span className="truncate">{firstHoliday.name}</span>
                          </div>
                          {day.holidays.length > 1 ? (
                            <div className="mt-0.5">
                              +{day.holidays.length - 1} more
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {firstCheckDate ? (
                        <div
                          className={cn(
                            "mt-2 rounded-md px-2 py-1 text-xs font-medium",
                            isSelected
                              ? "bg-primary-foreground/15 text-primary-foreground"
                              : "bg-sky-50 text-sky-900",
                          )}
                        >
                          <div className="flex items-center gap-1">
                            <CalendarClock className="h-3.5 w-3.5" />
                            <span className="truncate">
                              Check {firstCheckDate.checkDateNumber}:{" "}
                              {firstCheckDate.holidayName}
                            </span>
                          </div>
                          {day.holidayCheckDates.length > 1 ? (
                            <div className="mt-0.5">
                              +{day.holidayCheckDates.length - 1} more
                            </div>
                          ) : null}
                        </div>
                      ) : null}

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
        <CardContent className="max-h-[70vh] overflow-y-auto">
          {selectedDay ? (
            <div className="space-y-3">
              {selectedDay.holidays.length > 0 ? (
                <div className="space-y-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
                  <div className="flex items-center gap-2 font-semibold">
                    <CalendarCheck className="h-4 w-4" />
                    Holidays
                  </div>
                  {selectedDay.holidays.map((holiday) => (
                    <div key={`${holiday.id}-${selectedDay.date}`}>
                      <div className="font-medium">{holiday.name}</div>
                      <div className="text-xs text-rose-900">
                        {holiday.holidayType} |{" "}
                        {holiday.isPaid ? "Paid holiday" : "Unpaid holiday"} |{" "}
                        {formatHolidayDateRange(holiday)}
                      </div>
                      <div className="mt-1 text-xs text-rose-900">
                        {formatHolidayCheckDateLabel(holiday)}
                      </div>
                      <HolidayCheckDateEditor
                        holiday={holiday}
                        onSaved={() => router.refresh()}
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              {selectedDay.holidayCheckDates.length > 0 ? (
                <div className="space-y-1 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                  <div className="flex items-center gap-2 font-semibold">
                    <CalendarClock className="h-4 w-4" />
                    Holiday Check Dates
                  </div>
                  {selectedDay.holidayCheckDates.map((checkDate) => (
                    <div
                      key={`${checkDate.holidayId}-${checkDate.checkDateNumber}`}
                      className="text-xs text-sky-900"
                    >
                      Check {checkDate.checkDateNumber} for{" "}
                      {checkDate.holidayName} |{" "}
                      {checkDate.holidayDate2
                        ? `${checkDate.holidayDate} to ${checkDate.holidayDate2}`
                        : checkDate.holidayDate}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Day Account Codes</div>
                    <div className="text-xs text-muted-foreground">
                      {data.selectedDepartmentId
                        ? `Scope: ${departmentLabel}`
                        : "Scope: All Departments"}
                    </div>
                  </div>
                  {directAccountCodeOverride ? (
                    <span className="rounded-full border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-900">
                      Direct
                    </span>
                  ) : inheritedAccountCodeOverride ? (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
                      Inherited
                    </span>
                  ) : null}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1 text-xs font-medium">
                    <span>Regular Hours</span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
                      value={regularAccountCodeId}
                      onChange={(event) =>
                        setRegularAccountCodeId(event.currentTarget.value)
                      }
                      disabled={isSavingAccountCodes}
                    >
                      <option value="">Select account code</option>
                      {data.regularAccountCodeOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {formatAccountOptionLabel(option)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-xs font-medium">
                    <span>Overtime</span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
                      value={overtimeAccountCodeId}
                      onChange={(event) =>
                        setOvertimeAccountCodeId(event.currentTarget.value)
                      }
                      disabled={isSavingAccountCodes}
                    >
                      <option value="">Select account code</option>
                      {data.overtimeAccountCodeOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {formatAccountOptionLabel(option)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {effectiveAccountCodeOverride ? (
                  <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    Effective:{" "}
                    {effectiveAccountCodeOverride.regularAccount.code} /{" "}
                    {effectiveAccountCodeOverride.overtimeAccount.code}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveAccountCodes}
                    disabled={isSavingAccountCodes || !selectedDay}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {isSavingAccountCodes ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleClearAccountCodes}
                    disabled={isSavingAccountCodes || !directAccountCodeOverride}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear
                  </Button>
                </div>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search by name or employee no."
                  className="pl-8"
                  value={employeeQuery}
                  onChange={(event) => setEmployeeQuery(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                {filteredEmployees.map((employee) => (
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

                    <div className="mt-2 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Schedule
                        </div>
                        <div className="font-medium">
                          {formatScheduleLabel(employee)}
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
                              {leave.dayPart} |{" "}
                              {formatLeaveQuantity(leave.quantity)}
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
                    No employees are available for the selected department.
                  </p>
                ) : filteredEmployees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No employees match your search.
                  </p>
                ) : null}
              </div>
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

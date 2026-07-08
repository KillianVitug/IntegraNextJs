"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { SelectShiftTableSchemaType } from "@/zod-schemas/shiftTable";
import {
  deleteEmployeeWeeklyShiftPattern,
  saveEmployeeWeeklyShiftPattern,
} from "@/app/actions/shiftAssignmentAction";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildShiftAssignmentSnapshotFromTable } from "@/lib/shifts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const WEEKDAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

type WeekdayName = (typeof WEEKDAY_ORDER)[number];

type WeeklyPatternDayRow = {
  id: number;
  weekday: string;
  shiftTableId: number | null;
  shiftName: string | null;
  shiftCode: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  breakMinutes: number;
  paidBreakMinutes: number;
  hoursPerDay: string;
};

type WeeklyPatternRow = {
  id: number;
  employeeId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  days: WeeklyPatternDayRow[];
};

type Props = {
  employeeId: string;
  employeeLabel: string;
  initialPatterns: WeeklyPatternRow[];
};

type FormState = {
  id?: number;
  effectiveFrom: string;
  effectiveTo: string;
  days: Record<WeekdayName, string>;
};

function buildEmptyDays(): Record<WeekdayName, string> {
  return {
    Monday: "0",
    Tuesday: "0",
    Wednesday: "0",
    Thursday: "0",
    Friday: "0",
    Saturday: "0",
    Sunday: "0",
  };
}

const EMPTY_FORM: FormState = {
  effectiveFrom: "",
  effectiveTo: "",
  days: buildEmptyDays(),
};

function mapPatternToForm(pattern: WeeklyPatternRow): FormState {
  const days = buildEmptyDays();

  for (const day of pattern.days) {
    if (WEEKDAY_ORDER.includes(day.weekday as WeekdayName)) {
      days[day.weekday as WeekdayName] = day.shiftTableId
        ? String(day.shiftTableId)
        : "0";
    }
  }

  return {
    id: pattern.id,
    effectiveFrom: pattern.effectiveFrom,
    effectiveTo: pattern.effectiveTo ?? "",
    days,
  };
}

function formatDaySummary(day: WeeklyPatternDayRow | undefined) {
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

export function WeeklyShiftPatternManager({
  employeeId,
  employeeLabel,
  initialPatterns,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [shiftTables, setShiftTables] = useState<SelectShiftTableSchemaType[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    async function loadShiftTables() {
      try {
        const response = await fetch("/api/constants/shiftTable");
        const data = await response.json();
        setShiftTables(data);
      } catch (error) {
        console.error("Unable to load shift tables", error);
      }
    }

    void loadShiftTables();
  }, []);

  const shiftTableMap = useMemo(
    () => new Map(shiftTables.map((shiftTable) => [shiftTable.id, shiftTable])),
    [shiftTables]
  );

  const orderedPatterns = useMemo(
    () =>
      [...initialPatterns]
        .map((pattern) => ({
          ...pattern,
          dayMap: new Map(pattern.days.map((day) => [day.weekday, day])),
        }))
        .sort((left, right) => {
          const fromComparison = right.effectiveFrom.localeCompare(left.effectiveFrom);
          if (fromComparison !== 0) return fromComparison;
          return right.id - left.id;
        }),
    [initialPatterns]
  );

  const dayPreviews = useMemo(
    () =>
      WEEKDAY_ORDER.map((weekday) => {
        const selectedShiftTableId = Number(form.days[weekday]);
        const shiftTable =
          selectedShiftTableId > 0
            ? shiftTableMap.get(selectedShiftTableId) ?? null
            : null;
        const snapshot = shiftTable
          ? buildShiftAssignmentSnapshotFromTable(shiftTable)
          : null;

        return {
          weekday,
          shiftTable,
          snapshot,
        };
      }),
    [form.days, shiftTableMap]
  );

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateDay(weekday: WeekdayName, value: string) {
    setForm((current) => ({
      ...current,
      days: {
        ...current.days,
        [weekday]: value,
      },
    }));
  }

  function resetForm() {
    setForm({
      ...EMPTY_FORM,
      days: buildEmptyDays(),
    });
  }

  function handleEdit(pattern: WeeklyPatternRow) {
    setForm(mapPatternToForm(pattern));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        await saveEmployeeWeeklyShiftPattern({
          id: form.id,
          employeeId,
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo || null,
          days: WEEKDAY_ORDER.map((weekday) => ({
            weekday,
            shiftTableId: Number(form.days[weekday]) || null,
          })),
        });

        toast.success(form.id ? "Weekly schedule updated." : "Weekly schedule created.");
        resetForm();
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to save weekly schedule.");
      }
    });
  }

  function handleDelete(id: number) {
    if (!window.confirm("Delete this weekly schedule?")) return;

    startTransition(async () => {
      try {
        await deleteEmployeeWeeklyShiftPattern({ id });
        toast.success("Weekly schedule deleted.");
        if (form.id === id) {
          resetForm();
        }
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Unable to delete weekly schedule."
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Weekly Schedule Manager</CardTitle>
          <CardDescription>
            Base repeating Monday-Sunday schedule for {employeeLabel}. Date-based shift
            overrides still take priority when they overlap.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">Effective From</label>
                <Input
                  type="date"
                  value={form.effectiveFrom}
                  onChange={(event) => updateField("effectiveFrom", event.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Effective To</label>
                <Input
                  type="date"
                  value={form.effectiveTo}
                  onChange={(event) => updateField("effectiveTo", event.target.value)}
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
                      value={form.days[weekday]}
                      onChange={(event) => updateDay(weekday, event.target.value)}
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
                    {(() => {
                      const preview = dayPreviews.find((item) => item.weekday === weekday);

                      if (!preview?.shiftTable || !preview.snapshot) {
                        return "No scheduled shift. Payroll and attendance will treat this as an off/rest day unless an override exists.";
                      }

                      return `${preview.shiftTable.code} | ${preview.shiftTable.description} | ${preview.snapshot.checkInTime ?? "-"}-${preview.snapshot.checkOutTime ?? "-"} | ${preview.snapshot.hoursPerDay.toFixed(2)} hrs${preview.snapshot.breakMinutes > 0 ? ` | Break ${preview.snapshot.breakMinutes} mins` : ""}`;
                    })()}
                  </div>
                </div>
              ))}
            </div>

            {shiftTables.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Create shift tables first from Settings &gt; TimeKeeping Menu before saving
                a weekly schedule.
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={isPending || shiftTables.length === 0}>
                {isPending ? "Saving..." : form.id ? "Update Weekly Schedule" : "Save Weekly Schedule"}
              </Button>
              <Button type="button" variant="outline" disabled={isPending} onClick={resetForm}>
                Reset
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Existing Weekly Schedules</CardTitle>
          <CardDescription>
            Weekly schedules provide the normal recurring pattern. Shift overrides only
            replace them for specific dates.
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
                {orderedPatterns.map((pattern) => (
                  <TableRow key={pattern.id}>
                    <TableCell className="align-top">
                      <div>{pattern.effectiveFrom}</div>
                      <div className="text-xs text-muted-foreground">
                        to {pattern.effectiveTo || "open"}
                      </div>
                    </TableCell>
                    {WEEKDAY_ORDER.map((weekday) => (
                      <TableCell key={`${pattern.id}-${weekday}`} className="align-top text-sm">
                        {formatDaySummary(pattern.dayMap.get(weekday))}
                      </TableCell>
                    ))}
                    <TableCell className="space-x-2 align-top">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(pattern)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(pattern.id)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {orderedPatterns.length === 0 ? (
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
    </div>
  );
}

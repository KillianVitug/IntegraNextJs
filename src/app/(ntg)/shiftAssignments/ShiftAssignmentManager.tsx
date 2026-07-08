"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { SelectShiftTableSchemaType } from "@/zod-schemas/shiftTable";
import { restDayEnum, shiftScheduleEnum } from "@/db/schema";
import {
  deleteEmployeeShiftAssignment,
  saveEmployeeShiftAssignment,
} from "@/app/actions/shiftAssignmentAction";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildShiftAssignmentSnapshotFromTable, resolveShiftAssignmentSnapshot } from "@/lib/shifts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ShiftAssignmentRow = {
  id: number;
  employeeId: string;
  shiftTableId: number | null;
  shiftName: string;
  shiftCode: string | null;
  shiftSchedule: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  checkInTime: string;
  checkOutTime: string;
  breakMinutes: number;
  paidBreakMinutes: number;
  graceMinutes: number;
  restDay: string | null;
  hoursPerDay: string;
  isFlexible: boolean;
};

type Props = {
  employeeId: string;
  employeeLabel: string;
  initialAssignments: ShiftAssignmentRow[];
};

type FormState = {
  id?: number;
  shiftTableId: number;
  shiftSchedule: string;
  effectiveFrom: string;
  effectiveTo: string;
  graceMinutes: string;
  restDay: string;
  isFlexible: boolean;
};

const EMPTY_FORM: FormState = {
  shiftTableId: 0,
  shiftSchedule: "",
  effectiveFrom: "",
  effectiveTo: "",
  graceMinutes: "0",
  restDay: "",
  isFlexible: false,
};

function mapAssignmentToForm(row: ShiftAssignmentRow): FormState {
  return {
    id: row.id,
    shiftTableId: row.shiftTableId ?? 0,
    shiftSchedule: row.shiftSchedule ?? "",
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo ?? "",
    graceMinutes: String(row.graceMinutes),
    restDay: row.restDay ?? "",
    isFlexible: row.isFlexible,
  };
}

export function ShiftAssignmentManager({
  employeeId,
  employeeLabel,
  initialAssignments,
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

  const orderedAssignments = useMemo(
    () =>
      [...initialAssignments]
        .map((assignment) => {
          const resolved = resolveShiftAssignmentSnapshot({
            assignment,
          });

          return {
            ...assignment,
            resolvedShiftName: resolved.shiftName,
            resolvedShiftCode: resolved.shiftCode,
            resolvedCheckInTime: resolved.checkInTime,
            resolvedCheckOutTime: resolved.checkOutTime,
            resolvedBreakMinutes: resolved.breakMinutes,
            resolvedHoursPerDay: resolved.hoursPerDay,
            sourceLabel: assignment.shiftTableId ? "Shift Table" : "Legacy Manual",
          };
        })
        .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom)),
    [initialAssignments]
  );

  const selectedShiftTable =
    form.shiftTableId > 0 ? shiftTableMap.get(form.shiftTableId) ?? null : null;

  const selectedShiftMetrics = selectedShiftTable
    ? buildShiftAssignmentSnapshotFromTable(selectedShiftTable)
    : null;

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function handleEdit(row: ShiftAssignmentRow) {
    setForm(mapAssignmentToForm(row));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.shiftTableId) {
      toast.error("Select a Shift Table first.");
      return;
    }

    startTransition(async () => {
      try {
        await saveEmployeeShiftAssignment({
          id: form.id,
          employeeId,
          shiftTableId: form.shiftTableId,
          shiftSchedule: form.shiftSchedule || null,
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo || null,
          graceMinutes: Number(form.graceMinutes),
          restDay: form.restDay || null,
          isFlexible: form.isFlexible,
        });

        toast.success(form.id ? "Shift override updated." : "Shift override created.");
        resetForm();
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to save shift override.");
      }
    });
  }

  function handleDelete(id: number) {
    if (!window.confirm("Delete this shift override?")) return;

    startTransition(async () => {
      try {
        await deleteEmployeeShiftAssignment({ id });
        toast.success("Shift override deleted.");
        if (form.id === id) {
          resetForm();
        }
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to delete shift override.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Shift Override Manager</CardTitle>
          <CardDescription>
            Temporary date-based overrides for {employeeLabel}. These take priority over
            the weekly schedule during the covered dates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium">Shift Table</label>
                <select
                  className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.shiftTableId}
                  onChange={(event) => updateField("shiftTableId", Number(event.target.value))}
                  required
                >
                  <option value={0}>Select shift table</option>
                  {shiftTables.map((shiftTable) => (
                    <option key={shiftTable.id} value={shiftTable.id}>
                      {shiftTable.code} | {shiftTable.description}
                    </option>
                  ))}
                </select>
                {shiftTables.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Create a Shift Table first from Settings &gt; TimeKeeping Menu.
                  </p>
                ) : null}
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Shift Schedule</label>
                <select
                  className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.shiftSchedule}
                  onChange={(event) => updateField("shiftSchedule", event.target.value)}
                >
                  <option value="">Select schedule</option>
                  {shiftScheduleEnum.enumValues.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Grace Minutes</label>
                <Input
                  type="number"
                  min="0"
                  value={form.graceMinutes}
                  onChange={(event) => updateField("graceMinutes", event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
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
              <div>
                <label className="mb-2 block text-sm font-medium">Rest Day</label>
                <select
                  className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.restDay}
                  onChange={(event) => updateField("restDay", event.target.value)}
                >
                  <option value="">Select rest day</option>
                  {restDayEnum.enumValues.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.isFlexible}
                    onChange={(event) => updateField("isFlexible", event.target.checked)}
                  />
                  Flexible shift
                </label>
              </div>
            </div>

            {selectedShiftTable ? (
              <div className="grid gap-3 rounded-md border p-4 md:grid-cols-4">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Shift</div>
                  <div className="font-medium">
                    {selectedShiftTable.code} | {selectedShiftTable.description}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Regular Hours</div>
                  <div className="font-medium">
                    {selectedShiftMetrics?.checkInTime} - {selectedShiftMetrics?.checkOutTime}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Deductible Break</div>
                  <div className="font-medium">{selectedShiftMetrics?.breakMinutes ?? 0} mins</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Hours Per Day</div>
                  <div className="font-medium">
                    {(selectedShiftMetrics?.hoursPerDay ?? 0).toFixed(2)}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={isPending || shiftTables.length === 0}>
                {isPending ? "Saving..." : form.id ? "Update Override" : "Save Override"}
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
          <CardTitle>Existing Overrides</CardTitle>
          <CardDescription>
            Attendance import and payroll computation use the active override first, then
            the weekly schedule, then legacy timekeeping.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shift</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Rest Day</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderedAssignments.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.resolvedShiftName}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.resolvedShiftCode || "-"} | {row.sourceLabel}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{row.effectiveFrom}</div>
                      <div className="text-xs text-muted-foreground">
                        to {row.effectiveTo || "open"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        {row.resolvedCheckInTime || "-"} - {row.resolvedCheckOutTime || "-"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.shiftSchedule || "Manual"}
                        {row.isFlexible ? " | Flexible" : ""}
                        {row.resolvedBreakMinutes > 0
                          ? ` | Break ${row.resolvedBreakMinutes} mins`
                          : ""}
                      </div>
                    </TableCell>
                    <TableCell>{row.restDay || "-"}</TableCell>
                    <TableCell>{row.resolvedHoursPerDay.toFixed(2)}</TableCell>
                    <TableCell className="space-x-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => handleEdit(row)}>
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(row.id)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {orderedAssignments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No shift overrides recorded for this employee.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

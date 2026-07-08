"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarIcon, X } from "lucide-react";
import type { SelectShiftTableSchemaType } from "@/zod-schemas/shiftTable";
import {
  cancelManagerScheduleChangeRequest,
  submitManagerScheduleChangeRequest,
  updateManagerScheduleChangeRequest,
} from "@/app/actions/managerAction";
import type { getManagerScheduleRequests } from "@/app/actions/managerAction";
import { FormActions, FormGrid } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { buildShiftAssignmentSnapshotFromTable } from "@/lib/shifts";
import { cn } from "@/lib/utils";

type ScheduleRequestRow = Awaited<ReturnType<typeof getManagerScheduleRequests>>[number];

type Props = {
  employeeId: string;
  requests: ScheduleRequestRow[];
  initialShiftTables?: SelectShiftTableSchemaType[];
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00`);
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeDateKeys(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

function expandDateRange(startDate: string, endDate: string | null | undefined) {
  if (!endDate || endDate <= startDate) return [startDate];

  const dates: string[] = [];
  const current = parseDateKey(startDate);
  const end = parseDateKey(endDate);

  while (current <= end && dates.length < 370) {
    dates.push(toDateKey(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function getRequestEffectiveDates(request: ScheduleRequestRow) {
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

function isEditableRequest(request: ScheduleRequestRow) {
  return request.status === "Pending" && request.action === "Create";
}

function formatShiftTableLabel(
  shiftTableId: number,
  shiftTableMap: Map<number, SelectShiftTableSchemaType>,
) {
  const shiftTable = shiftTableMap.get(shiftTableId);
  if (!shiftTable) {
    return `Unknown shift table (#${shiftTableId})`;
  }

  return `${shiftTable.code} | ${shiftTable.description}`;
}

export function ManagerScheduleRequestForm({
  employeeId,
  requests,
  initialShiftTables = [],
}: Props) {
  const router = useRouter();
  const [shiftTables, setShiftTables] =
    useState<SelectShiftTableSchemaType[]>(initialShiftTables);
  const [selectedRequest, setSelectedRequest] = useState<ScheduleRequestRow | null>(null);
  const [isPending, startTransition] = useTransition();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [form, setForm] = useState({
    shiftTableId: 0,
    effectiveDates: [todayKey()],
    reason: "",
  });

  useEffect(() => {
    let cancelled = false;

    async function loadShiftTables() {
      try {
        const response = await fetch("/api/constants/shiftTable", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;

        const data = (await response.json()) as SelectShiftTableSchemaType[];
        if (!cancelled && Array.isArray(data)) {
          setShiftTables(data);
        }
      } catch {
        // Keep server-rendered initialShiftTables as the usable fallback.
      }
    }

    void loadShiftTables();

    return () => {
      cancelled = true;
    };
  }, []);

  const shiftTableMap = useMemo(
    () => new Map(shiftTables.map((shiftTable) => [shiftTable.id, shiftTable])),
    [shiftTables],
  );
  const selectedShiftTable =
    form.shiftTableId > 0 ? shiftTableMap.get(form.shiftTableId) ?? null : null;
  const selectedMetrics = selectedShiftTable
    ? buildShiftAssignmentSnapshotFromTable(selectedShiftTable)
    : null;

  function updateField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateEffectiveDates(effectiveDates: string[]) {
    setForm((current) => ({
      ...current,
      effectiveDates: normalizeDateKeys(effectiveDates),
    }));
  }

  function removeEffectiveDate(date: string) {
    updateEffectiveDates(form.effectiveDates.filter((value) => value !== date));
  }

  function resetForm() {
    setSelectedRequest(null);
    setForm({
      shiftTableId: 0,
      effectiveDates: [todayKey()],
      reason: "",
    });
  }

  function editRequest(request: ScheduleRequestRow) {
    if (!isEditableRequest(request)) return;

    setSelectedRequest(request);
    setForm({
      shiftTableId: request.payload.shiftTableId,
      effectiveDates: getRequestEffectiveDates(request),
      reason: request.reason ?? "",
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.shiftTableId) {
      toast.error("Select a shift table first.");
      return;
    }
    const effectiveDates = normalizeDateKeys(form.effectiveDates);

    if (effectiveDates.length === 0) {
      toast.error("Select at least one effective date.");
      return;
    }

    startTransition(async () => {
      try {
        const firstEffectiveDate = effectiveDates[0];
        const lastEffectiveDate = effectiveDates[effectiveDates.length - 1];
        const input = {
          payload: {
            employeeId,
            shiftTableId: form.shiftTableId,
            shiftSchedule: null,
            effectiveFrom: firstEffectiveDate,
            effectiveTo: lastEffectiveDate,
            effectiveDates,
            graceMinutes: 0,
            restDay: null,
            isFlexible: false,
          },
          reason: form.reason,
        };
        const result = selectedRequest
          ? await updateManagerScheduleChangeRequest({
              requestId: selectedRequest.id,
              ...input,
            })
          : await submitManagerScheduleChangeRequest({
              action: "Create",
              ...input,
            });

        if (result?.error) {
          toast.error(result.error);
          return;
        }

        toast.success(
          selectedRequest
            ? "Schedule change request updated."
            : "Schedule change request submitted.",
        );
        resetForm();
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to submit schedule change request.",
        );
      }
    });
  }

  function handleDeleteRequest() {
    if (!selectedRequest) return;
    if (!window.confirm("Delete this pending schedule request?")) return;

    startTransition(async () => {
      try {
        const result = await cancelManagerScheduleChangeRequest({
          requestId: selectedRequest.id,
        });
        if (result?.error) {
          toast.error(result.error);
          return;
        }

        toast.success("Schedule request deleted.");
        resetForm();
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to delete schedule request.",
        );
      }
    });
  }

  const selectedDates = form.effectiveDates.map(parseDateKey);

  return (
    <div className="space-y-4">
      <form className="space-y-3 rounded-md border p-3" onSubmit={handleSubmit}>
        <div>
          <h2 className="text-lg font-semibold">Sudden Schedule Change Request</h2>
          <p className="text-sm text-muted-foreground">
            Requests stay pending until Admin approval.
          </p>
        </div>

        <FormGrid columns={2}>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Shift Table</label>
            <select
              name="shiftTableId"
              value={form.shiftTableId}
              onChange={(event) => updateField("shiftTableId", Number(event.target.value))}
              required
              className="flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm"
            >
              <option value={0}>Select shift table</option>
              {shiftTables.map((shiftTable) => (
                <option key={shiftTable.id} value={shiftTable.id}>
                  {shiftTable.code} | {shiftTable.description}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Effective Date/s</label>
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "h-9 w-full justify-start text-left font-normal",
                    form.effectiveDates.length === 0 && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="h-4 w-4" />
                  {formatEffectiveDateSummary(form.effectiveDates)}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  mode="multiple"
                  selected={selectedDates}
                  onSelect={(dates) =>
                    updateEffectiveDates((dates ?? []).map(toDateKey))
                  }
                  captionLayout="dropdown"
                  fromYear={1950}
                  toYear={2100}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </FormGrid>

        <div className="rounded-md border p-2.5">
          <div className="text-sm font-medium">Selected Effective Date/s</div>
          <input
            type="hidden"
            name="effectiveDates"
            value={form.effectiveDates.join(", ")}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {form.effectiveDates.map((date) => (
              <span
                key={date}
                className="inline-flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-xs"
              >
                {date}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-background"
                  aria-label={`Remove ${date}`}
                  onClick={() => removeEffectiveDate(date)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {form.effectiveDates.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                No effective dates selected.
              </span>
            ) : null}
          </div>
        </div>

        {selectedMetrics ? (
          <div className="grid gap-2 rounded-md border p-2.5 text-sm md:grid-cols-4">
            <div>Shift: {selectedMetrics.shiftCode ?? selectedMetrics.shiftName}</div>
            <div>
              Hours: {selectedMetrics.checkInTime} - {selectedMetrics.checkOutTime}
            </div>
            <div>Break: {selectedMetrics.breakMinutes} mins</div>
            <div>Day Hours: {selectedMetrics.hoursPerDay.toFixed(2)}</div>
          </div>
        ) : null}

        <div>
          <label className="mb-1.5 block text-sm font-medium">Reason</label>
          <Textarea
            name="reason"
            value={form.reason}
            onChange={(event) => updateField("reason", event.target.value)}
          />
        </div>

        <FormActions align="start">
          <Button type="submit" disabled={isPending || shiftTables.length === 0}>
            {isPending
              ? "Submitting..."
              : selectedRequest
                ? "Update Request"
                : "Submit Request"}
          </Button>
          {selectedRequest ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={resetForm}
                disabled={isPending}
              >
                Cancel Edit
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeleteRequest}
                disabled={isPending}
              >
                Delete Request
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={resetForm}
              disabled={isPending}
            >
              Reset
            </Button>
          )}
        </FormActions>
      </form>

      <div className="rounded-md border p-3">
        <div>
          <h2 className="text-lg font-semibold">Submitted Schedule Requests</h2>
          <p className="text-sm text-muted-foreground">
            Click a pending created request to edit it before Admin approval.
          </p>
        </div>
        <div className="mt-3 space-y-2">
          {requests.map((request) => {
            const editable = isEditableRequest(request);
            const isSelected = selectedRequest?.id === request.id;
            const effectiveDates = getRequestEffectiveDates(request);

            return (
              <button
                key={request.id}
                type="button"
                disabled={!editable || isPending}
                onClick={() => editRequest(request)}
                className={[
                  "w-full rounded-md border p-3 text-left text-sm transition-colors",
                  editable ? "cursor-pointer hover:bg-muted" : "cursor-default opacity-75",
                  isSelected ? "border-primary bg-muted" : "",
                ].join(" ")}
              >
                <div className="font-medium">
                  {request.action} | {request.status}
                </div>
                <div>
                  Shift Table:{" "}
                  {formatShiftTableLabel(request.payload.shiftTableId, shiftTableMap)}
                </div>
                <div className="text-muted-foreground">
                  Effective Date/s: {formatEffectiveDateSummary(effectiveDates)}
                </div>
                {request.reason ? <div>Reason: {request.reason}</div> : null}
                {request.decisionNote ? (
                  <div>Decision: {request.decisionNote}</div>
                ) : null}
              </button>
            );
          })}
          {requests.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No schedule requests submitted yet.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

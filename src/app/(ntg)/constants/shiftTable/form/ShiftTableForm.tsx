"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  deleteShiftTableAction,
  saveShiftTableAction,
} from "@/app/actions/payrollConfigAction";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { SHIFT_BREAK_SLOT_DEFINITIONS } from "@/lib/shifts";
import {
  insertShiftTableSchema,
  type InsertShiftTableSchemaType,
  type SelectShiftTableSchemaType,
} from "@/zod-schemas/shiftTable";

type Props = {
  selectedRow: SelectShiftTableSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

function buildEmptyValues(): InsertShiftTableSchemaType {
  return {
    code: "",
    description: "",
    regularStartTime: "08:00",
    regularEndTime: "17:00",
    breaks: SHIFT_BREAK_SLOT_DEFINITIONS.map((definition) => ({
      slotKey: definition.slotKey,
      fromTime: null,
      toTime: null,
      deduct: false,
      deductHours: 0,
      deductMinutes: 0,
    })),
  };
}

function getBreakFieldError(
  selectedRow: SelectShiftTableSchemaType | null,
  errors: ReturnType<typeof useForm<InsertShiftTableSchemaType>>["formState"]["errors"],
  index: number,
  field: "fromTime" | "toTime" | "deduct" | "deductHours" | "deductMinutes"
) {
  const error = errors.breaks?.[index]?.[field];
  if (!error) return null;

  if (typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }

  return selectedRow ? "Invalid value." : "Invalid value.";
}

export default function ShiftTableForm({
  selectedRow,
  onResetSelection,
  onRefresh,
}: Props) {
  const emptyValues = buildEmptyValues();
  const form = useForm<InsertShiftTableSchemaType>({
    resolver: zodResolver(insertShiftTableSchema),
    defaultValues: emptyValues,
  });

  const { execute: saveShiftTable, isExecuting: saving } = useAction(
    saveShiftTableAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Shift table saved.");
        form.reset(buildEmptyValues());
        onResetSelection?.();
        onRefresh?.();
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? "Unable to save shift table.");
      },
    }
  );

  const { execute: deleteShiftTable, isExecuting: deleting } = useAction(
    deleteShiftTableAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Shift table deleted.");
        form.reset(buildEmptyValues());
        onResetSelection?.();
        onRefresh?.();
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? "Unable to delete shift table.");
      },
    }
  );

  useEffect(() => {
    if (!selectedRow) {
      form.reset(buildEmptyValues());
      return;
    }

    form.reset({
      id: selectedRow.id,
      code: selectedRow.code,
      description: selectedRow.description,
      regularStartTime: selectedRow.regularStartTime,
      regularEndTime: selectedRow.regularEndTime,
      breaks: selectedRow.breaks.map((breakRow) => ({
        slotKey: breakRow.slotKey,
        fromTime: breakRow.fromTime,
        toTime: breakRow.toTime,
        deduct: breakRow.deduct,
        deductHours: breakRow.deductHours,
        deductMinutes: breakRow.deductMinutes,
      })),
    });
  }, [form, selectedRow]);

  function handleReset() {
    form.reset(buildEmptyValues());
    onResetSelection?.();
  }

  function handleDelete() {
    if (!selectedRow?.id) return;
    if (!window.confirm("Delete this shift table?")) return;
    deleteShiftTable({ id: selectedRow.id });
  }

  function submitForm(data: InsertShiftTableSchemaType) {
    saveShiftTable(data);
  }

  const {
    formState: { errors },
    register,
    watch,
  } = form;
  const breakRows = watch("breaks");

  return (
    <div className="flex flex-col gap-3 sm:px-8">
      <div>
        <h2 className="text-2xl font-bold">Shift Table</h2>
        <p className="text-sm text-muted-foreground">
          Define reusable shift schedules and break windows for employee assignments.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(submitForm)} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Code</label>
              <Input {...register("code")} placeholder="MORN-01" />
              {errors.code?.message ? (
                <p className="text-xs text-destructive">{errors.code.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input {...register("description")} placeholder="Morning Shift" />
              {errors.description?.message ? (
                <p className="text-xs text-destructive">{errors.description.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Regular Working Hours From</label>
              <Input type="time" {...register("regularStartTime")} />
              {errors.regularStartTime?.message ? (
                <p className="text-xs text-destructive">{errors.regularStartTime.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Regular Working Hours To</label>
              <Input type="time" {...register("regularEndTime")} />
              {errors.regularEndTime?.message ? (
                <p className="text-xs text-destructive">{errors.regularEndTime.message}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="text-lg font-semibold">Break Schedule</h3>
              <p className="text-sm text-muted-foreground">
                Mid Breaktime is required. Optional rows become active once you enter values.
              </p>
            </div>

            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Break Slot</th>
                    <th className="px-3 py-2 text-left font-medium">From</th>
                    <th className="px-3 py-2 text-left font-medium">To</th>
                    <th className="px-3 py-2 text-left font-medium">Deduct</th>
                    <th className="px-3 py-2 text-left font-medium">Hrs</th>
                    <th className="px-3 py-2 text-left font-medium">Mins</th>
                  </tr>
                </thead>
                <tbody>
                  {SHIFT_BREAK_SLOT_DEFINITIONS.map((definition, index) => (
                    <tr key={definition.slotKey} className="border-t align-top">
                      <td className="px-3 py-3">
                        <div className="font-medium">{definition.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {definition.required ? "Required" : "Optional"}
                        </div>
                        <input
                          type="hidden"
                          value={breakRows?.[index]?.slotKey ?? definition.slotKey}
                          {...register(`breaks.${index}.slotKey`)}
                        />
                      </td>

                      <td className="px-3 py-3">
                        <Input type="time" {...register(`breaks.${index}.fromTime`)} />
                        {getBreakFieldError(selectedRow, errors, index, "fromTime") ? (
                          <p className="mt-1 text-xs text-destructive">
                            {getBreakFieldError(selectedRow, errors, index, "fromTime")}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-3 py-3">
                        <Input type="time" {...register(`breaks.${index}.toTime`)} />
                        {getBreakFieldError(selectedRow, errors, index, "toTime") ? (
                          <p className="mt-1 text-xs text-destructive">
                            {getBreakFieldError(selectedRow, errors, index, "toTime")}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-3 py-3">
                        <label className="flex h-10 items-center gap-2">
                          <input type="checkbox" {...register(`breaks.${index}.deduct`)} />
                          <span>Deduct</span>
                        </label>
                        {getBreakFieldError(selectedRow, errors, index, "deduct") ? (
                          <p className="mt-1 text-xs text-destructive">
                            {getBreakFieldError(selectedRow, errors, index, "deduct")}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-3 py-3">
                        <Input
                          type="number"
                          min="0"
                          max="23"
                          {...register(`breaks.${index}.deductHours`, {
                            valueAsNumber: true,
                          })}
                        />
                        {getBreakFieldError(selectedRow, errors, index, "deductHours") ? (
                          <p className="mt-1 text-xs text-destructive">
                            {getBreakFieldError(selectedRow, errors, index, "deductHours")}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-3 py-3">
                        <Input
                          type="number"
                          min="0"
                          max="59"
                          {...register(`breaks.${index}.deductMinutes`, {
                            valueAsNumber: true,
                          })}
                        />
                        {getBreakFieldError(selectedRow, errors, index, "deductMinutes") ? (
                          <p className="mt-1 text-xs text-destructive">
                            {getBreakFieldError(selectedRow, errors, index, "deductMinutes")}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : selectedRow?.id
                  ? "Update Shift Table"
                  : "Add Shift Table"}
            </Button>

            {selectedRow?.id ? (
              <Button
                type="button"
                variant="destructive"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? "Deleting..." : "Delete Shift Table"}
              </Button>
            ) : null}

            <Button type="button" variant="outline" onClick={handleReset}>
              {selectedRow?.id ? "Cancel Edit" : "Reset"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

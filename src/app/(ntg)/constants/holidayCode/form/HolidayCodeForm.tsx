"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { holidayTypeEnum } from "@/db/schema";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { DateWithLabel } from "@/components/inputs/DateWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { CheckboxWithLabel } from "@/components/inputs/CheckboxWithLabel";
import {
  insertHolidayCalendarSchema,
  holidayYearStatusValues,
  type InsertHolidayCalendarSchemaType,
  type SelectHolidayCalendarSchemaType,
} from "@/zod-schemas/holidayCalendar";
import {
  deleteHolidayCalendarAction,
  saveHolidayCalendarAction,
} from "@/app/actions/payrollConfigAction";
import { enumToSelectOptions } from "@/utils/enumHelpers";

type Props = {
  selectedHoliday: SelectHolidayCalendarSchemaType | null;
  selectedYear: number;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

function buildEmptyValues(year: number): InsertHolidayCalendarSchemaType {
  return {
    id: 0,
    year,
    templateId: null,
    source: "Manual",
    name: "",
    holidayDate: null,
    holidayDate2: null,
    checkDate1: null,
    checkDate2: null,
    requireCheckDate1: false,
    requireCheckDate2: false,
    holidayType: holidayTypeEnum.enumValues[0],
    isPaid: true,
    status: "Confirmed",
    notes: null,
  };
}

export default function HolidayCodeForm({
  selectedHoliday,
  selectedYear,
  onResetSelection,
  onRefresh,
}: Props) {
  const form = useForm<InsertHolidayCalendarSchemaType>({
    resolver: zodResolver(insertHolidayCalendarSchema),
    defaultValues: buildEmptyValues(selectedYear),
  });

  const { execute: saveHoliday, isExecuting: saving } = useAction(
    saveHolidayCalendarAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Holiday saved.");
        form.reset(buildEmptyValues(selectedYear));
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to save holiday.");
      },
    }
  );

  const { execute: removeHoliday, isExecuting: deleting } = useAction(
    deleteHolidayCalendarAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Holiday deleted.");
        form.reset(buildEmptyValues(selectedYear));
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to delete holiday.");
      },
    }
  );

  useEffect(() => {
    if (!selectedHoliday) {
      form.reset(buildEmptyValues(selectedYear));
      return;
    }

    form.reset({
      id: selectedHoliday.id,
      year: selectedHoliday.year,
      templateId: selectedHoliday.templateId ?? null,
      source: selectedHoliday.source,
      name: selectedHoliday.name,
      holidayDate: selectedHoliday.holidayDate ?? null,
      holidayDate2: selectedHoliday.holidayDate2 ?? null,
      checkDate1: selectedHoliday.checkDate1 ?? null,
      checkDate2: selectedHoliday.checkDate2 ?? null,
      requireCheckDate1: selectedHoliday.requireCheckDate1,
      requireCheckDate2: selectedHoliday.requireCheckDate2,
      holidayType: selectedHoliday.holidayType,
      isPaid: selectedHoliday.isPaid,
      status: selectedHoliday.status,
      notes: selectedHoliday.notes ?? null,
    });
  }, [form, selectedHoliday, selectedYear]);

  function submitForm(data: InsertHolidayCalendarSchemaType) {
    saveHoliday(data);
  }

  function handleDelete() {
    if (!selectedHoliday?.id) return;
    if (!window.confirm("Delete this holiday calendar entry?")) return;
    removeHoliday({ id: selectedHoliday.id });
  }

  function handleReset() {
    form.reset(buildEmptyValues(selectedYear));
    onResetSelection?.();
  }

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">Holiday Calendar</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="flex flex-col gap-4 md:flex-row md:gap-8"
        >
          <div className="flex w-full max-w-xs flex-col gap-4">
            <InputWithLabel<InsertHolidayCalendarSchemaType>
              fieldTitle="Year"
              nameInSchema="year"
              inputMode="numeric"
              readOnly
            />
            <InputWithLabel<InsertHolidayCalendarSchemaType>
              fieldTitle="Holiday Name"
              nameInSchema="name"
              register={form.register}
            />
            <DateWithLabel<InsertHolidayCalendarSchemaType>
              fieldTitle="Holiday Date"
              nameInSchema="holidayDate"
              control={form.control}
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-4">
            <SelectWithLabel<InsertHolidayCalendarSchemaType>
              fieldTitle="Holiday Type"
              nameInSchema="holidayType"
              control={form.control}
              data={enumToSelectOptions(holidayTypeEnum.enumValues)}
            />
            <SelectWithLabel<InsertHolidayCalendarSchemaType>
              fieldTitle="Status"
              nameInSchema="status"
              control={form.control}
              data={enumToSelectOptions(holidayYearStatusValues)}
            />
            <DateWithLabel<InsertHolidayCalendarSchemaType>
              fieldTitle="Check Date 1"
              nameInSchema="checkDate1"
              control={form.control}
            />
            <CheckboxWithLabel<InsertHolidayCalendarSchemaType>
              fieldTitle="Paid Holiday"
              nameInSchema="isPaid"
              message=""
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-4">
            <InputWithLabel<InsertHolidayCalendarSchemaType>
              fieldTitle="Source"
              nameInSchema="source"
              readOnly
            />
            <InputWithLabel<InsertHolidayCalendarSchemaType>
              fieldTitle="Notes"
              nameInSchema="notes"
              register={form.register}
            />
            <DateWithLabel<InsertHolidayCalendarSchemaType>
              fieldTitle="Check Date 2"
              nameInSchema="checkDate2"
              control={form.control}
            />
            <CheckboxWithLabel<InsertHolidayCalendarSchemaType>
              fieldTitle="Require Check Date 1"
              nameInSchema="requireCheckDate1"
              message=""
            />
            <CheckboxWithLabel<InsertHolidayCalendarSchemaType>
              fieldTitle="Require Check Date 2"
              nameInSchema="requireCheckDate2"
              message=""
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-2">
            <Button type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : selectedHoliday?.id
                  ? "Update Holiday"
                  : "Add Holiday"}
            </Button>

            {selectedHoliday?.id ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Holiday"}
              </Button>
            ) : null}

            <Button type="button" variant="outline" onClick={handleReset}>
              {selectedHoliday?.id ? "Cancel Edit" : "Reset"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

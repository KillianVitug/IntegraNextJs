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
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { CheckboxWithLabel } from "@/components/inputs/CheckboxWithLabel";
import {
  holidayTemplateRecurrenceValues,
  insertHolidayTemplateSchema,
  type InsertHolidayTemplateSchemaType,
  type SelectHolidayTemplateSchemaType,
} from "@/zod-schemas/holidayCalendar";
import {
  deleteHolidayTemplateAction,
  saveHolidayTemplateAction,
} from "@/app/actions/payrollConfigAction";
import { enumToSelectOptions } from "@/utils/enumHelpers";

type Props = {
  selectedTemplate: SelectHolidayTemplateSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

const monthOptions = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  name: new Date(Date.UTC(2026, index, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  }),
}));

const weekdayOptions = [
  { id: 0, name: "Sunday" },
  { id: 1, name: "Monday" },
  { id: 2, name: "Tuesday" },
  { id: 3, name: "Wednesday" },
  { id: 4, name: "Thursday" },
  { id: 5, name: "Friday" },
  { id: 6, name: "Saturday" },
];

const occurrenceOptions = [
  { id: 1, name: "First" },
  { id: 2, name: "Second" },
  { id: 3, name: "Third" },
  { id: 4, name: "Fourth" },
  { id: 5, name: "Fifth" },
  { id: -1, name: "Last" },
];

const emptyValues: InsertHolidayTemplateSchemaType = {
  id: 0,
  name: "",
  holidayType: holidayTypeEnum.enumValues[0],
  isPaid: true,
  isActive: true,
  recurrenceType: "FixedDate",
  fixedMonth: 1,
  fixedDay: 1,
  nthMonth: 1,
  nthWeekday: 1,
  nthOccurrence: 1,
  durationDays: 1,
  notes: null,
};

export default function HolidayTemplateForm({
  selectedTemplate,
  onResetSelection,
  onRefresh,
}: Props) {
  const form = useForm<InsertHolidayTemplateSchemaType>({
    resolver: zodResolver(insertHolidayTemplateSchema),
    defaultValues: emptyValues,
  });
  const recurrenceType = form.watch("recurrenceType");

  const { execute: saveTemplate, isExecuting: saving } = useAction(
    saveHolidayTemplateAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Holiday template saved.");
        form.reset(emptyValues);
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to save holiday template.");
      },
    }
  );

  const { execute: removeTemplate, isExecuting: deleting } = useAction(
    deleteHolidayTemplateAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Holiday template deleted.");
        form.reset(emptyValues);
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to delete holiday template.");
      },
    }
  );

  useEffect(() => {
    if (!selectedTemplate) {
      form.reset(emptyValues);
      return;
    }

    form.reset({
      id: selectedTemplate.id,
      name: selectedTemplate.name,
      holidayType: selectedTemplate.holidayType,
      isPaid: selectedTemplate.isPaid,
      isActive: selectedTemplate.isActive,
      recurrenceType: selectedTemplate.recurrenceType,
      fixedMonth: selectedTemplate.fixedMonth ?? null,
      fixedDay: selectedTemplate.fixedDay ?? null,
      nthMonth: selectedTemplate.nthMonth ?? null,
      nthWeekday: selectedTemplate.nthWeekday ?? null,
      nthOccurrence: selectedTemplate.nthOccurrence ?? null,
      durationDays: selectedTemplate.durationDays,
      notes: selectedTemplate.notes ?? null,
    });
  }, [form, selectedTemplate]);

  function submitForm(data: InsertHolidayTemplateSchemaType) {
    saveTemplate(data);
  }

  function handleDelete() {
    if (!selectedTemplate?.id) return;
    if (!window.confirm("Delete this holiday template?")) return;
    removeTemplate({ id: selectedTemplate.id });
  }

  function handleReset() {
    form.reset(emptyValues);
    onResetSelection?.();
  }

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">Holiday Templates</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="flex flex-col gap-4 md:flex-row md:gap-8"
        >
          <div className="flex w-full max-w-xs flex-col gap-4">
            <InputWithLabel<InsertHolidayTemplateSchemaType>
              fieldTitle="Template Name"
              nameInSchema="name"
              register={form.register}
            />
            <SelectWithLabel<InsertHolidayTemplateSchemaType>
              fieldTitle="Holiday Type"
              nameInSchema="holidayType"
              control={form.control}
              data={enumToSelectOptions(holidayTypeEnum.enumValues)}
            />
            <SelectWithLabel<InsertHolidayTemplateSchemaType>
              fieldTitle="Recurrence"
              nameInSchema="recurrenceType"
              control={form.control}
              data={enumToSelectOptions(holidayTemplateRecurrenceValues)}
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-4">
            {recurrenceType === "FixedDate" ? (
              <>
                <SelectWithLabel<InsertHolidayTemplateSchemaType>
                  fieldTitle="Fixed Month"
                  nameInSchema="fixedMonth"
                  control={form.control}
                  data={monthOptions}
                />
                <InputWithLabel<InsertHolidayTemplateSchemaType>
                  fieldTitle="Fixed Day"
                  nameInSchema="fixedDay"
                  inputMode="numeric"
                />
              </>
            ) : null}

            {recurrenceType === "NthWeekday" ? (
              <>
                <SelectWithLabel<InsertHolidayTemplateSchemaType>
                  fieldTitle="Month"
                  nameInSchema="nthMonth"
                  control={form.control}
                  data={monthOptions}
                />
                <SelectWithLabel<InsertHolidayTemplateSchemaType>
                  fieldTitle="Occurrence"
                  nameInSchema="nthOccurrence"
                  control={form.control}
                  data={occurrenceOptions}
                />
                <SelectWithLabel<InsertHolidayTemplateSchemaType>
                  fieldTitle="Weekday"
                  nameInSchema="nthWeekday"
                  control={form.control}
                  data={weekdayOptions}
                />
              </>
            ) : null}
          </div>

          <div className="flex w-full max-w-xs flex-col gap-4">
            <InputWithLabel<InsertHolidayTemplateSchemaType>
              fieldTitle="Duration Days"
              nameInSchema="durationDays"
              inputMode="numeric"
            />
            <InputWithLabel<InsertHolidayTemplateSchemaType>
              fieldTitle="Notes"
              nameInSchema="notes"
              register={form.register}
            />
            <CheckboxWithLabel<InsertHolidayTemplateSchemaType>
              fieldTitle="Paid Holiday"
              nameInSchema="isPaid"
              message=""
            />
            <CheckboxWithLabel<InsertHolidayTemplateSchemaType>
              fieldTitle="Active Template"
              nameInSchema="isActive"
              message=""
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-2">
            <Button type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : selectedTemplate?.id
                  ? "Update Template"
                  : "Add Template"}
            </Button>

            {selectedTemplate?.id ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Template"}
              </Button>
            ) : null}

            <Button type="button" variant="outline" onClick={handleReset}>
              {selectedTemplate?.id ? "Cancel Edit" : "Reset"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

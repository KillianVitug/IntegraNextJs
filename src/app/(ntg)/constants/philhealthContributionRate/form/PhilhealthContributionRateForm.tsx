"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import {
  deletePhilhealthContributionRateAction,
  savePhilhealthContributionRateAction,
} from "@/app/actions/payrollStatutoryAction";
import {
  insertPhilhealthContributionRateSchema,
  type InsertPhilhealthContributionRateSchemaType,
  type SelectPhilhealthContributionRateSchemaType,
} from "@/zod-schemas/philhealthContributionRate";

type Props = {
  selectedVersionId: number | null;
  selectedRow: SelectPhilhealthContributionRateSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

function getEmptyValues(
  versionId: number | null
): InsertPhilhealthContributionRateSchemaType {
  return {
    id: 0,
    versionId: versionId ?? 0,
    monthlyBasicSalaryFloor: 0,
    monthlyBasicSalaryCeiling: 0,
    premiumRate: 0,
    employeeShareRate: 0,
    employerShareRate: 0,
  };
}

export default function PhilhealthContributionRateForm({
  selectedVersionId,
  selectedRow,
  onResetSelection,
  onRefresh,
}: Props) {
  const form = useForm<InsertPhilhealthContributionRateSchemaType>({
    resolver: zodResolver(insertPhilhealthContributionRateSchema),
    defaultValues: getEmptyValues(selectedVersionId),
  });

  const { execute: saveRow, isExecuting: saving } = useAction(
    savePhilhealthContributionRateAction,
    {
      onSuccess: (result) => {
        if (result?.data?.error) {
          toast.error(result.data.error);
          return;
        }

        toast.success(result?.data?.message ?? "PhilHealth rate saved.");
        form.reset(getEmptyValues(selectedVersionId));
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to save PhilHealth rate.");
      },
    }
  );

  const { execute: removeRow, isExecuting: deleting } = useAction(
    deletePhilhealthContributionRateAction,
    {
      onSuccess: (result) => {
        if (result?.data?.error) {
          toast.error(result.data.error);
          return;
        }

        toast.success(result?.data?.message ?? "PhilHealth rate deleted.");
        form.reset(getEmptyValues(selectedVersionId));
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to delete PhilHealth rate.");
      },
    }
  );

  useEffect(() => {
    if (!selectedRow) {
      form.reset(getEmptyValues(selectedVersionId));
      return;
    }

    form.reset({
      id: selectedRow.id,
      versionId: selectedVersionId ?? selectedRow.versionId,
      monthlyBasicSalaryFloor: selectedRow.monthlyBasicSalaryFloor,
      monthlyBasicSalaryCeiling: selectedRow.monthlyBasicSalaryCeiling,
      premiumRate: selectedRow.premiumRate,
      employeeShareRate: selectedRow.employeeShareRate,
      employerShareRate: selectedRow.employerShareRate,
    });
  }, [form, selectedRow, selectedVersionId]);

  function submitForm(data: InsertPhilhealthContributionRateSchemaType) {
    saveRow({
      ...data,
      versionId: selectedVersionId ?? data.versionId,
    });
  }

  function handleDelete() {
    if (!selectedRow?.id) return;
    if (!window.confirm("Delete this PhilHealth contribution rate?")) return;
    removeRow({ id: selectedRow.id });
  }

  function handleReset() {
    form.reset(getEmptyValues(selectedVersionId));
    onResetSelection?.();
  }

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">PhilHealth Contribution Rates</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="flex flex-col gap-4 md:flex-row md:gap-8"
        >
          <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
            <InputWithLabel<InsertPhilhealthContributionRateSchemaType>
              fieldTitle="Monthly Salary Floor"
              nameInSchema="monthlyBasicSalaryFloor"
              register={form.register}
              type="number"
              step="0.01"
            />
            <InputWithLabel<InsertPhilhealthContributionRateSchemaType>
              fieldTitle="Monthly Salary Ceiling"
              nameInSchema="monthlyBasicSalaryCeiling"
              register={form.register}
              type="number"
              step="0.01"
            />
            <InputWithLabel<InsertPhilhealthContributionRateSchemaType>
              fieldTitle="Premium Rate"
              nameInSchema="premiumRate"
              register={form.register}
              type="number"
              step="0.000001"
            />
            <InputWithLabel<InsertPhilhealthContributionRateSchemaType>
              fieldTitle="Employee Share Rate"
              nameInSchema="employeeShareRate"
              register={form.register}
              type="number"
              step="0.000001"
            />
            <InputWithLabel<InsertPhilhealthContributionRateSchemaType>
              fieldTitle="Employer Share Rate"
              nameInSchema="employerShareRate"
              register={form.register}
              type="number"
              step="0.000001"
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-2">
            <Button type="submit" disabled={saving || !selectedVersionId}>
              {saving
                ? "Saving..."
                : selectedRow?.id
                  ? "Update Rate"
                  : "Add Rate"}
            </Button>

            {selectedRow?.id ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Rate"}
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

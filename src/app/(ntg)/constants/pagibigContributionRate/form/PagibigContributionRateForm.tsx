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
  deletePagibigContributionRateAction,
  savePagibigContributionRateAction,
} from "@/app/actions/payrollStatutoryAction";
import {
  insertPagibigContributionRateSchema,
  type InsertPagibigContributionRateSchemaType,
  type SelectPagibigContributionRateSchemaType,
} from "@/zod-schemas/pagibigContributionRate";

type Props = {
  selectedVersionId: number | null;
  selectedRow: SelectPagibigContributionRateSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

function getEmptyValues(
  versionId: number | null
): InsertPagibigContributionRateSchemaType {
  return {
    id: 0,
    versionId: versionId ?? 0,
    rangeFrom: 0,
    rangeTo: 0,
    employeeRate: 0,
    employerRate: 0,
    maxCompensationBase: null,
  };
}

export default function PagibigContributionRateForm({
  selectedVersionId,
  selectedRow,
  onResetSelection,
  onRefresh,
}: Props) {
  const form = useForm<InsertPagibigContributionRateSchemaType>({
    resolver: zodResolver(insertPagibigContributionRateSchema),
    defaultValues: getEmptyValues(selectedVersionId),
  });

  const { execute: saveRow, isExecuting: saving } = useAction(
    savePagibigContributionRateAction,
    {
      onSuccess: (result) => {
        if (result?.data?.error) {
          toast.error(result.data.error);
          return;
        }

        toast.success(result?.data?.message ?? "Pag-IBIG rate saved.");
        form.reset(getEmptyValues(selectedVersionId));
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to save Pag-IBIG rate.");
      },
    }
  );

  const { execute: removeRow, isExecuting: deleting } = useAction(
    deletePagibigContributionRateAction,
    {
      onSuccess: (result) => {
        if (result?.data?.error) {
          toast.error(result.data.error);
          return;
        }

        toast.success(result?.data?.message ?? "Pag-IBIG rate deleted.");
        form.reset(getEmptyValues(selectedVersionId));
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to delete Pag-IBIG rate.");
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
      rangeFrom: selectedRow.rangeFrom,
      rangeTo: selectedRow.rangeTo,
      employeeRate: selectedRow.employeeRate,
      employerRate: selectedRow.employerRate,
      maxCompensationBase: selectedRow.maxCompensationBase,
    });
  }, [form, selectedRow, selectedVersionId]);

  function submitForm(data: InsertPagibigContributionRateSchemaType) {
    saveRow({
      ...data,
      versionId: selectedVersionId ?? data.versionId,
    });
  }

  function handleDelete() {
    if (!selectedRow?.id) return;
    if (!window.confirm("Delete this Pag-IBIG contribution rate?")) return;
    removeRow({ id: selectedRow.id });
  }

  function handleReset() {
    form.reset(getEmptyValues(selectedVersionId));
    onResetSelection?.();
  }

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">Pag-IBIG Contribution Rates</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="flex flex-col gap-4 md:flex-row md:gap-8"
        >
          <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
            <InputWithLabel<InsertPagibigContributionRateSchemaType>
              fieldTitle="Range From"
              nameInSchema="rangeFrom"
              register={form.register}
              type="number"
              step="0.01"
            />
            <InputWithLabel<InsertPagibigContributionRateSchemaType>
              fieldTitle="Range To"
              nameInSchema="rangeTo"
              register={form.register}
              type="number"
              step="0.01"
            />
            <InputWithLabel<InsertPagibigContributionRateSchemaType>
              fieldTitle="Employee Rate"
              nameInSchema="employeeRate"
              register={form.register}
              type="number"
              step="0.000001"
            />
            <InputWithLabel<InsertPagibigContributionRateSchemaType>
              fieldTitle="Employer Rate"
              nameInSchema="employerRate"
              register={form.register}
              type="number"
              step="0.000001"
            />
            <InputWithLabel<InsertPagibigContributionRateSchemaType>
              fieldTitle="Max Compensation Base"
              nameInSchema="maxCompensationBase"
              register={form.register}
              type="number"
              step="0.01"
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

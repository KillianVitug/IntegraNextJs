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
  deleteSssContributionBracketAction,
  saveSssContributionBracketAction,
} from "@/app/actions/payrollStatutoryAction";
import {
  insertSssContributionBracketSchema,
  type InsertSssContributionBracketSchemaType,
  type SelectSssContributionBracketSchemaType,
} from "@/zod-schemas/sssContributionBracket";

type Props = {
  selectedVersionId: number | null;
  selectedRow: SelectSssContributionBracketSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

function getEmptyValues(versionId: number | null): InsertSssContributionBracketSchemaType {
  return {
    id: 0,
    versionId: versionId ?? 0,
    rangeFrom: 0,
    rangeTo: 0,
    salaryCredit: 0,
    employeeShare: 0,
    employerShare: 0,
    ecShare: 0,
  };
}

export default function SssContributionBracketForm({
  selectedVersionId,
  selectedRow,
  onResetSelection,
  onRefresh,
}: Props) {
  const form = useForm<InsertSssContributionBracketSchemaType>({
    resolver: zodResolver(insertSssContributionBracketSchema),
    defaultValues: getEmptyValues(selectedVersionId),
  });

  const { execute: saveRow, isExecuting: saving } = useAction(
    saveSssContributionBracketAction,
    {
      onSuccess: (result) => {
        if (result?.data?.error) {
          toast.error(result.data.error);
          return;
        }

        toast.success(result?.data?.message ?? "SSS bracket saved.");
        form.reset(getEmptyValues(selectedVersionId));
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to save SSS bracket.");
      },
    }
  );

  const { execute: removeRow, isExecuting: deleting } = useAction(
    deleteSssContributionBracketAction,
    {
      onSuccess: (result) => {
        if (result?.data?.error) {
          toast.error(result.data.error);
          return;
        }

        toast.success(result?.data?.message ?? "SSS bracket deleted.");
        form.reset(getEmptyValues(selectedVersionId));
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to delete SSS bracket.");
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
      salaryCredit: selectedRow.salaryCredit,
      employeeShare: selectedRow.employeeShare,
      employerShare: selectedRow.employerShare,
      ecShare: selectedRow.ecShare,
    });
  }, [form, selectedRow, selectedVersionId]);

  function submitForm(data: InsertSssContributionBracketSchemaType) {
    saveRow({
      ...data,
      versionId: selectedVersionId ?? data.versionId,
    });
  }

  function handleDelete() {
    if (!selectedRow?.id) return;
    if (!window.confirm("Delete this SSS contribution bracket?")) return;
    removeRow({ id: selectedRow.id });
  }

  function handleReset() {
    form.reset(getEmptyValues(selectedVersionId));
    onResetSelection?.();
  }

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">SSS Contribution Brackets</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="flex flex-col gap-4 md:flex-row md:gap-8"
        >
          <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
            <InputWithLabel<InsertSssContributionBracketSchemaType>
              fieldTitle="Range From"
              nameInSchema="rangeFrom"
              register={form.register}
              type="number"
              step="0.01"
            />
            <InputWithLabel<InsertSssContributionBracketSchemaType>
              fieldTitle="Range To"
              nameInSchema="rangeTo"
              register={form.register}
              type="number"
              step="0.01"
            />
            <InputWithLabel<InsertSssContributionBracketSchemaType>
              fieldTitle="Salary Credit"
              nameInSchema="salaryCredit"
              register={form.register}
              type="number"
              step="0.01"
            />
            <InputWithLabel<InsertSssContributionBracketSchemaType>
              fieldTitle="Employee Share"
              nameInSchema="employeeShare"
              register={form.register}
              type="number"
              step="0.01"
            />
            <InputWithLabel<InsertSssContributionBracketSchemaType>
              fieldTitle="Employer Share"
              nameInSchema="employerShare"
              register={form.register}
              type="number"
              step="0.01"
            />
            <InputWithLabel<InsertSssContributionBracketSchemaType>
              fieldTitle="EC Share"
              nameInSchema="ecShare"
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
                  ? "Update Bracket"
                  : "Add Bracket"}
            </Button>

            {selectedRow?.id ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Bracket"}
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

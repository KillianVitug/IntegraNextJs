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
  deleteBirWithholdingTaxBracketAction,
  saveBirWithholdingTaxBracketAction,
} from "@/app/actions/payrollStatutoryAction";
import {
  insertBirWithholdingTaxBracketSchema,
  type InsertBirWithholdingTaxBracketSchemaType,
  type SelectBirWithholdingTaxBracketSchemaType,
} from "@/zod-schemas/birWithholdingTaxBracket";

type Props = {
  selectedVersionId: number | null;
  selectedRow: SelectBirWithholdingTaxBracketSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

function getEmptyValues(
  versionId: number | null
): InsertBirWithholdingTaxBracketSchemaType {
  return {
    id: 0,
    versionId: versionId ?? 0,
    payrollTerms: "Semi-Monthly",
    compensationFrom: 0,
    compensationTo: null,
    baseTax: 0,
    overPercentage: 0,
  };
}

export default function BirWithholdingTaxBracketForm({
  selectedVersionId,
  selectedRow,
  onResetSelection,
  onRefresh,
}: Props) {
  const form = useForm<InsertBirWithholdingTaxBracketSchemaType>({
    resolver: zodResolver(insertBirWithholdingTaxBracketSchema),
    defaultValues: getEmptyValues(selectedVersionId),
  });

  const { execute: saveRow, isExecuting: saving } = useAction(
    saveBirWithholdingTaxBracketAction,
    {
      onSuccess: (result) => {
        if (result?.data?.error) {
          toast.error(result.data.error);
          return;
        }

        toast.success(result?.data?.message ?? "BIR bracket saved.");
        form.reset(getEmptyValues(selectedVersionId));
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to save BIR bracket.");
      },
    }
  );

  const { execute: removeRow, isExecuting: deleting } = useAction(
    deleteBirWithholdingTaxBracketAction,
    {
      onSuccess: (result) => {
        if (result?.data?.error) {
          toast.error(result.data.error);
          return;
        }

        toast.success(result?.data?.message ?? "BIR bracket deleted.");
        form.reset(getEmptyValues(selectedVersionId));
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to delete BIR bracket.");
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
      payrollTerms: "Semi-Monthly",
      compensationFrom: selectedRow.compensationFrom,
      compensationTo: selectedRow.compensationTo,
      baseTax: selectedRow.baseTax,
      overPercentage: selectedRow.overPercentage,
    });
  }, [form, selectedRow, selectedVersionId]);

  function submitForm(data: InsertBirWithholdingTaxBracketSchemaType) {
    saveRow({
      ...data,
      versionId: selectedVersionId ?? data.versionId,
      payrollTerms: "Semi-Monthly",
    });
  }

  function handleDelete() {
    if (!selectedRow?.id) return;
    if (!window.confirm("Delete this BIR withholding tax bracket?")) return;
    removeRow({ id: selectedRow.id });
  }

  function handleReset() {
    form.reset(getEmptyValues(selectedVersionId));
    onResetSelection?.();
  }

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">BIR Withholding Tax Brackets</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="flex flex-col gap-4 md:flex-row md:gap-8"
        >
          <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
            <InputWithLabel<InsertBirWithholdingTaxBracketSchemaType>
              fieldTitle="Payroll Terms"
              nameInSchema="payrollTerms"
              register={form.register}
              readOnly
            />
            <InputWithLabel<InsertBirWithholdingTaxBracketSchemaType>
              fieldTitle="Compensation From"
              nameInSchema="compensationFrom"
              register={form.register}
              type="number"
              step="0.01"
            />
            <InputWithLabel<InsertBirWithholdingTaxBracketSchemaType>
              fieldTitle="Compensation To"
              nameInSchema="compensationTo"
              register={form.register}
              type="number"
              step="0.01"
            />
            <InputWithLabel<InsertBirWithholdingTaxBracketSchemaType>
              fieldTitle="Base Tax"
              nameInSchema="baseTax"
              register={form.register}
              type="number"
              step="0.01"
            />
            <InputWithLabel<InsertBirWithholdingTaxBracketSchemaType>
              fieldTitle="Over Percentage"
              nameInSchema="overPercentage"
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

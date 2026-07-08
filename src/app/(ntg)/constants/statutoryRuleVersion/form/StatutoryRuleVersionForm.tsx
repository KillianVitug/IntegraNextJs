"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { statutoryRuleTypeEnum } from "@/db/schema";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { DateWithLabel } from "@/components/inputs/DateWithLabel";
import { CheckboxWithLabel } from "@/components/inputs/CheckboxWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { TextAreaWithLabel } from "@/components/inputs/TextAreaWithLabel";
import {
  insertStatutoryRuleVersionSchema,
  type InsertStatutoryRuleVersionSchemaType,
  type SelectStatutoryRuleVersionSchemaType,
} from "@/zod-schemas/statutoryRuleVersion";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import {
  deleteStatutoryRuleVersionAction,
  saveStatutoryRuleVersionAction,
} from "@/app/actions/payrollStatutoryAction";

type Props = {
  selectedVersion: SelectStatutoryRuleVersionSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

const emptyValues: InsertStatutoryRuleVersionSchemaType = {
  id: 0,
  ruleType: statutoryRuleTypeEnum.enumValues[0],
  code: "",
  description: null,
  payrollTerms: "Semi-Monthly",
  effectiveFrom: "",
  effectiveTo: null,
  isDefault: false,
};

export default function StatutoryRuleVersionForm({
  selectedVersion,
  onResetSelection,
  onRefresh,
}: Props) {
  const form = useForm<InsertStatutoryRuleVersionSchemaType>({
    resolver: zodResolver(insertStatutoryRuleVersionSchema),
    defaultValues: emptyValues,
  });

  const { execute: saveVersion, isExecuting: saving } = useAction(
    saveStatutoryRuleVersionAction,
    {
      onSuccess: (result) => {
        if (result?.data?.error) {
          toast.error(result.data.error);
          return;
        }

        toast.success(result?.data?.message ?? "Statutory rule version saved.");
        form.reset(emptyValues);
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to save statutory rule version.");
      },
    }
  );

  const { execute: removeVersion, isExecuting: deleting } = useAction(
    deleteStatutoryRuleVersionAction,
    {
      onSuccess: (result) => {
        if (result?.data?.error) {
          toast.error(result.data.error);
          return;
        }

        toast.success(result?.data?.message ?? "Statutory rule version deleted.");
        form.reset(emptyValues);
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to delete statutory rule version.");
      },
    }
  );

  useEffect(() => {
    if (!selectedVersion) {
      form.reset(emptyValues);
      return;
    }

    form.reset({
      id: selectedVersion.id,
      ruleType: selectedVersion.ruleType,
      code: selectedVersion.code,
      description: selectedVersion.description ?? null,
      payrollTerms: "Semi-Monthly",
      effectiveFrom: selectedVersion.effectiveFrom,
      effectiveTo: selectedVersion.effectiveTo ?? null,
      isDefault: selectedVersion.isDefault,
    });
  }, [form, selectedVersion]);

  function submitForm(data: InsertStatutoryRuleVersionSchemaType) {
    saveVersion({
      ...data,
      payrollTerms: "Semi-Monthly",
    });
  }

  function handleDelete() {
    if (!selectedVersion?.id) return;
    if (!window.confirm("Delete this statutory rule version?")) return;
    removeVersion({ id: selectedVersion.id });
  }

  function handleReset() {
    form.reset(emptyValues);
    onResetSelection?.();
  }

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">Statutory Rule Versions</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="flex flex-col gap-4 md:flex-row md:gap-8"
        >
          <div className="flex w-full max-w-xs flex-col gap-4">
            <SelectWithLabel<InsertStatutoryRuleVersionSchemaType>
              fieldTitle="Rule Type"
              nameInSchema="ruleType"
              control={form.control}
              data={enumToSelectOptions(statutoryRuleTypeEnum.enumValues)}
            />
            <InputWithLabel<InsertStatutoryRuleVersionSchemaType>
              fieldTitle="Version Code"
              nameInSchema="code"
              register={form.register}
            />
            <InputWithLabel<InsertStatutoryRuleVersionSchemaType>
              fieldTitle="Payroll Terms"
              nameInSchema="payrollTerms"
              register={form.register}
              readOnly
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-4">
            <DateWithLabel<InsertStatutoryRuleVersionSchemaType>
              fieldTitle="Effective From"
              nameInSchema="effectiveFrom"
              control={form.control}
            />
            <div className="space-y-2">
              <DateWithLabel<InsertStatutoryRuleVersionSchemaType>
                fieldTitle="Effective To"
                nameInSchema="effectiveTo"
                control={form.control}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full max-w-xs"
                onClick={() => form.setValue("effectiveTo", null)}
              >
                Clear Effective To
              </Button>
            </div>
            <CheckboxWithLabel<InsertStatutoryRuleVersionSchemaType>
              fieldTitle="Default Version"
              nameInSchema="isDefault"
              message=""
            />
          </div>

          <div className="flex w-full max-w-sm flex-col gap-4">
            <TextAreaWithLabel<InsertStatutoryRuleVersionSchemaType>
              fieldTitle="Description"
              nameInSchema="description"
              className="min-h-28"
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-2">
            <Button type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : selectedVersion?.id
                  ? "Update Version"
                  : "Add Version"}
            </Button>

            {selectedVersion?.id ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Version"}
              </Button>
            ) : null}

            <Button type="button" variant="outline" onClick={handleReset}>
              {selectedVersion?.id ? "Cancel Edit" : "Reset"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

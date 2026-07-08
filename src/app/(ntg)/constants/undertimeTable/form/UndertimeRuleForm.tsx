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
  deleteUndertimeRuleAction,
  saveUndertimeRuleAction,
} from "@/app/actions/payrollConfigAction";
import {
  insertUndertimeRuleSchema,
  type InsertUndertimeRuleSchemaType,
  type SelectUndertimeRuleSchemaType,
} from "@/zod-schemas/undertimeRule";

type Props = {
  selectedRow: SelectUndertimeRuleSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

const emptyValues: InsertUndertimeRuleSchemaType = {
  id: 0,
  minutesFrom: 0,
  minutesTo: null,
  rateMultiplier: 1,
};

export default function UndertimeRuleForm({
  selectedRow,
  onResetSelection,
  onRefresh,
}: Props) {
  const form = useForm<InsertUndertimeRuleSchemaType>({
    resolver: zodResolver(insertUndertimeRuleSchema),
    defaultValues: emptyValues,
  });

  const { execute: saveRule, isExecuting: saving } = useAction(
    saveUndertimeRuleAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Undertime rule saved.");
        form.reset(emptyValues);
        onResetSelection?.();
        onRefresh?.();
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? "Unable to save undertime rule.");
      },
    }
  );

  const { execute: deleteRule, isExecuting: deleting } = useAction(
    deleteUndertimeRuleAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Undertime rule deleted.");
        form.reset(emptyValues);
        onResetSelection?.();
        onRefresh?.();
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? "Unable to delete undertime rule.");
      },
    }
  );

  useEffect(() => {
    if (!selectedRow) {
      form.reset(emptyValues);
      return;
    }

    form.reset({
      id: selectedRow.id,
      minutesFrom: selectedRow.minutesFrom,
      minutesTo: selectedRow.minutesTo,
      rateMultiplier: selectedRow.rateMultiplier,
    });
  }, [form, selectedRow]);

  function submitForm(data: InsertUndertimeRuleSchemaType) {
    saveRule(data);
  }

  function handleDelete() {
    if (!selectedRow?.id) return;
    if (!window.confirm("Delete this undertime rule?")) return;
    deleteRule({ id: selectedRow.id });
  }

  function handleReset() {
    form.reset(emptyValues);
    onResetSelection?.();
  }

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">Undertime Table</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="flex flex-col gap-4 md:flex-row md:gap-8"
        >
          <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
            <InputWithLabel<InsertUndertimeRuleSchemaType>
              fieldTitle="Minutes From"
              nameInSchema="minutesFrom"
              register={form.register}
              type="number"
            />
            <InputWithLabel<InsertUndertimeRuleSchemaType>
              fieldTitle="Minutes To"
              nameInSchema="minutesTo"
              register={form.register}
              type="number"
            />
            <InputWithLabel<InsertUndertimeRuleSchemaType>
              fieldTitle="Rate Multiplier"
              nameInSchema="rateMultiplier"
              register={form.register}
              type="number"
              step="0.0001"
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-2">
            <Button type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : selectedRow?.id
                  ? "Update Rule"
                  : "Add Rule"}
            </Button>

            {selectedRow?.id ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Rule"}
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

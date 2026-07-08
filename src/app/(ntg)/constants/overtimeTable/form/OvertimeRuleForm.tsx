"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteOvertimeRuleAction,
  saveOvertimeRuleAction,
} from "@/app/actions/payrollConfigAction";
import {
  OVERTIME_CATEGORY_LABELS,
  overtimeCategoryValues,
} from "@/lib/payroll/overtime";
import {
  insertOvertimeRuleSchema,
  type InsertOvertimeRuleSchemaType,
  type SelectOvertimeRuleSchemaType,
} from "@/zod-schemas/overtimeRule";

type Props = {
  selectedRow: SelectOvertimeRuleSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

const emptyValues: InsertOvertimeRuleSchemaType = {
  id: 0,
  category: "REGULAR_DAY",
  minutesFrom: 0,
  minutesTo: null,
  rateMultiplier: 1,
};

export default function OvertimeRuleForm({
  selectedRow,
  onResetSelection,
  onRefresh,
}: Props) {
  const form = useForm<InsertOvertimeRuleSchemaType>({
    resolver: zodResolver(insertOvertimeRuleSchema),
    defaultValues: emptyValues,
  });

  const { execute: saveRule, isExecuting: saving } = useAction(
    saveOvertimeRuleAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Overtime rule saved.");
        form.reset(emptyValues);
        onResetSelection?.();
        onRefresh?.();
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? "Unable to save overtime rule.");
      },
    }
  );

  const { execute: deleteRule, isExecuting: deleting } = useAction(
    deleteOvertimeRuleAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Overtime rule deleted.");
        form.reset(emptyValues);
        onResetSelection?.();
        onRefresh?.();
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? "Unable to delete overtime rule.");
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
      category: selectedRow.category,
      minutesFrom: selectedRow.minutesFrom,
      minutesTo: selectedRow.minutesTo,
      rateMultiplier: selectedRow.rateMultiplier,
    });
  }, [form, selectedRow]);

  function submitForm(data: InsertOvertimeRuleSchemaType) {
    saveRule(data);
  }

  function handleDelete() {
    if (!selectedRow?.id) return;
    if (!window.confirm("Delete this overtime rule?")) return;
    deleteRule({ id: selectedRow.id });
  }

  function handleReset() {
    form.reset(emptyValues);
    onResetSelection?.();
  }

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">Overtime Table</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="flex flex-col gap-4 md:flex-row md:gap-8"
        >
          <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-4">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full max-w-xs">
                        <SelectValue placeholder="Select OT category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {overtimeCategoryValues.map((category) => (
                        <SelectItem key={category} value={category}>
                          {OVERTIME_CATEGORY_LABELS[category]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <InputWithLabel<InsertOvertimeRuleSchemaType>
              fieldTitle="Minutes From"
              nameInSchema="minutesFrom"
              register={form.register}
              type="number"
            />
            <InputWithLabel<InsertOvertimeRuleSchemaType>
              fieldTitle="Minutes To"
              nameInSchema="minutesTo"
              register={form.register}
              type="number"
            />
            <InputWithLabel<InsertOvertimeRuleSchemaType>
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

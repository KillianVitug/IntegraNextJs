"use client";

import { useCallback, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { holidayTypeEnum } from "@/db/schema";
import { saveHolidayTypeAccountCodeAction } from "@/app/actions/payrollConfigAction";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import {
  saveHolidayTypeAccountCodeSchema,
  type SaveHolidayTypeAccountCodeSchemaType,
  type SelectHolidayTypeAccountCodeSchemaType,
} from "@/zod-schemas/holidayTypeAccountCode";

type AccountCodeOption = {
  id: number;
  accountCode: string;
  description: string | null;
  accountType: string | null;
};

type Props = {
  selectedHolidayType: SelectHolidayTypeAccountCodeSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

const emptyValues: SaveHolidayTypeAccountCodeSchemaType = {
  holidayType: holidayTypeEnum.enumValues[0],
  accountCodeId: null,
  overtimeAccountCodeId: null,
  restDayAccountCodeId: null,
  restDayOvertimeAccountCodeId: null,
};

export default function HolidayTypeForm({
  selectedHolidayType,
  onResetSelection,
  onRefresh,
}: Props) {
  const [accountCodes, setAccountCodes] = useState<AccountCodeOption[]>([]);
  const form = useForm<SaveHolidayTypeAccountCodeSchemaType>({
    resolver: zodResolver(saveHolidayTypeAccountCodeSchema),
    defaultValues: emptyValues,
  });

  const loadAccountCodes = useCallback(async () => {
    const response = await fetch("/api/constants/accountCode");
    const data = await response.json();
    setAccountCodes(data);
  }, []);

  const { execute: saveHolidayType, isExecuting: saving } = useAction(
    saveHolidayTypeAccountCodeAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Holiday type saved.");
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to save holiday type.");
      },
    }
  );

  useEffect(() => {
    void loadAccountCodes();
  }, [loadAccountCodes]);

  useEffect(() => {
    if (!selectedHolidayType) {
      form.reset(emptyValues);
      return;
    }

    form.reset({
      holidayType: selectedHolidayType.holidayType,
      accountCodeId: selectedHolidayType.accountCodeId ?? null,
      overtimeAccountCodeId: selectedHolidayType.overtimeAccountCodeId ?? null,
      restDayAccountCodeId: selectedHolidayType.restDayAccountCodeId ?? null,
      restDayOvertimeAccountCodeId:
        selectedHolidayType.restDayOvertimeAccountCodeId ?? null,
    });
  }, [form, selectedHolidayType]);

  function submitForm(data: SaveHolidayTypeAccountCodeSchemaType) {
    saveHolidayType(data);
  }

  function handleReset() {
    form.reset(emptyValues);
    onResetSelection?.();
  }

  function saveCurrentValues(
    values: Partial<SaveHolidayTypeAccountCodeSchemaType>
  ) {
    saveHolidayType({
      holidayType: form.getValues("holidayType"),
      accountCodeId: form.getValues("accountCodeId") ?? null,
      overtimeAccountCodeId: form.getValues("overtimeAccountCodeId") ?? null,
      restDayAccountCodeId: form.getValues("restDayAccountCodeId") ?? null,
      restDayOvertimeAccountCodeId:
        form.getValues("restDayOvertimeAccountCodeId") ?? null,
      ...values,
    });
  }

  function handleClearRegularAccount() {
    form.setValue("accountCodeId", null);
    saveCurrentValues({ accountCodeId: null });
  }

  function handleClearOvertimeAccount() {
    form.setValue("overtimeAccountCodeId", null);
    saveCurrentValues({ overtimeAccountCodeId: null });
  }

  function handleClearRestDayAccount() {
    form.setValue("restDayAccountCodeId", null);
    saveCurrentValues({ restDayAccountCodeId: null });
  }

  function handleClearRestDayOvertimeAccount() {
    form.setValue("restDayOvertimeAccountCodeId", null);
    saveCurrentValues({ restDayOvertimeAccountCodeId: null });
  }

  const regularHolidayAccountOptions = accountCodes
    .filter((account) => account.accountType === "Sunday/Holiday")
    .sort((left, right) => left.accountCode.localeCompare(right.accountCode))
    .map((account) => ({
      id: account.id,
      name: account.description
        ? `${account.accountCode} | ${account.description}`
        : account.accountCode,
    }));
  const overtimeAccountOptions = accountCodes
    .filter((account) => account.accountType === "Overtime")
    .sort((left, right) => left.accountCode.localeCompare(right.accountCode))
    .map((account) => ({
      id: account.id,
      name: account.description
        ? `${account.accountCode} | ${account.description}`
        : account.accountCode,
    }));

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">Holiday Type</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"
        >
          <div className="flex w-full max-w-xs flex-col gap-4">
            <InputWithLabel<SaveHolidayTypeAccountCodeSchemaType>
              fieldTitle="Holiday Type"
              nameInSchema="holidayType"
              register={form.register}
              readOnly
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-4">
            <SelectWithLabel<SaveHolidayTypeAccountCodeSchemaType>
              fieldTitle="Regular Holiday Hours"
              nameInSchema="accountCodeId"
              control={form.control}
              data={regularHolidayAccountOptions}
              isClearable
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-4">
            <SelectWithLabel<SaveHolidayTypeAccountCodeSchemaType>
              fieldTitle="Holiday Overtime"
              nameInSchema="overtimeAccountCodeId"
              control={form.control}
              data={overtimeAccountOptions}
              isClearable
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-4">
            <SelectWithLabel<SaveHolidayTypeAccountCodeSchemaType>
              fieldTitle="Rest Day Holiday Hours"
              nameInSchema="restDayAccountCodeId"
              control={form.control}
              data={regularHolidayAccountOptions}
              isClearable
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-4">
            <SelectWithLabel<SaveHolidayTypeAccountCodeSchemaType>
              fieldTitle="Rest Day Holiday Overtime"
              nameInSchema="restDayOvertimeAccountCodeId"
              control={form.control}
              data={overtimeAccountOptions}
              isClearable
            />
          </div>

          <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-5">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Holiday Type"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClearRegularAccount}
              disabled={saving}
            >
              Clear Regular Code
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClearOvertimeAccount}
              disabled={saving}
            >
              Clear Overtime Code
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClearRestDayAccount}
              disabled={saving}
            >
              Clear Rest Day Code
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClearRestDayOvertimeAccount}
              disabled={saving}
            >
              Clear Rest Day OT Code
            </Button>
            <Button type="button" variant="outline" onClick={handleReset}>
              Reset
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

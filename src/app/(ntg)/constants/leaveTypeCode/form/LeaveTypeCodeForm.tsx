"use client";

import { useCallback, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { CheckboxWithLabel } from "@/components/inputs/CheckboxWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import {
  insertLeaveTypeSchema,
  type InsertLeaveTypeSchemaType,
  type SelectLeaveTypeSchemaType,
} from "@/zod-schemas/leaveType";
import {
  deleteLeaveTypeAction,
  saveLeaveTypeAction,
} from "@/app/actions/payrollConfigAction";

type AccountCodeOption = {
  id: number;
  accountCode: string;
  description: string | null;
  accountType: string | null;
};

type Props = {
  selectedLeaveType: SelectLeaveTypeSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

const emptyValues: InsertLeaveTypeSchemaType = {
  id: 0,
  code: "",
  name: "",
  accountCodeId: 0,
  isPaid: true,
  requiresBalance: true,
  annualEntitlement: 0,
  colorHex: null,
  carryoverLimit: 0,
  expiryMonth: 12,
  expiryDay: 31,
  encashmentEnabled: false,
  encashmentTaxable: true,
  encashmentMonth13thEligible: false,
  encashmentAccountCodeId: null,
  halfDayAllowed: true,
  excludeRestDaysAndHolidays: true,
};

export default function LeaveTypeCodeForm({
  selectedLeaveType,
  onResetSelection,
  onRefresh,
}: Props) {
  const [accountCodes, setAccountCodes] = useState<AccountCodeOption[]>([]);
  const form = useForm<InsertLeaveTypeSchemaType>({
    resolver: zodResolver(insertLeaveTypeSchema),
    defaultValues: emptyValues,
  });

  const loadAccountCodes = useCallback(async () => {
    const response = await fetch("/api/constants/accountCode");
    const data = await response.json();
    setAccountCodes(data);
  }, []);

  const { execute: saveLeaveType, isExecuting: saving } = useAction(
    saveLeaveTypeAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Leave type saved.");
        form.reset(emptyValues);
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to save leave type.");
      },
    }
  );

  const { execute: removeLeaveType, isExecuting: deleting } = useAction(
    deleteLeaveTypeAction,
    {
      onSuccess: (result) => {
        toast.success(result?.data?.message ?? "Leave type deleted.");
        form.reset(emptyValues);
        onResetSelection?.();
        onRefresh?.();
      },
      onError: () => {
        toast.error("Unable to delete leave type.");
      },
    }
  );

  useEffect(() => {
    void loadAccountCodes();
  }, [loadAccountCodes]);

  useEffect(() => {
    if (!selectedLeaveType) {
      form.reset(emptyValues);
      return;
    }

    form.reset({
      id: selectedLeaveType.id,
      code: selectedLeaveType.code,
      name: selectedLeaveType.name,
      accountCodeId: selectedLeaveType.accountCodeId ?? 0,
      isPaid: selectedLeaveType.isPaid,
      requiresBalance: selectedLeaveType.requiresBalance,
      annualEntitlement: selectedLeaveType.annualEntitlement,
      colorHex: selectedLeaveType.colorHex ?? null,
      carryoverLimit: selectedLeaveType.carryoverLimit ?? 0,
      expiryMonth: selectedLeaveType.expiryMonth ?? 12,
      expiryDay: selectedLeaveType.expiryDay ?? 31,
      encashmentEnabled: selectedLeaveType.encashmentEnabled ?? false,
      encashmentTaxable: selectedLeaveType.encashmentTaxable ?? true,
      encashmentMonth13thEligible:
        selectedLeaveType.encashmentMonth13thEligible ?? false,
      encashmentAccountCodeId: selectedLeaveType.encashmentAccountCodeId ?? null,
      halfDayAllowed: selectedLeaveType.halfDayAllowed ?? true,
      excludeRestDaysAndHolidays:
        selectedLeaveType.excludeRestDaysAndHolidays ?? true,
    });
  }, [form, selectedLeaveType]);

  function submitForm(data: InsertLeaveTypeSchemaType) {
    saveLeaveType(data);
  }

  function handleDelete() {
    if (!selectedLeaveType?.id) return;
    if (!window.confirm("Delete this leave type?")) return;
    removeLeaveType({ id: selectedLeaveType.id });
  }

  function handleReset() {
    form.reset(emptyValues);
    onResetSelection?.();
  }

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <h2 className="text-2xl font-bold">Leave Type Codes</h2>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm)}
          className="flex flex-col gap-4 md:flex-row md:gap-8"
        >
          <div className="flex w-full max-w-xs flex-col gap-4">
            <InputWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Code"
              nameInSchema="code"
              register={form.register}
            />
            <InputWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Name"
              nameInSchema="name"
              register={form.register}
            />
            <SelectWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Payroll Account Code"
              nameInSchema="accountCodeId"
              control={form.control}
              data={accountCodes
                .filter(
                  (account) =>
                    account.accountType === "Paid Leaves" ||
                    account.accountType === "Unpaid Leaves/Absences"
                )
                .sort((left, right) => left.accountCode.localeCompare(right.accountCode))
                .map((account) => ({
                  id: account.id,
                  name: account.description
                    ? `${account.accountCode} | ${account.description}`
                    : account.accountCode,
                }))}
            />
            <InputWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Annual Entitlement"
              nameInSchema="annualEntitlement"
              register={form.register}
              type="number"
              step="0.01"
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-4">
            <InputWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Color Hex"
              nameInSchema="colorHex"
              register={form.register}
            />
            <InputWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Carryover Limit"
              nameInSchema="carryoverLimit"
              register={form.register}
              type="number"
              step="0.01"
              min="0"
            />
            <div className="grid grid-cols-2 gap-3">
              <InputWithLabel<InsertLeaveTypeSchemaType>
                fieldTitle="Expiry Month"
                nameInSchema="expiryMonth"
                register={form.register}
                type="number"
                min="1"
                max="12"
              />
              <InputWithLabel<InsertLeaveTypeSchemaType>
                fieldTitle="Expiry Day"
                nameInSchema="expiryDay"
                register={form.register}
                type="number"
                min="1"
                max="31"
              />
            </div>
            <CheckboxWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Paid Leave"
              nameInSchema="isPaid"
              message=""
            />
            <CheckboxWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Requires Balance"
              nameInSchema="requiresBalance"
              message=""
            />
            <CheckboxWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Allow Half Day"
              nameInSchema="halfDayAllowed"
              message=""
            />
            <CheckboxWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Exclude Rest Days/Holidays"
              nameInSchema="excludeRestDaysAndHolidays"
              message=""
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-4">
            <CheckboxWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Allow Encashment"
              nameInSchema="encashmentEnabled"
              message=""
            />
            <CheckboxWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Taxable Encashment"
              nameInSchema="encashmentTaxable"
              message=""
            />
            <CheckboxWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="13th Month Eligible"
              nameInSchema="encashmentMonth13thEligible"
              message=""
            />
            <SelectWithLabel<InsertLeaveTypeSchemaType>
              fieldTitle="Encashment Account Code"
              nameInSchema="encashmentAccountCodeId"
              control={form.control}
              isClearable
              data={accountCodes
                .filter(
                  (account) =>
                    account.accountType === "Other Income" ||
                    account.accountType === "Paid Leaves"
                )
                .sort((left, right) => left.accountCode.localeCompare(right.accountCode))
                .map((account) => ({
                  id: account.id,
                  name: account.description
                    ? `${account.accountCode} | ${account.description}`
                    : account.accountCode,
                }))}
            />
          </div>

          <div className="flex w-full max-w-xs flex-col gap-2">
            <Button type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : selectedLeaveType?.id
                  ? "Update Leave Type"
                  : "Add Leave Type"}
            </Button>

            {selectedLeaveType?.id ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Leave Type"}
              </Button>
            ) : null}

            <Button type="button" variant="outline" onClick={handleReset}>
              {selectedLeaveType?.id ? "Cancel Edit" : "Reset"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

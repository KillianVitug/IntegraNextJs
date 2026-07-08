"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import {
  FormActions,
  FormGrid,
  PageHeader,
} from "@/components/layout/page-layout";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { CheckboxWithLabel } from "@/components/inputs/CheckboxWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { useAction } from "next-safe-action/hooks";
import { accountTypeEnum } from "@/db/schema";
import {
  insertAccountCodeSchema,
  InsertAccountCodeSchemaType,
  UpdateAccountCodeSchemaType,
} from "@/zod-schemas/accountCode";
import {
  saveAccountCodeAction,
  updateAccountCodeAction,
  deleteAccountCodeAction,
} from "@/app/actions/saveConstantAction";
import { enumToSelectOptions } from "@/utils/enumHelpers";

// 🔹 Mapping of account type → numeric code
const accountTypeCodeMap: Record<string, number> = {
  "Regular Hours": 1,
  "Overtime": 2,
  "Night Premium": 3,
  "Sunday/Holiday": 4,
  "Paid Leaves": 5,
  "Unpaid Leaves/Absences": 6,
  "Other Income": 7,
  "Loan": 8,
  "Other Deduction": 9,
};

type Props = {
  selectedAccountCode: InsertAccountCodeSchemaType | null;
  onResetSelection?: () => void;
  onRefresh?: () => void;
};

function formatDecimalInput(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  return String(value);
}

export default function AccountCodeForm({
  selectedAccountCode,
  onResetSelection,
  onRefresh,
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // ✅ Base form (using create schema by default)
  const form = useForm<InsertAccountCodeSchemaType>({
    resolver: zodResolver(insertAccountCodeSchema),
    defaultValues: {
      id: 0,
      accountCode: "",
      description: "",
      dailyRate: null,
      monthlyRate: null,
      accountType: null,
      month13thPay: false,
      nonTaxable: false,
      deminimis: false,
      healthInsurance: false,
    },
  });

  // ✅ Create action
  const {
    execute: save,
    isExecuting: saving,
    reset: resetSave,
  } = useAction(saveAccountCodeAction, {
    onSuccess: () => {
      console.log("✅ Account Code added");
      form.reset();
      setSelectedId(null);
      onResetSelection?.();
      onRefresh?.();
    },
    onError: (error) => console.error("❌ Add error:", error),
  });

  // ✅ Update action
  const {
    execute: update,
    isExecuting: updating,
    reset: resetUpdate,
  } = useAction(updateAccountCodeAction, {
    onSuccess: () => {
      console.log("✅ Account Code updated");
      form.reset();
      setSelectedId(null);
      onResetSelection?.();
      onRefresh?.();
    },
    onError: (error) => console.error("❌ Update error:", error),
  });

  // ✅ Delete action
  const { execute: remove, isExecuting: deleting } = useAction(
    deleteAccountCodeAction,
    {
      onSuccess: () => {
        console.log("🗑️ Account Code deleted");
        form.reset({ id: 0 });
        setSelectedId(null);
        onResetSelection?.();
        onRefresh?.();
      },
      onError: (error) => console.error("❌ Delete error:", error),
    }
  );

  // 🔹 Update form and ID when selecting a row
  useEffect(() => {
    if (selectedAccountCode) {
      const numericId = Number(selectedAccountCode.id);
      const fullCode = selectedAccountCode.accountCode ?? "";
  
      // 🔹 Strip the prefix "digit-" (like "1-100" -> "100")
      const strippedCode = fullCode.includes("-")
        ? fullCode.split("-")[1]
        : fullCode;
  
      console.log("🟢 Selected row ID:", numericId);
  
      setSelectedId(numericId);
      form.reset({
        ...selectedAccountCode,
        id: numericId,
        accountCode: strippedCode, // ✅ only show the digits
        dailyRate: formatDecimalInput(selectedAccountCode.dailyRate),
        monthlyRate: formatDecimalInput(selectedAccountCode.monthlyRate),
      });
    } else {
      setSelectedId(null);
      form.reset({
        id: 0,
        accountCode: "",
        description: "",
        dailyRate: null,
        monthlyRate: null,
        accountType: null,
        month13thPay: false,
        nonTaxable: false,
        deminimis: false,
        healthInsurance: false,
      });
    }
  }, [selectedAccountCode, form]);
  

  // 🔹 Submit handler (auto-detect create vs update)
  const submitForm = (data: InsertAccountCodeSchemaType) => {
    console.log("🟢 submitForm triggered with data:", data);
    const accountTypeCode = accountTypeCodeMap[data.accountType ?? ""] ?? "";
    const formattedCode = `${accountTypeCode}-${data.accountCode}`;

    const baseData = {
      ...data,
      accountCode: formattedCode,
      accountTypeCode,
    };

    if (!selectedId || selectedId === 0) {
      // 🟢 CREATE
      save(baseData);
    } else {
      // 🟣 UPDATE
      const updatePayload: UpdateAccountCodeSchemaType = {
        ...baseData,
        id: selectedId,
      };
      update(updatePayload);
    }
  };

  // 🔹 Delete record
  const handleDelete = () => {
    if (!selectedId) return;
    if (confirm("Are you sure you want to delete this account code?")) {
      remove({ id: selectedId });
    }
  };

  // 🔹 Cancel or reset
  const handleCancel = () => {
    setSelectedId(null);
    form.reset({
      id: 0,
      accountCode: "",
      description: "",
      dailyRate: null,
      monthlyRate: null,
      accountType: null,
      month13thPay: false,
      nonTaxable: false,
      deminimis: false,
      healthInsurance: false,
    });
    onResetSelection?.();
    resetSave();
    resetUpdate();
  };

  // 🔹 Watch account type to auto-update numeric code
  const accountType = form.watch("accountType");
  const accountTypeCode = accountTypeCodeMap[accountType ?? ""] ?? "";

  return (
    <div className="space-y-4">
      <PageHeader title="Account Code" />
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(
            submitForm,
            (errors) => {
              console.log("❌ Validation failed, errors:", errors);
            }
          )}
          className="space-y-3"
        >
          <FormGrid columns={4}>
          {/* Hidden ID input */}
          <Controller
            name="id"
            control={form.control}
            render={({ field }) => (
              <input type="hidden" {...field} value={field.value ?? 0} />
            )}
          />

          {/* Left column */}
          <div className="flex w-full min-w-0 flex-col gap-3">
            <SelectWithLabel<InsertAccountCodeSchemaType>
              fieldTitle="Account Type"
              nameInSchema="accountType"
              control={form.control}
              data={enumToSelectOptions(accountTypeEnum.enumValues)}
            />

            {/* Account Code input + numeric code */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <InputWithLabel<InsertAccountCodeSchemaType>
                  fieldTitle="Account Code"
                  nameInSchema="accountCode"
                  register={form.register}
                />
              </div>
              <div className="w-16">
                <label className="text-sm text-muted-foreground">Code</label>
                <input
                  className="border rounded px-2 py-1 w-full text-center"
                  value={String(accountTypeCode)}
                  readOnly
                  disabled
                />
              </div>
            </div>

            <InputWithLabel<InsertAccountCodeSchemaType>
              fieldTitle="Description"
              nameInSchema="description"
              register={form.register}
            />
          </div>

          {/* Middle column */}
          <div className="flex w-full min-w-0 flex-col gap-3">
            <InputWithLabel<InsertAccountCodeSchemaType>
              fieldTitle="Daily Rate"
              nameInSchema="dailyRate"
              register={form.register}
              inputMode="decimal"
              placeholder="0.0000"
            />
            <InputWithLabel<InsertAccountCodeSchemaType>
              fieldTitle="Monthly Rate"
              nameInSchema="monthlyRate"
              register={form.register}
              inputMode="decimal"
              placeholder="0.0000"
            />
          </div>

          {/* Right column */}
          <div className="flex w-full min-w-0 flex-col gap-3">
            <CheckboxWithLabel<InsertAccountCodeSchemaType>
              fieldTitle="13th Month Pay"
              nameInSchema="month13thPay"
              message=""
            />
            <CheckboxWithLabel<InsertAccountCodeSchemaType>
              fieldTitle="Non Taxable"
              nameInSchema="nonTaxable"
              message=""
            />
            <CheckboxWithLabel<InsertAccountCodeSchemaType>
              fieldTitle="De minimis"
              nameInSchema="deminimis"
              message=""
            />
            <CheckboxWithLabel<InsertAccountCodeSchemaType>
              fieldTitle="Health Insurance"
              nameInSchema="healthInsurance"
              message=""
            />
          </div>

          {/* Buttons */}
          <FormActions align="start" className="flex-col items-stretch pt-0 sm:items-start">
            <Button type="submit" disabled={saving || updating}>
              {saving
                ? "Saving..."
                : updating
                ? "Updating..."
                : selectedId
                ? "Update"
                : "Add"}
            </Button>

            {selectedId && (
              <Button
                type="button"
                variant="destructive"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            )}

            <Button type="button" variant="outline" onClick={handleCancel}>
              {selectedId ? "Cancel" : "Reset"}
            </Button>
          </FormActions>
          </FormGrid>
        </form>
      </Form>
    </div>
  );
}

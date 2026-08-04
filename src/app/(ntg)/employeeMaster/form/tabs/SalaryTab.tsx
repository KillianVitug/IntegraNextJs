"use client";

import React from "react";
import { Controller, useWatch, useFormContext } from "react-hook-form";

import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { InsertEmployeeSchemaType } from "@/zod-schemas/employee";
import type { EmployeeSalaryTabView } from "@/zod-schemas/employeeSalary";

import { showRateHistory } from "@/utils/showRateHistory";
import { showCustomPayrollHistory } from "@/utils/showCustomPayrollHistory";

import { useRouter } from "next/navigation";

type Props = {
  employeeId?: string;
  slvlGroups: { id: number; name: string }[];
  customPayrollCodes: {
    id: number;
    code: string;
    description: string | null;
    rateDivisor: string | null;
  }[];
  salaryTabView?: EmployeeSalaryTabView | null;
};

function toAmount(value: string | null | undefined) {
  if (!value) return 0;

  const normalized = value.replace(/,/g, "").trim();
  const numericValue = Number(normalized);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function getPayrollBasis(
  dailyRate: string | null | undefined,
  monthlyRate: string | null | undefined
) {
  if (toAmount(monthlyRate) > 0) return "Monthly Rate";
  if (toAmount(dailyRate) > 0) return "Daily Rate";
  return null;
}

export default function SalaryTab({
  employeeId,
  slvlGroups,
  customPayrollCodes,
}: Props) {
  const { register, control, setValue } = useFormContext<InsertEmployeeSchemaType>();
  const router = useRouter();

  const selectedPayrollId = useWatch({
    control,
    name: "salary.customPayrollId",
  });
  const dailyRateValue = useWatch({
    control,
    name: "salary.dailyRate",
  });
  const monthlyRateValue = useWatch({
    control,
    name: "salary.monthlyRate",
  });

  React.useEffect(() => {
    if (!selectedPayrollId) {
      setValue("salary.customPayrollDescription", "");
      return;
    }

    if (!customPayrollCodes?.length) {
      setValue("salary.customPayrollDescription", "");
      return;
    }

    const payroll = customPayrollCodes.find(
      (p) => p.id === Number(selectedPayrollId)
    );

    if (!payroll) {
      setValue("salary.customPayrollId", null);
      setValue("salary.customPayrollDescription", "");
      return;
    }

    setValue("salary.rateDivisor", payroll.rateDivisor ?? "");
    setValue("salary.customPayrollDescription", payroll.description ?? "");
  }, [selectedPayrollId, customPayrollCodes, setValue]);

  const payrollBasis = getPayrollBasis(dailyRateValue, monthlyRateValue);

  return (
    <div className="p-4">
      <div className="grid grid-cols-3 gap-3 mb-6">
        <InputWithLabel
          fieldTitle="Daily Rate"
          nameInSchema="salary.dailyRate"
          placeholder="0.0000"
          register={register}
          format="money"
        />
        <InputWithLabel
          fieldTitle="Monthly Rate"
          nameInSchema="salary.monthlyRate"
          placeholder="0.0000"
          register={register}
          format="money"
        />
        <InputWithLabel
          fieldTitle="Rate Divisor"
          nameInSchema="salary.rateDivisor"
          placeholder="Enter divisor"
          register={register}
          format="money"
        />
      </div>
      <div className="mb-6 space-y-3 rounded-xl border bg-muted/20 p-4 text-sm">
        <p className="text-muted-foreground">
          Daily-rate-only employees are supported. Leave Monthly Rate at{" "}
          <span className="font-mono">0.00</span> when payroll should compute
          regular pay from attendance days using the Daily Rate. If no valid
          Rate Divisor is set, payroll uses <span className="font-mono">26</span>.
        </p>
        <p className="font-medium">
          Current payroll basis: {payrollBasis ?? "Not set"}
        </p>
        <Controller
          control={control}
          name="salary.ignoreDtrForMonthlyRate"
          render={({ field }) => (
            <div className="flex items-center justify-between gap-4 rounded-md border bg-background px-3 py-2">
              <div className="space-y-1">
                <div className="font-medium">Ignore DTR for Monthly Rate</div>
                <div className="text-muted-foreground">
                  Monthly-rate payroll keeps regular pay at half monthly rate
                  and skips DTR-based pay effects.
                </div>
              </div>
              <Switch
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
                aria-label="Ignore DTR for Monthly Rate"
              />
            </div>
          )}
        />
        <Controller
          control={control}
          name="salary.ignoreContributionDeduction"
          render={({ field }) => (
            <div className="flex items-center justify-between gap-4 rounded-md border bg-background px-3 py-2">
              <div className="space-y-1">
                <div className="font-medium">Ignore Contribution Deduction</div>
                <div className="text-muted-foreground">
                  Automatic payroll skips statutory contributions and
                  withholding tax for this employee.
                </div>
              </div>
              <Switch
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
                aria-label="Ignore Contribution Deduction"
              />
            </div>
          )}
        />
        {!payrollBasis && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            Both Daily Rate and Monthly Rate are{" "}
            <span className="font-mono">0.00</span>. Payroll will compute zero
            regular pay until at least one rate is set.
          </div>
        )}
      </div>
      <hr className="p-2"></hr>
      <div className="grid grid-cols-3 gap-3 mb-6">
        <InputWithLabel
          fieldTitle="Daily Allowance"
          nameInSchema="salary.dailyAllowance"
          placeholder="0.00"
          register={register}
          format="money"
        />
        <InputWithLabel
          fieldTitle="Monthly Allowance"
          nameInSchema="salary.monthlyAllowance"
          placeholder="0.00"
          register={register}
          format="money"
        />
        <InputWithLabel
          fieldTitle="Billing Rate"
          nameInSchema="salary.billingRate"
          placeholder="0.00"
          register={register}
          format="money"
        />

        <InputWithLabel
          fieldTitle="COLA"
          nameInSchema="salary.cola"
          placeholder="0.00"
          register={register}
          format="money"
        />

        <SelectWithLabel
          fieldTitle="SLVL Group"
          nameInSchema="salary.slvlGroupId"
          control={control}
          data={slvlGroups.map((group) => ({
            id: String(group.id),
            name: group.name,
          }))}
        />
        <div className="grid grid-cols-2 mt-8 gap-3">
          <Button
            type="button"
            variant="default"
            title="SL/VL"
            onClick={() => {
              const confirmed = window.confirm(
                "Do you want to redirect to the SL/VL form?"
              );
              if (confirmed) {
                router.push("/leaves/form");
              }
            }}
          >
            Create SL/VL
          </Button>
          <Button
            type="button"
            variant="default"
            disabled={!employeeId}
            onClick={() => {
              if (!employeeId) return;
              showRateHistory(employeeId);
            }}
          >
            Show Rate History
          </Button>
        </div>
      </div>
      <hr className="p-2"></hr>
      <div className="grid grid-cols-3 gap-3">
        <SelectWithLabel
          fieldTitle="Custom Payroll Code"
          nameInSchema="salary.customPayrollId"
          control={control}
          isClearable
          data={customPayrollCodes.map((p) => ({
            id: String(p.id),
            name: `${p.code}`,
          }))}
        />
        <InputWithLabel
          fieldTitle="Custom Payroll Description"
          nameInSchema="salary.customPayrollDescription"
          register={register}
          disabled
        />
        <Button
          type="button"
          className="mt-8"
          variant="default"
          disabled={!employeeId}
          onClick={() => {
            if (!employeeId) return;
            showCustomPayrollHistory(employeeId);
          }}
        >
          Custom Payroll History
        </Button>
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { Controller, useWatch, useFormContext } from "react-hook-form";

import { makeSalaryChangeBaseSalary } from "@/app/actions/salaryAdjustAction";
import { InputWithLabel, formatMoney } from "@/components/inputs/InputWithLabel";
import { ReadOnlyField } from "@/components/inputs/ReadOnlyField";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { InsertEmployeeSchemaType } from "@/zod-schemas/employee";
import type { EmployeeSalaryTabView } from "@/zod-schemas/employeeSalary";
import { toast } from "sonner";

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

function formatReadOnlyMoney(value: string | null | undefined) {
  if (value == null) return "-";
  return formatMoney(value);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPeriodLabel(view: EmployeeSalaryTabView) {
  if (!view.effectiveChange) return "-";

  return `${view.effectiveChange.payrollCode} | ${view.effectiveChange.periodStartDate} to ${view.effectiveChange.periodEndDate}`;
}

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
  salaryTabView,
}: Props) {
  const { register, control, setValue } = useFormContext<InsertEmployeeSchemaType>();
  const router = useRouter();
  const [isApplyingBaseSalary, setIsApplyingBaseSalary] = React.useState(false);
  const [appliedChangeId, setAppliedChangeId] = React.useState<number | null>(null);

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

  const effectiveSalary = salaryTabView?.effectiveSalary ?? null;
  const effectiveChange = salaryTabView?.effectiveChange ?? null;
  const referencePeriod = salaryTabView?.referencePeriod ?? null;
  const payrollBasis = getPayrollBasis(dailyRateValue, monthlyRateValue);
  const effectivePayrollBasis = getPayrollBasis(
    effectiveSalary?.dailyRate,
    effectiveSalary?.monthlyRate
  );
  const canMakeBaseSalary =
    Boolean(employeeId) &&
    effectiveChange?.mode === "ForwardEffective" &&
    effectiveChange.status === "Active" &&
    appliedChangeId !== effectiveChange.id;

  async function handleMakeBaseSalary() {
    if (!employeeId || !effectiveChange) return;

    const confirmed = window.confirm(
      "Make this salary adjustment the employee base salary? This will overwrite the employee base salary fields with the salary adjustment values included in this record."
    );

    if (!confirmed) return;

    try {
      setIsApplyingBaseSalary(true);
      const result = await makeSalaryChangeBaseSalary({
        employeeId,
        changeId: effectiveChange.id,
      });

      setValue("salary.dailyRate", formatMoney(result.baseSalary.dailyRate));
      setValue("salary.monthlyRate", formatMoney(result.baseSalary.monthlyRate));
      setValue(
        "salary.monthlyAllowance",
        formatMoney(result.baseSalary.monthlyAllowance)
      );
      setValue(
        "salary.dailyAllowance",
        formatMoney(result.baseSalary.dailyAllowance)
      );
      setValue("salary.cola", formatMoney(result.baseSalary.cola));
      setValue("salary.rateDivisor", formatMoney(result.baseSalary.rateDivisor));
      setValue("salary.billingRate", formatMoney(result.baseSalary.billingRate));
      setAppliedChangeId(effectiveChange.id);

      toast.success("Base salary updated from salary adjustment.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to make this salary adjustment the base salary."
      );
    } finally {
      setIsApplyingBaseSalary(false);
    }
  }

  return (
    <div className="p-4">
      {effectiveSalary && effectiveChange && referencePeriod ? (
        <div className="mb-6 space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-base font-semibold text-emerald-900">
                Current Effective Salary
              </div>
              <p className="text-sm text-emerald-800">
                Forward-effective salary change is active for reference period{" "}
                <strong>{referencePeriod.code}</strong>. The editable salary fields
                below remain the base employee salary record.
              </p>
            </div>
            {canMakeBaseSalary ? (
              <Button
                type="button"
                disabled={isApplyingBaseSalary}
                onClick={handleMakeBaseSalary}
              >
                {isApplyingBaseSalary ? "Applying..." : "Make Base Salary"}
              </Button>
            ) : null}
          </div>

          <div className="grid grid-cols-4 gap-3">
            <ReadOnlyField
              label="Daily Rate"
              value={formatReadOnlyMoney(effectiveSalary.dailyRate)}
            />
            <ReadOnlyField
              label="Monthly Rate"
              value={formatReadOnlyMoney(effectiveSalary.monthlyRate)}
            />
            <ReadOnlyField
              label="Rate Divisor"
              value={formatReadOnlyMoney(effectiveSalary.rateDivisor)}
            />
            <ReadOnlyField
              label="Payroll Basis"
              value={effectivePayrollBasis ?? "-"}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <ReadOnlyField
              label="Daily Allowance"
              value={formatReadOnlyMoney(effectiveSalary.dailyAllowance)}
            />
            <ReadOnlyField
              label="Monthly Allowance"
              value={formatReadOnlyMoney(effectiveSalary.monthlyAllowance)}
            />
            <ReadOnlyField
              label="Billing Rate"
              value={formatReadOnlyMoney(effectiveSalary.billingRate)}
            />
            <ReadOnlyField
              label="COLA"
              value={formatReadOnlyMoney(effectiveSalary.cola)}
            />
            <ReadOnlyField label="Mode" value="Forward-effective" />
            <ReadOnlyField label="Status" value={effectiveChange.status} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <ReadOnlyField
              label="Payroll Period / Code"
              value={formatPeriodLabel(salaryTabView as EmployeeSalaryTabView)}
              className="max-w-full"
            />
            <ReadOnlyField
              label="Created"
              value={formatDateTime(effectiveChange.createdAt)}
            />
            <ReadOnlyField
              label="Reference Period"
              value={`${referencePeriod.code} | ${referencePeriod.startDate} to ${referencePeriod.endDate}`}
              className="max-w-full"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">Reason</div>
              <div className="rounded-md border bg-background px-3 py-2 text-sm">
                {effectiveChange.reason}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Notes</div>
              <div className="rounded-md border bg-background px-3 py-2 text-sm">
                {effectiveChange.notes || "-"}
              </div>
            </div>
          </div>
        </div>
      ) : null}

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

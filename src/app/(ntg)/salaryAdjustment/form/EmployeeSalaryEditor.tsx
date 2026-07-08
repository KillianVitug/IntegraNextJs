"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  cancelSalaryChange,
  createSalaryChange,
  getResolvedSalaryForPeriod,
} from "@/app/actions/salaryAdjustAction";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { ReadOnlyField } from "@/components/inputs/ReadOnlyField";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { TextAreaWithLabel } from "@/components/inputs/TextAreaWithLabel";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { FormActions, FormGrid } from "@/components/layout/page-layout";
import {
  createSalaryChangeSchema,
  type CreateSalaryChangeInput,
  type ResolvedSalaryRead,
  type SalaryChangeHistoryRead,
  type SalaryChangeMode,
} from "@/zod-schemas/salaryChange";

type PayrollPeriodOption = {
  id: string;
  code: string;
  payrollTerms: string;
  year: number;
  startDate: string;
  endDate: string;
  adjustedPayDate: string;
  cycle: "A" | "B";
  status: string;
};

type Props = {
  selectedEmployeeId: string;
  payrollPeriod: PayrollPeriodOption;
  periods: PayrollPeriodOption[];
  mode: SalaryChangeMode;
  onModeChange: (mode: SalaryChangeMode) => void;
  activeChange: SalaryChangeHistoryRead | null;
  onCommitted: () => Promise<void>;
};

const MODE_OPTIONS = [
  { id: "OnePeriodOverride", name: "One-period override" },
  { id: "ForwardEffective", name: "Forward-effective" },
  { id: "MultiPeriodOverride", name: "Multi-period override" },
];

function formatMode(mode: SalaryChangeMode) {
  if (mode === "OnePeriodOverride") return "one-period";
  if (mode === "ForwardEffective") return "forward-effective";
  return "multi-period";
}

const SALARY_FIELDS = [
  "dailyRate",
  "monthlyRate",
  "monthlyAllowance",
  "dailyAllowance",
  "cola",
  "rateDivisor",
  "billingRate",
] as const;

export default function EmployeeSalaryEditor({
  selectedEmployeeId,
  payrollPeriod,
  periods,
  mode,
  onModeChange,
  activeChange,
  onCommitted,
}: Props) {
  const [currentResolved, setCurrentResolved] = useState<ResolvedSalaryRead | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<CreateSalaryChangeInput>({
    resolver: zodResolver(createSalaryChangeSchema),
    defaultValues: {
      employeeId: selectedEmployeeId,
      payrollPeriodId: payrollPeriod.id,
      endPayrollPeriodId: null,
      mode,
      reason: "",
      notes: "",
      dailyRate: "0.00",
      monthlyRate: "0.00",
      monthlyAllowance: "0.00",
      dailyAllowance: "0.00",
      cola: "0.00",
      rateDivisor: "0.00",
      billingRate: "0.00",
    },
  });

  const selectedFromPeriodId = useWatch({
    control: form.control,
    name: "payrollPeriodId",
  });
  const isMultiPeriodMode = mode === "MultiPeriodOverride";
  const selectedFromPeriod = useMemo(
    () =>
      periods.find((period) => period.id === selectedFromPeriodId) ??
      payrollPeriod,
    [payrollPeriod, periods, selectedFromPeriodId]
  );
  const activePayrollPeriod = isMultiPeriodMode
    ? selectedFromPeriod
    : payrollPeriod;
  const fromPeriodOptions = useMemo(
    () =>
      periods.map((period) => ({
        id: period.id,
        name: `${period.code} | ${period.startDate} to ${period.endDate} | Pay ${period.adjustedPayDate}`,
      })),
    [periods]
  );

  const applyResolvedSalary = useCallback((resolved: ResolvedSalaryRead) => {
    for (const field of SALARY_FIELDS) {
      form.setValue(field, resolved.salary[field]);
    }
  }, [form]);

  const loadResolvedSalary = useCallback(async (
    payrollPeriodId = payrollPeriod.id,
    options: { resetForm?: boolean } = { resetForm: true }
  ) => {
    const resolved = await getResolvedSalaryForPeriod({
      employeeId: selectedEmployeeId,
      payrollPeriodId,
    });

    setCurrentResolved(resolved);

    if (options.resetForm === false) {
      applyResolvedSalary(resolved);
      return;
    }

    form.reset({
      employeeId: selectedEmployeeId,
      payrollPeriodId,
      endPayrollPeriodId:
        activeChange?.mode === "MultiPeriodOverride"
          ? activeChange.endPayrollPeriodId
          : null,
      mode,
      reason: "",
      notes: "",
      ...resolved.salary,
    });
  }, [
    activeChange?.endPayrollPeriodId,
    activeChange?.mode,
    applyResolvedSalary,
    form,
    mode,
    payrollPeriod.id,
    selectedEmployeeId,
  ]);

  useEffect(() => {
    void loadResolvedSalary(payrollPeriod.id);
  }, [loadResolvedSalary, payrollPeriod.id]);

  useEffect(() => {
    form.setValue("employeeId", selectedEmployeeId);
    form.setValue("mode", mode);
    if (mode !== "MultiPeriodOverride") {
      form.setValue("payrollPeriodId", payrollPeriod.id);
      form.setValue("endPayrollPeriodId", null);
      void loadResolvedSalary(payrollPeriod.id, { resetForm: false });
      return;
    }

    if (!form.getValues("payrollPeriodId")) {
      form.setValue("payrollPeriodId", payrollPeriod.id);
    }
  }, [form, loadResolvedSalary, mode, payrollPeriod.id, selectedEmployeeId]);

  const toPeriodOptions = useMemo(
    () =>
      periods
        .filter(
          (period) =>
            period.payrollTerms === selectedFromPeriod.payrollTerms &&
            period.year === selectedFromPeriod.year &&
            period.startDate > selectedFromPeriod.startDate
        )
        .map((period) => ({
          id: period.id,
          name: `${period.code} | ${period.startDate} to ${period.endDate} | Pay ${period.adjustedPayDate}`,
        })),
    [
      periods,
      selectedFromPeriod.payrollTerms,
      selectedFromPeriod.startDate,
      selectedFromPeriod.year,
    ]
  );

  useEffect(() => {
    if (!isMultiPeriodMode) return;

    const currentEndPeriodId = form.getValues("endPayrollPeriodId");
    if (
      currentEndPeriodId &&
      !toPeriodOptions.some((period) => period.id === currentEndPeriodId)
    ) {
      form.setValue("endPayrollPeriodId", null);
    }
  }, [form, isMultiPeriodMode, selectedFromPeriod.id, toPeriodOptions]);

  async function handleFromPeriodChange(nextPeriodId: string) {
    form.setValue("payrollPeriodId", nextPeriodId);

    const nextFromPeriod =
      periods.find((period) => period.id === nextPeriodId) ?? payrollPeriod;
    const currentEndPeriodId = form.getValues("endPayrollPeriodId");
    const currentEndPeriod = periods.find(
      (period) => period.id === currentEndPeriodId
    );

    if (
      currentEndPeriod &&
      (currentEndPeriod.payrollTerms !== nextFromPeriod.payrollTerms ||
        currentEndPeriod.year !== nextFromPeriod.year ||
        currentEndPeriod.startDate <= nextFromPeriod.startDate)
    ) {
      form.setValue("endPayrollPeriodId", null);
    }

    await loadResolvedSalary(nextPeriodId, { resetForm: false });
  }

  const latestRunStatus = currentResolved?.latestRunStatus ?? null;
  const isBlockedByRun =
    latestRunStatus === "Approved" || latestRunStatus === "Posted";

  const handleSubmit = async (data: CreateSalaryChangeInput) => {
    try {
      setIsLoading(true);
      await createSalaryChange(data);
      await onCommitted();
      await loadResolvedSalary(data.payrollPeriodId);
      toast.success("Salary change saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save salary change.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelActiveChange = async () => {
    if (!activeChange) return;
    if (!cancelReason.trim()) {
      toast.error("Enter a cancel reason first.");
      return;
    }

    try {
      setIsLoading(true);
      await cancelSalaryChange({
        changeId: activeChange.id,
        reason: cancelReason,
      });
      setCancelReason("");
      await onCommitted();
      await loadResolvedSalary(activePayrollPeriod.id);
      toast.success("Salary change canceled.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to cancel salary change."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-2">
        <div className="text-lg font-semibold">Salary Change Editor</div>
        <div className="text-sm text-muted-foreground">
          Period {activePayrollPeriod.code} from {activePayrollPeriod.startDate} to{" "}
          {activePayrollPeriod.endDate}. Pay date {activePayrollPeriod.adjustedPayDate}.
        </div>
      </div>

      {latestRunStatus ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            isBlockedByRun
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-amber-300 bg-amber-50 text-amber-800"
          }`}
        >
          Latest payroll run status for this period: <strong>{latestRunStatus}</strong>
          {isBlockedByRun
            ? ". Changes are blocked until that run is voided or a later forward-effective period is used."
            : ". Saving a change will mark any draft or reviewed run for the affected period(s) as stale."}
        </div>
      ) : null}

      {activeChange ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Active {formatMode(activeChange.mode)} change exists for this employee and period.
          Created by {activeChange.createdByUserId} on{" "}
          {new Date(activeChange.createdAt).toLocaleString("en-PH")}.
        </div>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <FormGrid columns={3}>
            <ReadOnlyField label="Resolved From" value={currentResolved?.resolvedFrom ?? "-"} />
            <ReadOnlyField
              label="Period Status"
              value={activePayrollPeriod.status}
            />
            <SelectWithLabel<CreateSalaryChangeInput>
              fieldTitle="Adjustment Mode"
              nameInSchema="mode"
              data={MODE_OPTIONS}
              value={mode}
              onChange={(value) => {
                const nextMode = value as SalaryChangeMode;
                onModeChange(nextMode);
                if (nextMode !== "MultiPeriodOverride") {
                  form.setValue("endPayrollPeriodId", null);
                }
              }}
            />
          </FormGrid>

          {isMultiPeriodMode ? (
            <FormGrid columns={3}>
              <SelectWithLabel<CreateSalaryChangeInput>
                fieldTitle="From Payroll Period"
                nameInSchema="payrollPeriodId"
                data={fromPeriodOptions}
                value={selectedFromPeriod.id}
                onChange={(value) => void handleFromPeriodChange(value)}
                className="max-w-md"
              />
              <SelectWithLabel<CreateSalaryChangeInput>
                fieldTitle="To Payroll Period"
                nameInSchema="endPayrollPeriodId"
                control={form.control}
                data={toPeriodOptions}
                disabled={toPeriodOptions.length === 0}
                className="max-w-md"
              />
              {toPeriodOptions.length === 0 ? (
                <div className="flex items-end text-sm text-destructive">
                  No later payroll period is available for this payroll terms/year.
                </div>
              ) : null}
            </FormGrid>
          ) : null}

          <div className="space-y-3">
            <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Current Resolved Salary
            </div>
            <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
              <ReadOnlyField label="Daily Rate" value={currentResolved?.salary.dailyRate} />
              <ReadOnlyField
                label="Monthly Rate"
                value={currentResolved?.salary.monthlyRate}
              />
              <ReadOnlyField
                label="Monthly Allowance"
                value={currentResolved?.salary.monthlyAllowance}
              />
              <ReadOnlyField
                label="Daily Allowance"
                value={currentResolved?.salary.dailyAllowance}
              />
              <ReadOnlyField label="COLA" value={currentResolved?.salary.cola} />
              <ReadOnlyField
                label="Rate Divisor"
                value={currentResolved?.salary.rateDivisor}
              />
              <ReadOnlyField
                label="Billing Rate"
                value={currentResolved?.salary.billingRate}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              New Salary Snapshot
            </div>
            <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
              <InputWithLabel<CreateSalaryChangeInput>
                fieldTitle="Daily Rate"
                nameInSchema="dailyRate"
                format="money"
              />
              <InputWithLabel<CreateSalaryChangeInput>
                fieldTitle="Monthly Rate"
                nameInSchema="monthlyRate"
                format="money"
              />
              <InputWithLabel<CreateSalaryChangeInput>
                fieldTitle="Monthly Allowance"
                nameInSchema="monthlyAllowance"
                format="money"
              />
              <InputWithLabel<CreateSalaryChangeInput>
                fieldTitle="Daily Allowance"
                nameInSchema="dailyAllowance"
                format="money"
              />
              <InputWithLabel<CreateSalaryChangeInput>
                fieldTitle="COLA"
                nameInSchema="cola"
                format="money"
              />
              <InputWithLabel<CreateSalaryChangeInput>
                fieldTitle="Rate Divisor"
                nameInSchema="rateDivisor"
                format="money"
              />
              <InputWithLabel<CreateSalaryChangeInput>
                fieldTitle="Billing Rate"
                nameInSchema="billingRate"
                format="money"
              />
            </div>
          </div>

          <FormGrid columns={2}>
            <TextAreaWithLabel<CreateSalaryChangeInput>
              fieldTitle="Reason"
              nameInSchema="reason"
              rows={3}
              placeholder="Explain why this salary change is needed."
            />
            <TextAreaWithLabel<CreateSalaryChangeInput>
              fieldTitle="Notes"
              nameInSchema="notes"
              rows={3}
              placeholder="Optional operational notes."
            />
          </FormGrid>

          {activeChange ? (
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <TextAreaWithLabel<{ cancelReason: string }>
                fieldTitle="Cancel Reason"
                nameInSchema="cancelReason"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                rows={3}
                placeholder="Explain why the active salary change is being canceled."
              />
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isLoading || isBlockedByRun}
                  onClick={handleCancelActiveChange}
                >
                  Cancel Active Change
                </Button>
              </div>
            </div>
          ) : null}

          <FormActions>
            <Button
              type="button"
              variant="outline"
              disabled={isLoading}
              onClick={() =>
                currentResolved
                  ? form.reset({
                      employeeId: selectedEmployeeId,
                      payrollPeriodId: activePayrollPeriod.id,
                      endPayrollPeriodId:
                        mode === "MultiPeriodOverride" ? null : undefined,
                      mode,
                      reason: "",
                      notes: "",
                      ...currentResolved.salary,
                    })
                  : undefined
              }
            >
              Reset Values
            </Button>
            <Button
              type="submit"
              disabled={
                isLoading ||
                isBlockedByRun ||
                (isMultiPeriodMode && toPeriodOptions.length === 0)
              }
            >
              {isLoading ? "Saving..." : "Save Salary Change"}
            </Button>
          </FormActions>
        </form>
      </Form>
    </div>
  );
}

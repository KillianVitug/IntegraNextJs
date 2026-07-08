"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { basisOfComputationEnum } from "@/db/schema";
import { useRouter } from "next/navigation";
import {
  type Control,
  type FieldErrors,
  FormProvider,
  useForm,
  useFormContext,
  useWatch,
} from "react-hook-form";
import {
  createCustomPayrollCode,
  deleteCustomPayrollCode,
  updateCustomPayrollCode,
} from "@/app/actions/customPayrollAction";
import {
  type CustomPayrollContributionKey,
  type CustomPayrollPayload,
  type SelectCustomPayrollWithRelations,
  customPayrollPayloadSchema,
} from "@/zod-schemas/payrollCodeCustom";
import { CheckboxWithLabel } from "@/components/inputs/CheckboxWithLabel";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { ScheduleCheckboxGroup } from "./scheduleCheckBoxGroup";
import { contributionTabs } from "./payrollCodeTabs";
import {
  createEmptyCustomPayrollPayload,
  customPayrollContributionKeys,
  mapPayrollToForm,
} from "@/utils/customPayrollMapper";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import {
  type ContributionField,
  useContributionDisabler,
  usePagibigDisabler,
} from "./basisRules";

type ContributionId = CustomPayrollContributionKey;
type FormTabValue = "general" | ContributionId;

type PayrollCodeFormProps = {
  initialData?: SelectCustomPayrollWithRelations;
};

const generalFields = [
  "code",
  "description",
  "rateDivisor",
  "hourlyRateDivisor",
] as const;

function hasNestedError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;

  if ("message" in value || "type" in value) {
    return true;
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, nestedValue]) => key !== "root" && hasNestedError(nestedValue)
  );
}

function getFirstErrorTab(errors: FieldErrors<CustomPayrollPayload>): FormTabValue {
  const topLevelErrors = errors as Record<string, unknown>;

  if (generalFields.some((field) => Boolean(topLevelErrors[field]))) {
    return "general";
  }

  for (const contributionId of customPayrollContributionKeys) {
    if (hasNestedError(errors.contributions?.[contributionId])) {
      return contributionId;
    }
  }

  return "general";
}

function getCustomPayrollErrorMessage(
  error: unknown,
  action: "save" | "delete"
): string {
  if (error instanceof Error) {
    const message = error.message.trim();

    if (/duplicate key|unique/i.test(message) && /code/i.test(message)) {
      return "Payroll code already exists.";
    }

    if (message.length > 0) {
      return message;
    }
  }

  return action === "save"
    ? "Unable to save payroll code."
    : "Unable to delete payroll code.";
}

function PagibigFlagsGroup({
  basePath,
  control,
}: {
  basePath: "contributions.PAGIBIG";
  control: Control<CustomPayrollPayload>;
}) {
  const { setValue } = useFormContext<CustomPayrollPayload>();

  const { isMaxContributionDisabled, isDeductShareDisabled } =
    usePagibigDisabler(control, basePath);

  useEffect(() => {
    if (!isMaxContributionDisabled) return;

    setValue(`${basePath}.flags.pagibigMaxContribution`, false);
    setValue(`${basePath}.flags.pagibigDeductShare`, false);
  }, [isMaxContributionDisabled, setValue, basePath]);

  return (
    <>
      <CheckboxWithLabel
        fieldTitle="Allow contribution in excess of Maximum Contribution"
        nameInSchema={`${basePath}.flags.pagibigMaxContribution`}
        disabled={isMaxContributionDisabled}
      />

      <CheckboxWithLabel
        fieldTitle="Deduct excess Employer Share from employee"
        nameInSchema={`${basePath}.flags.pagibigDeductShare`}
        disabled={isDeductShareDisabled}
      />
    </>
  );
}

export default function PayrollCodeForm({ initialData }: PayrollCodeFormProps) {
  const router = useRouter();
  const defaultValues = useMemo(() => createEmptyCustomPayrollPayload(), []);
  const [activeTab, setActiveTab] = useState<FormTabValue>("general");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const form = useForm<CustomPayrollPayload>({
    resolver: zodResolver(customPayrollPayloadSchema),
    defaultValues,
    shouldUnregister: false,
  });

  const { register, control, handleSubmit } = form;
  const payrollCodeId = initialData?.id;
  const isBusy = isSaving || isDeleting;

  const contributionDisablers: Record<
    ContributionId,
    (field: ContributionField) => boolean
  > = {
    SSS: useContributionDisabler(control, "contributions.SSS"),
    PHILHEALTH: useContributionDisabler(control, "contributions.PHILHEALTH"),
    PAGIBIG: useContributionDisabler(control, "contributions.PAGIBIG"),
    PERAA: useContributionDisabler(control, "contributions.PERAA"),
    TAX: useContributionDisabler(control, "contributions.TAX"),
  };

  const taxMonthEnd = useWatch({
    control,
    name: "contributions.TAX.flags.taxMonthEndAdjustment",
  }) as boolean;

  function setPeraaFlag(
    key: "peraaComputeBoth" | "peraaComputeEmployer",
    value: boolean
  ) {
    if (!value) return;

    form.setValue(
      "contributions.PERAA.flags.peraaComputeBoth",
      key === "peraaComputeBoth"
    );
    form.setValue(
      "contributions.PERAA.flags.peraaComputeEmployer",
      key === "peraaComputeEmployer"
    );
  }

  useEffect(() => {
    setActiveTab("general");

    if (!initialData) {
      form.reset(defaultValues, {
        keepDefaultValues: false,
      });
      return;
    }

    const payload = mapPayrollToForm(initialData);
    form.reset(payload, {
      keepDefaultValues: false,
    });
  }, [defaultValues, form, initialData]);

  const onValid = async (data: CustomPayrollPayload) => {
    setIsSaving(true);

    try {
      if (payrollCodeId) {
        await updateCustomPayrollCode(payrollCodeId, data);
      } else {
        await createCustomPayrollCode(data);
      }

      toast.success(
        payrollCodeId ? "Payroll code updated." : "Payroll code created."
      );
      router.push("/constants/payrollCode");
    } catch (error) {
      toast.error(getCustomPayrollErrorMessage(error, "save"));
    } finally {
      setIsSaving(false);
    }
  };

  const onInvalid = (errors: FieldErrors<CustomPayrollPayload>) => {
    setActiveTab(getFirstErrorTab(errors));
    toast.error("Unable to save payroll code. Please fix the highlighted fields.");
  };

  const handleDelete = async () => {
    if (!payrollCodeId) return;
    if (!window.confirm("Delete payroll code?")) return;

    setIsDeleting(true);

    try {
      await deleteCustomPayrollCode(payrollCodeId);
      toast.success("Payroll code deleted.");
      router.push("/constants/payrollCode");
    } catch (error) {
      toast.error(getCustomPayrollErrorMessage(error, "delete"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(onValid, onInvalid)}>
        <div className="w-full mx-auto">
          <h1 className="mb-4 text-2xl font-bold">
            {payrollCodeId ? "Edit" : "Create"} Custom Payroll Code
          </h1>

          <div className="grid grid-cols-3">
            <InputWithLabel
              fieldTitle="Payroll Code"
              nameInSchema="code"
              placeholder="Enter code (e.g. CP001)"
              register={register}
            />
            <InputWithLabel
              fieldTitle="Description"
              nameInSchema="description"
              placeholder="Enter Description"
              register={register}
            />
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as FormTabValue)}
            className="mt-4"
          >
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              {contributionTabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="general" className="mt-4 space-y-4">
              <div className="grid grid-cols-3">
                <InputWithLabel
                  fieldTitle="Rate Divisor"
                  nameInSchema="rateDivisor"
                  placeholder="Enter Rate"
                  register={register}
                  format="money"
                />
                <InputWithLabel
                  fieldTitle="Hourly Rate Divisor"
                  nameInSchema="hourlyRateDivisor"
                  placeholder="Enter Hourly Rate"
                  register={register}
                  format="money"
                />
              </div>
            </TabsContent>

            {contributionTabs.map((tab) => (
              <TabsContent key={tab.id} value={tab.id} className="space-y-6">
                {(() => {
                  const contributionId = tab.id as ContributionId;
                  const basePath = `contributions.${contributionId}` as const;
                  const isDisabled = contributionDisablers[contributionId];

                  return (
                    <>
                      <ScheduleCheckboxGroup
                        basePath={`${basePath}.scheduleFlags`}
                        forceEndOfMonth={contributionId === "TAX" && taxMonthEnd}
                      />

                      <div className="grid grid-cols-3 gap-3">
                        <SelectWithLabel
                          fieldTitle="Basis Of Computation"
                          nameInSchema={`${basePath}.basisOfComputation`}
                          control={control}
                          data={enumToSelectOptions(
                            basisOfComputationEnum.enumValues
                          )}
                        />

                        <InputWithLabel
                          fieldTitle="Basis Amount"
                          nameInSchema={`${basePath}.basisValue`}
                          register={register}
                          placeholder="0"
                          disabled={isDisabled("basisValue")}
                          format="money"
                        />

                        <InputWithLabel
                          fieldTitle="Salary Approximation %"
                          nameInSchema={`${basePath}.approximationPercent`}
                          register={register}
                          type="number"
                          disabled={isDisabled("approximationPercent")}
                        />
                      </div>

                      <div className="space-y-3 rounded-lg border p-4">
                        <h3 className="font-semibold">Additional Options</h3>

                        {tab.id === "PAGIBIG" && (
                          <PagibigFlagsGroup
                            basePath="contributions.PAGIBIG"
                            control={control}
                          />
                        )}

                        {tab.id === "PERAA" && (
                          <>
                            <CheckboxWithLabel
                              fieldTitle="Compute Employee And Employer Share"
                              nameInSchema={`${basePath}.flags.peraaComputeBoth`}
                              onCheckedChange={(value) =>
                                setPeraaFlag("peraaComputeBoth", value)
                              }
                            />
                            <CheckboxWithLabel
                              fieldTitle="Compute Employer Share Only"
                              nameInSchema={`${basePath}.flags.peraaComputeEmployer`}
                              onCheckedChange={(value) =>
                                setPeraaFlag("peraaComputeEmployer", value)
                              }
                            />
                          </>
                        )}

                        {tab.id === "TAX" && (
                          <>
                            <div className="flex items-center gap-2">
                              <CheckboxWithLabel
                                fieldTitle="Fixed Tax Percentage"
                                nameInSchema={`${basePath}.flags.taxFixedPercentage`}
                              />
                              <InputWithLabel
                                fieldTitle="Tax Percentage"
                                nameInSchema={`${basePath}.flags.taxFixedValue`}
                                register={register}
                                disabled={isDisabled("percentage")}
                                format="money"
                              />
                            </div>

                            <CheckboxWithLabel
                              fieldTitle="Use Month-End Tax Adjustment"
                              nameInSchema={`${basePath}.flags.taxMonthEndAdjustment`}
                            />
                          </>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <InputWithLabel
                          fieldTitle="Employee Share"
                          nameInSchema={`${basePath}.fixedEmployeeShare`}
                          register={register}
                          disabled={isDisabled("fixedEmployeeShare")}
                          format="money"
                        />

                        <InputWithLabel
                          fieldTitle="Employer Share"
                          nameInSchema={`${basePath}.fixedEmployerShare`}
                          register={register}
                          disabled={isDisabled("fixedEmployerShare")}
                          format="money"
                        />

                        <InputWithLabel
                          fieldTitle="EC Share"
                          nameInSchema={`${basePath}.fixedECShare`}
                          register={register}
                          disabled={isDisabled("fixedECShare")}
                          format="money"
                        />
                      </div>
                    </>
                  );
                })()}
              </TabsContent>
            ))}
          </Tabs>

          <div className="mt-6 flex justify-end gap-2">
            <Button type="submit" disabled={isBusy}>
              {isSaving
                ? "Saving..."
                : payrollCodeId
                  ? "Update Payroll Code"
                  : "Save Payroll Code"}
            </Button>

            {payrollCodeId && (
              <Button
                type="button"
                variant="destructive"
                disabled={isBusy}
                onClick={handleDelete}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              className="leading-none"
              disabled={isBusy}
              onClick={() => router.back()}
            >
              Back
            </Button>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { basisOfComputationEnum, payrollScheduleEnum } from "@/db/schema";
import { contributionTabs, tabSpecificFlags } from "./payrollCodeTabs";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import { CheckboxWithLabel } from "@/components/inputs/CheckboxWithLabel";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import { useForm, FormProvider } from "react-hook-form";
import { createCustomPayrollCode, updateCustomPayrollCode, getCustomPayrollForEdit, deleteCustomPayrollCode } from "@/app/actions/customPayrollAction";
import {
  customPayrollPayloadSchema,
  CustomPayrollPayload,
  insertCustomPayrollSchema,
  InsertCustomPayrollSchemaType,
} from "@/zod-schemas/payrollCodeCustom";
import { ScheduleCheckboxGroup } from "./scheduleCheckBoxGroup";

export default function PayrollCodeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

const defaultContribution = {
    scheduleFlags: {
      always: true,
      endOfMonth: false,
      firstPayroll: false,
      secondPayroll: false,
      thirdPayroll: false,
      forthPayroll: false,
    },
    basisOfComputation: "Gross Pay" as const, // must match enum exactly
    basisValue: null,
    approximationPercent: 100,
    percentage: null,
    fixedAmount: null,
    minimum: null,
    maximum: null,
    fixedEmployeeShare: 0,
    fixedEmployerShare: 0,
    fixedECShare: 0,
    flags: {
    scheduleFlags: {
      always: true,
      endOfMonth: false,
      firstPayroll: false,
      secondPayroll: false,
      thirdPayroll: false,
    },
      // optional flags can stay undefined or set explicitly
      flag1: false,
      flag2: false,
      flag3: false,
    },
  };
  
  const defaultValues: CustomPayrollPayload = {
    code: "",
    description: null,
    rateDivisor: null,
    hourlyRateDivisor: null,
    contributions: {
      SSS: structuredClone(defaultContribution),
      PHILHEALTH: structuredClone(defaultContribution),
      PAGIBIG: {
        ...structuredClone(defaultContribution),
        flags: {
          ...defaultContribution.flags,
          pagibigMaxContribution: false,
          pagibigDeductShare: false,
        },
      },
      PERAA: {
        ...structuredClone(defaultContribution),
        flags: {
          ...defaultContribution.flags,
          peraaComputeBoth: false,
          peraaComputeEmployer: false,
        },
      },
      TAX: {
        ...structuredClone(defaultContribution),
        flags: {
          ...defaultContribution.flags,
          taxFixedPercentage: false,
          taxFixedValue: 0,
          taxMonthEndAdjustment: false,
        },
      },
    },
  };
  
  const form = useForm<CustomPayrollPayload>({
    resolver: zodResolver(customPayrollPayloadSchema),
    defaultValues,
  });

  const { register, control, handleSubmit } = form;

  const onSubmit = async (data: CustomPayrollPayload) => {
    if (id) await updateCustomPayrollCode(+id, data);
    else await createCustomPayrollCode(data);
  };

  const id = searchParams.get("id");

    useEffect(() => {
    if (!id) return;
    getCustomPayrollForEdit(+id).then((data) => form.reset(data));
    }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="p-6 w-full max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">
            Create Custom Payroll Code
          </h1>

          <div className="flex gap-4">
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

          <Tabs defaultValue="general" className="mt-4">
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              {contributionTabs.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* ---------------------- GENERAL TAB ---------------------- */}
            <TabsContent value="general" className="space-y-4 mt-4">
              <div>
                <InputWithLabel
                  fieldTitle="Rate Divisor"
                  nameInSchema="rateDivisor"
                  placeholder="Enter Rate"
                  register={register}
                />
              </div>
              <div>
                <InputWithLabel
                  fieldTitle="Hourly Rate Divisor"
                  nameInSchema="hourlyRateDivisor"
                  placeholder="Enter Hourly Rate"
                  register={register}
                />
              </div>
            </TabsContent>

            {/* ---------------------- CONTRIBUTION TABS ---------------------- */}
            {contributionTabs.map((tab) => (
              <TabsContent
                key={tab.id}
                value={tab.id}
                className="mt-6 space-y-6"
              >
                <div>
                  <ScheduleCheckboxGroup
                    basePath={`contributions.${tab.id}.scheduleFlags`}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <SelectWithLabel
                      fieldTitle="Basis Of Computation"
                      nameInSchema={`contributions.${tab.id}.basisOfComputation`}
                      control={control}
                      data={enumToSelectOptions(
                        basisOfComputationEnum.enumValues
                      )}
                    />
                  </div>

                  <div>
                    <InputWithLabel
                      fieldTitle="Basis Amount"
                      nameInSchema={`contributions.${tab.id}.basisValue`}
                      placeholder="Enter Amount (Optional Fixed Value)"
                      register={register}
                    />
                  </div>
                  <div>
                    <InputWithLabel
                      fieldTitle="Salary Approximation %"
                      nameInSchema={`contributions.${tab.id}.approximationPercent`}
                      placeholder="Enter Approximation"
                      register={register}
                      defaultValue={100}
                      type="number"
                    />
                  </div>
                </div>

                {/* -------- PER-TAB UNIQUE CHECKBOXES -------- */}
                <div className="border rounded-lg p-4 space-y-3">
                  <h3 className="font-semibold">Additional Options</h3>

                  {/* SSS has EC employer-only check */}
                  {tab.id === "PAGIBIG" && (
                    <>
                      <div className="flex items-center space-x-2">
                        <CheckboxWithLabel
                          fieldTitle="Allow contribution in excess of Maximum Contribution"
                          nameInSchema={`contributions.PAGIBIG.flags.pagibigMaxContribution`}
                          //   control={control}
                        />
                      </div>

                      <div className="flex items-center space-x-2">
                        <CheckboxWithLabel
                          fieldTitle="Deduct excess Employer Share from employee"
                          nameInSchema={`contributions.PAGIBIG.flags.pagibigDeductShare`}
                          //   control={control}
                        />
                      </div>
                    </>
                  )}
                  {tab.id === "PERAA" && (
                    <>
                      <div className="flex items-center space-x-2">
                        <CheckboxWithLabel
                          fieldTitle="Compute Employee And Employer Share"
                          nameInSchema={`contributions.PERAA.flags.peraaComputeBoth`}
                          //   control={control}
                        />
                      </div>
                      <div className="flex items-center space-x-2">
                        <CheckboxWithLabel
                          fieldTitle="Compute Employer Share Only"
                          nameInSchema={`contributions.PERAA.flags.peraaComputeEmployer`}
                          //   control={control}
                        />
                      </div>
                    </>
                  )}

                  {tab.id === "TAX" && (
                    <>
                      <div className="flex items-center space-x-2">
                        <CheckboxWithLabel
                          fieldTitle="Fixed Tax Percentage"
                          nameInSchema={`contributions.TAX.flags.taxFixedPercentage`}
                          //   control={control}
                        />
                        <InputWithLabel
                          fieldTitle="Tax Percentage"
                          nameInSchema={`contributions.TAX.flags.taxFixedValue`}
                          register={register}
                        />
                      </div>
                      <div className="flex items-center space-x-2">
                        <CheckboxWithLabel
                          fieldTitle="Use Month-End Tax Adjustment"
                          nameInSchema={`contributions.TAX.flags.taxMonthEndAdjustment`}
                          //   control={control}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* -------- FIXED CONTRIBUTION INPUTS -------- */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <InputWithLabel
                      fieldTitle="Employee Share"
                      nameInSchema={`contributions.${tab.id}.fixedEmployeeShare`}
                      placeholder="Enter Employee Share"
                      register={register}
                    />
                  </div>
                  <div>
                    <InputWithLabel
                      fieldTitle="Employer Share"
                      nameInSchema={`contributions.${tab.id}.fixedEmployerShare`}
                      placeholder="Enter Employer Share"
                      register={register}
                    />
                  </div>
                  <div>
                    <InputWithLabel
                      fieldTitle="EC Share (if applicable)"
                      nameInSchema={`contributions.${tab.id}.fixedECShare`}
                      placeholder="Enter EC Share"
                      register={register}
                    />
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>

          <div className="flex justify-end mt-6">
            <Button>Save Payroll Code</Button>
            {id && (
            <Button
                variant="destructive"
                onClick={async () => {
                if (confirm("Delete payroll code?")) {
                    await deleteCustomPayrollCode(+id);
                    router.push("/payroll/");
                }
                }}
            >
                Delete
            </Button>
            )}
          </div>
        </div>
      </form>
    </FormProvider>
  );
}


//   const defaultContribution = {
//     scheduleFlags: {
//       always: true,
//       endOfMonth: false,
//       firstPayroll: false,
//       secondPayroll: false,
//       thirdPayroll: false,
//     },
//     basisOfComputation: "Gross Pay",
//     basisValue: 0,
//     approximationPercent: 100,
//     fixedEmployeeShare: 0,
//     fixedEmployerShare: 0,
//     fixedECShare: 0,
//     percentage: null,
//     fixedAmount: null,
//     minimum: null,
//     maximum: null,
//     flags: {},
//   };

//   const defaultValues = {
//     code: "",
//     description: "",
//     rateDivisor: null,
//     hourlyRateDivisor: null,
//     contributions: {
//       SSS: structuredClone(defaultContribution),
//       PHILHEALTH: structuredClone(defaultContribution),
//       PAGIBIG: {
//         ...structuredClone(defaultContribution),
//         flags: {
//           pagibigMaxContribution: false,
//           pagibigDeductShare: false,
//         },
//       },
//       PERAA: {
//         ...structuredClone(defaultContribution),
//         flags: {
//           peraaComputeBoth: false,
//           peraaComputeEmployer: false,
//         },
//       },
//       TAX: {
//         ...structuredClone(defaultContribution),
//         flags: {
//           taxFixedPercentage: false,
//           taxFixedValue: null,
//           taxMonthEndAdjustment: false,
//         },
//       },
//     },
//   };

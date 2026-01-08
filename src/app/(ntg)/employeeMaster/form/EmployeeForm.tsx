"use client";

import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { v4 as uuidv4 } from "uuid"; // Import UUID generator
import { useAction } from "next-safe-action/hooks";
import { useKindeBrowserClient } from "@kinde-oss/kinde-auth-nextjs";
import { LoaderCircle } from "lucide-react";
import { DisplayServerActionResponse } from "@/components/DisplayServerActionResponse";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import TabsSection from "@/app/(ntg)/employeeMaster/form/TabSection";

import {
  insertEmployeeSchema,
  type InsertEmployeeSchemaType,
  type SelectEmployeeWithRelationsSchemaType,
} from "@/zod-schemas/employee";
import { saveEmployeeAction } from "@/app/actions/saveEmployeeAction";

import {
  defaultEmployeeValues,
  defaultGeneralInfo,
  defaultSalary,
  defaultOtherReferences,
  defaultTimekeeping,
} from "@/constants/defaultEmployeeValues";

type Props = {
  employee?: SelectEmployeeWithRelationsSchemaType;
  departments: { id: number; name: string }[];
  positions: { id: number; name: string }[];
  slvlGroups: { id: number; name: string }[];
};

export default function EmployeeForm({
  employee,
  departments,
  positions,
  slvlGroups,
}: Props) {
  // const { getPermission, isLoading } = useKindeBrowserClient();
  // const isManager = !isLoading && getPermission("manager")?.isGranted;
  const router = useRouter();
  const generatedId = uuidv4();

  const searchParams = useSearchParams();
  const hasEmployeeId = searchParams.has("employeeId");

  const emptyValues: InsertEmployeeSchemaType = {
    id: generatedId,
    employeeNo: defaultEmployeeValues.employeeNo,
    firstName: defaultEmployeeValues.firstName,
    lastName: defaultEmployeeValues.lastName,
    middleName: defaultEmployeeValues.middleName,
    middleInitial: defaultEmployeeValues.middleInitial,
    suffix: defaultEmployeeValues.suffix,
    generalInfo: defaultGeneralInfo,
    salary: defaultSalary,
    otherReferences: defaultOtherReferences,
    timekeeping: defaultTimekeeping,
    recurringEntries: [],
  };

  const defaultValues: InsertEmployeeSchemaType = hasEmployeeId
    ? {
        id: employee?.id || generatedId,
        employeeNo: employee?.employeeNo ?? defaultEmployeeValues.employeeNo,
        firstName: employee?.firstName ?? defaultEmployeeValues.firstName,
        lastName: employee?.lastName ?? defaultEmployeeValues.lastName,
        middleName: employee?.middleName ?? defaultEmployeeValues.middleName,
        middleInitial:
          employee?.middleInitial ?? defaultEmployeeValues.middleInitial,
        suffix: employee?.suffix ?? defaultEmployeeValues.suffix,
        generalInfo: employee?.generalInfo
          ? {
              ...employee.generalInfo,
              departmentId: employee.generalInfo.departmentId
                ? String(employee.generalInfo.departmentId)
                : "",
            }
          : {
              ...defaultGeneralInfo,
              employeeId: employee?.id || generatedId,
              departmentId: "",
            },
        salary: employee?.salary
          ? {
              ...employee.salary,
              slvlGroupId:
                employee?.salary?.slvlGroupId != null
                  ? String(employee.salary.slvlGroupId)
                  : "",
            }
          : {
              ...defaultSalary,
              employeeId: employee?.id || generatedId,
              slvlGroupId: "",
            },
        otherReferences: employee?.otherReferences
          ? {
              ...employee.otherReferences,
              positionId:
                employee?.otherReferences?.positionId != null
                  ? String(employee.otherReferences.positionId)
                  : "",
            }
          : {
              ...defaultOtherReferences,
              employeeId: employee?.id || generatedId,
              positionId: "",
            },
        timekeeping: employee?.timekeeping ?? {
          ...defaultTimekeeping,
          employeeId: employee?.id || generatedId,
        },
      }
    : emptyValues;

  const form = useForm<InsertEmployeeSchemaType>({
    mode: "onBlur",
    resolver: zodResolver(insertEmployeeSchema),
    defaultValues,
  });

  useEffect(() => {
    form.reset(hasEmployeeId ? defaultValues : emptyValues);
  }, [searchParams.get("employeeId")]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    execute: executeSave,
    result: saveResult,
    isPending: isSaving,
    reset: resetSaveAction,
  } = useAction(saveEmployeeAction);

  async function submitForm(data: InsertEmployeeSchemaType) {
    const result = await executeSave(data);
    if (data) {
      router.refresh(); // Seamlessly reloads the current route without a full refresh
    }
  }
  const { register, control } = form;
  return (
    <FormProvider {...form}>
      <div className="flex flex-col gap-1 sm:px-8">
        <DisplayServerActionResponse result={saveResult} />
        <div>
          <h2 className="text-2xl font-bold">
            {employee?.id ? "Edit" : "New"} Employee{" "}
            {employee?.id ? `#${employee.id}` : "Form"}
          </h2>
        </div>

        <form
          onSubmit={form.handleSubmit(submitForm, (errors) =>
            console.log("Form validation errors:", errors)
          )}
          className="flex flex-col md:flex-row gap-4 md:gap-8 mb-6"
        >
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <InputWithLabel<InsertEmployeeSchemaType>
              fieldTitle="Employee No"
              nameInSchema="employeeNo"
              register={register}
            />

            <InputWithLabel<InsertEmployeeSchemaType>
              fieldTitle="First Name"
              nameInSchema="firstName"
              register={register}
            />

            <InputWithLabel<InsertEmployeeSchemaType>
              fieldTitle="Last Name"
              nameInSchema="lastName"
              register={register}
            />
          </div>

          <div className="flex flex-col gap-4 w-full max-w-xs">
            <InputWithLabel<InsertEmployeeSchemaType>
              fieldTitle="Middle Name"
              nameInSchema="middleName"
              register={register}
            />
            <InputWithLabel<InsertEmployeeSchemaType>
              fieldTitle="Middle Initial"
              nameInSchema="middleInitial"
              register={register}
            />

            <InputWithLabel<InsertEmployeeSchemaType>
              fieldTitle="Suffix"
              nameInSchema="suffix"
              register={register}
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="submit"
              className="w-3/4"
              variant="default"
              title="Save"
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <LoaderCircle className="animate-spin" /> Saving
                </>
              ) : (
                "Save"
              )}
            </Button>

            <Button
              type="button"
              variant="destructive"
              title="Reset"
              onClick={() => {
                form.reset();
                resetSaveAction();
              }}
            >
              Reset
            </Button>

            <Button
              type="button"
              variant="outline"
              title="Back"
              onClick={() => router.back()}
            >
              Back
            </Button>
          </div>
        </form>
        <div className="flex-grow overflow-auto">
          <TabsSection
            employee={employee}
            departments={departments}
            positions={positions}
            slvlGroups={slvlGroups}
            form={form}
          />
        </div>
      </div>
    </FormProvider>
  );
}

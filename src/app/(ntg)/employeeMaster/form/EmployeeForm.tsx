"use client";

import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
// import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { FormGrid, PageHeader } from "@/components/layout/page-layout";
import { useAction } from "next-safe-action/hooks";
import { LoaderCircle } from "lucide-react";
import { DisplayServerActionResponse } from "@/components/DisplayServerActionResponse";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import TabsSection from "@/app/(ntg)/employeeMaster/form/TabSection";
import { formatMoney } from "@/components/inputs/InputWithLabel";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

import {
  insertEmployeeSchema,
  type InsertEmployeeSchemaType,
  type SelectEmployeeWithRelationsSchemaType,
} from "@/zod-schemas/employee";
import {
  type EmployeeRecurringAccountCodeOption,
  type EmployeeRecurringEntryFormType,
} from "@/zod-schemas/employeeRecurringEntries";
import type { EmployeeSalaryTabView } from "@/zod-schemas/employeeSalary";
import { saveEmployeeAction } from "@/app/actions/saveEmployeeAction";
import { archiveEmployeeAction } from "@/app/actions/archiveEmployeeAction";
// import { SaveEmployeeSuccess } from "@/types/employeeResults";
import SalaryHistoryModal from "@/components/modal/SalaryHistoryModal";


import {
  defaultEmployeeValues,
  defaultGeneralInfo,
  defaultSalary,
  defaultOtherReferences,
  defaultTimekeeping,
} from "@/constants/defaultEmployeeValues";
import { DEFAULT_EMPLOYEE_TYPE, employeeTypeValues } from "@/utils/employeeCode";

import { Upload } from "lucide-react";
import { useRef } from "react";


type Props = {
  employee?: SelectEmployeeWithRelationsSchemaType;
  recurringEntries: EmployeeRecurringEntryFormType[];
  departments: { id: number; name: string }[];
  positions: { id: number; name: string }[];
  slvlGroups: { id: number; name: string }[];
  nextEmployeeNo?: string;
  canManageEmployeeType: boolean;
  customPayrollCodes: {
    id: number;
    code: string;
    description: string | null;
    rateDivisor: string | null;
  }[];
  recurringAccountCodeOptions: EmployeeRecurringAccountCodeOption[];
  salaryTabView?: EmployeeSalaryTabView | null;
};

const MONEY_FIELDS = [
  "dailyRate",
  "monthlyRate",
  "monthlyAllowance",
  "dailyAllowance",
  "cola",
  "rateDivisor",
  "billingRate",
] as const;

type EmployeeCsvImportResponse = {
  success?: boolean;
  error?: string;
  errors?: string[];
  summary?: {
    totalRows: number;
    createdEmployees: number;
    updatedEmployees: number;
    createdDepartments: number;
    createdPositions: number;
  };
};

function formatCsvImportError(payload: EmployeeCsvImportResponse | null) {
  if (!payload) return "CSV import failed";

  const errors = payload.errors?.filter(Boolean) ?? [];
  if (!errors.length) return payload.error || "CSV import failed";

  const visibleErrors = errors.slice(0, 6);
  const remainingCount = errors.length - visibleErrors.length;

  return [
    payload.error || "CSV import failed",
    ...visibleErrors,
    ...(remainingCount > 0 ? [`...and ${remainingCount} more error(s).`] : []),
  ].join("\n");
}

export default function EmployeeForm({
  employee,
  departments,
  positions,
  slvlGroups,
  nextEmployeeNo,
  canManageEmployeeType,
  customPayrollCodes,
  recurringEntries,
  recurringAccountCodeOptions,
  salaryTabView,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasEmployeeId = searchParams.has("employeeId");
  const [saveMode, setSaveMode] = useState<"normal" | "new">("normal");
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasInitializedEmployeeTypePreviewRef = useRef(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const isCreateMode = !employee?.id;
  const canEditEmployeeType = isCreateMode && canManageEmployeeType;
  const selectedEmployeeIdParam = searchParams.get("employeeId");

  
  const emptyValues = useMemo<InsertEmployeeSchemaType>(
    () => ({
      employeeType: defaultEmployeeValues.employeeType,
      employeeNo: nextEmployeeNo,
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
    }),
    [nextEmployeeNo]
  );

  const defaultValues = useMemo<InsertEmployeeSchemaType>(
    () => hasEmployeeId
      ? {
        id: employee!.id ,
        employeeType: employee!.employeeType,
        employeeNo:employee!.employeeNo,
        firstName:employee!.firstName ?? defaultEmployeeValues.firstName,
        lastName:employee!.lastName ?? defaultEmployeeValues.lastName,
        middleName:employee!.middleName ?? defaultEmployeeValues.middleName,
        middleInitial:employee!.middleInitial ?? defaultEmployeeValues.middleInitial,
        suffix:employee!.suffix ?? defaultEmployeeValues.suffix,
        generalInfo: employee?.generalInfo
          ? {
              ...employee.generalInfo,
              departmentId: employee.generalInfo.departmentId
                ? String(employee.generalInfo.departmentId)
                : "",
            }
          : {
              ...defaultGeneralInfo,
              employeeId: employee?.id,
              departmentId: "",
            },
        salary: employee?.salary
          ? {
              dailyRate: String(employee.salary.dailyRate ?? "0"),
              monthlyRate: String(employee.salary.monthlyRate ?? "0"),
              monthlyAllowance: String(employee.salary.monthlyAllowance ?? "0"),
              dailyAllowance: String(employee.salary.dailyAllowance ?? "0"),
              cola: String(employee.salary.cola ?? "0"),
              rateDivisor: String(employee.salary.rateDivisor ?? "0"),
              billingRate: String(employee.salary.billingRate ?? "0"),
              ignoreDtrForMonthlyRate:
                employee.salary.ignoreDtrForMonthlyRate ?? false,
              ignoreContributionDeduction:
                employee.salary.ignoreContributionDeduction ?? false,
              slvlGroupId:
                employee.salary.slvlGroupId != null
                  ? String(employee.salary.slvlGroupId)
                  : null,
                  customPayrollId:
                employee.salary.customPayrollId != null
                    ? String(employee.salary.customPayrollId)
                    : null,
              customPayrollDescription:
                employee.salary.customPayrollDescription ?? "",
            }
          : {
              ...defaultSalary,
              employeeId: employee?.id,
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
              employeeId: employee?.id,
              positionId: "",
            },
        timekeeping: employee?.timekeeping
          ? {
            timekeepingId: employee.timekeeping.timekeepingId ?? null,
            shiftSchedule: employee.timekeeping.shiftSchedule ?? null,
            checkInTime: employee.timekeeping.checkInTime ?? null,
            checkOutTime: employee.timekeeping.checkOutTime ?? null,
            restDay: employee.timekeeping.restDay ?? null,
            hoursWorked: Number(employee.timekeeping.hoursWorked ?? 0),
            minutesWorked: Number(employee.timekeeping.minutesWorked ?? 0),
            }
          : {
              ...defaultTimekeeping,
              employeeId: employee?.id,
            },
      }
    : emptyValues,
    [employee, emptyValues, hasEmployeeId]
  );

  const form = useForm<InsertEmployeeSchemaType>({
    mode: "onBlur",
    resolver: zodResolver(insertEmployeeSchema),
    defaultValues,
  });
  const selectedEmployeeType = form.watch("employeeType") ?? DEFAULT_EMPLOYEE_TYPE;


  const {
    execute: executeSave,
    result: saveResult,
    isPending: isSaving,
    reset: resetSaveAction,
  } = useAction(saveEmployeeAction);
  
  const { 
    execute: executeArchive, 
    isPending: isArchiving
  } = useAction(archiveEmployeeAction);

  async function submitForm(data: InsertEmployeeSchemaType) {
  setHasSubmitted(true);  // Mark that user submitted
  executeSave(data);
}

useEffect(() => {
  const valuesToReset = hasEmployeeId ? defaultValues : emptyValues;
  // Format salary fields for display
  const formattedSalary = valuesToReset.salary
    ? {
        ...valuesToReset.salary,
        ...Object.fromEntries(
          MONEY_FIELDS.map((k) => [
            k,
            formatMoney(String(valuesToReset.salary?.[k] ?? "0")),
          ])
        ),
      }
    : defaultSalary;
  form.reset({
    ...valuesToReset,
    salary: formattedSalary,
  });
}, [defaultValues, emptyValues, form, hasEmployeeId, selectedEmployeeIdParam]);

useEffect(() => {
  if (!employee?.id && nextEmployeeNo) {
    form.reset({
      ...emptyValues,
      employeeType: selectedEmployeeType,
      employeeNo: nextEmployeeNo,
    });
  }
}, [employee?.id, emptyValues, form, nextEmployeeNo, selectedEmployeeType]);

useEffect(() => {
  if (!isCreateMode) return;

  if (!canManageEmployeeType && form.getValues("employeeType") !== DEFAULT_EMPLOYEE_TYPE) {
    form.setValue("employeeType", DEFAULT_EMPLOYEE_TYPE);
  }
}, [canManageEmployeeType, form, isCreateMode]);

useEffect(() => {
  if (!isCreateMode) return;
  if (!selectedEmployeeType) return;

  if (!hasInitializedEmployeeTypePreviewRef.current) {
    hasInitializedEmployeeTypePreviewRef.current = true;
    return;
  }

  let cancelled = false;

  (async () => {
    const res = await fetch(`/api/next-employee-no?type=${selectedEmployeeType}`);
    const nextNo = await res.text();

    if (!cancelled) {
      form.setValue("employeeNo", nextNo, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: true,
      });
    }
  })();

  return () => {
    cancelled = true;
  };
}, [form, isCreateMode, selectedEmployeeType]);

useEffect(() => {
  const actionData = saveResult.data;

  if (!hasSubmitted || !actionData) return;

  if ("serverError" in actionData) {
    setHasSubmitted(false);
    return;
  }

  if (saveMode === "normal") {
    router.refresh();
    router.push("/employeeMaster");
  }

  if (saveMode === "new") {
    (async () => {
      const employeeType = form.getValues("employeeType") ?? DEFAULT_EMPLOYEE_TYPE;
      const res = await fetch(`/api/next-employee-no?type=${employeeType}`);
      const nextNo = await res.text();

      form.reset({
        ...emptyValues,
        employeeType,
        employeeNo: nextNo,
      });
      resetSaveAction();
      router.refresh();
      setSaveMode("normal");
    })();
  }

  setHasSubmitted(false);
}, [emptyValues, form, hasSubmitted, resetSaveAction, router, saveMode, saveResult]);

async function handleCsvUpload(file: File) {
  try {
    setIsImporting(true);
    setImportError(null);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/employees/import", {
      method: "POST",
      body: formData,
    });

    const payload = (await res
      .json()
      .catch(() => null)) as EmployeeCsvImportResponse | null;

    if (!res.ok) {
      throw new Error(formatCsvImportError(payload));
    }

    router.refresh();
    router.push("/employeeMaster");
  } catch (err) {
    setImportError(
      err instanceof Error ? err.message : "Unknown import error"
    );
  } finally {
    setIsImporting(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }
}

  const { register } = form;
  return (
    <FormProvider {...form}>
      <SalaryHistoryModal />
      <div className="space-y-4">
        <DisplayServerActionResponse result={saveResult} />
        <PageHeader
          title={`${employee?.id ? "Edit" : "New"} Employee ${
            employee?.id ? `#${employee.id}` : "Form"
          }`}
        />

        <form
          onSubmit={form.handleSubmit(submitForm, (errors) =>
            console.log("Form validation errors:", errors)
          )}
          className="mb-4"
        >
          <FormGrid columns={3}>
          <div className="flex w-full min-w-0 flex-col gap-3">
            <FormField
              control={form.control}
              name="employeeNo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee No</FormLabel>
                  <div className="flex items-start gap-2">
                    <div className="w-[78%]">
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          className="w-full"
                        />
                      </FormControl>
                    </div>
                    <div className="w-[22%] min-w-[96px]">
                      <FormField
                        control={form.control}
                        name="employeeType"
                        render={({ field: employeeTypeField }) => (
                          <FormItem>
                            <Select
                              value={employeeTypeField.value ?? DEFAULT_EMPLOYEE_TYPE}
                              onValueChange={employeeTypeField.onChange}
                              disabled={!canEditEmployeeType}
                            >
                              <FormControl>
                                <SelectTrigger className="w-full" disabled={!canEditEmployeeType}>
                                  <SelectValue placeholder="Type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {employeeTypeValues.map((employeeType) => (
                                  <SelectItem key={employeeType} value={employeeType}>
                                    {employeeType}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
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

          <div className="flex w-full min-w-0 flex-col gap-3">
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

          <div className="flex min-h-[180px] w-full min-w-0 flex-col">
            {/* IMAGE CONTAINER */}
            <div className="mb-2 flex flex-1 items-center justify-center rounded-md border bg-muted">
              <span className="text-sm text-muted-foreground">
                Employee Photo
              </span>
            </div>

            {/* <div className="flex-1 border rounded-lg bg-muted hover:bg-muted/70 transition overflow-hidden flex items-center justify-center mb-2">
              {employee?.photoUrl ? (
                <img
                  src={employee.photoUrl}
                  className="object-cover w-full h-full"
                  alt="Employee Photo"
                />
              ) : (
                <span className="text-sm text-muted-foreground">No Photo</span>
              )}
            </div> */}
            {/* BUTTONS */}
            <div className="grid grid-cols-4 gap-x-2 gap-y-2">
              <Button
                type="submit"
                className="col-span-2 leading-none"
                disabled={isSaving}
                onClick={() => setSaveMode("normal")}
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
                onClick={() => {
                  form.reset();   // 👈 resets but keeps employeeNo
                  resetSaveAction();
                }}
              >
                Reset
              </Button>

              <Button
                type="button"
                variant="outline"
                className="leading-none"
                onClick={() => router.back()}
              >
                Back
              </Button>

              {employee?.id && (
                <Button
                  type="button"
                  variant="destructive"
                  className="col-span-4 leading-none"
                  disabled={isArchiving}
                  onClick={async () => {
                    if (!confirm("Archive this employee?")) return;
                    await executeArchive(employee.id);
                    router.refresh();
                    router.push("/employeeMaster");
                  }}
                >
                  {isArchiving ? "Archiving..." : "Archive Employee"}
                </Button>
                
                
              )}

              {!employee?.id && (
              <Button
                type="button"
                variant="outline"
                className="col-span-4 leading-none"
                disabled={isImporting}
                onClick={() => fileInputRef.current?.click()}
              >
                {isImporting ? (
                  <>
                    <LoaderCircle className="animate-spin mr-2" />
                    Importing CSV...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2" />
                    Import Employees (CSV)
                  </>
                )}
              </Button>
              )}
              {importError && (
                <p className="col-span-4 text-sm text-destructive mt-2 whitespace-pre-line">
                  {importError}
                </p>
              )}

              {!employee?.id && (
                <Button
                  type="submit"
                  variant="secondary"
                  className="col-span-4 leading-none"
                  disabled={isSaving}
                  onClick={() => setSaveMode("new")}
                >
                  Save & New
                </Button>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCsvUpload(file);
                }}
              />
            </div>
          </div>
          </FormGrid>
        </form>
        <div className="flex-grow overflow-auto">
          <TabsSection
            employee={employee}
            departments={departments}
            positions={positions}
            slvlGroups={slvlGroups}
            customPayrollCodes={customPayrollCodes}
            recurringEntries={recurringEntries}
            recurringAccountCodeOptions={recurringAccountCodeOptions}
            salaryTabView={salaryTabView}
          />
        </div>
      </div>
    </FormProvider>
  );
}

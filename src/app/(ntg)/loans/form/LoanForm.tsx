"use client";

import { generateUUID } from "@/lib/uuid";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FormActions,
  FormGrid,
  PageHeader,
} from "@/components/layout/page-layout";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { InputWithLabel, formatMoney } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import {
  insertEmployeeLoanSchema,
  type EmployeeLoanList,
  type EmployeeLoanSummary,
  type InsertEmployeeLoanSchemaType,
} from "@/zod-schemas/employeeLoan";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { cn, generatePayrollCodes, getCurrentYear } from "@/lib/utils";
import { loanStatusEnum } from "@/db/schema";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import {
  getLoanReferencePreview,
  searchActiveEmployeesForLoan,
  saveEmployeeLoanAction,
  type LoanEmployeeSearchResult,
} from "@/app/actions/loanAction";
import { useAction } from "next-safe-action/hooks";
import { DateWithLabel } from "@/components/inputs/DateWithLabel";
import { calculateSemiMonthlyAmortization } from "@/lib/payroll/loan";
import { stripCommas } from "@/lib/number";
import {
  formatEmployeeNoDisplay,
  formatEmployeePickerLabel,
  getEmployeeTypeDisplay,
  sortEmployeesByLastName,
} from "@/utils/employeeDisplay";
import { Check, ChevronDown, Search } from "lucide-react";

type Props = {
  employeeLoan?: Partial<EmployeeLoanList>;
  loanSummary?: EmployeeLoanSummary | null;
  initialAccountCodes?: AccountCode[];
};

type LoanReferencePreview = Awaited<ReturnType<typeof getLoanReferencePreview>>;

type AccountCode = {
  id: string | number;
  accountCode: string;
  description: string | null;
  accountType: string | null;
};

type EmployeePickerOption = {
  id: string;
  name: string;
  employeeNo?: string | null;
  employeeType?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
};

function appendMissingOption<T extends { id: string }>(
  options: T[],
  option: T | null
) {
  if (!option) return options;

  const hasOption = options.some((item) => item.id === option.id);
  return hasOption ? options : [...options, option];
}

function matchesSearchTerm(
  values: Array<string | number | null | undefined>,
  searchTerm: string
) {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  if (!normalizedSearchTerm) return true;

  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(normalizedSearchTerm)
  );
}

function formatEmployeeOptionName(employee: {
  firstName?: string | null;
  lastName?: string | null;
  employeeNo?: string | null;
  employeeType?: string | null;
  employeeId?: string | null;
}) {
  return formatEmployeePickerLabel({
    ...employee,
    fallbackName: "Saved employee",
  });
}

function formatAccountCodeOptionName(account: {
  accountCode?: string | null;
  description?: string | null;
  accountCodeDescription?: string | null;
  accountType?: string | null;
  accountCodeType?: string | null;
}) {
  const code = account.accountCode ?? "Saved account code";
  const description = account.description ?? account.accountCodeDescription;
  const type = account.accountType ?? account.accountCodeType;

  return `${code}${description ? ` | ${description}` : ""}${
    type ? ` (${type})` : ""
  }`;
}

function normalizePaymentTerms(
  value: string | null | undefined
): InsertEmployeeLoanSchemaType["paymentTerms"] {
  void value;
  return "Always";
}

function normalizeLoanStatus(
  value: string | null | undefined
): InsertEmployeeLoanSchemaType["status"] {
  return loanStatusEnum.enumValues.includes(
    value as (typeof loanStatusEnum.enumValues)[number]
  )
    ? (value as InsertEmployeeLoanSchemaType["status"])
    : "Active";
}

function toMoneyNumber(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const numericValue =
    typeof value === "number" ? value : Number(stripCommas(value).trim());

  return Number.isFinite(numericValue) ? numericValue : 0;
}

function LoanEmployeeSearchPicker({
  value,
  employees,
  onChange,
  onSearchChange,
  isSearching,
  disabled,
}: {
  value: string | null | undefined;
  employees: EmployeePickerOption[];
  onChange: (value: string) => void;
  onSearchChange?: (value: string) => void;
  isSearching?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setEmployeeSearch("");
    }
  }, [open]);

  const selectedEmployee =
    employees.find((employee) => employee.id === value) ?? null;
  const filteredEmployees = employees.filter((employee) =>
    matchesSearchTerm(
      [
        employee.name,
        employee.firstName,
        employee.middleName,
        employee.lastName,
        employee.employeeNo,
        formatEmployeeNoDisplay(employee.employeeNo),
        getEmployeeTypeDisplay(employee),
        formatEmployeePickerLabel({
          firstName: employee.firstName,
          middleName: employee.middleName,
          lastName: employee.lastName,
          employeeNo: employee.employeeNo,
          employeeType: employee.employeeType,
          fallbackName: employee.name,
        }),
      ],
      employeeSearch
    )
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-9 w-full min-w-0 justify-between whitespace-normal px-3 py-2 text-left"
          aria-label="Search employee"
          aria-expanded={open}
          disabled={disabled}
        >
          <span className="min-w-0 flex-1">
            {selectedEmployee ? (
              <span className="block truncate">
                {formatEmployeePickerLabel({
                  firstName: selectedEmployee.firstName,
                  middleName: selectedEmployee.middleName,
                  lastName: selectedEmployee.lastName,
                  employeeNo: selectedEmployee.employeeNo,
                  employeeType: selectedEmployee.employeeType,
                  fallbackName: selectedEmployee.name,
                })}
              </span>
            ) : (
              <span className="text-muted-foreground">Search employee</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0"
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={employeeSearch}
              onChange={(event) => {
                const nextSearch = event.target.value;
                setEmployeeSearch(nextSearch);
                onSearchChange?.(nextSearch);
              }}
              placeholder="Search employee or no..."
              aria-label="Search employees"
              className="pl-8"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-auto p-1">
          {filteredEmployees.map((employee) => {
            const selected = employee.id === selectedEmployee?.id;

            return (
              <button
                key={employee.id}
                type="button"
                className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                onClick={() => {
                  onChange(employee.id);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    selected ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {formatEmployeePickerLabel({
                      firstName: employee.firstName,
                      middleName: employee.middleName,
                      lastName: employee.lastName,
                      employeeNo: employee.employeeNo,
                      employeeType: employee.employeeType,
                      fallbackName: employee.name,
                    })}
                  </span>
                </span>
              </button>
            );
          })}
          {filteredEmployees.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {isSearching
                ? "Searching..."
                : employeeSearch.trim().length < 2 && !selectedEmployee
                  ? "Type at least 2 characters to search."
                  : "No employees found."}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function toEmployeePickerOption(employee: LoanEmployeeSearchResult): EmployeePickerOption {
  return {
    id: employee.id,
    name: formatEmployeeOptionName(employee),
    employeeNo: employee.employeeNo,
    employeeType: employee.employeeType,
    firstName: employee.firstName,
    middleName: employee.middleName,
    lastName: employee.lastName,
  };
}

export default function LoanForm({
  employeeLoan,
  loanSummary,
  initialAccountCodes = [],
}: Props) {
  const [accountCode] = useState<AccountCode[]>(initialAccountCodes);
  const [employees, setEmployees] = useState<EmployeePickerOption[]>([]);
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState("");
  const [isEmployeeSearchLoading, setIsEmployeeSearchLoading] = useState(false);
  const [generatedId] = useState(() => generateUUID());
  const [referencePreview, setReferencePreview] =
    useState<LoanReferencePreview | null>(null);
  const [isReferencePreviewLoading, setIsReferencePreviewLoading] =
    useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const loanId = searchParams.get("loanId");
  const hasLoanId = searchParams.has("loanId");
  const isEditingExistingLoan = Boolean(employeeLoan?.id);

  const [payrollYear, setPayrollYear] = useState<number>(getCurrentYear());

  const payrollCodes = Array.from({ length: 12 }, (_, i) =>
    generatePayrollCodes(payrollYear, i + 1)
  ).flat();

  const emptyValues: InsertEmployeeLoanSchemaType = {
    id: generatedId,
    employeeId: "",
    accountCodeId: 0,
    loanReferenceNumber: "",
    amountGranted: "0",
    payrollDateDeduction: "",
    paymentTerms: "Always",
    loanDate: "",
    termMonths: 1,
    payableLoan: "0",
    loanTotalCredit: "0",
    amortization: "",
    loanBalance: "0",
    loanPaymentDate: "",
    status: "Active",
  };

  const defaultValues: InsertEmployeeLoanSchemaType = hasLoanId
    ? {
        id: employeeLoan?.id || generatedId,
        employeeId: employeeLoan?.employeeId ?? "",
        accountCodeId: employeeLoan?.accountCodeId ?? 0,
        loanReferenceNumber: employeeLoan?.loanReferenceNumber ?? "",
        amountGranted: employeeLoan?.amountGranted ?? "0",
        payrollDateDeduction: employeeLoan?.payrollDateDeduction ?? "",
        loanDate: employeeLoan?.loanDate ?? "",
        paymentTerms: normalizePaymentTerms(employeeLoan?.paymentTerms),
        termMonths: employeeLoan?.termMonths ?? 1,
        payableLoan: employeeLoan?.payableLoan ?? "0",
        loanTotalCredit: employeeLoan?.loanTotalCredit ?? "0",
        amortization: employeeLoan?.amortization ?? "",
        loanBalance: employeeLoan?.loanBalance ?? "0",
        loanPaymentDate: employeeLoan?.loanPaymentDate ?? "",
        status: normalizeLoanStatus(employeeLoan?.status),
      }
    : emptyValues;

  const form = useForm<InsertEmployeeLoanSchemaType>({
    mode: "onBlur",
    resolver: zodResolver(insertEmployeeLoanSchema),
    defaultValues,
  });

  const payableLoanValue = useWatch({
    control: form.control,
    name: "payableLoan",
  });
  const termMonthsValue = useWatch({
    control: form.control,
    name: "termMonths",
  });
  const employeeIdValue = useWatch({
    control: form.control,
    name: "employeeId",
  });
  const accountCodeIdValue = useWatch({
    control: form.control,
    name: "accountCodeId",
  });
  const hasPostedDeductions = Number(loanSummary?.totalDeducted ?? "0") > 0;
  const currentBalanceValue = hasLoanId
    ? hasPostedDeductions
      ? loanSummary?.currentBalance ?? employeeLoan?.loanBalance ?? "0"
      : payableLoanValue ?? loanSummary?.currentBalance ?? employeeLoan?.loanBalance ?? "0"
    : payableLoanValue ?? "0";
  const totalDeductedValue = loanSummary?.totalDeducted ?? "0";
  const hasReferenceConflict = referencePreview?.hasActiveConflict ?? false;

  const { execute, status } = useAction(saveEmployeeLoanAction, {
    onSuccess: (res) => {
      if (res?.data?.error) {
        alert(res.data.error);
        return;
      }

      if (res?.data?.message) {
        alert(res.data.message);
        router.refresh();
        form.reset(defaultValues);
      }
    },
    onError: (err) => {
      console.error("Error creating loan:", err);
      alert("Error creating loan. Please check inputs or try again.");
    },
  });

  useEffect(() => {
    form.reset(defaultValues);
  }, [form, loanId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isEditingExistingLoan) return;

    const normalizedSearch = employeeSearchTerm.trim();
    if (normalizedSearch.length < 2) {
      setEmployees([]);
      setIsEmployeeSearchLoading(false);
      return;
    }

    let cancelled = false;
    setIsEmployeeSearchLoading(true);

    const timeoutId = window.setTimeout(() => {
      void searchActiveEmployeesForLoan(normalizedSearch)
        .then((results) => {
          if (cancelled) return;
          setEmployees(results.map(toEmployeePickerOption));
        })
        .catch((error) => {
          if (cancelled) return;
          console.error("Error searching employees:", error);
          setEmployees([]);
        })
        .finally(() => {
          if (!cancelled) {
            setIsEmployeeSearchLoading(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [employeeSearchTerm, isEditingExistingLoan]);

  useEffect(() => {
    const nextBalance = formatMoney(currentBalanceValue || "0");
    if (form.getValues("loanBalance") === nextBalance) return;

    form.setValue("loanBalance", nextBalance, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });
  }, [currentBalanceValue, form]);

  useEffect(() => {
    const selectedAccountCodeId = Number(accountCodeIdValue);
    const fallbackReference = employeeLoan?.loanReferenceNumber ?? "";

    if (isEditingExistingLoan) {
      setReferencePreview(null);
      setIsReferencePreviewLoading(false);
      form.setValue("loanReferenceNumber", fallbackReference, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
      return;
    }

    if (
      !employeeIdValue ||
      !Number.isFinite(selectedAccountCodeId) ||
      selectedAccountCodeId <= 0
    ) {
      setReferencePreview(null);
      setIsReferencePreviewLoading(false);
      form.setValue("loanReferenceNumber", fallbackReference, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
      return;
    }

    let cancelled = false;
    setIsReferencePreviewLoading(true);

    void getLoanReferencePreview({
      employeeId: employeeIdValue,
      accountCodeId: selectedAccountCodeId,
      loanId: hasLoanId ? loanId : null,
    })
      .then((preview) => {
        if (cancelled) return;

        setReferencePreview(preview);
        form.setValue(
          "loanReferenceNumber",
          preview.loanReferenceNumber || fallbackReference,
          {
            shouldDirty: false,
            shouldTouch: false,
            shouldValidate: false,
          }
        );
      })
      .catch((error) => {
        if (cancelled) return;

        console.error("Error previewing loan reference:", error);
        setReferencePreview({
          loanReferenceNumber: fallbackReference,
          hasActiveConflict: true,
          message: "Unable to preview loan reference number.",
        });
        form.setValue("loanReferenceNumber", fallbackReference, {
          shouldDirty: false,
          shouldTouch: false,
          shouldValidate: false,
        });
      })
      .finally(() => {
        if (!cancelled) {
          setIsReferencePreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    accountCodeIdValue,
    employeeIdValue,
    employeeLoan?.loanReferenceNumber,
    form,
    hasLoanId,
    isEditingExistingLoan,
    loanId,
  ]);

  async function submitForm(data: InsertEmployeeLoanSchemaType) {
    if (hasReferenceConflict) {
      alert(
        referencePreview?.message ??
          "This employee already has an active loan with the same account code."
      );
      return;
    }

    if (isReferencePreviewLoading) return;

    execute({
      ...data,
      paymentTerms: "Always",
    });
  }

  function handleRecalculateAmortization() {
    const termMonths = Number(termMonthsValue);
    const balanceBasis = hasLoanId ? currentBalanceValue : payableLoanValue;
    const amortization = calculateSemiMonthlyAmortization({
      balance: toMoneyNumber(balanceBasis),
      termMonths,
    });

    form.setValue("paymentTerms", "Always", {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });
    form.setValue("amortization", amortization.toFixed(2), {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  }

  const baseEmployeeOptions: EmployeePickerOption[] = sortEmployeesByLastName(
    employees
  ).map((emp) => ({
    id: emp.id,
    name: formatEmployeeOptionName(emp),
    employeeNo: emp.employeeNo,
    employeeType: emp.employeeType,
    firstName: emp.firstName,
    middleName: emp.middleName,
    lastName: emp.lastName,
  }));

  const savedEmployeeOption =
    hasLoanId && employeeLoan?.employeeId
      ? {
          id: employeeLoan.employeeId,
          name: formatEmployeeOptionName({
            employeeId: employeeLoan.employeeId,
            firstName: employeeLoan.employeeFirstName,
            lastName: employeeLoan.employeeLastName,
            employeeNo: employeeLoan.employeeNo,
            employeeType: employeeLoan.employeeType,
          }),
          employeeNo: employeeLoan.employeeNo,
          employeeType: employeeLoan.employeeType,
          firstName: employeeLoan.employeeFirstName,
          middleName: null,
          lastName: employeeLoan.employeeLastName,
        }
      : null;

  const employeeOptions = appendMissingOption(
    baseEmployeeOptions,
    savedEmployeeOption
  );

  const baseAccountCodeOptions = accountCode
    .filter(
      (acc) =>
        acc.accountType === "Loan" || acc.accountType === "Other Deduction"
    )
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
    .map((acc) => ({
      id: String(acc.id),
      name: formatAccountCodeOptionName(acc),
    }));

  const savedAccountCodeOption =
    hasLoanId && employeeLoan?.accountCodeId
      ? {
          id: String(employeeLoan.accountCodeId),
          name: formatAccountCodeOptionName({
            accountCode: employeeLoan.accountCode,
            accountCodeDescription: employeeLoan.accountCodeDescription,
            accountCodeType: employeeLoan.accountCodeType,
          }),
        }
      : null;

  const accountCodeOptions = appendMissingOption(
    baseAccountCodeOptions,
    savedAccountCodeOption
  );

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <PageHeader
          title={`${employeeLoan?.id ? "Edit" : "New"} Employee Loan ${
            employeeLoan?.id ? `#${employeeLoan.id}` : "Form"
          }`}
        />
        {hasLoanId ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-sm text-muted-foreground">Current Balance</div>
              <div className="text-lg font-semibold">
                {formatMoney(currentBalanceValue)}
              </div>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-sm text-muted-foreground">Total Deducted</div>
              <div className="text-lg font-semibold">
                {formatMoney(totalDeductedValue)}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(submitForm, (errors) => {
            console.log("Validation failed, errors:", errors);
          })}
          className="space-y-3"
        >
          <FormGrid columns={4} className="lg:grid-cols-3 2xl:grid-cols-4">
          <div className="flex w-full min-w-0 flex-col gap-3">
            <FormField
              name="employeeId"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee</FormLabel>
                  <FormControl>
                    <LoanEmployeeSearchPicker
                      value={field.value}
                      employees={employeeOptions}
                      disabled={isEditingExistingLoan}
                      isSearching={isEmployeeSearchLoading}
                      onSearchChange={setEmployeeSearchTerm}
                      onChange={(nextEmployeeId) => {
                        form.setValue("employeeId", nextEmployeeId, {
                          shouldDirty: true,
                          shouldTouch: true,
                          shouldValidate: true,
                        });
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-1">
              <InputWithLabel<InsertEmployeeLoanSchemaType>
                fieldTitle="Loan Reference Number"
                nameInSchema="loanReferenceNumber"
                register={form.register}
                readOnly
                className="bg-muted text-muted-foreground"
              />
              {isReferencePreviewLoading ? (
                <p className="text-xs text-muted-foreground">Generating...</p>
              ) : referencePreview?.message ? (
                <p
                  className={`text-xs ${
                    hasReferenceConflict
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {referencePreview.message}
                </p>
              ) : null}
            </div>
            <SelectWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Account Code"
              nameInSchema="accountCodeId"
              data={accountCodeOptions}
              control={form.control}
              disabled={isEditingExistingLoan}
            />
            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Amount Granted"
              nameInSchema="amountGranted"
              type="decimal"
              register={form.register}
              format="money"
            />
          </div>

          <div className="flex w-full min-w-0 flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem] sm:items-end">
              <div className="min-w-0">
                <SelectWithLabel<InsertEmployeeLoanSchemaType>
                  fieldTitle="Payroll Date Deduction"
                  nameInSchema="payrollDateDeduction"
                  data={payrollCodes.map((code) => ({
                    id: code.code,
                    name: code.displayText,
                  }))}
                  control={form.control}
                />
              </div>
              <div className="min-w-0">
                <label className="text-sm font-medium">Year</label>
                <select
                  className="h-9 w-full min-w-0 rounded-md border bg-background px-2 py-2 text-sm"
                  value={payrollYear}
                  onChange={(e) => setPayrollYear(Number(e.target.value))}
                >
                  {Array.from({ length: 10 }, (_, i) => {
                    const year = getCurrentYear() - 5 + i;
                    return (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <DateWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Loan Date"
              nameInSchema="loanDate"
              control={form.control}
            />
            <SelectWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Payment Terms"
              nameInSchema="paymentTerms"
              data={enumToSelectOptions(["Always"])}
              control={form.control}
              disabled
            />
            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Payable Loan"
              nameInSchema="payableLoan"
              type="decimal"
              register={form.register}
              format="money"
            />
          </div>

          <div className="flex w-full min-w-0 flex-col gap-3">
            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Loan Total Credit"
              nameInSchema="loanTotalCredit"
              type="decimal"
              register={form.register}
              disabled
              format="money"
            />
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem] sm:items-end">
              <div className="min-w-0">
                <InputWithLabel<InsertEmployeeLoanSchemaType>
                  fieldTitle="Term"
                  nameInSchema="termMonths"
                  type="number"
                  min="1"
                  max="120"
                  step="1"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto min-h-9 w-full whitespace-normal px-3 py-2 text-xs leading-tight"
                onClick={handleRecalculateAmortization}
              >
                Recalculate Amortization
              </Button>
            </div>
            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Amortization"
              nameInSchema="amortization"
              register={form.register}
              format="money"
            />
            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Loan Balance"
              nameInSchema="loanBalance"
              type="decimal"
              register={form.register}
              disabled
              format="money"
            />
          </div>

          <div className="grid w-full min-w-0 gap-3 sm:col-span-2 md:grid-cols-2 lg:col-span-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto] xl:items-end 2xl:col-span-4">
            <DateWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Loan Payment Date"
              nameInSchema="loanPaymentDate"
              control={form.control}
            />
            <SelectWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Status"
              nameInSchema="status"
              data={enumToSelectOptions(loanStatusEnum.enumValues)}
              control={form.control}
            />

            <FormActions align="start" className="pt-0 md:col-span-2 xl:col-span-1 xl:justify-end">
              <Button
                type="submit"
                variant="default"
                disabled={
                  status === "executing" ||
                  hasReferenceConflict ||
                  isReferencePreviewLoading
                }
              >
                {status === "executing"
                  ? "Saving..."
                  : employeeLoan?.id
                    ? "Update"
                    : "Submit"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => form.reset(defaultValues)}
              >
                Reset
              </Button>
            </FormActions>
          </div>
          </FormGrid>
        </form>
      </Form>
    </div>
  );
}

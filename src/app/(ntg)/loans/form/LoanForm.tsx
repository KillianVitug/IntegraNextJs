"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { v4 as uuidv4 } from "uuid";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { SelectWithLabel } from "@/components/inputs/SelectWithLabel";
import {
  insertEmployeeLoanSchema,
  type InsertEmployeeLoanSchemaType,
  type SelectEmployeeLoanSchemaType,
} from "@/zod-schemas/employeeLoan";
import { getActiveEmployees } from "@/app/actions/employeeAction";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { generatePayrollCodes, getCurrentYear } from "@/lib/utils";
import { loanPaymentTermsEnum, loanStatusEnum } from "@/db/schema";
import { enumToSelectOptions } from "@/utils/enumHelpers";
import { saveEmployeeLoanAction } from "@/app/actions/loanAction";
import { useAction } from "next-safe-action/hooks";

type Props = {
  employeeLoan?: Partial<SelectEmployeeLoanSchemaType>;
};
type AccountCode = {
  id: string;
  accountCode: string;
  description: string;
  accountType: string;
};
type Employee = {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
};

export default function LoanForm({ employeeLoan }: Props) {
  const [accountCode, setaccountCode] = useState<AccountCode[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const generatedId = uuidv4();
  const searchParams = useSearchParams();
  const hasLoanId = searchParams.has("loanId");

  // 🔹 Track selected payroll year
  const [payrollYear, setPayrollYear] = useState<number>(getCurrentYear());

  // 🔹 Generate ALL 12 months for the selected year
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
        paymentTerms: employeeLoan?.paymentTerms ?? "Always",
        payableLoan: employeeLoan?.payableLoan ?? "0",
        loanTotalCredit: employeeLoan?.loanTotalCredit ?? "0",
        amortization: employeeLoan?.amortization ?? "",
        loanBalance:  employeeLoan?.loanBalance ?? "0",
        loanPaymentDate: employeeLoan?.loanPaymentDate ?? "",
        status: employeeLoan?.status ?? "Active",
      }
    : emptyValues;

  const form = useForm<InsertEmployeeLoanSchemaType>({
    mode: "onBlur",
    resolver: zodResolver(insertEmployeeLoanSchema),
    defaultValues,
  });

  const { execute, status, result } = useAction(saveEmployeeLoanAction, {
    onSuccess: (res) => {
      if (res?.data?.message) {
        alert(res.data.message);
        router.refresh(); // refresh page or table
        form.reset(defaultValues); // reset form after success
      }
    },
    onError: (err) => {
      console.error("❌ Error creating loan:", err);
      alert("Error creating loan. Please check inputs or try again.");
    },
  });

  useEffect(() => {
    fetchEmployees();
    loadAccountCode();
    form.reset(hasLoanId ? defaultValues : defaultValues);
  }, [searchParams.get("loanId")]); // eslint-disable-line react-hooks/exhaustive-deps

async function submitForm(data: InsertEmployeeLoanSchemaType) {
  execute(data); // 🟢 Call the server action
}
   // 🔹 Fetcher function
  const loadAccountCode = useCallback(async () => {
        const res = await fetch("/api/constants/accountCode");
        const data = await res.json();
        setaccountCode(data);
    }, []);
  const fetchEmployees = async () => {
    try {
      const result = await getActiveEmployees();
      setEmployees(result.data || []);
    } catch (error) {
      console.error("Error fetching employees:", error);
    } finally {
      setIsLoading(false);
    }
  };
  const employeeOptions = employees.map((emp) => ({
    id: emp.id,
    name: `${emp.lastName}, ${emp.firstName} (${emp.employeeNo})`,
  }));

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <div>
        <h2 className="text-2xl font-bold">
          {employeeLoan?.id ? "Edit" : "New"} Employee Loan{" "}
          {employeeLoan?.id ? `#${employeeLoan.id}` : "Form"}
        </h2>
      </div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(
            submitForm,
            (errors) => {
              console.log("❌ Validation failed, errors:", errors);
            }
          )}
          className="flex flex-col md:flex-row gap-4 md:gap-8"
        >
          {/* Column 1 */}
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <SelectWithLabel
              fieldTitle="Employee"
              nameInSchema="employeeId"
              control={form.control}
              data={employeeOptions}
            />
            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Loan Reference Number"
              nameInSchema="loanReferenceNumber"
              register={form.register}
            />
            <SelectWithLabel<InsertEmployeeLoanSchemaType> 
              fieldTitle="Account Code"
              nameInSchema="accountCodeId"
              data={accountCode.filter(
                (acc) =>
                  acc.accountType === "Loan" ||
                  acc.accountType === "Other Deduction"
              )
              .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
              .map(acc => ({
                id: acc.id.toString(),  // string
                name: `${acc.accountCode} | ${acc.description} (${acc.accountType})`,
              }))}
              control={form.control}
              
            />
            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Amount Granted"
              nameInSchema="amountGranted"
              type="decimal"
              register={form.register}
            />
          </div>

          {/* Column 2 */}
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <SelectWithLabel<InsertEmployeeLoanSchemaType>
                  fieldTitle="Payroll Date Deduction"
                  nameInSchema="payrollDateDeduction"
                  data={payrollCodes.map((code) => ({
                    id: code.code,
                    name: `${code.code} (${code.period})`,
                  }))}
                  control={form.control}
                />
              </div>
              {/* 🔹 Year Dropdown */}
              <div className="w-30">
                <label className="text-sm font-medium">Year</label>
                <select
                  className="w-full border rounded-md px-1 py-2 text-sm"
                  value={payrollYear}
                  onChange={(e) => setPayrollYear(Number(e.target.value))}
                >
                  {Array.from({ length: 10 }, (_, i) => {
                    const year = getCurrentYear() - 5 + i; // range: 5 years back, 5 forward
                    return (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Loan Date"
              nameInSchema="loanDate"
              type="date"
              register={form.register}
            />
            <SelectWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Payment Terms"
              nameInSchema="paymentTerms"
              data={enumToSelectOptions(loanPaymentTermsEnum.enumValues)}
              control={form.control}
            />
            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Payable Loan"
              nameInSchema="payableLoan"
              type="decimal"
              register={form.register}
            />
          </div>

          {/* Column 3 */}
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Loan Total Credit"
              nameInSchema="loanTotalCredit"
              type="decimal"
              register={form.register}
              disabled
            />
            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Amortization"
              nameInSchema="amortization"
              register={form.register}
            />
            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Loan Balance"
              nameInSchema="loanBalance"
              type="decimal"
              register={form.register}
              disabled
            />
            <InputWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Loan Payment Date"
              nameInSchema="loanPaymentDate"
              type="date"
              register={form.register}
            />
          </div>
          <div className="flex flex-col gap-4 w-full max-w-xs"> 
          <SelectWithLabel<InsertEmployeeLoanSchemaType>
              fieldTitle="Status"
              nameInSchema="status"
              data={enumToSelectOptions(loanStatusEnum.enumValues)}
              control={form.control}
            />

          <div className="flex gap-2">
            <Button
              type="submit"
              className="w-3/4"
              variant="default"
              disabled={status === "executing"}
            >
              {status === "executing" ? "Saving..." : "Submit"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => form.reset(defaultValues)}
            >
              Reset
            </Button>
          </div>
          </div>
        </form>
      </Form>
    </div>
  );
}

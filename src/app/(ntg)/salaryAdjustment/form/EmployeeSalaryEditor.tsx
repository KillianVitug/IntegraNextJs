"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { InputWithLabel } from "@/components/inputs/InputWithLabel";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import {
  getEmployeeSalaryById,
  updateEmployeeSalary,
  deleteSalaryAdjustmentAndRestore,
} from "@/app/actions/salaryAdjustAction";
import {
  updateEmployeeSalarySchema,
  type UpdateEmployeeSalarySchemaType,
} from "@/zod-schemas/employeeSalary";

type Props = {
  selectedEmployeeId: string;
  payrollCode: string;
  onUpdateComplete: (updatedEmployee: any) => void;
  onCancel: () => void; // <-- Add this
};

export default function EmployeeSalaryEditor({
  selectedEmployeeId,
  payrollCode,
  onUpdateComplete,
  onCancel,
}: Props) {
  const [currentSalary, setCurrentSalary] =
    useState<UpdateEmployeeSalarySchemaType | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<UpdateEmployeeSalarySchemaType>({
    resolver: zodResolver(updateEmployeeSalarySchema),
    defaultValues: {
      dailyRate: "",
      monthlyRate: "",
      monthlyAllowance: "",
      dailyAllowance: "",
      rateDivisor: "",
      billingRate: "",
    },
  });

  // Fetch salary info when employee is selected
  useEffect(() => {
    if (selectedEmployeeId) {
      getEmployeeSalaryById(selectedEmployeeId).then((info) => {
        if (info) {
          const salaryData = {
            dailyRate: info.dailyRate ?? "",
            monthlyRate: info.monthlyRate ?? "",
            monthlyAllowance: info.monthlyAllowance ?? "",
            dailyAllowance: info.dailyAllowance ?? "",
            rateDivisor: info.rateDivisor ?? "",
            billingRate: info.billingRate ?? "",
          };
          setCurrentSalary(salaryData);
          // Don't reset the form with current values - keep it empty for new input
        } else {
          setCurrentSalary(null);
        }
      });
    }
  }, [selectedEmployeeId]);

  const onSubmit = async (data: UpdateEmployeeSalarySchemaType) => {
    try {
      setIsLoading(true);

      // Pass payroll code to the update function
      await updateEmployeeSalary(selectedEmployeeId, data, payrollCode);

      // Call the callback to refresh the table
      onUpdateComplete({});

      // Reset form
      form.reset({
        dailyRate: "",
        monthlyRate: "",
        monthlyAllowance: "",
        dailyAllowance: "",
        rateDivisor: "",
        billingRate: "",
      });
    } catch (error) {
      console.error("Error updating salary:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    form.reset({
      dailyRate: "",
      monthlyRate: "",
      monthlyAllowance: "",
      dailyAllowance: "",
      rateDivisor: "",
      billingRate: "",
    });
  };

  const handleDelete = async () => {
    try {
      setIsLoading(true);
      await deleteSalaryAdjustmentAndRestore(selectedEmployeeId, payrollCode);
      onUpdateComplete({});
      onCancel();
    } catch (error) {
      console.error("Error deleting salary adjustment:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="flex flex-col gap-8">
            {/* Current Salary Info */}
            <div>
              <h3 className="font-bold mb-4 text-lg">
                Current Salary Information
              </h3>
              <div className="flex justify-evenly">
                <InputWithLabel
                  fieldTitle="Daily Rate"
                  nameInSchema="currentDailyRate"
                  value={currentSalary?.dailyRate || ""}
                  readOnly
                />
                <InputWithLabel
                  fieldTitle="Monthly Rate"
                  nameInSchema="currentMonthlyRate"
                  value={currentSalary?.monthlyRate || ""}
                  readOnly
                />
                <InputWithLabel
                  fieldTitle="Monthly Allowance"
                  nameInSchema="currentMonthlyAllowance"
                  value={currentSalary?.monthlyAllowance || ""}
                  readOnly
                />
                <InputWithLabel
                  fieldTitle="Daily Allowance"
                  nameInSchema="currentDailyAllowance"
                  value={currentSalary?.dailyAllowance || ""}
                  readOnly
                />
                <InputWithLabel
                  fieldTitle="Rate Divisor"
                  nameInSchema="currentRateDivisor"
                  value={currentSalary?.rateDivisor || ""}
                  readOnly
                />
                <InputWithLabel
                  fieldTitle="Billing Rate"
                  nameInSchema="currentBillingRate"
                  value={currentSalary?.billingRate || ""}
                  readOnly
                />
              </div>
            </div>

            {/* New Salary Info */}
            <div>
              <h3 className="font-bold mb-4 text-lg">New Salary Information</h3>
              <div className="flex justify-evenly">
                <InputWithLabel
                  fieldTitle="Daily Rate"
                  nameInSchema="dailyRate"
                  type="decimal"
                  placeholder="0.00"
                  register={form.register}
                />
                <InputWithLabel
                  fieldTitle="Monthly Rate"
                  nameInSchema="monthlyRate"
                  type="decimal"
                  placeholder="0.00"
                  register={form.register}
                />
                <InputWithLabel
                  fieldTitle="Monthly Allowance"
                  nameInSchema="monthlyAllowance"
                  type="decimal"
                  placeholder="0.00"
                  register={form.register}
                />
                <InputWithLabel
                  fieldTitle="Daily Allowance"
                  nameInSchema="dailyAllowance"
                  type="decimal"
                  placeholder="0.00"
                  register={form.register}
                />
                <InputWithLabel
                  fieldTitle="Rate Divisor"
                  nameInSchema="rateDivisor"
                  type="decimal"
                  placeholder="0.00"
                  register={form.register}
                />
                <InputWithLabel
                  fieldTitle="Billing Rate"
                  nameInSchema="billingRate"
                  type="decimal"
                  placeholder="0.00"
                  register={form.register}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isLoading}
                >
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Salary Adjustment?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will restore the employee’s salary to the original
                    values and remove this adjustment for payroll code{" "}
                    <strong>{payrollCode}</strong>. This action cannot be
                    undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Yes, Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              type="button"
              variant="outline"
              onClick={() => handleReset()}
              disabled={isLoading}
            >
              Reset
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Updating..." : "Update Salary"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

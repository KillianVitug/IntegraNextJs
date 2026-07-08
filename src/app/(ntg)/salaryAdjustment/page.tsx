import { getActiveEmployees } from "@/app/actions/employeeAction";
import {
  listSalaryAdjustmentPeriods,
  listSalaryChanges,
} from "@/app/actions/salaryAdjustAction";
import SalaryAdjustTable from "./SalaryAdjustTable";

export const metadata = {
  title: "Salary Adjustment",
};

export default async function SalaryAdjustmentPage() {
  const year = new Date().getFullYear();

  const [periods, salaryChanges, employees] = await Promise.all([
    listSalaryAdjustmentPeriods(year),
    listSalaryChanges({ year }),
    getActiveEmployees(),
  ]);

  return (
    <SalaryAdjustTable
      initialData={salaryChanges}
      initialEmployees={employees.data ?? []}
      initialPeriods={periods}
      initialYear={year}
    />
  );
}

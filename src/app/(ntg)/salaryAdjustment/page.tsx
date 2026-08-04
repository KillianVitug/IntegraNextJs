import {
  listSalaryAdjustmentEmployees,
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
    listSalaryAdjustmentEmployees(),
  ]);

  return (
    <SalaryAdjustTable
      initialData={salaryChanges}
      initialEmployees={employees}
      initialPeriods={periods}
      initialYear={year}
    />
  );
}

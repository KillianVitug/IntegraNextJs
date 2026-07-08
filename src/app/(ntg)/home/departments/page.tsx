import { getHomeDepartmentsData } from "@/lib/queries/home";
import { DepartmentSelectionClient } from "./DepartmentSelectionClient";

export const metadata = {
  title: "Departments",
};

export default async function Departments() {
  const data = await getHomeDepartmentsData();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          Employee Departments
        </h1>
        <p className="text-sm text-muted-foreground">
          Select a department card to review assigned employees and their
          current positions.
        </p>
      </div>

      <DepartmentSelectionClient cards={data.cards} />
    </div>
  );
}

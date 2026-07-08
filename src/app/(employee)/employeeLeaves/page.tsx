import { getEmployeeForUser } from "@/lib/queries/getEmployeeForUser";
import { requireEmployee } from "@/lib/auth/server";
import EmployeeLeavesClient from "./EmployeeLeavesClient";
import EmployeeServiceTable from "./EmployeeServiceTable";

export const metadata = {
  title: "Employee Leaves",
};

export default async function EmployeeLeaves() {
  const auth = await requireEmployee({ redirectTo: "/" });
  const employee = await getEmployeeForUser({
    employeeId: auth.employeeId,
  });

  if (!employee) {
    return (
      <div className="p-6">
        <h2 className="mb-2 text-2xl font-bold">Employee Leaves</h2>
        <div className="rounded-lg border border-border bg-muted p-4">
          <p className="font-medium">Profile not linked</p>
          <p className="text-sm text-muted-foreground">
            We could not find an employee record linked to your account. Please
            contact HR or your administrator.
          </p>
        </div>
      </div>
    );
  }

  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <EmployeeLeavesClient initialYear={currentYear} />
      <EmployeeServiceTable />
    </div>
  );
}

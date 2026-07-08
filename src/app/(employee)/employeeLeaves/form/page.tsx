import { getEmployeeForUser } from "@/lib/queries/getEmployeeForUser";
import { requireEmployee } from "@/lib/auth/server";
import EmployeeLeaveClient from "./EmployeeLeaveClient";
import { ensureDefaultLeaveTypes } from "@/lib/payroll/leave";
import { fetchLeaveTypes } from "@/lib/queries/fetchLookupData";

export const metadata = {
  title: "Employee Leave Request",
};

export default async function EmployeeLeaveFormPage() {
  const auth = await requireEmployee({ redirectTo: "/" });
  const employee = await getEmployeeForUser({
    employeeId: auth.employeeId,
  });

  if (!employee) {
    return (
      <div className="p-6">
        <h2 className="mb-2 text-2xl font-bold">Leave Request</h2>
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
  await ensureDefaultLeaveTypes();
  const leaveTypes = await fetchLeaveTypes();

  return (
    <EmployeeLeaveClient
      employee={{
        id: employee.id,
        employeeNo: employee.employeeNo,
        firstName: employee.firstName,
        lastName: employee.lastName,
      }}
      leaveTypeOptions={leaveTypes.map((leaveType) => ({
        id: leaveType.code,
        name: `${leaveType.code} | ${leaveType.name}`,
      }))}
      initialYear={currentYear}
    />
  );
}

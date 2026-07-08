import { getEmployeeForUser } from "@/lib/queries/getEmployeeForUser";
import { requireEmployee } from "@/lib/auth/server";
import {
  fetchCustomPayrollCodes,
  fetchDepartments,
  fetchPositions,
  fetchSlVl,
} from "@/lib/queries/fetchLookupData";
import ProfileHeaderSection from "./ProfileHeaderSection";
import ProfileTabSection from "./ProfileTabSection";

export const metadata = {
  title: "Employee Profile",
};

export default async function EmployeeProfilePage() {
  const auth = await requireEmployee({ redirectTo: "/" });

  const [departments, positions, slvlGroups, customPayrollCodes, employee] =
    await Promise.all([
      fetchDepartments(),
      fetchPositions(),
      fetchSlVl(),
      fetchCustomPayrollCodes(),
      getEmployeeForUser({ employeeId: auth.employeeId }),
    ]);

  if (!employee) {
    return (
      <div className="p-6">
        <h2 className="mb-2 text-2xl font-bold">Employee Profile</h2>
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

  return (
    <div className="p-6">
      <ProfileHeaderSection employee={employee} />
      <div className="flex-grow overflow-auto">
        <ProfileTabSection
          employee={employee}
          departments={departments}
          positions={positions}
          slvlGroups={slvlGroups}
          customPayrollCodes={customPayrollCodes}
        />
      </div>
    </div>
  );
}

import { AccessManagementClient } from "./AccessManagementClient";
import { listAccountAccessRows, requirePermission } from "@/lib/auth/server";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";
import { isManagerialConfidentialityLevel } from "@/utils/employeeCode";

export const metadata = {
  title: "Users & access",
};

export default async function AccessManagementPage() {
  const auth = await requirePermission(AUTH_PERMISSIONS.ACCESS_MANAGE, { redirectTo: "/" });
  const accountRows = await listAccountAccessRows();
  const accounts = accountRows.map((account) => ({
      ...account,
      createdAt: account.createdAt.toISOString(),
      lastLoginAt: account.lastLoginAt ? account.lastLoginAt.toISOString() : null,
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Users &amp; access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Find a login account, then manage access and passwords on the employee record.
        </p>
      </div>
      <AccessManagementClient accounts={accounts} canCreateAdministrator={isManagerialConfidentialityLevel(auth.confidentialityLevel)} />
    </div>
  );
}

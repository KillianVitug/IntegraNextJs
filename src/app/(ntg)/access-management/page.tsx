import { AccessManagementClient } from "./AccessManagementClient";
import { listAccountAccessRows, requirePermission } from "@/lib/auth/server";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";
import { fetchDepartments } from "@/lib/queries/fetchLookupData";

export const metadata = {
  title: "Access Management",
};

export default async function AccessManagementPage() {
  await requirePermission(AUTH_PERMISSIONS.ACCESS_MANAGE, { redirectTo: "/" });
  const [accountRows, departments] = await Promise.all([
    listAccountAccessRows(),
    fetchDepartments(),
  ]);
  const accounts = accountRows.map((account) => ({
      ...account,
      createdAt: account.createdAt.toISOString(),
      lastLoginAt: account.lastLoginAt ? account.lastLoginAt.toISOString() : null,
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Access Management</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage account groups, lifecycle status, sessions, and password resets.
        </p>
      </div>
      <AccessManagementClient
        accounts={accounts}
        departments={departments.map((department) => ({
          id: department.id,
          code: department.code,
          name: department.name,
        }))}
      />
    </div>
  );
}

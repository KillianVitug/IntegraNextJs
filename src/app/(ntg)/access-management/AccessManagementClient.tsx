"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, KeyRound, RefreshCw, ShieldPlus, UserCog } from "lucide-react";
import {
  createAdminAccountAction,
  resetAccountPasswordAction,
  revokeAccountSessionsAction,
  updateAccountGroupAction,
  updateAccountStatusAction,
} from "@/app/actions/authAction";
import { initialAuthActionState } from "@/lib/auth/action-state";
import { AUTH_GROUPS, AUTH_GROUP_KEYS, type AuthGroupKey } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AccountRow = {
  accountId: string;
  employeeId: string;
  employeeType: "EMP" | "ADMIN";
  employeeNo: string;
  email: string;
  firstName: string;
  lastName: string;
  confidentialityLevel: "Rank and File" | "Supervisory" | "Managerial" | null;
  status: "PendingSetup" | "Active" | "Locked" | "Disabled";
  mustSetPassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  groupKeys: AuthGroupKey[];
  groupNames: string[];
  managerDepartmentIds: number[];
  managerDepartmentNames: string[];
};

type Props = {
  accounts: AccountRow[];
  departments: DepartmentOption[];
};

type DepartmentOption = {
  id: number;
  code: string;
  name: string;
};

const assignableGroups = [
  AUTH_GROUPS.SYSTEM_ADMIN,
  AUTH_GROUPS.HR_ADMIN,
  AUTH_GROUPS.MANAGER,
  AUTH_GROUPS.EMPLOYEE,
];

const adminCreateGroups = [
  AUTH_GROUPS.SYSTEM_ADMIN,
  AUTH_GROUPS.HR_ADMIN,
  AUTH_GROUPS.MANAGER,
];

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function StatusActions({ account }: { account: AccountRow }) {
  const nextStatus =
    account.status === "Active"
      ? "Locked"
      : account.status === "Locked" || account.status === "Disabled"
        ? "Active"
        : "Active";
  const nextStatusLabel =
    account.status === "Active"
      ? "Lock"
      : account.status === "Disabled"
        ? "Reactivate"
        : "Unlock";

  return (
    <div className="flex flex-wrap gap-2">
      <form action={updateAccountStatusAction}>
        <input type="hidden" name="accountId" value={account.accountId} />
        <input type="hidden" name="status" value={nextStatus} />
        <Button type="submit" variant="outline" size="sm">
          {nextStatusLabel}
        </Button>
      </form>

      {account.status !== "Disabled" ? (
        <form action={updateAccountStatusAction}>
          <input type="hidden" name="accountId" value={account.accountId} />
          <input type="hidden" name="status" value="Disabled" />
          <Button type="submit" variant="outline" size="sm">
            Deactivate
          </Button>
        </form>
      ) : null}

      <form action={revokeAccountSessionsAction}>
        <input type="hidden" name="accountId" value={account.accountId} />
        <Button type="submit" variant="outline" size="sm">
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          Sessions
        </Button>
      </form>
    </div>
  );
}

function DepartmentMultiSelect({
  departments,
  defaultDepartmentIds,
  triggerId,
  required,
}: {
  departments: DepartmentOption[];
  defaultDepartmentIds?: number[];
  triggerId?: string;
  required?: boolean;
}) {
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<number[]>(
    defaultDepartmentIds ?? [],
  );
  const selectedDepartments = departments.filter((department) =>
    selectedDepartmentIds.includes(department.id),
  );
  const triggerLabel =
    selectedDepartments.length === 0
      ? "Select departments"
      : selectedDepartments.length === 1
        ? `${selectedDepartments[0].code} | ${selectedDepartments[0].name}`
        : `${selectedDepartments.length} departments selected`;

  function toggleDepartment(departmentId: number, checked: boolean) {
    setSelectedDepartmentIds((current) => {
      if (checked) {
        return current.includes(departmentId) ? current : [...current, departmentId];
      }

      return current.filter((id) => id !== departmentId);
    });
  }

  return (
    <div className="space-y-2">
      {selectedDepartmentIds.map((departmentId) => (
        <input
          key={departmentId}
          type="hidden"
          name="departmentIds"
          value={departmentId}
        />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            id={triggerId}
            type="button"
            variant="outline"
            disabled={departments.length === 0}
            aria-invalid={required && selectedDepartmentIds.length === 0}
            className="h-9 w-full justify-between px-3 text-left font-normal"
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        >
          {departments.map((department) => (
            <DropdownMenuCheckboxItem
              key={department.id}
              checked={selectedDepartmentIds.includes(department.id)}
              onCheckedChange={(checked) =>
                toggleDepartment(department.id, checked === true)
              }
              onSelect={(event) => event.preventDefault()}
              className="pr-3"
            >
              <span className="truncate">
                {department.code} | {department.name}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
          {departments.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              No departments available.
            </div>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {required && selectedDepartmentIds.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Select at least one department.
        </p>
      ) : null}
    </div>
  );
}

function GroupForm({
  account,
  departments,
}: {
  account: AccountRow;
  departments: DepartmentOption[];
}) {
  const defaultGroup = account.groupKeys[0] ?? AUTH_GROUP_KEYS.EMPLOYEE;
  const [selectedGroup, setSelectedGroup] = useState(defaultGroup);

  return (
    <form action={updateAccountGroupAction} className="grid min-w-56 gap-2">
      <input type="hidden" name="accountId" value={account.accountId} />
      <div className="flex gap-2">
        <select
          name="groupKey"
          defaultValue={defaultGroup}
          onChange={(event) => setSelectedGroup(event.target.value as AuthGroupKey)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {assignableGroups.map((group) => (
            <option key={group.key} value={group.key}>
              {group.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          Save
        </Button>
      </div>
      {selectedGroup === AUTH_GROUP_KEYS.MANAGER ? (
        <DepartmentMultiSelect
          departments={departments}
          defaultDepartmentIds={account.managerDepartmentIds}
          triggerId={`account-${account.accountId}-departments`}
          required
        />
      ) : null}
    </form>
  );
}

function CreateAccessAccountForm({
  departments,
  adminAccountState,
  adminAccountAction,
}: {
  departments: DepartmentOption[];
  adminAccountState: typeof initialAuthActionState;
  adminAccountAction: (payload: FormData) => void;
}) {
  const [selectedGroup, setSelectedGroup] = useState<AuthGroupKey>(
    AUTH_GROUP_KEYS.HR_ADMIN,
  );

  return (
    <form action={adminAccountAction} className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="admin-account-email">Email</Label>
        <Input
          id="admin-account-email"
          name="email"
          type="email"
          placeholder="manager@company.com"
          required
        />
        {adminAccountState.fieldErrors?.email?.[0] ? (
          <p className="text-sm text-destructive">
            {adminAccountState.fieldErrors.email[0]}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="admin-account-group">Access Group</Label>
        <select
          id="admin-account-group"
          name="groupKey"
          defaultValue={AUTH_GROUP_KEYS.HR_ADMIN}
          onChange={(event) => setSelectedGroup(event.target.value as AuthGroupKey)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
        >
          {adminCreateGroups.map((group) => (
            <option key={group.key} value={group.key}>
              {group.name}
            </option>
          ))}
        </select>
        {adminAccountState.fieldErrors?.groupKey?.[0] ? (
          <p className="text-sm text-destructive">
            {adminAccountState.fieldErrors.groupKey[0]}
          </p>
        ) : null}
      </div>
      {selectedGroup === AUTH_GROUP_KEYS.MANAGER ? (
        <div className="space-y-2 lg:col-span-2">
          <Label htmlFor="admin-account-departments">Departments</Label>
          <DepartmentMultiSelect
            departments={departments}
            triggerId="admin-account-departments"
            required
          />
          {adminAccountState.fieldErrors?.departmentIds?.[0] ? (
            <p className="text-sm text-destructive">
              {adminAccountState.fieldErrors.departmentIds[0]}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="admin-account-first-name">First Name</Label>
        <Input
          id="admin-account-first-name"
          name="firstName"
          placeholder="Required only for new profiles"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="admin-account-last-name">Last Name</Label>
        <Input
          id="admin-account-last-name"
          name="lastName"
          placeholder="Required only for new profiles"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="admin-account-temp-password">Temporary Password</Label>
        <Input
          id="admin-account-temp-password"
          name="tempPassword"
          type="password"
          placeholder="At least 5 characters"
          minLength={5}
          required
        />
        {adminAccountState.fieldErrors?.tempPassword?.[0] ? (
          <p className="text-sm text-destructive">
            {adminAccountState.fieldErrors.tempPassword[0]}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="admin-account-confirm-temp-password">
          Confirm Temporary Password
        </Label>
        <Input
          id="admin-account-confirm-temp-password"
          name="confirmTempPassword"
          type="password"
          placeholder="Repeat the temporary password"
          minLength={5}
          required
        />
        {adminAccountState.fieldErrors?.confirmTempPassword?.[0] ? (
          <p className="text-sm text-destructive">
            {adminAccountState.fieldErrors.confirmTempPassword[0]}
          </p>
        ) : null}
      </div>
      <div className="flex items-end lg:col-span-2">
        <Button type="submit" className="w-full lg:w-auto">
          Create Or Update Access Account
        </Button>
      </div>
    </form>
  );
}

function ResetPasswordForm({ account }: { account: AccountRow }) {
  return (
    <form action={resetAccountPasswordAction} className="grid min-w-72 gap-2">
      <input type="hidden" name="accountId" value={account.accountId} />
      <div className="grid grid-cols-2 gap-2">
        <Input
          name="tempPassword"
          type="password"
          placeholder="Temp password"
          minLength={5}
          required
        />
        <Input
          name="confirmTempPassword"
          type="password"
          placeholder="Confirm"
          minLength={5}
          required
        />
      </div>
      <Button type="submit" variant="outline" size="sm" className="justify-self-start">
        <KeyRound className="mr-1 h-3.5 w-3.5" />
        Reset Password
      </Button>
    </form>
  );
}

export function AccessManagementClient({ accounts, departments }: Props) {
  const router = useRouter();
  const [adminAccountState, adminAccountAction] = useActionState(
    createAdminAccountAction,
    initialAuthActionState,
  );

  useEffect(() => {
    if (adminAccountState.status === "success") {
      router.refresh();
    }
  }, [adminAccountState.status, router]);

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldPlus className="h-5 w-5" />
            Create Or Promote Access Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CreateAccessAccountForm
            departments={departments}
            adminAccountState={adminAccountState}
            adminAccountAction={adminAccountAction}
          />

          {adminAccountState.message ? (
            <p
              className={`mt-4 text-sm ${
                adminAccountState.status === "error"
                  ? "text-destructive"
                  : "text-emerald-700"
              }`}
            >
              {adminAccountState.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <UserCog className="h-5 w-5" />
            Accounts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-3 pr-4 font-medium">Employee</th>
                  <th className="pb-3 pr-4 font-medium">Email</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 pr-4 font-medium">Group</th>
                  <th className="pb-3 pr-4 font-medium">Password</th>
                  <th className="pb-3 pr-4 font-medium">Last Login</th>
                  <th className="pb-3 pr-4 font-medium">Lifecycle</th>
                  <th className="pb-3 font-medium">Reset</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td className="py-4 text-slate-500" colSpan={8}>
                      No login accounts yet.
                    </td>
                  </tr>
                ) : null}
                {accounts.map((account) => (
                  <tr key={account.accountId} className="border-b align-top last:border-b-0">
                    <td className="py-4 pr-4">
                      <div className="font-medium">
                        {account.firstName} {account.lastName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {account.employeeType}
                        {account.employeeNo} - {account.confidentialityLevel ?? "No level"}
                      </div>
                    </td>
                    <td className="py-4 pr-4">{account.email}</td>
                    <td className="py-4 pr-4">{account.status}</td>
                    <td className="py-4 pr-4">
                      <div className="mb-2 text-xs text-slate-500">
                        {account.groupNames.join(", ")}
                        {account.managerDepartmentNames.length > 0
                          ? ` | ${account.managerDepartmentNames.join(", ")}`
                          : ""}
                      </div>
                      <GroupForm account={account} departments={departments} />
                    </td>
                    <td className="py-4 pr-4">
                      {account.mustSetPassword
                        ? "Temporary password pending"
                        : "Permanent password set"}
                    </td>
                    <td className="py-4 pr-4">{formatDate(account.lastLoginAt)}</td>
                    <td className="py-4 pr-4">
                      <StatusActions account={account} />
                    </td>
                    <td className="py-4">
                      <ResetPasswordForm account={account} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

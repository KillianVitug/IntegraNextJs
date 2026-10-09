"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AUTH_GROUPS, type AuthGroupKey } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
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
  status: "PendingSetup" | "Active" | "Locked" | "Disabled";
  mustSetPassword: boolean;
  lastLoginAt: string | null;
  groupKeys: AuthGroupKey[];
  groupNames: string[];
  managerDepartmentNames: string[];
};

export function AccessManagementClient({ accounts, canCreateAdministrator = false }: { accounts: AccountRow[]; canCreateAdministrator?: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const visibleAccounts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return accounts.filter((account) =>
      (status === "all" || account.status === status) &&
      (role === "all" || account.groupKeys.includes(role as AuthGroupKey)) &&
      (!query || [account.firstName, account.lastName, account.employeeNo,
        account.employeeType, account.email, ...account.groupNames,
        ...account.managerDepartmentNames].join(" ").toLocaleLowerCase().includes(query)),
    );
  }, [accounts, search, status, role]);

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href="/employeeMaster">Find employee / create login</Link></Button>
        {canCreateAdministrator ? <Button asChild variant="outline"><Link href="/employeeMaster/form?employeeType=ADMIN&tab=access">Create administrator</Link></Button> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-2 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="access-search">Search users</Label>
          <Input id="access-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, employee number, email or branch" />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="access-status">Account status</Label>
          <select id="access-status" className="h-10 w-full rounded-md border border-input bg-background px-3 text-base" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="Active">Active</option>
            <option value="PendingSetup">Pending setup</option>
            <option value="Locked">Locked</option>
            <option value="Disabled">Disabled</option>
          </select>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="access-role">Role</Label>
          <select id="access-role" className="h-10 w-full rounded-md border border-input bg-background px-3 text-base" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="all">All roles</option>
            {Object.values(AUTH_GROUPS).map((group) => <option key={group.key} value={group.key}>{group.name}</option>)}
          </select>
        </div>
      </div>
      <p className="text-sm text-muted-foreground" role="status">{visibleAccounts.length} of {accounts.length} login accounts</p>
      <div className="divide-y rounded-lg border">
        {visibleAccounts.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{accounts.length ? "No accounts match these filters." : "No login accounts yet. Open an employee to create their login."}</p> : null}
        {visibleAccounts.map((account) => (
          <article key={account.accountId} className="grid min-w-0 gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0 space-y-1">
              <h2 className="break-words font-medium">{account.firstName} {account.lastName}</h2>
              <p className="text-xs text-muted-foreground">{account.employeeType} · {account.employeeNo}</p>
              <p className="break-all text-sm">{account.email}</p>
            </div>
            <div className="min-w-0 space-y-1 text-sm">
              <p>{account.groupNames.join(", ") || "No explicit role"} · {account.status === "PendingSetup" ? "Pending setup" : account.status}</p>
              {account.managerDepartmentNames.length ? <p className="break-words text-muted-foreground">Branches: {account.managerDepartmentNames.join(", ")}</p> : null}
              <p className="text-muted-foreground">{account.mustSetPassword ? "Password setup required" : "Permanent password set"}</p>
              <p className="text-xs text-muted-foreground">Last sign-in: {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : "Never"}</p>
            </div>
            <Button asChild variant="outline" className="justify-self-start">
              <Link href={`/employeeMaster/form?employeeId=${encodeURIComponent(account.employeeId)}&tab=access`} aria-label={`Manage account for ${account.firstName} ${account.lastName}`}>Manage account</Link>
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
}

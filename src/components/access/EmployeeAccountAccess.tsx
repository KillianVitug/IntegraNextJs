"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  getEmployeeAccountAccessAction,
  mutateEmployeeAccountAccessAction,
} from "@/app/actions/employeeAccessAction";
import type {
  EmployeeAccountAccessData,
  EmployeeAccountAccessMutation,
} from "@/lib/auth/employee-access-types";
import { AUTH_GROUPS, AUTH_GROUP_KEYS, type AuthGroupKey } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Operation = EmployeeAccountAccessMutation["operation"];
type Props = {
  employeeId: string;
  disabledReason?: string;
  onAccessSaved?: (data: EmployeeAccountAccessData) => void;
  onPendingChange?: (pending: boolean) => void;
};

const operationTitles: Record<Operation, string> = {
  create: "Create login",
  access: "Edit access",
  resetPassword: "Reset password",
  status: "Change account status",
  revokeSessions: "Sign out all sessions",
};

function confidentialityForRole(role: AuthGroupKey) {
  if (role === AUTH_GROUP_KEYS.SYSTEM_ADMIN) return "Managerial";
  return role === AUTH_GROUP_KEYS.EMPLOYEE ? "Rank and File" : "Supervisory";
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 border-b py-2"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{children}</dd></div>;
}

/** This editor is nested in EmployeeForm. It deliberately never renders a form. */
export function EmployeeAccountAccess({ employeeId, disabledReason, onAccessSaved, onPendingChange }: Props) {
  const prefix = useId();
  const requestId = useRef(0);
  const submitting = useRef(false);
  const pendingCallback = useRef(onPendingChange);
  const [data, setData] = useState<EmployeeAccountAccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const [view, setView] = useState<"summary" | "edit" | "review" | "receipt">("summary");
  const [operation, setOperation] = useState<Operation>("access");
  const [groupKey, setGroupKey] = useState<AuthGroupKey | "">("");
  const [departmentIds, setDepartmentIds] = useState<number[]>([]);
  const [nextStatus, setNextStatus] = useState<"Active" | "Locked" | "Disabled">("Disabled");
  const [tempPassword, setTempPassword] = useState("");
  const [confirmTempPassword, setConfirmTempPassword] = useState("");
  const [receipt, setReceipt] = useState("");

  useEffect(() => { pendingCallback.current = onPendingChange; }, [onPendingChange]);

  const clearPasswords = useCallback(() => {
    setTempPassword("");
    setConfirmTempPassword("");
  }, []);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    submitting.current = false;
    setPending(false);
    pendingCallback.current?.(false);
    setLoading(true);
    setError("");
    setNeedsReload(false);
    setView("summary");
    setReceipt("");
    clearPasswords();
    try {
      const result = await getEmployeeAccountAccessAction(employeeId);
      if (requestId.current !== currentRequest) return;
      if (result.status === "success" && result.data) setData(result.data);
      else {
        setData(null);
        setError(result.message || "Account access could not be loaded.");
      }
    } catch {
      if (requestId.current !== currentRequest) return;
      setData(null);
      setError("Account access could not be loaded. Check your connection and retry.");
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [employeeId, clearPasswords]);

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; pendingCallback.current?.(false); };
  }, [load]);

  function preventEmployeeSubmit(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) event.preventDefault();
    // EmployeeForm owns the enclosing form; account controls must not submit it.
    event.stopPropagation();
  }

  function cancel() {
    if (pending) return;
    clearPasswords();
    if (!needsReload) setError("");
    setView("summary");
    setReceipt("");
  }

  function start(nextOperation: Operation, status?: "Active" | "Locked" | "Disabled") {
    if (!data || pending || disabledReason || needsReload) return;
    setOperation(nextOperation);
    setGroupKey(nextOperation === "create" ? AUTH_GROUP_KEYS.EMPLOYEE : data.account?.groupKey ?? "");
    setDepartmentIds(nextOperation === "create" ? [] : [...(data.account?.managerDepartmentIds ?? [])]);
    if (status) setNextStatus(status);
    clearPasswords();
    setError("");
    setView(nextOperation === "status" || nextOperation === "revokeSessions" ? "review" : "edit");
  }

  function review() {
    if (disabledReason || pending) return;
    if ((operation === "create" || operation === "access") && !groupKey) {
      setError("Choose one role for this account.");
      return;
    }
    if ((operation === "create" || operation === "access") && groupKey === AUTH_GROUP_KEYS.MANAGER && !departmentIds.length) {
      setError("Select at least one branch for this manager.");
      return;
    }
    if (operation === "create" || operation === "resetPassword") {
      if (tempPassword.length < 5) { setError("Enter a temporary password with at least 5 characters."); return; }
      if (tempPassword !== confirmTempPassword) { setError("The temporary passwords do not match."); return; }
    }
    setError("");
    setView("review");
  }

  async function save() {
    if (!data || pending || submitting.current || disabledReason || needsReload) return;
    const common = { employeeId, expectedAccountId: data.account?.id ?? null, expectedVersion: data.version };
    let command: EmployeeAccountAccessMutation;
    if (operation === "create" || operation === "access") {
      if (!groupKey) return;
      const access = { groupKey, departmentIds: groupKey === AUTH_GROUP_KEYS.MANAGER ? departmentIds : [] };
      command = operation === "create"
        ? { ...common, operation, ...access, tempPassword, confirmTempPassword }
        : { ...common, operation, ...access };
    } else if (operation === "resetPassword") command = { ...common, operation, tempPassword, confirmTempPassword };
    else if (operation === "status") command = { ...common, operation, status: nextStatus };
    else command = { ...common, operation };

    submitting.current = true;
    setPending(true);
    pendingCallback.current?.(true);
    setError("");
    const currentRequest = requestId.current;
    try {
      const result = await mutateEmployeeAccountAccessAction(command);
      if (requestId.current !== currentRequest) return;
      if (result.status !== "success" || !result.data) {
        setError(result.message || "The change was not confirmed. Reload the account before trying again.");
        setNeedsReload(true);
        return;
      }
      setData(result.data);
      setReceipt(result.message);
      setView("receipt");
      onAccessSaved?.(result.data);
    } catch {
      if (requestId.current !== currentRequest) return;
      setError("The result could not be confirmed. Reload the latest account before deciding whether to try again.");
      setNeedsReload(true);
    } finally {
      clearPasswords();
      if (requestId.current === currentRequest) {
        submitting.current = false;
        setPending(false);
        pendingCallback.current?.(false);
      }
    }
  }

  const actionDisabled = !!disabledReason || pending || needsReload;
  const roleName = (key: AuthGroupKey) => AUTH_GROUPS[key].name;
  const branches = (ids: number[]) => ids.map((id) => data?.departments.find((department) => department.id === id)?.name ?? `Department ${id}`).join(", ");
  const currentRole = data?.account?.groupKeys.map(roleName).join(", ") || "No role assigned";
  const currentStatus = data?.account?.status === "PendingSetup" ? "Pending setup" : data?.account?.status;
  const changingAccess = operation === "create" || operation === "access";
  const statusLabel = nextStatus === "Active" ? (data?.account?.status === "Locked" ? "Unlock account" : data?.account?.status === "PendingSetup" ? "Activate account" : "Reactivate account") : nextStatus === "Locked" ? "Lock account" : "Disable account";
  const title = operation === "status" ? statusLabel : operationTitles[operation];

  return (
    <div className="min-w-0 space-y-4 py-4" onKeyDown={preventEmployeeSubmit} aria-busy={loading || pending}>
      {disabledReason ? <p className="rounded-md border bg-muted/30 p-3 text-sm" role="status">{disabledReason}</p> : null}
      {loading ? <p role="status" className="text-sm text-muted-foreground">Loading account access…</p> : null}
      {error ? <div className="space-y-2 rounded-md border border-destructive/40 p-3"><p role="alert" className="text-sm text-destructive">{error}</p>{needsReload || !data ? <Button type="button" variant="outline" disabled={pending || loading} onClick={() => void load()}>{needsReload ? "Reload latest account" : "Retry loading account"}</Button> : null}</div> : null}
      {!loading && data ? <>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-medium">{view === "summary" ? "Account access" : view === "receipt" ? "Account updated" : `${view === "review" ? "Review: " : ""}${title}`}</h3>
            <p className="break-words text-sm text-muted-foreground">{data.employee.firstName} {data.employee.lastName} · {data.employee.employeeType} · {data.employee.employeeNo}</p>
          </div>
          {view === "summary" ? <div className="flex flex-wrap gap-2">
            {data.account ? <><Button type="button" variant="outline" disabled={actionDisabled} onClick={() => start("access")}>Edit access</Button><Button type="button" variant="outline" disabled={actionDisabled} onClick={() => start("resetPassword")}>Reset password</Button></> : <Button type="button" disabled={actionDisabled || !data.employee.email} onClick={() => start("create")}>Create login</Button>}
          </div> : null}
        </div>

        {view === "summary" || view === "receipt" ? <>
          {view === "receipt" ? <p className="rounded-md border bg-muted/30 p-3 text-sm" role="status">{receipt}</p> : null}
          <div className="grid min-w-0 gap-x-8 sm:grid-cols-2">
            <dl><Detail label="Login email">{data.account?.email || data.employee.email || "No saved email"}</Detail><Detail label="Home department">{data.employee.homeDepartmentName || "Not assigned"}</Detail><Detail label="Confidentiality Level">{data.employee.confidentialityLevel || "Not set"}</Detail></dl>
            <dl><Detail label="Account status">{data.account ? currentStatus : "No login"}</Detail>{data.account ? <><Detail label="Role">{currentRole}</Detail><Detail label="Managed branches">{branches(data.account.managerDepartmentIds) || "None"}</Detail><Detail label="Password setup">{data.account.mustSetPassword ? "Required at next sign-in" : "Complete"}</Detail><Detail label="Last sign-in">{data.account.lastLoginAt ? new Date(data.account.lastLoginAt).toLocaleString() : "Never"}</Detail></> : null}</dl>
          </div>
          {!data.account && !data.employee.email ? <p className="text-sm text-muted-foreground">Save an email in Other References before creating a login.</p> : null}
          {data.advisory ? <p className="text-sm text-muted-foreground">{data.advisory}</p> : null}
          {data.account?.status === "Disabled" ? <p className="text-sm text-muted-foreground">This account is Disabled. Editing access or resetting its password does not reactivate it.</p> : null}
          {view === "summary" && data.account ? <div className="flex flex-wrap gap-2 border-t pt-4">
            {data.account.status === "Active" ? <Button type="button" variant="outline" disabled={actionDisabled} onClick={() => start("status", "Locked")}>Lock account</Button> : null}
            {data.account.status !== "Active" ? <Button type="button" variant="outline" disabled={actionDisabled} onClick={() => start("status", "Active")}>{data.account.status === "Locked" ? "Unlock account" : data.account.status === "PendingSetup" ? "Activate account" : "Reactivate account"}</Button> : null}
            {data.account.status !== "Disabled" ? <Button type="button" variant="outline" disabled={actionDisabled} onClick={() => start("status", "Disabled")}>Disable account</Button> : null}
            <Button type="button" variant="outline" disabled={actionDisabled} onClick={() => start("revokeSessions")}>Sign out all sessions</Button>
          </div> : null}
          {view === "receipt" ? <Button type="button" variant="outline" onClick={cancel}>Back to Account access</Button> : null}
        </> : null}

        {view === "edit" ? <div className="max-w-2xl space-y-4">
          <p className="break-all text-sm">Login email: {data.account?.email || data.employee.email}</p>
          {changingAccess ? <>
            <div className="space-y-2"><Label htmlFor={`${prefix}-role`}>Role</Label><select id={`${prefix}-role`} className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base" value={groupKey} disabled={actionDisabled} onChange={(event) => { setGroupKey(event.target.value as AuthGroupKey | ""); setError(""); }}><option value="" disabled>Choose a role</option>{Object.values(AUTH_GROUPS).map((group) => <option key={group.key} value={group.key}>{group.name}</option>)}</select></div>
            {groupKey === AUTH_GROUP_KEYS.MANAGER ? <fieldset className="space-y-1" disabled={actionDisabled}><legend className="mb-1 text-sm font-medium">Managed branches</legend><p className="pb-2 text-xs text-muted-foreground">Home department: {data.employee.homeDepartmentName || "Not assigned"}. Select the branches this manager will handle.</p>{data.departments.map((department) => <label key={department.id} className="flex min-h-11 items-center gap-3 rounded px-1 text-sm"><input type="checkbox" className="h-4 w-4 shrink-0" checked={departmentIds.includes(department.id)} onChange={(event) => { setDepartmentIds((current) => event.target.checked ? [...current, department.id] : current.filter((id) => id !== department.id)); setError(""); }} /><span className="min-w-0 break-words">{department.name}{department.id === data.employee.homeDepartmentId ? " · Home department" : ""}</span></label>)}{!data.departments.length ? <p className="text-sm text-muted-foreground">No departments are available.</p> : null}</fieldset> : null}
          </> : null}
          {operation === "create" || operation === "resetPassword" ? <>
            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`${prefix}-password`}>Temporary password</Label><Input id={`${prefix}-password`} type="password" autoComplete="new-password" value={tempPassword} minLength={5} disabled={actionDisabled} onChange={(event) => setTempPassword(event.target.value)} /></div><div className="space-y-2"><Label htmlFor={`${prefix}-confirm`}>Confirm temporary password</Label><Input id={`${prefix}-confirm`} type="password" autoComplete="new-password" value={confirmTempPassword} minLength={5} disabled={actionDisabled} onChange={(event) => setConfirmTempPassword(event.target.value)} /></div></div>
            <p className="text-sm text-muted-foreground">Use at least 5 characters. Share the temporary password privately; the user must choose a permanent password at their next sign-in.</p>
          </> : <p className="text-sm text-muted-foreground">The password and account status stay unchanged.</p>}
          {operation === "resetPassword" ? <p className="text-sm text-muted-foreground">Resetting signs out existing sessions. The account stays {currentStatus}; its role and managed branches stay unchanged.</p> : null}
          <div className="flex flex-wrap gap-2"><Button type="button" disabled={actionDisabled} onClick={review}>Review changes</Button><Button type="button" variant="outline" disabled={pending} onClick={cancel}>Cancel</Button></div>
        </div> : null}

        {view === "review" ? <div className="max-w-2xl space-y-4">
          <dl><Detail label="Login email">{data.account?.email || data.employee.email}</Detail><Detail label="Role">{changingAccess && groupKey ? `${data.account ? currentRole + " → " : ""}${roleName(groupKey)}` : `${currentRole} — unchanged`}</Detail><Detail label="Managed branches">{changingAccess ? groupKey === AUTH_GROUP_KEYS.MANAGER ? branches(departmentIds) : "None" : `${branches(data.account?.managerDepartmentIds || []) || "None"} — unchanged`}</Detail><Detail label="Account status">{operation === "create" ? "Active" : operation === "status" ? `${currentStatus} → ${nextStatus}` : `${currentStatus} — unchanged`}</Detail><Detail label="Password setup">{operation === "create" || operation === "resetPassword" ? "New temporary password; permanent password required at next sign-in" : "Unchanged"}</Detail><Detail label="Confidentiality Level">{changingAccess && groupKey ? `${data.employee.confidentialityLevel || "Not set"} → ${confidentialityForRole(groupKey)}` : `${data.employee.confidentialityLevel || "Not set"} — unchanged`}</Detail></dl>
          {(operation === "resetPassword" || operation === "revokeSessions" || (operation === "status" && nextStatus !== "Active")) ? <p className="text-sm text-muted-foreground">Existing sessions will be signed out. {operation === "revokeSessions" ? "The password, role and account status stay unchanged." : null}</p> : null}
          {operation === "status" && nextStatus !== "Active" ? <p className="text-sm text-muted-foreground">This account will be unable to sign in until an authorized administrator restores access.</p> : null}
          <div className="flex flex-wrap gap-2"><Button type="button" disabled={actionDisabled} onClick={() => void save()}>{pending ? "Saving…" : operation === "access" ? "Save access" : title}</Button>{operation !== "status" && operation !== "revokeSessions" ? <Button type="button" variant="outline" disabled={pending || needsReload} onClick={() => { setView("edit"); setError(""); }}>Back</Button> : null}<Button type="button" variant="outline" disabled={pending} onClick={cancel}>Cancel</Button></div>
        </div> : null}
        {((changingAccess && groupKey === AUTH_GROUP_KEYS.MANAGER && (view === "edit" || view === "review")) || ((view === "summary" || view === "receipt") && data.account?.groupKeys.includes(AUTH_GROUP_KEYS.MANAGER))) ? <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">Manager includes schedules, attendance and leave for selected branches. Separate permission choices are not available yet.</p> : null}
      </> : null}
    </div>
  );
}

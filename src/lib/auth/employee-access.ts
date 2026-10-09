import { createHash } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbClient } from "@/db";
import {
  authAccounts, authManagerDepartments, authSessions, department,
  employees, employeesGeneralInfo, employeesOtherReferences,
} from "@/db/schema";
import { recordAdminAuditEvent } from "@/lib/admin";
import { hashPassword, normalizeEmail } from "./crypto";
import { setAccountGroupsTx, setManagerDepartmentsTx } from "./group-sync";
import {
  acquireAccountLifecycleLockTx, assertAccountAccessManagerTx,
  assertNotRemovingLastSystemAdminTx, getAccountAccessStateTx,
} from "./lifecycle";
import { AUTH_GROUP_KEYS, type AuthGroupKey } from "./permissions";
import { revokeAccountArtifactsTx } from "./server";
import type {
  EmployeeAccountAccessData, EmployeeAccountAccessMutation,
  EmployeeConfidentialityLevel,
} from "./employee-access-types";

type Actor = { accountId: string; sessionId: string };
export class EmployeeAccessError extends Error {}

const identity = {
  employeeId: z.string().uuid("Select a saved employee."),
  expectedAccountId: z.string().uuid().nullable(),
  expectedVersion: z.string().regex(/^[a-f0-9]{64}$/, "Reload account access before saving."),
};
const access = {
  groupKey: z.enum(["SYSTEM_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE"]),
  departmentIds: z.array(z.number().int().positive()),
};
const password = {
  tempPassword: z.string().min(5, "Use at least 5 characters for the temporary password."),
  confirmTempPassword: z.string(),
};
const mutationSchema = z.discriminatedUnion("operation", [
  z.object({ ...identity, ...access, ...password, operation: z.literal("create") }).strict(),
  z.object({ ...identity, ...access, operation: z.literal("access") }).strict(),
  z.object({ ...identity, ...password, operation: z.literal("resetPassword") }).strict(),
  z.object({ ...identity, operation: z.literal("status"), status: z.enum(["Active", "Locked", "Disabled"]) }).strict(),
  z.object({ ...identity, operation: z.literal("revokeSessions") }).strict(),
]).superRefine((input, context) => {
  if ("tempPassword" in input && input.tempPassword !== input.confirmTempPassword) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmTempPassword"], message: "The temporary passwords do not match." });
  }
  if ("groupKey" in input && input.groupKey === AUTH_GROUP_KEYS.MANAGER && input.departmentIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["departmentIds"], message: "Select at least one branch for a Manager account." });
  }
});

function confidentialityForGroup(groupKey: AuthGroupKey): EmployeeConfidentialityLevel {
  return groupKey === AUTH_GROUP_KEYS.SYSTEM_ADMIN ? "Managerial"
    : groupKey === AUTH_GROUP_KEYS.EMPLOYEE ? "Rank and File" : "Supervisory";
}

/** Called only inside the lifecycle transaction, after checking the actor. */
async function readEmployeeAccessTx(tx: DbClient, employeeId: string): Promise<EmployeeAccountAccessData> {
  const [record] = await tx.select({
    id: employees.id, employeeNo: employees.employeeNo, employeeType: employees.employeeType,
    firstName: employees.firstName, lastName: employees.lastName, deletedAt: employees.deletedAt,
    email: employeesOtherReferences.email, homeDepartmentId: employeesGeneralInfo.departmentId,
    homeDepartmentName: department.name, confidentialityLevel: employeesGeneralInfo.confidentialityLevel,
  }).from(employees)
    .leftJoin(employeesGeneralInfo, eq(employeesGeneralInfo.employeeId, employees.id))
    .leftJoin(employeesOtherReferences, and(eq(employeesOtherReferences.employeeId, employees.id), isNull(employeesOtherReferences.deletedAt)))
    .leftJoin(department, eq(department.id, employeesGeneralInfo.departmentId))
    .where(eq(employees.id, employeeId)).limit(1);
  if (!record) throw new EmployeeAccessError("Employee not found. Select a saved employee.");
  if (record.deletedAt) throw new EmployeeAccessError("This employee is archived. Account access cannot be changed here.");

  const [linked] = await tx.select({ id: authAccounts.id, revision: sql<string>`${authAccounts.updatedAt}::text` })
    .from(authAccounts).where(eq(authAccounts.employeeId, employeeId)).limit(1);
  const state = linked ? await getAccountAccessStateTx(tx, linked.id) : null;
  const scope = linked ? await tx.select({ id: authManagerDepartments.departmentId }).from(authManagerDepartments)
    .where(eq(authManagerDepartments.accountId, linked.id)).orderBy(asc(authManagerDepartments.departmentId)) : [];
  const departments = await tx.select({ id: department.id, code: department.code, name: department.name })
    .from(department).orderBy(asc(department.code), asc(department.id));
  const { deletedAt: _deletedAt, ...employee } = record;
  void _deletedAt;
  const groupKeys = state ? [...state.groupKeys].sort() : [];
  const account: EmployeeAccountAccessData["account"] = state ? {
    id: state.account.id, email: state.account.email, status: state.account.status,
    mustSetPassword: state.account.mustSetPassword,
    lastLoginAt: state.account.lastLoginAt?.toISOString() ?? null,
    groupKey: groupKeys.length === 1 ? groupKeys[0] : null,
    groupKeys, managerDepartmentIds: scope.map(row => row.id),
  } : null;
  // Neither the hash nor session secrets leave the server. Include credential
  // revision so a stale editor cannot unknowingly replace a newer reset.
  const version = createHash("sha256").update(JSON.stringify({
    employee, account, departments, revision: linked?.revision ?? null,
    passwordHash: state?.account.passwordHash ?? null,
    assignedGroups: [...(state?.assignedGroupKeys ?? [])].sort(),
  })).digest("hex");
  const savedEmail = employee.email ? normalizeEmail(employee.email) : "";
  const advisory = account && normalizeEmail(account.email) !== savedEmail
    ? `This login uses ${account.email}; the saved employee email differs. Update the employee details to correct the email. Account controls below apply to this existing login.`
    : !account && !z.string().email().safeParse(savedEmail).success
      ? "Save a valid email in Other References before creating a login." : null;
  return { employee, account, departments, advisory, version };
}

export async function getEmployeeAccountAccess(actor: Actor, employeeId: string) {
  z.string().uuid("Select a saved employee.").parse(employeeId);
  return db.transaction(async tx => {
    await acquireAccountLifecycleLockTx(tx);
    await assertAccountAccessManagerTx(tx, actor);
    return readEmployeeAccessTx(tx, employeeId);
  });
}

export async function mutateEmployeeAccountAccess(actor: Actor, rawInput: EmployeeAccountAccessMutation) {
  const input = mutationSchema.parse(rawInput);
  // Hash outside the lock; current actor, employee and expected revision are
  // checked after acquiring it, including when another reset won the race.
  const passwordHash = "tempPassword" in input ? await hashPassword(input.tempPassword) : null;
  return db.transaction(async tx => {
    await acquireAccountLifecycleLockTx(tx);
    await assertAccountAccessManagerTx(tx, actor);
    const before = await readEmployeeAccessTx(tx, input.employeeId);
    if ((before.account?.id ?? null) !== input.expectedAccountId || before.version !== input.expectedVersion) {
      throw new EmployeeAccessError("Employee or account access changed. Reload account access and review the latest details before saving.");
    }
    if (input.operation === "create" ? before.account !== null : before.account === null) {
      throw new EmployeeAccessError(input.operation === "create" ? "This employee already has a login. Reload and edit its access." : "This employee does not have a login yet.");
    }
    const email = before.employee.email ? normalizeEmail(before.employee.email) : "";
    if (input.operation === "create" && !z.string().email().safeParse(email).success) {
      throw new EmployeeAccessError("Save a valid email in the employee's Other References before managing account access.");
    }
    const departmentIds = "groupKey" in input && input.groupKey === AUTH_GROUP_KEYS.MANAGER
      ? [...new Set(input.departmentIds)].sort((a, b) => a - b) : [];
    if (departmentIds.some(id => !before.departments.some(row => row.id === id))) {
      throw new EmployeeAccessError("A selected branch is no longer available. Reload account access and review the branches.");
    }
    const now = new Date();
    let accountId = before.account?.id;
    let message: string;
    const details: Record<string, unknown> = { employeeId: input.employeeId, operation: input.operation };

    if (input.operation === "create") {
      const [owner] = await tx.select({ id: authAccounts.id }).from(authAccounts)
        .where(sql`lower(${authAccounts.email}) = ${email}`).limit(1);
      if (owner) throw new EmployeeAccessError("This email is already used by another login. Correct the employee email before creating access.");
      const [created] = await tx.insert(authAccounts).values({
        employeeId: input.employeeId, email, passwordHash: passwordHash!, status: "Active", mustSetPassword: true,
      }).returning({ id: authAccounts.id });
      accountId = created.id;
      message = "Login created. Share the temporary password securely; the employee must set a permanent password at first sign-in.";
    } else {
      accountId = before.account!.id;
      message = "Account access saved.";
    }

    if (input.operation === "create" || input.operation === "access") {
      if (input.operation === "access") {
        await assertNotRemovingLastSystemAdminTx({ tx, accountId: accountId!, nextGroupKey: input.groupKey });
      }
      const confidentialityLevel = confidentialityForGroup(input.groupKey);
      await setAccountGroupsTx(tx, accountId!, [input.groupKey]);
      await setManagerDepartmentsTx(tx, accountId!, departmentIds);
      await tx.insert(employeesGeneralInfo).values({ employeeId: input.employeeId, confidentialityLevel })
        .onConflictDoUpdate({ target: [employeesGeneralInfo.employeeId], set: { confidentialityLevel } });
      Object.assign(details, { previousGroups: before.account?.groupKeys ?? [], nextGroups: [input.groupKey], previousDepartmentIds: before.account?.managerDepartmentIds ?? [], managerDepartmentIds: departmentIds, confidentialityLevel });
      if (input.operation === "access") message = `Access saved. Password and ${before.account!.status} account status are unchanged.`;
    } else if (input.operation === "resetPassword") {
      await tx.update(authAccounts).set({ passwordHash: passwordHash!, mustSetPassword: true, lastLoginAt: null })
        .where(eq(authAccounts.id, accountId!));
      await revokeAccountArtifactsTx(tx, accountId!, now);
      details.accountStatus = before.account!.status;
      message = `Temporary password reset and existing sessions signed out. ${before.account!.status} account status is unchanged. Share the temporary password securely.`;
    } else if (input.operation === "status") {
      await assertNotRemovingLastSystemAdminTx({ tx, accountId: accountId!, nextStatus: input.status });
      await tx.update(authAccounts).set({ status: input.status }).where(eq(authAccounts.id, accountId!));
      if (input.status !== "Active") await revokeAccountArtifactsTx(tx, accountId!, now);
      Object.assign(details, { previousStatus: before.account!.status, nextStatus: input.status });
      message = `Account status changed to ${input.status}.`;
    } else if (input.operation === "revokeSessions") {
      await tx.update(authSessions).set({ revokedAt: now })
        .where(and(eq(authSessions.accountId, accountId!), isNull(authSessions.revokedAt)));
      message = "Existing sessions signed out. Password and account status are unchanged.";
    }

    // Every accepted command advances the revision, including session-only and
    // no-op saves, so retrying an old form cannot repeat a password reset.
    await tx.update(authAccounts).set({ updatedAt: sql`greatest(clock_timestamp(), ${authAccounts.updatedAt} + interval '1 microsecond')` })
      .where(eq(authAccounts.id, accountId!));
    await recordAdminAuditEvent({ actorUserId: actor.accountId, entityType: "auth_account", entityId: accountId,
      action: `employee_account_${input.operation}`, details, database: tx });
    const data = await readEmployeeAccessTx(tx, input.employeeId);
    return { message, data };
  });
}

import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { NeonPreparedQuery } from "drizzle-orm/neon-serverless/session";
import { eq, inArray, sql } from "drizzle-orm";
import {
  adminAuditEvents, authAccountPermissionGroups, authAccounts, authEmailOtps,
  authManagerDepartments, authPasswordSetupTokens, authPermissionGroups, authSessions,
  department, employees, employeesGeneralInfo, employeesOtherReferences,
} from "@/db/schema";
import type { AuthGroupKey } from "@/lib/auth/permissions";
import type { EmployeeAccountAccessData, EmployeeAccountAccessMutation, EmployeeAccountStatus } from "@/lib/auth/employee-access-types";

// Actual actions/SQL/transactions, fictional fixtures, Next request adapters.
// The launcher must supply the already verified isolated local restore.
const destination = new URL(process.env.DATABASE_URL ?? "");
assert.equal(destination.hostname, "127.0.0.1");
assert.match(destination.pathname, /_p1b$/);
assert.equal(process.env.NODE_ENV, "test");
assert.ok(process.env.PAYROLL_LOCAL_REHEARSAL_PROXY_PORT);
const request = new AsyncLocalStorage<{ token: string | null }>();
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (name, ...args) {
  if (name === "next/navigation") return { redirect() { throw new Error("Redirect"); }, unstable_rethrow() {} };
  if (name === "next/headers") return {
    cookies: async () => ({ get: () => request.getStore()?.token ? { value: request.getStore()!.token } : undefined, set() {}, delete() {} }),
    headers: async () => new Headers(),
  };
  if (name === "next/cache") return { revalidatePath() {} };
  return originalLoad.call(this, name, ...args);
};
const originalExecute = NeonPreparedQuery.prototype.execute;
let failAudit = false;
NeonPreparedQuery.prototype.execute = async function (...args) {
  const result = await originalExecute.apply(this, args);
  const query = (this as unknown as { queryConfig: { text: string } }).queryConfig.text;
  if (failAudit && /^insert into "admin_audit_events"/i.test(query)) {
    failAudit = false;
    throw new Error("Fictional audit failure after actual insert");
  }
  return result;
};
type Fixture = { employeeId: string; accountId: string | null; email: string; token: string | null };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

async function main() {
  const { db } = await import("@/db");
  const actions = await import("@/app/actions/employeeAccessAction");
  const service = await import("@/lib/auth/employee-access");
  const server = await import("@/lib/auth/server");
  const { hashPassword, verifyPassword } = await import("@/lib/auth/crypto");
  const tableNames = (await db.execute(sql`select tablename from pg_tables where schemaname='public' order by tablename`)).rows.map(row => String(row.tablename));
  const fingerprint = async () => (await db.execute(sql.raw(tableNames.map(table => {
    assert.match(table, /^[A-Za-z_][A-Za-z0-9_]*$/);
    return `select '${table}' as name,count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as hash from "${table}" t`;
  }).join(" union all ") + " order by name"))).rows;
  const before = await fingerprint();
  const originalAccounts = await db.select({ id: authAccounts.id, status: authAccounts.status }).from(authAccounts);
  const originalGroups = (await db.execute(sql`select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) as rows from auth_permission_groups g`)).rows[0].rows;
  const groups = await db.select().from(authPermissionGroups);
  for (const key of ["SYSTEM_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE"]) assert.ok(groups.some(group => group.key === key));
  const fixtures: Fixture[] = [];
  const tag = `EA-${randomUUID().slice(0, 8)}`;
  const departmentIds = [1_500_000_000 + Math.floor(Math.random() * 100_000_000), 1_700_000_000 + Math.floor(Math.random() * 100_000_000)];
  const password = "FictionalEmployeeAccessPassword";
  const passwordHash = await hashPassword(password);
  const checks: string[] = [];
  const pass = (name: string) => checks.push(name);
  const as = <T>(actor: Fixture | null, operation: () => Promise<T>) => request.run({ token: actor?.token ?? null }, operation);
  async function fixture(group: AuthGroupKey | null = "EMPLOYEE", status: EmployeeAccountStatus = "Active") {
    const item: Fixture = { employeeId: randomUUID(), accountId: group ? randomUUID() : null, email: `${tag.toLowerCase()}-${fixtures.length}@example.invalid`, token: group ? randomUUID() : null };
    fixtures.push(item);
    await db.insert(employees).values({ id: item.employeeId, employeeNo: `99${Date.now()}${fixtures.length}`, firstName: "Fictional", lastName: "Employee access" });
    await db.insert(employeesGeneralInfo).values({ employeeId: item.employeeId, departmentId: departmentIds[0], employmentStatus: "Regular", confidentialityLevel: group === "SYSTEM_ADMIN" ? "Managerial" : "Rank and File" });
    await db.insert(employeesOtherReferences).values({ employeeId: item.employeeId, email: item.email });
    if (group) {
      await db.insert(authAccounts).values({ id: item.accountId!, employeeId: item.employeeId, email: item.email, passwordHash, status, mustSetPassword: false });
      await db.insert(authAccountPermissionGroups).values({ accountId: item.accountId!, groupId: groups.find(row => row.key === group)!.id });
      if (group === "MANAGER") await db.insert(authManagerDepartments).values({ accountId: item.accountId!, departmentId: departmentIds[0] });
      await db.insert(authSessions).values({ accountId: item.accountId!, sessionTokenHash: digest(item.token!), expiresAt: new Date(Date.now() + 1_800_000) });
    }
    return item;
  }
  async function get(actor: Fixture, target: Fixture) {
    const result = await as(actor, () => actions.getEmployeeAccountAccessAction(target.employeeId));
    assert.equal(result.status, "success", result.message); assert.ok(result.data); return result.data;
  }
  const expected = (data: EmployeeAccountAccessData) => ({ employeeId: data.employee.id, expectedAccountId: data.account?.id ?? null, expectedVersion: data.version });
  const createInput = (data: EmployeeAccountAccessData): EmployeeAccountAccessMutation => ({ ...expected(data), operation: "create", groupKey: "MANAGER", departmentIds: [departmentIds[1]], tempPassword: password, confirmTempPassword: password });
  async function command(actor: Fixture, input: EmployeeAccountAccessMutation, success = true) {
    const result = await as(actor, () => actions.mutateEmployeeAccountAccessAction(input));
    assert.equal(result.status, success ? "success" : "error", result.message);
    if (success) assert.ok(result.data);
    return result;
  }
  const account = async (target: Fixture) => (await db.select().from(authAccounts).where(eq(authAccounts.employeeId, target.employeeId)))[0];
  const state = async (target: Fixture) => {
    const saved = await account(target);
    return {
      account: saved, employee: await db.select().from(employees).where(eq(employees.id, target.employeeId)),
      general: await db.select().from(employeesGeneralInfo).where(eq(employeesGeneralInfo.employeeId, target.employeeId)),
      groups: saved ? await db.select().from(authAccountPermissionGroups).where(eq(authAccountPermissionGroups.accountId, saved.id)).orderBy(authAccountPermissionGroups.id) : [],
      scopes: saved ? await db.select().from(authManagerDepartments).where(eq(authManagerDepartments.accountId, saved.id)).orderBy(authManagerDepartments.id) : [],
      sessions: saved ? await db.select().from(authSessions).where(eq(authSessions.accountId, saved.id)).orderBy(authSessions.id) : [],
    };
  };
  let failure: unknown = null, preserved = false;
  try {
    await db.insert(department).values(departmentIds.map((id, i) => ({ id, code: `${tag}-${i}`, name: `${tag} branch ${i}` })));
    const admin = await fixture("SYSTEM_ADMIN");
    const fresh = await fixture(null);
    const data = await get(admin, fresh);
    assert.equal(data.account, null); assert.equal(data.employee.email, fresh.email);
    assert.equal(data.employee.homeDepartmentId, departmentIds[0]);
    assert.equal(JSON.stringify(data).includes("passwordHash"), false);
    pass("saved-employee-prefill-without-credential-leak");
    for (const group of ["HR_ADMIN", "MANAGER", "EMPLOYEE"] as const) {
      const actor = await fixture(group);
      assert.equal((await as(actor, () => actions.getEmployeeAccountAccessAction(fresh.employeeId))).status, "error");
      await command(actor, createInput(data), false);
      assert.equal(await account(fresh), undefined);
      pass(`${group.toLowerCase()}-cannot-read-or-mutate-account-access`);
    }
    const anonymous = await as(null, () => actions.getEmployeeAccountAccessAction(fresh.employeeId));
    assert.equal(anonymous.status, "error");
    assert.equal(anonymous.message, "Your session expired. Sign in again, then reload account access.");
    pass("anonymous-access-denied-with-sign-in-recovery");
    const originalEmployee = (await state(fresh)).employee;
    const created = await command(admin, createInput(data));
    fresh.accountId = created.data!.account!.id;
    assert.equal(created.data!.account!.status, "Active"); assert.equal(created.data!.account!.mustSetPassword, true);
    assert.deepEqual(created.data!.account!.managerDepartmentIds, [departmentIds[1]]);
    assert.deepEqual((await state(fresh)).employee, originalEmployee);
    assert.equal(created.data!.employee.homeDepartmentId, departmentIds[0]);
    assert.equal(created.data!.employee.confidentialityLevel, "Supervisory");
    assert.ok(await verifyPassword(password, (await account(fresh)).passwordHash!));
    pass("create-links-same-employee-with-explicit-manager-scope-and-setup-password");
    const duplicatePrior = await state(fresh);
    await command(admin, createInput(data), false);
    assert.deepEqual(await state(fresh), duplicatePrior);
    pass("duplicate-create-cannot-reset-or-relink-existing-account");
    const raceTarget = await fixture(null), raceData = await get(admin, raceTarget);
    const race = await Promise.all([as(admin, () => actions.mutateEmployeeAccountAccessAction(createInput(raceData))), as(admin, () => actions.mutateEmployeeAccountAccessAction(createInput(raceData)))]);
    assert.deepEqual(race.map(row => row.status).sort(), ["error", "success"]);
    assert.equal((await db.select().from(authAccounts).where(eq(authAccounts.employeeId, raceTarget.employeeId))).length, 1);
    pass("concurrent-create-serializes-to-one-account");
    for (const email of [null, "invalid-address"]) {
      const target = await fixture(null);
      await db.update(employeesOtherReferences).set({ email }).where(eq(employeesOtherReferences.employeeId, target.employeeId));
      await command(admin, createInput(await get(admin, target)), false);
      assert.equal(await account(target), undefined);
      pass(email ? "invalid-saved-email-blocks-create" : "missing-saved-email-blocks-create");
    }
    const collision = await fixture(null), collisionOwner = await fixture("EMPLOYEE");
    await db.update(authAccounts).set({ email: collision.email }).where(eq(authAccounts.id, collisionOwner.accountId!));
    await command(admin, createInput(await get(admin, collision)), false);
    assert.equal(await account(collision), undefined);
    pass("email-owned-by-different-login-cannot-be-claimed");
    const changed = await fixture(null), oldIdentity = await get(admin, changed);
    await db.update(employeesOtherReferences).set({ email: `changed-${changed.email}` }).where(eq(employeesOtherReferences.employeeId, changed.employeeId));
    await command(admin, createInput(oldIdentity), false);
    pass("changed-saved-email-requires-fresh-review");
    const mismatch = await fixture("EMPLOYEE");
    await db.update(authAccounts).set({ email: `different-${mismatch.email}` }).where(eq(authAccounts.id, mismatch.accountId!));
    const mismatchData = await get(admin, mismatch);
    assert.ok(mismatchData.advisory);
    const mismatchDisabled = await command(admin, { ...expected(mismatchData), operation: "status", status: "Disabled" });
    assert.equal(mismatchDisabled.data!.account!.email, `different-${mismatch.email}`);
    await command(admin, { ...expected(mismatchDisabled.data!), operation: "revokeSessions" });
    pass("email-mismatch-advisory-does-not-block-disable-or-session-revocation");
    const missingLinkedEmail = await fixture("EMPLOYEE");
    await db.update(employeesOtherReferences).set({ email: null }).where(eq(employeesOtherReferences.employeeId, missingLinkedEmail.employeeId));
    const linkedEmailData = await get(admin, missingLinkedEmail);
    assert.ok(linkedEmailData.advisory);
    const missingDisabled = await command(admin, { ...expected(linkedEmailData), operation: "status", status: "Disabled" });
    await command(admin, { ...expected(missingDisabled.data!), operation: "revokeSessions" });
    pass("missing-employee-email-does-not-block-security-reduction");
    const archived = await fixture("EMPLOYEE"), archivedData = await get(admin, archived);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, archived.employeeId));
    assert.equal((await as(admin, () => actions.getEmployeeAccountAccessAction(archived.employeeId))).status, "error");
    await command(admin, { ...expected(archivedData), operation: "status", status: "Active" }, false);
    pass("archived-employee-read-and-reactivation-denied");
    const promote = await fixture("EMPLOYEE", "Disabled"), promotionData = await get(admin, promote);
    for (const departmentScope of [[], [2_000_000_001]]) {
      await command(admin, { ...expected(promotionData), operation: "access", groupKey: "MANAGER", departmentIds: departmentScope }, false);
    }
    pass("manager-requires-existing-explicit-branch");
    const promotionHash = (await account(promote)).passwordHash;
    const promoted = await command(admin, { ...expected(promotionData), operation: "access", groupKey: "MANAGER", departmentIds: [departmentIds[1]] });
    assert.equal((await account(promote)).passwordHash, promotionHash);
    assert.equal(promoted.data!.account!.status, "Disabled");
    assert.deepEqual(promoted.data!.account!.managerDepartmentIds, [departmentIds[1]]);
    await command(admin, { ...expected(promotionData), operation: "access", groupKey: "EMPLOYEE", departmentIds: [] }, false);
    pass("promotion-preserves-password-disabled-status-and-rejects-old-editor");
    const removed = await command(admin, { ...expected(promoted.data!), operation: "access", groupKey: "EMPLOYEE", departmentIds: [] });
    assert.deepEqual(removed.data!.account!.managerDepartmentIds, []);
    pass("removing-manager-role-clears-former-scope");
    for (const status of ["Active", "Disabled", "Locked", "PendingSetup"] as const) {
      const target = await fixture("EMPLOYEE", status), resetData = await get(admin, target);
      await db.insert(authEmailOtps).values({ accountId: target.accountId!, purpose: "Onboarding", otpHash: digest(randomUUID()), expiresAt: new Date(Date.now() + 600_000) });
      await db.insert(authPasswordSetupTokens).values({ accountId: target.accountId!, tokenHash: digest(randomUUID()), expiresAt: new Date(Date.now() + 600_000) });
      const reset = await command(admin, { ...expected(resetData), operation: "resetPassword", tempPassword: `${password}Reset`, confirmTempPassword: `${password}Reset` });
      assert.equal(reset.data!.account!.status, status); assert.equal(reset.data!.account!.mustSetPassword, true);
      assert.equal(reset.data!.account!.lastLoginAt, null);
      assert.ok(await verifyPassword(`${password}Reset`, (await account(target)).passwordHash!));
      assert.equal(await verifyPassword(password, (await account(target)).passwordHash!), false);
      assert.ok((await state(target)).sessions.every(row => row.revokedAt));
      assert.equal((await db.select().from(authEmailOtps).where(eq(authEmailOtps.accountId, target.accountId!))).length, 0);
      assert.equal((await db.select().from(authPasswordSetupTokens).where(eq(authPasswordSetupTokens.accountId, target.accountId!))).length, 0);
      assert.equal(await as(target, () => server.getCurrentAuthContext()), null);
      pass(`reset-${status.toLowerCase()}-preserves-status-and-revokes-old-credentials`);
    }
    const target = await fixture("EMPLOYEE"), sessionData = await get(admin, target);
    const signedOut = await command(admin, { ...expected(sessionData), operation: "revokeSessions" });
    assert.equal(signedOut.data!.account!.status, "Active"); assert.equal((await account(target)).passwordHash, passwordHash);
    assert.ok((await state(target)).sessions.every(row => row.revokedAt));
    await command(admin, { ...expected(sessionData), operation: "revokeSessions" }, false);
    pass("sign-out-sessions-preserves-account-and-advances-revision");
    const disabled = await command(admin, { ...expected(signedOut.data!), operation: "status", status: "Disabled" });
    const active = await command(admin, { ...expected(disabled.data!), operation: "status", status: "Active" });
    assert.equal(active.data!.account!.status, "Active"); assert.equal((await account(target)).passwordHash, passwordHash);
    pass("explicit-disable-reactivate-preserves-password");
    const rollback = await fixture("EMPLOYEE"), rollbackData = await get(admin, rollback), rollbackPrior = await state(rollback);
    failAudit = true;
    await command(admin, { ...expected(rollbackData), operation: "access", groupKey: "MANAGER", departmentIds: [departmentIds[1]] }, false);
    assert.equal(failAudit, false, "Audit fault must actually execute");
    assert.deepEqual(await state(rollback), rollbackPrior);
    pass("audit-failure-rolls-back-role-scope-confidentiality-and-version");
    const staleActor = await fixture("SYSTEM_ADMIN");
    const actorContext = await as(staleActor, () => server.getCurrentAuthContext()); assert.ok(actorContext);
    await db.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.accountId, staleActor.accountId!));
    await assert.rejects(service.mutateEmployeeAccountAccess(actorContext, { ...expected(await get(admin, rollback)), operation: "access", groupKey: "MANAGER", departmentIds: [departmentIds[0]] }), /no longer has permission/);
    pass("actor-session-rechecked-inside-command-transaction");
    // Temporarily remove every other restored/fixture administrator from the
    // effective set; raw SQL avoids touching timestamps, and finally restores it.
    await db.execute(sql`update auth_accounts set status='Disabled' where id <> ${admin.accountId}::uuid`);
    const lastData = await get(admin, admin), lastPrior = await state(admin);
    await command(admin, { ...expected(lastData), operation: "status", status: "Disabled" }, false);
    await command(admin, { ...expected(lastData), operation: "access", groupKey: "EMPLOYEE", departmentIds: [] }, false);
    assert.deepEqual(await state(admin), lastPrior);
    pass("last-effective-system-admin-cannot-be-disabled-or-demoted");
    const audit = await db.select().from(adminAuditEvents).where(eq(adminAuditEvents.actorUserId, admin.accountId!));
    assert.ok(audit.length > 0);
    assert.equal(JSON.stringify(audit).includes(password), false);
    pass("successful-commands-audited-without-temporary-passwords");
  } catch (error) { failure = error; }
  finally {
    failAudit = false;
    await db.transaction(async tx => {
      const actors = fixtures.map(row => row.accountId).filter((id): id is string => !!id);
      if (actors.length) await tx.delete(adminAuditEvents).where(inArray(adminAuditEvents.actorUserId, actors));
      if (fixtures.length) await tx.delete(employees).where(inArray(employees.id, fixtures.map(row => row.employeeId)));
      await tx.delete(department).where(inArray(department.id, departmentIds));
      for (const row of originalAccounts) await tx.execute(sql`update auth_accounts set status=${row.status}::auth_account_status where id=${row.id}::uuid`);
      await tx.execute(sql`update auth_permission_groups g set key=r.key,name=r.name,description=r.description,is_system=r.is_system,created_at=r.created_at,updated_at=r.updated_at from jsonb_populate_recordset(null::auth_permission_groups,${JSON.stringify(originalGroups)}::jsonb) r where g.id=r.id`);
    });
    preserved = JSON.stringify(await fingerprint()) === JSON.stringify(before);
    const report = { passed: !failure && preserved, checks, checkCount: checks.length, tablesPreserved: tableNames.length, allOriginalRowsPreserved: preserved, productionAccess: false, actualApplicationActions: true, browserAcceptance: false, fixtureCleanup: true, failure: failure instanceof Error ? failure.message : failure ? String(failure) : null };
    const directory = process.env.EMPLOYEE_ACCESS_REPORT_DIRECTORY;
    if (directory) { mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, "acceptance.json"), JSON.stringify(report, null, 2)); }
    console.log(JSON.stringify(report));
    NeonPreparedQuery.prototype.execute = originalExecute; loader._load = originalLoad;
  }
  assert.ok(preserved, "All restored public table rows must match after fixture cleanup");
  if (failure) throw failure;
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

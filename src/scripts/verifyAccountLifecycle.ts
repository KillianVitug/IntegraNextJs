import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { NeonPreparedQuery } from "drizzle-orm/neon-serverless/session";
import { eq, inArray, sql } from "drizzle-orm";
import {
  adminAuditEvents, authAccountPermissionGroups, authAccounts, authEmailOtps,
  authManagerDepartments, authPasswordSetupTokens, authPermissionGroups, authSessions,
  authTemporaryPasswordReveals, department, employeeFiles, employeeFolders,
  employees, employeesGeneralInfo, employeesOtherReferences,
} from "@/db/schema";
import type { AuthGroupKey } from "@/lib/auth/permissions";

// Actual application commands and PostgreSQL transactions on an explicitly
// isolated restore. Only Next request/redirect adapters and query scheduling
// are supplied by this test. No HTTP, GUI, or live-account acceptance is implied.
const destination = new URL(process.env.DATABASE_URL ?? "");
assert.equal(destination.hostname, "127.0.0.1");
assert.match(destination.pathname, /_p1b$/);
assert.equal(process.env.NODE_ENV, "test");
assert.ok(process.env.PAYROLL_LOCAL_REHEARSAL_PROXY_PORT);
const request = new AsyncLocalStorage<{ lane: string; token: string | null; writtenToken?: string }>();
class Redirect extends Error {
  readonly digest: string;
  constructor(readonly location: string) { super(`Redirect to ${location}`); this.digest = `NEXT_REDIRECT;replace;${location};307;`; }
}
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (name, ...args) {
  if (name === "next/navigation") return {
    redirect(location: string): never { throw new Redirect(location); },
    unstable_rethrow(error: unknown) { if (error instanceof Redirect) throw error; },
  };
  if (name === "next/headers") return {
    cookies: async () => ({
      get: () => request.getStore()?.token ? { value: request.getStore()!.token } : undefined,
      set: (_name: string, value: string) => { const context = request.getStore(); if (context) context.writtenToken = value; },
      delete() {},
    }),
    headers: async () => new Headers(),
  };
  if (name === "next/cache") return { revalidatePath() {} };
  return originalLoad.call(this, name, ...args);
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
type Barrier = { lane: string; matches: (query: string) => boolean; reached: ReturnType<typeof deferred>; release: ReturnType<typeof deferred>; used: boolean };
let barrier: Barrier | null = null;
let fault: { lane: string; matches: (query: string) => boolean; used: boolean } | null = null;
const originalExecute = NeonPreparedQuery.prototype.execute;
NeonPreparedQuery.prototype.execute = async function (...args) {
  const result = await originalExecute.apply(this, args);
  const query = (this as unknown as { queryConfig: { text: string } }).queryConfig.text;
  if (fault && !fault.used && request.getStore()?.lane === fault.lane && fault.matches(query)) {
    fault.used = true;
    throw new Error("Synthetic P1b failure after a real database write");
  }
  const active = barrier;
  if (active && !active.used && request.getStore()?.lane === active.lane && active.matches(query)) {
    active.used = true; active.reached.resolve(); await active.release.promise;
  }
  return result;
};
function pauseAfter(lane: string, matches: Barrier["matches"]) {
  assert.equal(barrier, null);
  barrier = { lane, matches, reached: deferred(), release: deferred(), used: false };
  return barrier;
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 20_000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function form(values: Record<string, string | number | number[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) for (const entry of Array.isArray(value) ? value : [value]) data.append(key, String(entry));
  return data;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const initial = { status: "idle" as const, message: null };
const checks: Array<Record<string, unknown>> = [];
const pass = (name: string, details: Record<string, unknown> = {}) => { checks.push({ case: name, passed: true, ...details }); };
type Fixture = { employeeId: string; employeeNo: string; accountId: string; email: string; token: string };

async function main() {
  const { db } = await import("@/db");
  const actions = await import("@/app/actions/authAction");
  const { archiveEmployeeAction } = await import("@/app/actions/archiveEmployeeAction");
  const { saveEmployeeAction } = await import("@/app/actions/saveEmployeeAction");
  const { importEmployeesFromCsv } = await import("@/app/actions/employeeCSVImport");
  const { deleteAllRegularEmployeesAction } = await import("@/app/actions/employeeMasterDataAction");
  const { DELETE_EMPLOYEE_MASTER_DATA_CONFIRMATION } = await import("@/constants/employeeMasterData");
  const server = await import("@/lib/auth/server");
  const { hashPassword, verifyPassword } = await import("@/lib/auth/crypto");
  const tableNames = (await db.execute(sql`select tablename from pg_tables where schemaname='public' order by tablename`)).rows.map(row => String(row.tablename));
  const fingerprint = async () => (await db.execute(sql.raw(tableNames.map(table => {
    assert.match(table, /^[A-Za-z_][A-Za-z0-9_]*$/);
    return `select '${table}' as name,count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as hash from "${table}" t`;
  }).join(" union all ") + " order by name"))).rows;
  const before = await fingerprint();
  const originalAccounts = await db.select({ id: authAccounts.id, status: authAccounts.status }).from(authAccounts);
  // Preserve timestamp precision by round-tripping group rows as PostgreSQL JSON.
  const originalGroups = (await db.execute(sql`select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) as rows from auth_permission_groups g`)).rows[0].rows;
  const groups = await db.select().from(authPermissionGroups);
  for (const key of ["SYSTEM_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE"]) assert.ok(groups.some(group => group.key === key), `Restored permission group ${key} required`);
  const fixtures: Fixture[] = [];
  const tag = `P1B-${randomUUID().slice(0, 8)}`;
  const departmentIds = [1_500_000_000 + Math.floor(Math.random() * 100_000_000), 1_700_000_000 + Math.floor(Math.random() * 100_000_000)];
  const password = "FictionalP1bPassword";
  const passwordHash = await hashPassword(password);
  const account = async (fixture: Fixture) => (await db.select().from(authAccounts).where(eq(authAccounts.id, fixture.accountId)))[0];
  const state = async (fixture: Fixture) => ({
    account: await account(fixture),
    employee: await db.select().from(employees).where(eq(employees.id, fixture.employeeId)),
    general: await db.select().from(employeesGeneralInfo).where(eq(employeesGeneralInfo.employeeId, fixture.employeeId)),
    groups: await db.select().from(authAccountPermissionGroups).where(eq(authAccountPermissionGroups.accountId, fixture.accountId)).orderBy(authAccountPermissionGroups.id),
    scopes: await db.select().from(authManagerDepartments).where(eq(authManagerDepartments.accountId, fixture.accountId)).orderBy(authManagerDepartments.id),
    sessions: await db.select().from(authSessions).where(eq(authSessions.accountId, fixture.accountId)).orderBy(authSessions.id),
    tokens: await db.select().from(authPasswordSetupTokens).where(eq(authPasswordSetupTokens.accountId, fixture.accountId)).orderBy(authPasswordSetupTokens.id),
    otps: await db.select().from(authEmailOtps).where(eq(authEmailOtps.accountId, fixture.accountId)).orderBy(authEmailOtps.id),
    reveals: await db.select().from(authTemporaryPasswordReveals).where(eq(authTemporaryPasswordReveals.accountId, fixture.accountId)).orderBy(authTemporaryPasswordReveals.id),
  });
  const as = <T>(fixture: Fixture | null, operation: () => Promise<T>, lane = "default") => request.run({ lane, token: fixture?.token ?? null }, operation);
  async function fixture(group: AuthGroupKey | "LEGACY" = "EMPLOYEE", status: "Active" | "Disabled" | "Locked" | "PendingSetup" = "Active") {
    const result = { employeeId: randomUUID(), employeeNo: `99${Date.now()}${fixtures.length}`, accountId: randomUUID(), email: `${tag.toLowerCase()}-${fixtures.length}@example.invalid`, token: randomUUID() };
    fixtures.push(result);
    await db.insert(employees).values({ id: result.employeeId, employeeNo: result.employeeNo, firstName: "Fictional", lastName: "Account lifecycle" });
    await db.insert(employeesGeneralInfo).values({ employeeId: result.employeeId, departmentId: departmentIds[0], employmentStatus: "Regular", confidentialityLevel: group === "LEGACY" || group === "SYSTEM_ADMIN" ? "Managerial" : "Rank and File" });
    await db.insert(employeesOtherReferences).values({ employeeId: result.employeeId, email: result.email });
    await db.insert(authAccounts).values({ id: result.accountId, employeeId: result.employeeId, email: result.email, passwordHash, status, mustSetPassword: false });
    if (group !== "LEGACY") await db.insert(authAccountPermissionGroups).values({ accountId: result.accountId, groupId: groups.find(row => row.key === group)!.id });
    if (group === "MANAGER") await db.insert(authManagerDepartments).values({ accountId: result.accountId, departmentId: departmentIds[0] });
    await db.insert(authSessions).values({ accountId: result.accountId, sessionTokenHash: digest(result.token), expiresAt: new Date(Date.now() + 1_800_000) });
    return result;
  }
  async function artifacts(target: Fixture) {
    const raw = randomUUID();
    await db.insert(authEmailOtps).values({ accountId: target.accountId, purpose: "Onboarding", otpHash: digest(randomUUID()), expiresAt: new Date(Date.now() + 600_000) });
    await db.insert(authPasswordSetupTokens).values({ accountId: target.accountId, tokenHash: digest(raw), expiresAt: new Date(Date.now() + 600_000) });
    await db.insert(authTemporaryPasswordReveals).values({ accountId: target.accountId, purpose: "admin_reset", encryptedPassword: "fictional", iv: "fictional", authTag: "fictional", expiresAt: new Date(Date.now() + 600_000) });
    return raw;
  }
  async function assertRevoked(target: Fixture) {
    const saved = await state(target);
    assert.ok(saved.sessions.every(session => session.revokedAt));
    assert.equal(saved.tokens.length, 0); assert.equal(saved.otps.length, 0);
    assert.equal(await as(target, () => server.getCurrentAuthContext()), null);
  }
  async function waitForLifecycleLock() {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const result = await db.execute(sql`select count(*)::int as waiting from pg_locks where locktype='advisory' and classid=734120 and objid=1 and not granted and database=(select oid from pg_database where datname=current_database())`);
      if (Number(result.rows[0]?.waiting) > 0) return;
      await delay(20);
    }
    throw new Error("No competing lifecycle command observed waiting on PostgreSQL advisory lock");
  }
  const reset = (actor: Fixture, target: Fixture, lane = "reset") => as(actor, () => actions.resetAccountPasswordAction(form({ accountId: target.accountId, tempPassword: password + "Reset", confirmTempPassword: password + "Reset" })), lane);
  const status = (actor: Fixture, target: Fixture, nextStatus: "Active" | "Disabled" | "Locked", lane = "status") => as(actor, () => actions.updateAccountStatusAction(form({ accountId: target.accountId, status: nextStatus })), lane);
  async function setup(target: Fixture, token: string, lane = "setup", nextPassword = password + "Permanent") {
    try { return await as(null, () => actions.setPasswordAction(initial, form({ email: target.email, setupToken: token, password: nextPassword, confirmPassword: nextPassword })), lane); }
    catch (error) { if (error instanceof Redirect) return { status: "success" as const, redirect: error.location }; throw error; }
  }
  const updateGroup = (actor: Fixture, target: Fixture, groupKey: AuthGroupKey, departmentScope: number[] = [], lane = "group") => as(actor, () => actions.updateAccountGroupAction(form({ accountId: target.accountId, groupKey, departmentIds: departmentScope })), lane);
  const upsert = (actor: Fixture, target: Fixture, lane = "upsert") => as(actor, () => actions.createAdminAccountAction(initial, form({ email: target.email, groupKey: "HR_ADMIN", firstName: "Fictional", lastName: "Account lifecycle", tempPassword: password, confirmTempPassword: password })), lane);
  function expectDenied(result: unknown) {
    const denied = (value: unknown): boolean => value instanceof Error || (typeof value === "object" && value !== null && ("serverError" in value || ("status" in value && value.status === "error") || ("success" in value && value.success === false) || ("data" in value && denied(value.data))));
    assert.ok(denied(result), "Command must reject or return an explicit error");
  }
  const outcome = <T>(operation: Promise<T>) => operation.catch(error => error as Error);
  let failure: unknown;
  let preserved = false;
  try {
    // Existing restored accounts are untouched except status; raw SQL avoids
    // timestamp churn. Their exact statuses are restored in finally.
    await db.execute(sql`update auth_accounts set status='Disabled'`);
    await db.insert(department).values(departmentIds.map((id, index) => ({ id, code: `${tag}-${index}`, name: `${tag} department ${index}` })));
    const admin = await fixture("SYSTEM_ADMIN");
    assert.equal((await as(admin, () => server.getCurrentAuthContext()))?.role, "ADMIN");

    for (const originalStatus of ["Active", "PendingSetup", "Locked", "Disabled"] as const) {
      const target = await fixture("EMPLOYEE", originalStatus);
      const raw = await artifacts(target);
      await reset(admin, target);
      const saved = await account(target);
      assert.equal(saved.status, originalStatus, "Password reset cannot change account eligibility");
      assert.equal(saved.mustSetPassword, true);
      assert.ok(await verifyPassword(password + "Reset", saved.passwordHash!));
      await assertRevoked(target);
      assert.equal((await setup(target, raw)).status, "error");
      pass(`reset-preserves-${originalStatus.toLowerCase()}-and-revokes-artifacts`);
    }

    for (const originalStatus of ["Locked", "Disabled"] as const) {
      const target = await fixture("EMPLOYEE", originalStatus), raw = await artifacts(target);
      const prior = await state(target);
      assert.equal((await setup(target, raw)).status, "error");
      assert.deepEqual(await state(target), prior, "Rejected setup leaves disabled/locked account and token unchanged");
      pass(`setup-rejects-${originalStatus.toLowerCase()}-without-mutation`);
    }
    {
      const target = await fixture("EMPLOYEE", "PendingSetup"), raw = await artifacts(target);
      const result = await setup(target, raw);
      assert.equal(result.status, "success");
      const saved = await state(target);
      assert.equal(saved.account.status, "Active"); assert.equal(saved.account.mustSetPassword, false);
      assert.ok(await verifyPassword(password + "Permanent", saved.account.passwordHash!));
      assert.equal(saved.tokens.length, 0); assert.equal(saved.otps.length, 0);
      assert.equal(saved.sessions.filter(row => !row.revokedAt).length, 1);
      assert.equal((await setup(target, raw)).status, "error");
      assert.deepEqual(await state(target), saved, "Used token retry cannot change password or add another session");
      pass("pending-setup-completes-once-and-replay-is-read-only");
    }
    for (const invalid of ["expired", "used", "archived"] as const) {
      const target = await fixture("EMPLOYEE", "PendingSetup"), raw = await artifacts(target);
      if (invalid === "expired") await db.update(authPasswordSetupTokens).set({ expiresAt: new Date(0) }).where(eq(authPasswordSetupTokens.accountId, target.accountId));
      if (invalid === "used") await db.update(authPasswordSetupTokens).set({ usedAt: new Date() }).where(eq(authPasswordSetupTokens.accountId, target.accountId));
      if (invalid === "archived") await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, target.employeeId));
      const prior = await state(target);
      assert.equal((await setup(target, raw)).status, "error");
      assert.deepEqual(await state(target), prior);
      pass(`setup-rejects-${invalid}-token-or-owner`);
    }

    // Each pair is scheduled at a real transaction write. The competing
    // command must visibly wait on the production lifecycle lock.
    for (const ordering of ["setup-first", "disable-first", "setup-replay"] as const) {
      const target = await fixture("EMPLOYEE"), raw = await artifacts(target);
      const priorHash = (await account(target)).passwordHash;
      const gate = pauseAfter("first", query => /^update "auth_accounts" set /i.test(query));
      const first = ordering === "disable-first" ? outcome(status(admin, target, "Disabled", "first")) : outcome(setup(target, raw, "first"));
      let second: Promise<unknown> | undefined;
      try {
        await bounded(gate.reached.promise, ordering + " first mutation");
        second = ordering === "setup-first" ? outcome(status(admin, target, "Disabled", "second")) : outcome(setup(target, raw, "second", password + "Other"));
        await waitForLifecycleLock(); gate.release.resolve();
        const [firstResult, secondResult] = await bounded(Promise.all([first, second]), ordering + " completion");
        if (ordering === "setup-replay") {
          assert.equal((firstResult as { status: string }).status, "success");
          assert.equal((secondResult as { status: string }).status, "error");
          assert.ok(await verifyPassword(password + "Permanent", (await account(target)).passwordHash!));
          assert.equal((await state(target)).sessions.filter(row => !row.revokedAt).length, 1);
        } else {
          assert.equal((await account(target)).status, "Disabled");
          await assertRevoked(target);
          if (ordering === "disable-first") { assert.equal((secondResult as { status: string }).status, "error"); assert.equal((await account(target)).passwordHash, priorHash); }
        }
        pass(`concurrent-${ordering}`, { actualLockWaitObserved: true });
      } finally { gate.release.resolve(); await first; await second; barrier = null; }
    }
    for (const operation of ["setup", "reset"] as const) {
      const target = await fixture("EMPLOYEE"), raw = await artifacts(target), prior = await state(target);
      fault = { lane: "rollback", matches: query => /^update "auth_accounts" set /i.test(query), used: false };
      const result = operation === "setup" ? await outcome(setup(target, raw, "rollback")) : await outcome(reset(admin, target, "rollback"));
      assert.ok(fault.used); fault = null;
      expectDenied(result); assert.deepEqual(await state(target), prior, "Failure rolls back account, credentials, tokens and sessions together");
      pass(`${operation}-failure-rolls-back-whole-transaction`);
    }
    for (const operation of ["disable", "reset"] as const) {
      for (const loginFirst of [true, false]) {
        const target = await fixture();
        const login = (lane: string) => outcome(as(null, () => actions.passwordLoginAction(initial, form({ email: target.email, password })), lane));
        const change = (lane: string) => operation === "disable" ? outcome(status(admin, target, "Disabled", lane)) : outcome(reset(admin, target, lane));
        const gate = pauseAfter("first", query => /^update "auth_accounts" set /i.test(query));
        const first = loginFirst ? login("first") : change("first");
        let second: Promise<unknown> | undefined;
        try {
          await bounded(gate.reached.promise, "login/access mutation before commit");
          second = loginFirst ? change("second") : login("second");
          await waitForLifecycleLock(); gate.release.resolve();
          const [firstResult, secondResult] = await bounded(Promise.all([first, second]), "login/access mutation completion");
          if (loginFirst) assert.ok(firstResult instanceof Redirect);
          else assert.equal((secondResult as { status: string }).status, "error");
          await assertRevoked(target);
          assert.equal((await account(target)).status, operation === "disable" ? "Disabled" : "Active");
          pass(`concurrent-${loginFirst ? "login-first" : operation + "-first"}-${operation === "disable" ? "disable" : "credential-reset"}`, { actualLockWaitObserved: true });
        } finally { gate.release.resolve(); await first; await second; barrier = null; }
      }
    }
    {
      const target = await fixture("EMPLOYEE", "Disabled"); await artifacts(target);
      const prior = await state(target);
      const result = await as(admin, () => actions.createAdminAccountAction(initial, form({ email: target.email, groupKey: "MANAGER", departmentIds: [2_147_483_000], firstName: "Fictional", lastName: "Account lifecycle", tempPassword: password, confirmTempPassword: password })));
      assert.equal(result.status, "error");
      assert.deepEqual(await state(target), prior, "Failed scope assignment cannot partially reset password, activate, or change groups");
      pass("account-upsert-invalid-scope-rolls-back-profile-password-and-role");
    }
    {
      const otherAdmin = await fixture("SYSTEM_ADMIN"), target = await fixture();
      const prior = await state(target);
      const gate = pauseAfter("disabler", query => /^update "auth_accounts" set /i.test(query));
      const disabling = outcome(status(admin, otherAdmin, "Disabled", "disabler"));
      let queued: Promise<unknown> | undefined;
      try {
        await bounded(gate.reached.promise, "administrator disabling another administrator");
        queued = outcome(reset(otherAdmin, target, "queued"));
        await waitForLifecycleLock(); gate.release.resolve();
        await bounded(disabling, "administrator disable commit");
        expectDenied(await bounded(queued, "queued actor permission recheck"));
        assert.deepEqual(await state(target), prior);
        await assertRevoked(otherAdmin);
        pass("queued-command-rechecks-disabled-actor-before-writing", { actualLockWaitObserved: true });
      } finally { gate.release.resolve(); await disabling; await queued; barrier = null; }
    }
    {
      const target = await fixture("EMPLOYEE"), raw = await artifacts(target);
      await status(admin, target, "Disabled"); await assertRevoked(target);
      await status(admin, target, "Active");
      assert.equal((await account(target)).status, "Active");
      assert.equal(await as(target, () => server.getCurrentAuthContext()), null, "Reactivation cannot resurrect a revoked session");
      assert.equal((await setup(target, raw)).status, "error", "Reactivation cannot resurrect an old recovery token");
      const context = { lane: "login", token: null as string | null, writtenToken: undefined as string | undefined };
      const result = await outcome(request.run(context, () => actions.passwordLoginAction(initial, form({ email: target.email, password }))));
      assert.ok(result instanceof Redirect); assert.ok(context.writtenToken);
      assert.equal((await as({ ...target, token: context.writtenToken }, () => server.getCurrentAuthContext()))?.accountId, target.accountId);
      pass("explicit-reactivation-requires-fresh-login");
    }
    {
      const manager = await fixture("MANAGER"), teamA = await fixture(), teamB = await fixture();
      await db.update(employeesGeneralInfo).set({ departmentId: departmentIds[1] }).where(eq(employeesGeneralInfo.employeeId, teamB.employeeId));
      await as(manager, () => server.assertManagerCanAccessEmployee({ accountId: manager.accountId, employeeId: teamA.employeeId }));
      await updateGroup(admin, manager, "MANAGER", [departmentIds[1]]);
      await assert.rejects(() => as(manager, () => server.assertManagerCanAccessEmployee({ accountId: manager.accountId, employeeId: teamA.employeeId })));
      await as(manager, () => server.assertManagerCanAccessEmployee({ accountId: manager.accountId, employeeId: teamB.employeeId }));
      await updateGroup(admin, manager, "EMPLOYEE");
      assert.deepEqual(await server.getManagerDepartmentIds(manager.accountId), []);
      assert.equal((await as(manager, () => server.getCurrentAuthContext()))?.role, "EMPLOYEE");
      pass("manager-scope-removal-and-role-change-apply-to-existing-session");
    }

    // Archive multiple folders, retain file bytes/metadata, and verify an
    // interrupted final child write cannot leave a partly archived employee.
    for (const rollback of [false, true]) {
      const target = await fixture(), neighbor = await fixture(); await artifacts(target);
      const folders = [0, 1, 2].map(index => ({ id: randomUUID(), employeeId: index === 2 ? neighbor.employeeId : target.employeeId, folderName: `${tag} folder ${index}`, folderType: "Admin" as const }));
      await db.insert(employeeFolders).values(folders);
      const files = folders.map(folder => ({ id: randomUUID(), groupId: folder.id, fileName: "Fictional evidence", filePath: "/private-fictional-document", fileSize: 3 }));
      await db.insert(employeeFiles).values(files);
      const prior = await state(target);
      const beforeFolders = await db.select().from(employeeFolders).where(inArray(employeeFolders.id, folders.map(row => row.id))).orderBy(employeeFolders.id);
      const beforeFiles = await db.select().from(employeeFiles).where(inArray(employeeFiles.id, files.map(row => row.id))).orderBy(employeeFiles.id);
      if (rollback) fault = { lane: "archive", matches: query => /^update "employee_files" set /i.test(query), used: false };
      const result = await outcome(as(admin, () => archiveEmployeeAction(target.employeeId), "archive"));
      if (rollback) {
        assert.ok(fault!.used); fault = null; expectDenied(result);
        assert.deepEqual(await state(target), prior);
        assert.deepEqual(await db.select().from(employeeFolders).where(inArray(employeeFolders.id, folders.map(row => row.id))).orderBy(employeeFolders.id), beforeFolders);
        assert.deepEqual(await db.select().from(employeeFiles).where(inArray(employeeFiles.id, files.map(row => row.id))).orderBy(employeeFiles.id), beforeFiles);
      } else {
        assert.equal((result as { data?: { success: boolean } }).data?.success, true);
        assert.equal((await account(target)).status, "Disabled"); await assertRevoked(target);
        assert.ok((await state(target)).employee[0].deletedAt);
        for (const file of files.slice(0, 2)) assert.ok((await db.select().from(employeeFiles).where(eq(employeeFiles.id, file.id)))[0].deletedAt);
        for (const folder of folders.slice(0, 2)) assert.ok((await db.select().from(employeeFolders).where(eq(employeeFolders.id, folder.id)))[0].deletedAt);
        assert.deepEqual((await db.select().from(employeeFiles).where(eq(employeeFiles.id, files[2].id)))[0], beforeFiles.find(row => row.id === files[2].id));
        assert.deepEqual((await db.select().from(employeeFolders).where(eq(employeeFolders.id, folders[2].id)))[0], beforeFolders.find(row => row.id === folders[2].id));
      }
      pass(rollback ? "archive-failure-rolls-back-all-folders-and-account" : "archive-multiple-folders-retains-neighbor-and-revokes-access");
    }

    type Removal = "status" | "group" | "archive" | "upsert";
    const remove = (target: Fixture, kind: Removal, lane: string) => {
      if (kind === "status") return outcome(status(target, target, "Disabled", lane));
      if (kind === "group") return outcome(updateGroup(target, target, "HR_ADMIN", [], lane));
      if (kind === "archive") return outcome(as(target, () => archiveEmployeeAction(target.employeeId), lane));
      return outcome(upsert(target, target, lane));
    };
    const onlyFixturesActive = async () => { await db.execute(sql`update auth_accounts set status='Disabled'`); };
    for (const group of ["SYSTEM_ADMIN", "LEGACY"] as const) {
      await onlyFixturesActive();
      const last = await fixture(group);
      assert.ok((await as(last, () => server.getCurrentAuthContext()))?.groupKeys.includes("SYSTEM_ADMIN"));
      for (const kind of ["status", "group", "archive", "upsert"] as const) {
        const prior = await state(last);
        expectDenied(await remove(last, kind, "last"));
        assert.deepEqual(await state(last), prior, "Last effective administrator cannot be removed through any command");
        pass(`last-${group.toLowerCase()}-survives-${kind}`);
      }
    }
    {
      await onlyFixturesActive();
      const last = await fixture("SYSTEM_ADMIN");
      const immediateBefore = await fingerprint();
      const capturedErrors: unknown[] = [];
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => { capturedErrors.push(...args); originalConsoleError(...args); };
      let result: unknown;
      try { result = await outcome(as(last, () => deleteAllRegularEmployeesAction({ confirmation: DELETE_EMPLOYEE_MASTER_DATA_CONFIRMATION }), "bulk-delete")); }
      finally { console.error = originalConsoleError; }
      expectDenied(result);
      assert.deepEqual(await fingerprint(), immediateBefore, "Denied bulk deletion restores every original and fixture row immediately");
      assert.ok(capturedErrors.some(error => (error instanceof Error ? error.message : String(error)).includes("At least one active System Admin account is required.")), "Last-admin guard must be the denial reason; foreign-key rejection is not lifecycle acceptance");
      assert.ok((await as(last, () => server.getCurrentAuthContext()))?.groupKeys.includes("SYSTEM_ADMIN"));
      pass("bulk-regular-employee-delete-preserves-last-admin-and-all-original-rows");
    }
    for (const pathway of ["employee-form", "employee-csv"] as const) {
      for (const group of ["LEGACY", "SYSTEM_ADMIN"] as const) {
        await onlyFixturesActive();
        const last = await fixture(group), prior = await state(last);
        const result = pathway === "employee-form"
          ? await outcome(as(last, () => saveEmployeeAction({ id: last.employeeId, employeeType: "EMP", employeeNo: last.employeeNo, firstName: "Fictional", lastName: "Account lifecycle", generalInfo: { confidentialityLevel: "Rank and File", departmentId: String(departmentIds[0]) }, otherReferences: { email: last.email } })))
          : await outcome(as(last, () => importEmployeesFromCsv([{ EmployeeNo: last.employeeNo, firstName: "Fictional", lastName: "Account lifecycle", "Confidentiality Level": "Rank and File", Email: last.email }])));
        if (group === "LEGACY") {
          expectDenied(result); assert.deepEqual(await state(last), prior);
        } else {
          assert.equal(result instanceof Error, false);
          if (pathway === "employee-form") assert.equal((result as { data?: { data?: { employeeId: string } } }).data?.data?.employeeId, last.employeeId);
          else assert.equal((result as { success: boolean }).success, true);
          assert.equal((await state(last)).general[0].confidentialityLevel, "Rank and File");
          assert.ok((await as(last, () => server.getCurrentAuthContext()))?.groupKeys.includes("SYSTEM_ADMIN"), "Explicit access group survives employment classification change");
        }
        pass(`${pathway}-${group.toLowerCase()}-confidentiality-change-${group === "LEGACY" ? "blocked" : "preserves-explicit-role"}`);
      }
    }
    {
      await onlyFixturesActive();
      const last = await fixture("SYSTEM_ADMIN"), archivedAdmin = await fixture("SYSTEM_ADMIN"), explicitHr = await fixture("HR_ADMIN");
      await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, archivedAdmin.employeeId));
      await db.update(employeesGeneralInfo).set({ confidentialityLevel: "Managerial" }).where(eq(employeesGeneralInfo.employeeId, explicitHr.employeeId));
      const prior = await state(last);
      expectDenied(await remove(last, "status", "last"));
      assert.deepEqual(await state(last), prior);
      pass("archived-admin-and-explicit-hr-with-legacy-level-do-not-count-as-survivors");
    }
    for (const [firstKind, secondKind] of [["status", "status"], ["group", "group"], ["archive", "status"], ["upsert", "group"]] as const) {
      await onlyFixturesActive();
      const firstAdmin = await fixture("SYSTEM_ADMIN"), secondAdmin = await fixture("LEGACY");
      const gate = pauseAfter("first", query => /pg_advisory_xact_lock/i.test(query));
      const first = remove(firstAdmin, firstKind, "first");
      let second: Promise<unknown> | undefined;
      try {
        await bounded(gate.reached.promise, `first ${firstKind} holds lock`);
        second = remove(secondAdmin, secondKind, "second");
        await waitForLifecycleLock(); gate.release.resolve();
        const [firstResult, secondResult] = await bounded(Promise.all([first, second]), "concurrent admin removals");
        assert.equal(firstResult instanceof Error, false);
        if (firstKind === "archive") assert.equal((firstResult as { data?: { success: boolean } }).data?.success, true);
        if (firstKind === "upsert") assert.equal((firstResult as { status: string }).status, "success");
        expectDenied(secondResult);
        const surviving = await as(secondAdmin, () => server.getCurrentAuthContext());
        assert.ok(surviving?.groupKeys.includes("SYSTEM_ADMIN"));
        pass(`concurrent-${firstKind}-then-${secondKind}-preserves-last-legacy-admin`, { actualLockWaitObserved: true });
      } finally { gate.release.resolve(); await first; await second; barrier = null; }
    }
  } catch (error) { failure = error; }
  finally {
    barrier?.release.resolve(); barrier = null; fault = null;
    await db.transaction(async tx => {
      const accountIds = fixtures.map(row => row.accountId);
      if (accountIds.length) await tx.delete(adminAuditEvents).where(inArray(adminAuditEvents.actorUserId, accountIds));
      if (fixtures.length) await tx.delete(employees).where(inArray(employees.id, fixtures.map(row => row.employeeId)));
      await tx.delete(department).where(inArray(department.id, departmentIds));
      for (const row of originalAccounts) await tx.execute(sql`update auth_accounts set status=${row.status}::auth_account_status where id=${row.id}::uuid`);
      await tx.execute(sql`update auth_permission_groups g set key=r.key,name=r.name,description=r.description,is_system=r.is_system,created_at=r.created_at,updated_at=r.updated_at from jsonb_populate_recordset(null::auth_permission_groups,${JSON.stringify(originalGroups)}::jsonb) r where g.id=r.id`);
    });
    preserved = JSON.stringify(await fingerprint()) === JSON.stringify(before);
    const report = { passed: !failure && preserved, checks, checkCount: checks.length, tablesPreserved: tableNames.length, allOriginalRowsPreserved: preserved, productionAccess: false, actualApplicationActions: true, browserAcceptance: false, fixtureCleanup: true, failure: failure instanceof Error ? failure.message : failure ? String(failure) : null };
    if (process.env.P1B_REPORT_DIRECTORY) { mkdirSync(process.env.P1B_REPORT_DIRECTORY, { recursive: true }); writeFileSync(path.join(process.env.P1B_REPORT_DIRECTORY, "acceptance.json"), JSON.stringify(report, null, 2)); }
    console.log(JSON.stringify(report));
    NeonPreparedQuery.prototype.execute = originalExecute; loader._load = originalLoad;
  }
  assert.ok(preserved, "All restored public table rows must match after fixture cleanup");
  if (failure) throw failure;
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { getManagerDepartmentIds } from "@/lib/auth/server";
import { freshScheduleDatabase } from "./attendanceTest/freshScheduleDatabase";
import type * as PendingRequests from "@/lib/manager/pendingRequests";

async function main() {
  const { pg, database, client } = await freshScheduleDatabase();
  const managerA = randomUUID(), managerB = randomUUID();
  let currentActor = managerA;
  let allowManager = true;
  const sentinel = "CONFIDENTIAL_PAY_837465.12_MEDICAL_REASON";
  const filename = path.resolve("src/lib/manager/pendingRequests.ts"), nativeRequire = createRequire(filename), fixture = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = (request: string) => request === "@/db" ? { db: client }
    : request === "server-only" ? {}
    : request === "@/lib/auth/server" ? {
      requireManager: async () => { if (!allowManager) throw new Error("Forbidden."); return { accountId: currentActor }; },
      getManagerDepartmentIds: (accountId: string) => getManagerDepartmentIds(accountId, client),
    } : nativeRequire(request);
  new vm.Script(compiled, { filename }).runInNewContext({ module: fixture, exports: fixture.exports, require, Number, Error, Promise });
  const { getManagerPendingRequests } = fixture.exports as typeof PendingRequests;
  async function fingerprint() {
    const tables = (await pg.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
    const hash = createHash("sha256");
    for (const { tablename } of tables) hash.update(tablename).update(JSON.stringify((await pg.query(`select to_jsonb(t) as row from "${tablename.replaceAll('"', '""')}" t order by to_jsonb(t)::text`)).rows));
    return hash.digest("hex");
  }
  try {
    const [branchA, branchB] = await database.insert(s.department).values([{ code: "PENDING-A", name: "Fictional A" }, { code: "PENDING-B", name: "Fictional B" }]).returning();
    await database.insert(s.authManagerDepartments).values([{ accountId: managerA, departmentId: branchA.id }, { accountId: managerB, departmentId: branchB.id }]);
    async function employee(label: string, departmentId: number, options: { archived?: boolean; profileArchived?: boolean; employmentStatus?: typeof s.employeesGeneralInfo.$inferInsert.employmentStatus } = {}) {
      const [person] = await database.insert(s.employees).values({ employeeNo: label, firstName: label, lastName: "Fictional", deletedAt: options.archived ? new Date("2026-10-01T00:00:00Z") : null }).returning();
      await database.insert(s.employeesGeneralInfo).values({ employeeId: person.id, departmentId, employmentStatus: options.employmentStatus ?? "Regular", deletedAt: options.profileArchived ? new Date("2026-10-01T00:00:00Z") : null });
      await database.insert(s.employeesSalary).values({ employeeId: person.id, dailyRate: "837465.12" });
      return person;
    }
    const alpha = await employee("Alpha", branchA.id), beta = await employee("Beta", branchB.id);
    const excluded = await Promise.all([
      employee("Archived employee", branchA.id, { archived: true }), employee("Archived profile", branchA.id, { profileArchived: true }),
      employee("Resigned", branchA.id, { employmentStatus: "Resigned" }), employee("Terminated", branchA.id, { employmentStatus: "Terminated" }), employee("Contract ended", branchA.id, { employmentStatus: "Finished Conctract" }),
    ]);
    const leave = async (employeeId: string, leaveStatus: typeof s.employeesLeaveRecords.$inferInsert.leaveStatus = "Pending", dateFiled = "2026-10-14", archived = false) => (await database.insert(s.employeesLeaveRecords).values({ employeeId, dateFiled, leaveStartDate: dateFiled, leaveEndDate: dateFiled, leaveType: "VL", noOfDays: "1.00", reason: sentinel, leaveStatus, deletedAt: archived ? new Date() : null }).returning())[0];
    const schedule = async (employeeId: string, requestedByAccountId: string, status: typeof s.managerScheduleChangeRequests.$inferInsert.status = "Pending") => (await database.insert(s.managerScheduleChangeRequests).values({ employeeId, requestedByAccountId, action: "Create", status, reason: sentinel, decisionNote: sentinel, payload: { employeeId, shiftTableId: 1, effectiveFrom: "2026-10-14", effectiveTo: "2026-10-14", metadata: { privateNote: sentinel } } as unknown as s.ManagerScheduleChangePayload }).returning())[0];
    const older = await leave(alpha.id, "Pending", "2025-12-31"), current = await leave(alpha.id), other = await leave(beta.id);
    await leave(alpha.id, "Approved"); await leave(alpha.id, "Cancelled"); await leave(alpha.id, "Pending", "2026-10-14", true);
    const own = await schedule(alpha.id, managerA), otherOwn = await schedule(beta.id, managerB);
    await schedule(alpha.id, managerB); await schedule(alpha.id, managerA, "Approved"); await schedule(alpha.id, managerA, "Cancelled");
    for (const person of excluded) { await leave(person.id); await schedule(person.id, managerA); }
    const before = await fingerprint();
    const resultA = await getManagerPendingRequests(branchA.id);
    assert.deepEqual(resultA.leaves.map(row => row.id), [older.id, current.id], "all pending dates, ordered oldest first, current roster only");
    assert.deepEqual(resultA.schedules.map(row => row.id), [own.id], "own pending schedules only");
    for (const row of resultA.leaves) assert.deepEqual(Object.keys(row).sort(), ["id", "employeeId", "firstName", "lastName", "dateFiled", "startDate", "endDate"].sort());
    for (const row of resultA.schedules) assert.deepEqual(Object.keys(row).sort(), ["id", "employeeId", "firstName", "lastName", "action", "submittedAt"].sort());
    const serialized = JSON.stringify(resultA);
    for (const value of [sentinel, "837465", beta.id, other.id.toString(), ...excluded.map(row => row.id)]) {
      // Numeric IDs may occur as date digits; check the out-of-scope record via the array assertions above.
      if (value === other.id.toString()) continue;
      assert(!serialized.includes(value), `private/out-of-scope data excluded: ${value}`);
    }
    await assert.rejects(() => getManagerPendingRequests(branchB.id), /not available/);
    for (const branch of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(() => getManagerPendingRequests(branch), /not available/);
    assert.equal(JSON.stringify(await getManagerPendingRequests(null)), JSON.stringify({ leaves: [], schedules: [] }));
    currentActor = managerB;
    const resultB = await getManagerPendingRequests(branchB.id);
    assert.deepEqual(resultB.leaves.map(row => row.id), [other.id]); assert.deepEqual(resultB.schedules.map(row => row.id), [otherOwn.id]);
    assert(!JSON.stringify(resultB).includes(alpha.id));
    await assert.rejects(() => getManagerPendingRequests(branchA.id), /not available/);
    allowManager = false;
    await assert.rejects(() => getManagerPendingRequests(branchB.id), /Forbidden/);
    await assert.rejects(() => getManagerPendingRequests(null), /Forbidden/);
    allowManager = true;
    assert.equal(await fingerprint(), before, "every fictional DB table remains unchanged by reads/denials");
    await database.delete(s.authManagerDepartments).where(eq(s.authManagerDepartments.accountId, managerB));
    const afterRevocation = await fingerprint();
    await assert.rejects(() => getManagerPendingRequests(branchB.id), /not available/);
    assert.equal(await fingerprint(), afterRevocation);
    console.log("PASS manager dashboard pending requests: actual query + assignment lookup on fictional PGlite; two-manager isolation, tampered/revoked scope, pending/all-date ordering, own schedules, archived/separated exclusions, exact field allowlist, confidential sentinels absent, every table preserved. Session identity/role gate mocked; HTTP authentication remains separate.");
  } finally { await pg.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

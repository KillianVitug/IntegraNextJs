import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { request as httpRequest } from "node:http";
import { eq, inArray, sql } from "drizzle-orm";
import JSZip from "jszip";
import {
  adminAuditEvents, authAccountPermissionGroups, authAccounts, authManagerDepartments,
  authPermissionGroups, authSessions, department, employeeFileContents, employeeFiles,
  employeeFolders, employees, employeesGeneralInfo, employeesSalaryAdjustments,
} from "@/db/schema";
import { AUTH_GROUP_KEYS } from "@/lib/auth/permissions";
import { MAX_DOCUMENT_BYTES, protectedDocumentUrl } from "@/lib/employee-documents/model";

// The running production build must use the same isolated restored database.
// Fixtures commit solely so the separate server can read real stored sessions.
// Every fixture ID, its audit rows, and the one exclusively-created legacy file
// are removed in finally; all public table row fingerprints must return exactly.
async function main() {
  assert.equal(new URL(process.env.DATABASE_URL ?? "").hostname, "127.0.0.1", "HTTP fixtures require a loopback restored database");
  assert.notEqual(process.env.NODE_ENV, "development", "Do not load development credentials");
  const base = new URL(process.env.EMPLOYEE_DOCUMENT_TEST_BASE_URL ?? "");
  assert.equal(base.protocol, "http:");
  assert.equal(base.hostname, "127.0.0.1", "HTTP verification may only contact the loopback test server");
  assert.equal(base.username + base.password + base.search + base.hash, "");
  const configuredDirectory = process.env.EMPLOYEE_DOCUMENT_TEST_PRIVATE_DIRECTORY ?? "";
  assert.ok(path.isAbsolute(configuredDirectory), "Pass the validated built server's private employee-file directory");
  const privateDirectory = await realpath(configuredDirectory);
  assert.equal(path.basename(privateDirectory), "employee-files");
  assert.equal(path.basename(path.dirname(privateDirectory)), "private");
  const { db } = await import("@/db");
  const { authConfig } = await import("@/lib/auth/config");
  const tableRows = (await db.execute(sql`select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows;
  const tables = tableRows.map(row => String(row.tablename));
  assert.ok(tables.includes("employee_file_contents"), "Migrate only the restored copy before this test");
  const fingerprint = async () => (await db.execute(sql.raw(tables.map(name => {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return `select '${name.replaceAll("'", "''")}' as name,count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as hash from ${quoted} t`;
  }).join(" union all ") + " order by name"))).rows;
  const before = await fingerprint();
  const suffix = randomUUID().slice(0, 8);
  const serialBase = -randomInt(1000, 1_000_000_000);
  const departmentIds = [serialBase, serialBase - 1];
  const now = new Date();
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const specifications = [
    { name: "hr", group: AUTH_GROUP_KEYS.HR_ADMIN, status: "Active" as const },
    { name: "system", group: AUTH_GROUP_KEYS.SYSTEM_ADMIN, status: "Active" as const },
    { name: "manager", group: AUTH_GROUP_KEYS.MANAGER, status: "Active" as const },
    { name: "employee", group: AUTH_GROUP_KEYS.EMPLOYEE, status: "Active" as const },
    { name: "disabled", group: AUTH_GROUP_KEYS.HR_ADMIN, status: "Disabled" as const },
    { name: "locked", group: AUTH_GROUP_KEYS.HR_ADMIN, status: "Locked" as const },
    { name: "revoked", group: AUTH_GROUP_KEYS.HR_ADMIN, status: "Active" as const },
    { name: "expired", group: AUTH_GROUP_KEYS.HR_ADMIN, status: "Active" as const },
    { name: "archived", group: AUTH_GROUP_KEYS.HR_ADMIN, status: "Active" as const },
  ];
  const actors = specifications.map(spec => ({ ...spec, employeeId: randomUUID(), accountId: randomUUID(), sessionId: randomUUID(), token: randomBytes(24).toString("base64url") }));
  const actor = (name: string) => actors.find(candidate => candidate.name === name)!;
  const employeeIds = actors.map(item => item.employeeId);
  const accountIds = actors.map(item => item.accountId);
  const folderA = randomUUID(), folderB = randomUUID(), fileA = randomUUID(), fileB = randomUUID(), legacyId = randomUUID();
  const legacyName = `qa-document-${randomUUID()}.pdf`;
  const legacyPath = `/uploads/${legacyName}`;
  const legacyFile = path.join(privateDirectory, legacyName);
  const pdf = Buffer.from("%PDF-1.7\nFictional HTTP document acceptance\n%%EOF");
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("Fictional HTTP byte fixture")]);
  const folderInput = (id = randomUUID()) => ({ id, employeeId: actor("employee").employeeId, folderName: "HTTP new folder", folderType: "Admin", description: null, remarks: null });
  const form = (id = randomUUID(), bytes = pdf, groupId = folderA, fileName = "HTTP document") => {
    const data = new FormData();
    data.set("id", id); data.set("groupId", groupId); data.set("fileName", fileName);
    data.set("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), "fixture.pdf");
    return data;
  };
  const json = (body: unknown, origin = base.origin): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
  let requests = 0, committed = false, ownedLegacyFile = false;
  let failure: unknown;
  const call = async (route: string, name: string | null, status: number, init: RequestInit = {}, protectedHeaders = true) => {
    const target = new URL(route, base);
    assert.equal(target.origin, base.origin, "No external test requests");
    const headers = new Headers(init.headers);
    if (name) headers.set("Cookie", `${authConfig.sessionCookieName}=${actor(name).token}`);
    // Fetch may discard a custom Host. Native HTTP models the proxy boundary
    // explicitly for that one fixture while keeping the connection on loopback.
    const response = headers.has("host") ? await new Promise<Response>((resolve, reject) => {
      assert.equal(typeof init.body, "string");
      const outgoing = httpRequest(target, { method: init.method, headers: Object.fromEntries(headers) }, incoming => {
        const chunks: Buffer[] = [];
        incoming.on("data", chunk => chunks.push(Buffer.from(chunk)));
        incoming.once("error", reject);
        incoming.once("end", () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(incoming.headers)) {
            if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          resolve(new Response(new Uint8Array(Buffer.concat(chunks)), { status: incoming.statusCode, headers: responseHeaders }));
        });
      });
      outgoing.setTimeout(30_000, () => outgoing.destroy(new Error("Loopback proxy fixture timed out")));
      outgoing.once("error", reject);
      outgoing.end(init.body);
    }) : await fetch(target, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
    requests += 1;
    assert.equal(response.status, status, `${name ?? "anonymous"} ${init.method ?? "GET"} ${target.pathname}`);
    if (protectedHeaders) {
      assert.match(response.headers.get("cache-control") ?? "", /private/);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      assert.match(response.headers.get("vary") ?? "", /Cookie/i);
      if (!route.includes("SalaryRateHistory") && !route.includes("CustomPayrollHistory")) {
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      }
    }
    return response;
  };

  try {
    // Exclusive creation cannot overwrite any preserved legacy document.
    const handle = await open(legacyFile, "wx");
    ownedLegacyFile = true;
    try { await handle.writeFile(pdf); } finally { await handle.close(); }
    await db.transaction(async tx => {
      const groupRows = await tx.select().from(authPermissionGroups);
      for (const spec of specifications) assert.ok(groupRows.some(group => group.key === spec.group), `Required fixture group ${spec.group} exists`);
      await tx.insert(department).values(departmentIds.map((id, index) => ({ id, code: `DHTTP-${suffix}-${index}`, name: `Document HTTP ${suffix} ${index}` })));
      await tx.insert(employees).values(actors.map((item, index) => ({
        id: item.employeeId, employeeNo: `DHTTP-${suffix}-${index}`, firstName: "Document HTTP", lastName: item.name,
        createdAt: now, updatedAt: now, deletedAt: item.name === "archived" ? now : null,
      })));
      await tx.insert(employeesGeneralInfo).values(actors.map((item, index) => ({
        id: serialBase - index, employeeId: item.employeeId, departmentId: departmentIds[index % 2],
        employmentStatus: "Regular" as const, confidentialityLevel: "Rank and File" as const,
      })));
      await tx.insert(authAccounts).values(actors.map(item => ({ id: item.accountId, employeeId: item.employeeId, email: `document-http-${suffix}-${item.name}@example.invalid`, status: item.status, mustSetPassword: false })));
      await tx.insert(authAccountPermissionGroups).values(actors.map(item => ({ accountId: item.accountId, groupId: groupRows.find(group => group.key === item.group)!.id })));
      await tx.insert(authManagerDepartments).values({ accountId: actor("manager").accountId, departmentId: departmentIds[1] });
      await tx.insert(authSessions).values(actors.map(item => ({
        id: item.sessionId, accountId: item.accountId, sessionTokenHash: hash(item.token),
        expiresAt: new Date(now.getTime() + (item.name === "expired" ? -60_000 : 3_600_000)), revokedAt: item.name === "revoked" ? now : null,
      })));
      await tx.insert(employeeFolders).values([
        { id: folderA, employeeId: actor("employee").employeeId, folderName: "HTTP employee folder", folderType: "Admin" },
        { id: folderB, employeeId: actor("manager").employeeId, folderName: "HTTP manager folder", folderType: "Payroll" },
      ]);
      await tx.insert(employeeFiles).values([
        { id: fileA, groupId: folderA, fileName: "HTTP PDF", filePath: protectedDocumentUrl(fileA), mimeType: "application/pdf", fileSize: pdf.length },
        { id: fileB, groupId: folderB, fileName: "HTTP PNG", filePath: protectedDocumentUrl(fileB), mimeType: "image/png", fileSize: png.length },
        { id: legacyId, groupId: folderA, fileName: "HTTP legacy PDF", filePath: legacyPath, mimeType: "text/html", fileSize: pdf.length },
      ]);
      await tx.insert(employeeFileContents).values([
        { fileId: fileA, contentBase64: pdf.toString("base64"), sha256: hash(pdf), size: pdf.length, mimeType: "application/pdf" },
        { fileId: fileB, contentBase64: png.toString("base64"), sha256: hash(png), size: png.length, mimeType: "image/png" },
      ]);
      await tx.insert(employeesSalaryAdjustments).values([
        { id: serialBase, employeeId: actor("employee").employeeId, payrollCode: `HTTP-${suffix}-A`, oldDailyRate: "100", newDailyRate: "200" },
        { id: serialBase - 1, employeeId: actor("manager").employeeId, payrollCode: `HTTP-${suffix}-B`, oldDailyRate: "300", newDailyRate: "400" },
      ]);
    });
    committed = true;

    const denialBefore = await fingerprint();
    for (const denied of [null, "manager", "employee", "disabled", "locked", "revoked", "expired", "archived"]) {
      const status = denied === "manager" || denied === "employee" ? 403 : 401;
      for (const route of [`/api/get-file?groupId=${folderA}`, `/api/get-files?groupId=${folderB}`, protectedDocumentUrl(fileA), protectedDocumentUrl(fileB), protectedDocumentUrl(legacyId), legacyPath]) {
        await call(route, denied, status);
      }
      await call("/api/employee-folder", denied, status, json(folderInput()));
      await call("/api/upload", denied, status, { method: "POST", body: form() });
      await call("/api/zip", denied, status, json({ fileIds: [fileA] }));
      for (const person of [actor("employee"), actor("manager")]) {
        for (const routeName of ["SalaryRateHistory", "CustomPayrollHistory"]) {
          const response = await call(`/api/employees/${person.employeeId}/${routeName}`, denied, status);
          assert.equal("data" in await response.json(), false);
        }
      }
    }
    assert.deepEqual(await fingerprint(), denialBefore, "Denied HTTP requests cannot mutate any stored rows");

    for (const name of ["hr", "system"]) {
      for (const [folderId, fileId, expected] of [[folderA, fileA, pdf], [folderB, fileB, png]] as const) {
        const listing = await (await call(`/api/get-files?groupId=${folderId}`, name, 200)).json();
        assert.ok(listing.some((file: { id: string }) => file.id === fileId));
        const first = await (await call(`/api/get-file?groupId=${folderId}`, name, 200)).json();
        assert.ok(listing.some((file: { id: string }) => file.id === first.id));
        const content = await call(protectedDocumentUrl(fileId), name, 200);
        assert.deepEqual(Buffer.from(await content.arrayBuffer()), expected);
        assert.match(content.headers.get("content-disposition") ?? "", /^inline;/);
        assert.match(content.headers.get("content-security-policy") ?? "", /sandbox/);
      }
      for (const route of [legacyPath, protectedDocumentUrl(legacyId)]) {
        const response = await call(route, name, 200);
        assert.equal(response.headers.get("content-type"), "application/pdf", "Legacy MIME is derived from actual private file bytes");
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
      }
      for (const person of [actor("employee"), actor("manager")]) {
        for (const routeName of ["SalaryRateHistory", "CustomPayrollHistory"]) {
          const history = await (await call(`/api/employees/${person.employeeId}/${routeName}`, name, 200)).json();
          assert.equal(history.data.length, 1);
          assert.match(history.data[0].payrollCode, new RegExp(`^HTTP-${suffix}-`));
        }
      }
      const archive = await JSZip.loadAsync(await (await call("/api/zip", name, 200, json({ fileIds: [fileA, fileB, legacyId] }))).arrayBuffer());
      assert.equal(Object.keys(archive.files).length, 3);
      for (const entry of Object.values(archive.files)) {
        assert.equal(/[\\/]/.test(entry.name), false, "ZIP entry names contain no paths");
        const bytes = await entry.async("nodebuffer");
        assert.ok(bytes.equals(pdf) || bytes.equals(png));
      }
    }
    const forcedDownload = await call(`${protectedDocumentUrl(fileA)}?download=1`, "hr", 200);
    assert.match(forcedDownload.headers.get("content-disposition") ?? "", /^attachment;/);
    await call("/api/zip", "hr", 200, {
      ...json({ fileIds: [fileA] }),
      headers: { "Content-Type": "application/json", Host: "document-test.invalid", "X-Forwarded-Proto": "https", Origin: "https://document-test.invalid" },
    });
    await call("/api/zip", "hr", 403, {
      ...json({ fileIds: [fileA] }),
      headers: { "Content-Type": "application/json", "X-Forwarded-Host": "untrusted.invalid", Origin: "https://untrusted.invalid" },
    });

    for (const route of [protectedDocumentUrl(fileA), legacyPath]) {
      for (const name of [null, "hr"]) await call(`/_next/image?url=${encodeURIComponent(route)}&w=640&q=75`, name, 400, {}, false);
    }
    await call("/uploads/unknown-http-fixture.pdf", null, 401);
    await call("/uploads/unknown-http-fixture.pdf", "hr", 404);

    const newFolder = folderInput();
    const folderResponse = await (await call("/api/employee-folder", "hr", 200, json(newFolder))).json();
    assert.equal(folderResponse.id, newFolder.id);
    const beforeFolderRetry = await fingerprint();
    await call("/api/employee-folder", "system", 200, json(newFolder));
    assert.deepEqual(await fingerprint(), beforeFolderRetry, "HTTP folder retry is unchanged");
    const newFile = randomUUID();
    const uploadResponse = await (await call("/api/upload", "hr", 200, { method: "POST", body: form(newFile, pdf, newFolder.id) })).json();
    assert.equal(uploadResponse.id, newFile);
    assert.equal(uploadResponse.filePath, protectedDocumentUrl(newFile));
    const beforeUploadRetry = await fingerprint();
    await call("/api/upload", "system", 200, { method: "POST", body: form(newFile, pdf, newFolder.id) });
    assert.deepEqual(await fingerprint(), beforeUploadRetry, "HTTP upload retry is unchanged");
    const htmlId = randomUUID();
    await call("/api/upload", "hr", 200, { method: "POST", body: form(htmlId, Buffer.from("<script>fictional</script>"), newFolder.id, "../../payload.html") });
    const html = await call(protectedDocumentUrl(htmlId), "hr", 200);
    assert.equal(html.headers.get("content-type"), "application/octet-stream");
    assert.match(html.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.equal((html.headers.get("content-disposition") ?? "").includes("../"), false);

    const invalidBefore = await fingerprint();
    await call("/api/employee-folder", "hr", 403, json(folderInput(), "https://untrusted.invalid"));
    await call("/api/employee-folder", "hr", 400, json({ ...folderInput(), employeeId: "invalid" }));
    await call("/api/employee-folder", "hr", 415, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
    await call("/api/upload", "hr", 400, { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=qa" }, body: "--qa\r\ninvalid" });
    await call("/api/upload", "hr", 415, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await call("/api/upload", "hr", 413, { method: "POST", body: form(randomUUID(), Buffer.alloc(MAX_DOCUMENT_BYTES + 1)) });
    await call("/api/upload", "hr", 409, { method: "POST", body: form(newFile, Buffer.from("changed"), newFolder.id) });
    await call("/api/zip", "hr", 400, json({ filePaths: [legacyPath] }));
    await call("/api/zip", "hr", 400, json({ fileIds: [fileA, fileA] }));
    await call("/api/zip", "hr", 400, json({ fileIds: ["../secret"] }));
    await call("/api/zip", "hr", 404, json({ fileIds: [randomUUID()] }));
    assert.deepEqual(await fingerprint(), invalidBefore, "Rejected HTTP payloads do not mutate rows or audit");

    // The same already-successful session must observe current account state on
    // its next request, without relying on a new browser or new cookie.
    await db.update(authAccounts).set({ status: "Disabled" }).where(eq(authAccounts.id, actor("hr").accountId));
    await call(protectedDocumentUrl(fileA), "hr", 401);
    await call(`/api/employees/${actor("employee").employeeId}/SalaryRateHistory`, "hr", 401);
    await db.update(authAccounts).set({ status: "Active" }).where(eq(authAccounts.id, actor("hr").accountId));
    await call(protectedDocumentUrl(fileA), "hr", 200);
    await db.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, actor("hr").sessionId));
    await call(protectedDocumentUrl(fileA), "hr", 401);
    await call("/api/zip", "hr", 401, json({ fileIds: [fileA] }));
  } catch (error) {
    failure = error;
  } finally {
    if (committed) {
      await db.transaction(async tx => {
        await tx.delete(adminAuditEvents).where(inArray(adminAuditEvents.actorUserId, accountIds));
        await tx.delete(employeeFolders).where(inArray(employeeFolders.employeeId, employeeIds));
        await tx.delete(employees).where(inArray(employees.id, employeeIds));
        await tx.delete(department).where(inArray(department.id, departmentIds));
      });
    }
    if (ownedLegacyFile) {
      const resolved = await realpath(legacyFile);
      assert.equal(path.dirname(resolved), privateDirectory, "Cleanup may only unlink the exact owned fixture in the private directory");
      assert.equal(hash(await readFile(resolved)), hash(pdf), "Refuse to remove an unexpectedly changed fixture file");
      await unlink(resolved);
    }
  }
  assert.deepEqual(await fingerprint(), before, "All public table row fingerprints must be restored after committed fixture cleanup");
  if (failure) throw failure;
  console.log(JSON.stringify({ passed: true, requests, tablesPreserved: tables.length, storedSessions: true, authStubs: false, database: "loopback restored copy", server: "loopback production build", fixtureCleanup: true, ownedLegacyFileRemoved: true }));
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "@/db";
import {
  adminAuditEvents, authAccounts, department, employeeFileContents,
  employeeFiles, employeeFolders, employees, employeesGeneralInfo,
} from "@/db/schema";
import { AUTH_GROUP_KEYS, getPermissionsForGroups } from "@/lib/auth/permissions";
import {
  DocumentError, MAX_DOCUMENT_BYTES, documentSha256, protectedDocumentUrl,
  safeDownloadName, type DocumentActor,
} from "@/lib/employee-documents/model";

// Only run against a restored local database. Runtime DB/service imports occur
// after these checks so development dotenv loading cannot replace this target.
async function main() {
  assert.equal(new URL(process.env.DATABASE_URL ?? "").hostname, "127.0.0.1",
    "Document write verification requires an isolated loopback database");
  assert.notEqual(process.env.NODE_ENV, "development", "Do not load development database credentials");
  const { db } = await import("@/db");
  const service = await import("@/lib/employee-documents/service");
  const tableRows = (await db.execute(sql`select tablename from pg_tables where schemaname = 'public' order by tablename`)).rows;
  const tables = tableRows.map(row => String(row.tablename));
  assert.ok(tables.includes("employee_file_contents"), "Apply the private-content migration to the restored copy first");
  const fingerprint = async (database: DbClient, names = tables) => (await database.execute(sql.raw(names.map(name => {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    const literal = name.replaceAll("'", "''");
    return `select '${literal}' as name,count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as hash from ${quoted} t`;
  }).join(" union all ") + " order by name"))).rows;
  const before = await fingerprint(db);
  const rollback = new Error("document verification rollback");
  let failure: unknown;
  let checks = 0;
  const expectError = async (operation: () => Promise<unknown>, status: number, label: string) => {
    await assert.rejects(operation, (error: unknown) => error instanceof DocumentError && error.status === status, label);
    checks += 1;
  };

  try {
    await db.transaction(async tx => {
      const suffix = randomUUID().slice(0, 8);
      const fixtureTime = new Date();
      const branches = await tx.insert(department).values([1, 2].map(index => ({
        name: `Document QA ${suffix} ${index}`, code: `DOC-${suffix}-${index}`,
      }))).returning();
      const people = await tx.insert(employees).values([1, 2].map(index => ({
        employeeNo: `DOC-${suffix}-${index}`, firstName: "Document", lastName: `Fixture ${index}`,
        createdAt: fixtureTime, updatedAt: fixtureTime,
      }))).returning();
      await tx.insert(employeesGeneralInfo).values(people.map((person, index) => ({
        employeeId: person.id, departmentId: branches[index].id, employmentStatus: "Regular" as const,
      })));
      const accounts = await tx.insert(authAccounts).values(people.map((person, index) => ({
        employeeId: person.id, email: `document-${suffix}-${index}@example.invalid`, status: "Active" as const,
      }))).returning();
      const hr: DocumentActor = { accountId: accounts[0].id, permissions: getPermissionsForGroups([AUTH_GROUP_KEYS.HR_ADMIN]) };
      const system: DocumentActor = { accountId: accounts[1].id, permissions: getPermissionsForGroups([AUTH_GROUP_KEYS.SYSTEM_ADMIN]) };
      const deniedActors = [
        { label: "Manager", actor: { accountId: accounts[0].id, permissions: getPermissionsForGroups([AUTH_GROUP_KEYS.MANAGER]) }, status: 403 },
        { label: "Employee", actor: { accountId: accounts[1].id, permissions: getPermissionsForGroups([AUTH_GROUP_KEYS.EMPLOYEE]) }, status: 403 },
        { label: "Missing account", actor: { accountId: "", permissions: hr.permissions }, status: 401 },
      ];
      const folderA = { id: randomUUID(), employeeId: people[0].id, folderName: "Fixture A", folderType: "Admin" as const, description: "Private QA", remarks: null };
      const folderB = { ...folderA, id: randomUUID(), employeeId: people[1].id, folderName: "Untouched neighbor" };
      await service.saveFolder(hr, folderA, tx);
      await service.saveFolder(system, folderB, tx);
      const pdf = Buffer.from("%PDF-1.7\nFictional employee document fixture\n%%EOF");
      const uploadA = { id: randomUUID(), groupId: folderA.id, fileName: "Fixture payroll", description: "Fictional", remarks: null, originalName: "fixture.pdf", bytes: pdf };
      const uploadB = { ...uploadA, id: randomUUID(), groupId: folderB.id, fileName: "Neighbor document" };
      const savedA = await service.saveUpload(hr, uploadA, tx);
      await service.saveUpload(system, uploadB, tx);
      assert.equal(savedA.filePath, protectedDocumentUrl(uploadA.id));
      assert.equal(savedA.mimeType, "application/pdf");
      const neighborBefore = {
        folder: await tx.select().from(employeeFolders).where(eq(employeeFolders.id, folderB.id)),
        file: await tx.select().from(employeeFiles).where(eq(employeeFiles.id, uploadB.id)),
        content: await tx.select().from(employeeFileContents).where(eq(employeeFileContents.fileId, uploadB.id)),
      };
      const expectedWriteTables = new Set(["employee_folder", "employee_files", "employee_file_contents", "admin_audit_events"]);
      const protectedTables = tables.filter(name => !expectedWriteTables.has(name));
      const protectedBefore = await fingerprint(tx, protectedTables);

      const denialBefore = await fingerprint(tx);
      for (const denied of deniedActors) {
        const actor = denied.actor;
        const operations = [
          () => service.readFolder(actor, folderA.id, tx),
          () => service.listFiles(actor, folderB.id, tx),
          () => service.readFile(actor, uploadA.id, tx),
          () => service.readContent(actor, uploadB.id, tx),
          () => service.readLegacyContent(actor, "/uploads/unknown.pdf", tx),
          () => service.saveFolder(actor, { ...folderA, id: randomUUID() }, tx),
          () => service.saveUpload(actor, { ...uploadA, id: randomUUID() }, tx),
          () => service.updateFile(actor, { id: uploadA.id, groupId: folderB.id, fileName: "Forbidden" }, tx),
          () => service.archiveFiles(actor, { groupId: folderB.id }, tx),
          () => service.archiveFolder(actor, folderA.id, tx),
          () => service.readFile(actor, "invalid-id", tx),
        ];
        for (const operation of operations) await expectError(operation, denied.status, `${denied.label} must be denied before object access`);
      }
      assert.deepEqual(await fingerprint(tx), denialBefore, "Denied requests cannot change any table, including audit history");

      for (const actor of [hr, system]) {
        for (const [folder, upload] of [[folderA, uploadA], [folderB, uploadB]] as const) {
          assert.equal((await service.readFolder(actor, folder.id, tx)).employeeId, folder.employeeId);
          assert.equal((await service.listFiles(actor, folder.id, tx))[0].id, upload.id);
          assert.equal((await service.readFile(actor, upload.id, tx)).filePath, protectedDocumentUrl(upload.id));
          const content = await service.readContent(actor, upload.id, tx);
          assert.deepEqual(content.bytes, pdf);
          assert.equal(content.mime, "application/pdf");
          assert.equal("contentBase64" in content.file, false, "Metadata never includes private bytes");
          checks += 1;
        }
      }

      const replayBefore = await fingerprint(tx);
      assert.deepEqual(await service.saveFolder(hr, folderA, tx), { id: folderA.id });
      assert.deepEqual(await service.saveUpload(system, uploadA, tx), savedA);
      assert.deepEqual(await fingerprint(tx), replayBefore, "Identical retry does not duplicate content or audit events");
      checks += 1;

      const conflictBefore = await fingerprint(tx);
      await expectError(() => service.saveFolder(hr, { ...folderA, employeeId: people[1].id }, tx), 409, "Folder ID cannot be reassigned");
      await expectError(() => service.saveUpload(hr, { ...uploadA, groupId: folderB.id }, tx), 409, "File ID cannot be reused in another folder");
      await expectError(() => service.saveUpload(hr, { ...uploadA, bytes: Buffer.from("%PDF-1.7\nChanged") }, tx), 409, "Changed bytes cannot masquerade as retry");
      await expectError(() => service.saveUpload(hr, { ...uploadA, fileName: "Changed metadata" }, tx), 409, "Changed metadata cannot masquerade as retry");
      await expectError(() => service.updateFile(hr, { id: uploadA.id, groupId: folderB.id, fileName: "Wrong group" }, tx), 409, "Metadata edit cannot move a file");
      await expectError(() => service.archiveFiles(hr, { id: uploadA.id, groupId: folderB.id }, tx), 400, "Ambiguous archive selector is rejected");
      await expectError(() => service.readFolder(hr, randomUUID(), tx), 404, "Forged folder ID");
      await expectError(() => service.readFile(hr, randomUUID(), tx), 404, "Forged file ID");
      await expectError(() => service.saveFolder(hr, { ...folderA, id: randomUUID(), employeeId: randomUUID() }, tx), 404, "Missing employee cannot own new folder");
      await expectError(() => service.saveUpload(hr, { ...uploadA, id: randomUUID(), groupId: randomUUID() }, tx), 404, "Missing folder cannot own new file");
      await expectError(() => service.saveUpload(hr, { ...uploadA, id: randomUUID(), bytes: Buffer.alloc(0) }, tx), 400, "Empty upload");
      await expectError(() => service.saveUpload(hr, { ...uploadA, id: randomUUID(), bytes: Buffer.alloc(MAX_DOCUMENT_BYTES + 1) }, tx), 413, "Oversized upload");
      await expectError(() => service.saveUpload(hr, { ...uploadA, id: randomUUID(), originalName: "header\r\ninjection.pdf" }, tx), 400, "Filename header injection");
      await expectError(() => service.updateFile(hr, { id: uploadA.id, fileName: "bad\u0000name" }, tx), 400, "Control character metadata");
      for (const legacyPath of ["/uploads/../secret", "/uploads/%2e%2e", "/uploads/C:\\secret", "https://example.invalid/x", "/uploads/x?download=1", "/uploads/missing.pdf"]) {
        await expectError(() => service.readLegacyContent(hr, legacyPath, tx), 404, "Legacy lookup cannot accept arbitrary paths or URLs");
      }
      assert.deepEqual(await fingerprint(tx), conflictBefore, "Failed validation/conflicts do not partially mutate documents or audit");

      await service.saveFolder(system, { ...folderA, folderName: "Reviewed folder" }, tx);
      assert.equal((await service.readFolder(hr, folderA.id, tx)).folderName, "Reviewed folder");
      checks += 1;

      const spoofedInput = {
        ...uploadA, id: randomUUID(), fileName: "Spoofed document", originalName: "../../invoice.pdf",
        bytes: Buffer.from("<script>fictional QA only</script>"),
        filePath: "/uploads/untrusted.html", mimeType: "application/pdf", fileSize: 1,
      };
      const spoofed = await service.saveUpload(hr, spoofedInput, tx);
      assert.equal(spoofed.filePath, protectedDocumentUrl(spoofed.id));
      assert.equal(spoofed.mimeType, "application/octet-stream");
      assert.equal(spoofed.fileSize, spoofedInput.bytes.length);
      assert.equal((await service.readContent(hr, spoofed.id, tx)).mime, "application/octet-stream");
      const downloadName = safeDownloadName("../../header\r\n\"name.pdf");
      assert.equal(/[\\/\r\n\"]/.test(downloadName), false);
      checks += 1;

      const storedA = (await tx.select().from(employeeFileContents).where(eq(employeeFileContents.fileId, uploadA.id)))[0];
      assert.equal(storedA.sha256, documentSha256(pdf));
      const metadataUpdate = { id: uploadA.id, groupId: folderA.id, fileName: "Reviewed fixture", description: "Reviewed description", remarks: "QA" };
      await service.updateFile(system, metadataUpdate, tx);
      const updateReplayBefore = await fingerprint(tx);
      await service.updateFile(hr, metadataUpdate, tx);
      assert.deepEqual(await fingerprint(tx), updateReplayBefore, "Repeated metadata update is a no-op");
      assert.deepEqual((await tx.select().from(employeeFileContents).where(eq(employeeFileContents.fileId, uploadA.id)))[0], storedA, "Metadata edits preserve original bytes");
      checks += 1;

      // Model a registered legacy alias backed by already-private bytes. Actual
      // filesystem migration/reachability is verified by the release workflow.
      const legacyInput = { ...uploadA, id: randomUUID(), fileName: "Legacy alias" };
      await service.saveUpload(hr, legacyInput, tx);
      const legacyPath = `/uploads/qa-${legacyInput.id}.pdf`;
      await tx.update(employeeFiles).set({ filePath: legacyPath }).where(eq(employeeFiles.id, legacyInput.id));
      const legacy = await service.readLegacyContent(system, legacyPath, tx);
      assert.equal(legacy.file.filePath, protectedDocumentUrl(legacyInput.id));
      assert.deepEqual(legacy.bytes, pdf);
      checks += 1;

      // Integrity errors are denied before returning bytes.
      await tx.update(employeeFileContents).set({ sha256: "0".repeat(64) }).where(eq(employeeFileContents.fileId, legacyInput.id));
      await expectError(() => service.readContent(hr, legacyInput.id, tx), 409, "Corrupted stored bytes/hash must be denied");
      await tx.update(employeeFileContents).set({ sha256: documentSha256(pdf) }).where(eq(employeeFileContents.fileId, legacyInput.id));

      await tx.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, people[0].id));
      await expectError(() => service.readFolder(hr, folderA.id, tx), 404, "Archived employee folder denied");
      await expectError(() => service.listFiles(hr, folderA.id, tx), 404, "Archived employee listing denied");
      await expectError(() => service.readContent(hr, uploadA.id, tx), 404, "Archived employee content denied");
      await expectError(() => service.readLegacyContent(hr, legacyPath, tx), 404, "Archived employee legacy alias denied");
      await expectError(() => service.saveUpload(hr, { ...uploadA, id: randomUUID() }, tx), 404, "Archived employee upload denied");
      await expectError(() => service.updateFile(hr, metadataUpdate, tx), 404, "Archived employee metadata edit denied");
      await tx.update(employees).set({ deletedAt: null, updatedAt: people[0].updatedAt }).where(eq(employees.id, people[0].id));

      await service.archiveFiles(hr, { id: uploadA.id }, tx);
      const singleArchiveBeforeRetry = await fingerprint(tx);
      assert.equal((await service.archiveFiles(system, { id: uploadA.id }, tx)).success, true);
      assert.deepEqual(await fingerprint(tx), singleArchiveBeforeRetry, "Single-file archive retry succeeds without changing rows or duplicating audit");
      checks += 1;
      assert.equal((await service.listFiles(hr, folderA.id, tx)).some(file => file.id === uploadA.id), false);
      await expectError(() => service.readContent(hr, uploadA.id, tx), 404, "Archived file content denied");
      await expectError(() => service.updateFile(hr, metadataUpdate, tx), 404, "Archived file edit denied");
      await expectError(() => service.saveUpload(hr, uploadA, tx), 409, "Archived upload ID cannot be reused");
      assert.deepEqual((await tx.select().from(employeeFileContents).where(eq(employeeFileContents.fileId, uploadA.id)))[0], storedA, "File archive retains private bytes");
      await service.archiveFiles(system, { groupId: folderA.id }, tx);
      assert.deepEqual(await service.listFiles(hr, folderA.id, tx), []);
      await expectError(() => service.readLegacyContent(hr, legacyPath, tx), 404, "Archived legacy alias denied");
      assert.equal((await tx.select().from(employeeFileContents).where(inArray(employeeFileContents.fileId, [uploadA.id, spoofed.id, legacyInput.id]))).length, 3, "Bulk archive retains every content row");

      const folderC = { ...folderA, id: randomUUID(), folderName: "Archive folder fixture" };
      await service.saveFolder(hr, folderC, tx);
      const uploadC = { ...uploadA, id: randomUUID(), groupId: folderC.id };
      await service.saveUpload(hr, uploadC, tx);
      await service.archiveFolder(system, folderC.id, tx);
      const folderArchiveBeforeRetry = await fingerprint(tx);
      assert.equal((await service.archiveFolder(hr, folderC.id, tx)).success, true);
      assert.deepEqual(await fingerprint(tx), folderArchiveBeforeRetry, "Folder archive retry succeeds without changing rows or duplicating audit");
      checks += 1;
      await expectError(() => service.readFolder(hr, folderC.id, tx), 404, "Archived folder denied");
      await expectError(() => service.listFiles(hr, folderC.id, tx), 404, "Archived folder listing denied");
      await expectError(() => service.readContent(hr, uploadC.id, tx), 404, "Archived folder child content denied");
      await expectError(() => service.saveUpload(hr, { ...uploadC, id: randomUUID() }, tx), 404, "Archived folder upload denied");
      await expectError(() => service.saveFolder(hr, folderC, tx), 409, "Archived folder ID cannot be reused");
      assert.equal((await tx.select().from(employeeFileContents).where(eq(employeeFileContents.fileId, uploadC.id))).length, 1, "Folder archive retains bytes");
      assert.ok((await tx.select().from(employeeFiles).where(eq(employeeFiles.id, uploadC.id)))[0].deletedAt);

      await tx.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, people[0].id));
      const deletedOwnerBeforeRetry = await fingerprint(tx);
      await expectError(() => service.archiveFiles(hr, { id: uploadA.id }, tx), 404, "Archived file retry is denied after employee deletion");
      await expectError(() => service.archiveFolder(system, folderC.id, tx), 404, "Archived folder retry is denied after employee deletion");
      assert.deepEqual(await fingerprint(tx), deletedOwnerBeforeRetry, "Denied archive retries leave audit and retained records unchanged");
      await tx.update(employees).set({ deletedAt: null, updatedAt: people[0].updatedAt }).where(eq(employees.id, people[0].id));

      const audits = await tx.select().from(adminAuditEvents).where(inArray(adminAuditEvents.actorUserId, accounts.map(account => account.id)));
      for (const action of ["folder_created", "folder_updated", "uploaded", "metadata_updated", "archived", "folder_archived"]) {
        assert.ok(audits.some(row => row.action === `employee_document.${action}`), `Audit records ${action}`);
      }
      assert.ok(audits.some(row => row.actorUserId === hr.accountId));
      assert.ok(audits.some(row => row.actorUserId === system.accountId));
      assert.equal(audits.some(row => row.details?.includes(pdf.toString("base64"))), false, "Audit must not contain document bytes");
      assert.deepEqual({
        folder: await tx.select().from(employeeFolders).where(eq(employeeFolders.id, folderB.id)),
        file: await tx.select().from(employeeFiles).where(eq(employeeFiles.id, uploadB.id)),
        content: await tx.select().from(employeeFileContents).where(eq(employeeFileContents.fileId, uploadB.id)),
      }, neighborBefore, "Other-department neighbor stays exact through conflicts/archives");
      assert.deepEqual(await fingerprint(tx, protectedTables), protectedBefore, "Document operations do not mutate payroll, attendance, schedules, account state or other tables");
      assert.equal((await tx.select().from(employeeFiles).where(and(eq(employeeFiles.id, uploadA.id), eq(employeeFiles.groupId, folderA.id)))).length, 1);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) failure = error;
  }
  assert.deepEqual(await fingerprint(db), before, "All public table row fingerprints are preserved after rollback, even on failure");
  if (failure) throw failure;
  console.log(JSON.stringify({ passed: true, checks, tablesPreserved: tables.length, database: "isolated loopback restored copy", writesRolledBack: true, filesystemWrites: false }));
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });

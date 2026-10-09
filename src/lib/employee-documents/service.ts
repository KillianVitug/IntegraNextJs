import "server-only";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type DbClient } from "@/db";
import { employeeFiles, employeeFileContents, employeeFolders, employeeFileTypeEnum, employees } from "@/db/schema";
import { recordAdminAuditEvent } from "@/lib/admin";
import {
  DocumentError, MAX_DOCUMENT_BYTES, documentExtension, documentSha256,
  legacyBasename, parseDocumentId, protectedDocumentUrl, requireDocumentActor,
  safeDocumentMime, validateDocumentBytes, type DocumentActor,
} from "./model";

export type { DocumentActor } from "./model";
type FileRow = typeof employeeFiles.$inferSelect;
type FolderRow = typeof employeeFolders.$inferSelect;
export type DocumentMetadata = FileRow;
export type DocumentContent = { file: DocumentMetadata; bytes: Buffer; mime: string };

const label = z.string().trim().min(1).max(255).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Use a name without control characters.");
const optionalText = z.string().max(10000).nullable().optional();
const fileMetadataSchema = z.object({ id: z.string().uuid(), groupId: z.string().uuid().optional(), fileName: label, description: optionalText, remarks: optionalText });
const folderSchema = z.object({ id: z.string().uuid(), employeeId: z.string().uuid(), folderName: label.max(100), folderType: z.enum(employeeFileTypeEnum.enumValues), description: optionalText, remarks: optionalText });
export type SaveFolderInput = z.input<typeof folderSchema>;
export type UpdateFileInput = z.input<typeof fileMetadataSchema>;
export type SaveUploadInput = Omit<UpdateFileInput, "groupId"> & { groupId: string; bytes: Buffer; originalName: string };

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new DocumentError(400, "Check the document or folder details.");
  return result.data;
}

function publicMetadata(row: FileRow): DocumentMetadata {
  return { ...row, filePath: protectedDocumentUrl(row.id) };
}

async function activeFolder(groupId: string, database: DbClient, includeArchived = false): Promise<FolderRow> {
  const [record] = await database.select({ folder: employeeFolders }).from(employeeFolders)
    .innerJoin(employees, eq(employeeFolders.employeeId, employees.id))
    .where(and(eq(employeeFolders.id, groupId), includeArchived ? undefined : isNull(employeeFolders.deletedAt), isNull(employees.deletedAt))).limit(1);
  if (!record) throw new DocumentError(404, "Folder not found.");
  return record.folder;
}

async function activeFile(id: string, database: DbClient, includeArchived = false): Promise<FileRow> {
  const [record] = await database.select({ file: employeeFiles }).from(employeeFiles)
    .innerJoin(employeeFolders, eq(employeeFiles.groupId, employeeFolders.id))
    .innerJoin(employees, eq(employeeFolders.employeeId, employees.id))
    .where(and(eq(employeeFiles.id, id), includeArchived ? undefined : isNull(employeeFiles.deletedAt), isNull(employeeFolders.deletedAt), isNull(employees.deletedAt))).limit(1);
  if (!record) throw new DocumentError(404, "Document not found.");
  return record.file;
}

async function lockEmployee(employeeId: string, database: DbClient) {
  const [employee] = await database.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt))).for("update").limit(1);
  if (!employee) throw new DocumentError(404, "Employee not found.");
}

/** Employee then folder is the shared order used by upload, edit and archive. */
async function lockFolder(groupId: string, database: DbClient, includeArchived = false) {
  const initial = await activeFolder(groupId, database, includeArchived);
  await lockEmployee(initial.employeeId, database);
  const [folder] = await database.select().from(employeeFolders)
    .where(and(eq(employeeFolders.id, groupId), includeArchived ? undefined : isNull(employeeFolders.deletedAt))).for("update").limit(1);
  if (!folder || folder.employeeId !== initial.employeeId) throw new DocumentError(409, "Folder ownership changed. Reload before saving.");
  return folder;
}

async function audit(actor: DocumentActor, database: DbClient, action: string, entityType: string, entityId: string, details?: Record<string, unknown>) {
  await recordAdminAuditEvent({ actorUserId: actor.accountId, action, entityType, entityId, details, database });
}

export async function readFolder(actor: DocumentActor, groupId: string, database: DbClient = db) {
  requireDocumentActor(actor);
  return activeFolder(parseDocumentId(groupId), database);
}

export async function listFiles(actor: DocumentActor, groupId: string, database: DbClient = db) {
  requireDocumentActor(actor);
  groupId = parseDocumentId(groupId);
  await activeFolder(groupId, database);
  const records = await database.select({ file: employeeFiles }).from(employeeFiles)
    .innerJoin(employeeFolders, eq(employeeFiles.groupId, employeeFolders.id))
    .innerJoin(employees, eq(employeeFolders.employeeId, employees.id))
    .where(and(eq(employeeFiles.groupId, groupId), isNull(employeeFiles.deletedAt), isNull(employeeFolders.deletedAt), isNull(employees.deletedAt)))
    .orderBy(asc(employeeFiles.createdAt), asc(employeeFiles.id));
  return records.map(row => publicMetadata(row.file));
}

export async function readFile(actor: DocumentActor, id: string, database: DbClient = db) {
  requireDocumentActor(actor);
  return publicMetadata(await activeFile(parseDocumentId(id), database));
}

async function legacyBytes(filePath: string) {
  const basename = legacyBasename(filePath);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const root = await realpath(path.join(process.cwd(), "private", "employee-files"));
    const target = await realpath(path.join(root, basename));
    const relative = path.relative(root, target);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new DocumentError(404, "Document not found.");
    }
    handle = await open(target, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) throw new DocumentError(404, "Document not found.");
    if (stat.size > MAX_DOCUMENT_BYTES) throw new DocumentError(413, "This document is too large for the protected download service.");
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size) throw new DocumentError(409, "Document changed while loading. Retry the download.");
    return bytes;
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError(404, "Document content is unavailable.");
  } finally {
    await handle?.close();
  }
}

async function contentFor(row: FileRow, database: DbClient): Promise<DocumentContent> {
  const [stored] = await database.select().from(employeeFileContents).where(eq(employeeFileContents.fileId, row.id)).limit(1);
  let bytes: Buffer;
  if (stored) {
    if (stored.size < 1 || stored.size > MAX_DOCUMENT_BYTES || stored.contentBase64.length > 4 * Math.ceil(MAX_DOCUMENT_BYTES / 3)) {
      throw new DocumentError(409, "Stored document integrity check failed.");
    }
    bytes = Buffer.from(stored.contentBase64, "base64");
    if (bytes.toString("base64") !== stored.contentBase64 || bytes.length !== stored.size || documentSha256(bytes) !== stored.sha256 || safeDocumentMime(bytes) !== stored.mimeType) {
      throw new DocumentError(409, "Stored document integrity check failed.");
    }
  } else {
    bytes = await legacyBytes(row.filePath);
  }
  const mime = safeDocumentMime(bytes);
  return { file: { ...publicMetadata(row), fileSize: bytes.length, mimeType: mime }, bytes, mime };
}

export async function readContent(actor: DocumentActor, id: string, database: DbClient = db): Promise<DocumentContent> {
  requireDocumentActor(actor);
  return contentFor(await activeFile(parseDocumentId(id), database), database);
}

export async function readLegacyContent(actor: DocumentActor, legacyPath: string, database: DbClient = db): Promise<DocumentContent> {
  requireDocumentActor(actor);
  legacyBasename(legacyPath);
  const records = await database.select({ file: employeeFiles }).from(employeeFiles)
    .innerJoin(employeeFolders, eq(employeeFiles.groupId, employeeFolders.id))
    .innerJoin(employees, eq(employeeFolders.employeeId, employees.id))
    .where(and(eq(employeeFiles.filePath, legacyPath), isNull(employeeFiles.deletedAt), isNull(employeeFolders.deletedAt), isNull(employees.deletedAt)))
    .orderBy(asc(employeeFiles.id)).limit(1);
  if (!records[0]) throw new DocumentError(404, "Document not found.");
  return contentFor(records[0].file, database);
}

export async function saveFolder(actor: DocumentActor, input: SaveFolderInput, database: DbClient = db) {
  requireDocumentActor(actor);
  const data = parse(folderSchema, input);
  return database.transaction(async tx => {
    await lockEmployee(data.employeeId, tx);
    const inserted = await tx.insert(employeeFolders).values({ ...data, description: data.description ?? null, remarks: data.remarks ?? null })
      .onConflictDoNothing({ target: employeeFolders.id }).returning({ id: employeeFolders.id });
    const [existing] = await tx.select().from(employeeFolders).where(eq(employeeFolders.id, data.id)).for("update").limit(1);
    if (!existing || existing.deletedAt || existing.employeeId !== data.employeeId) throw new DocumentError(409, "This folder ID cannot be reused or assigned to another employee.");
    const details = { folderName: data.folderName, folderType: data.folderType, description: data.description ?? null, remarks: data.remarks ?? null };
    if (!inserted.length) {
      const unchanged = existing.folderName === details.folderName && existing.folderType === details.folderType && existing.description === details.description && existing.remarks === details.remarks;
      if (unchanged) return { id: existing.id };
      await tx.update(employeeFolders).set(details).where(eq(employeeFolders.id, data.id));
    }
    await audit(actor, tx, inserted.length ? "employee_document.folder_created" : "employee_document.folder_updated", "employee_folder", data.id, { employeeId: data.employeeId });
    return { id: data.id };
  });
}

export async function saveUpload(actor: DocumentActor, input: SaveUploadInput, database: DbClient = db): Promise<DocumentMetadata> {
  requireDocumentActor(actor);
  const data = parse(fileMetadataSchema.extend({ groupId: z.string().uuid(), originalName: label }), input);
  validateDocumentBytes(input.bytes);
  const bytes = Buffer.from(input.bytes);
  const hash = documentSha256(bytes);
  const mime = safeDocumentMime(bytes);
  const extension = documentExtension(mime, data.originalName);
  return database.transaction(async tx => {
    await lockFolder(data.groupId, tx);
    const [prior] = await tx.select().from(employeeFiles).where(eq(employeeFiles.id, data.id)).for("update").limit(1);
    if (prior) {
      const [content] = await tx.select().from(employeeFileContents).where(eq(employeeFileContents.fileId, data.id)).limit(1);
      if (prior.deletedAt || prior.groupId !== data.groupId || !content || content.sha256 !== hash || content.size !== bytes.length || prior.fileName !== data.fileName || prior.description !== (data.description ?? null) || prior.remarks !== (data.remarks ?? null) || prior.fileExtension !== extension || prior.mimeType !== mime) {
        throw new DocumentError(409, "This upload ID was already used for a different document or metadata. Reload before retrying.");
      }
      return publicMetadata(prior);
    }
    const [file] = await tx.insert(employeeFiles).values({ id: data.id, groupId: data.groupId, fileName: data.fileName, description: data.description ?? null, remarks: data.remarks ?? null, filePath: protectedDocumentUrl(data.id), mimeType: mime, fileExtension: extension, fileSize: bytes.length })
      .onConflictDoNothing({ target: employeeFiles.id }).returning();
    if (!file) throw new DocumentError(409, "This upload ID is already in use. Reload before retrying.");
    await tx.insert(employeeFileContents).values({ fileId: data.id, contentBase64: bytes.toString("base64"), sha256: hash, size: bytes.length, mimeType: mime });
    await audit(actor, tx, "employee_document.uploaded", "employee_file", file.id, { groupId: data.groupId, size: bytes.length, sha256: hash });
    return publicMetadata(file);
  });
}

export async function updateFile(actor: DocumentActor, input: UpdateFileInput, database: DbClient = db) {
  requireDocumentActor(actor);
  const data = parse(fileMetadataSchema, input);
  return database.transaction(async tx => {
    const initial = await activeFile(data.id, tx);
    if (data.groupId && data.groupId !== initial.groupId) throw new DocumentError(409, "A document cannot be moved to another folder by editing its metadata.");
    await lockFolder(initial.groupId, tx);
    const existing = await activeFile(data.id, tx);
    const fields = { fileName: data.fileName, description: data.description ?? null, remarks: data.remarks ?? null };
    if (existing.fileName === fields.fileName && existing.description === fields.description && existing.remarks === fields.remarks) return { id: data.id };
    await tx.update(employeeFiles).set(fields).where(and(eq(employeeFiles.id, data.id), eq(employeeFiles.groupId, initial.groupId), isNull(employeeFiles.deletedAt)));
    await audit(actor, tx, "employee_document.metadata_updated", "employee_file", data.id, { groupId: initial.groupId });
    return { id: data.id };
  });
}

export async function archiveFiles(actor: DocumentActor, input: { groupId: string } | { id: string }, database: DbClient = db) {
  requireDocumentActor(actor);
  const data = parse(z.union([z.object({ groupId: z.string().uuid() }).strict(), z.object({ id: z.string().uuid() }).strict()]), input);
  return database.transaction(async tx => {
    const groupId = "groupId" in data ? data.groupId : (await activeFile(data.id, tx, true)).groupId;
    await lockFolder(groupId, tx);
    if ("id" in data) await activeFile(data.id, tx, true);
    const rows = await tx.update(employeeFiles).set({ deletedAt: new Date() })
      .where(and(eq(employeeFiles.groupId, groupId), isNull(employeeFiles.deletedAt), "id" in data ? eq(employeeFiles.id, data.id) : undefined)).returning({ id: employeeFiles.id });
    if (rows.length) await audit(actor, tx, "employee_document.archived", "employee_folder", groupId, { fileIds: rows.map(row => row.id) });
    return { success: true as const, message: `${rows.length} document(s) removed from active files. Retained content is no longer accessible through the document service.` };
  });
}

export async function archiveFolder(actor: DocumentActor, groupId: string, database: DbClient = db) {
  requireDocumentActor(actor);
  groupId = parseDocumentId(groupId);
  return database.transaction(async tx => {
    const folder = await lockFolder(groupId, tx, true);
    if (folder.deletedAt) return { success: true as const, message: "Folder and documents were already removed from active files." };
    const now = new Date();
    const files = await tx.update(employeeFiles).set({ deletedAt: now }).where(and(eq(employeeFiles.groupId, groupId), isNull(employeeFiles.deletedAt))).returning({ id: employeeFiles.id });
    await tx.update(employeeFolders).set({ deletedAt: now }).where(eq(employeeFolders.id, groupId));
    await audit(actor, tx, "employee_document.folder_archived", "employee_folder", groupId, { fileIds: files.map(row => row.id) });
    return { success: true as const, message: "Folder and documents removed from active files. Retained content is no longer accessible through the document service." };
  });
}

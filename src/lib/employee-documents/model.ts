import { createHash } from "node:crypto";
import { z } from "zod";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";

export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
export const MAX_ZIP_BYTES = MAX_DOCUMENT_BYTES;
export const MAX_ZIP_FILES = 20;

export class DocumentError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

export type DocumentActor = {
  accountId: string;
  permissions: readonly string[];
};

export function requireDocumentActor(actor: DocumentActor) {
  if (!actor?.accountId) throw new DocumentError(401, "Sign in to access employee documents.");
  if (!actor.permissions?.includes(AUTH_PERMISSIONS.FILES_MANAGE)) {
    throw new DocumentError(403, "Employee document access is not permitted.");
  }
}

export function parseDocumentId(value: unknown): string {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) throw new DocumentError(400, "A valid document or folder ID is required.");
  return result.data;
}

export function protectedDocumentUrl(id: string) {
  return `/api/employee-files/${parseDocumentId(id)}/content`;
}

export function documentSha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Client MIME and extensions never decide whether content may be rendered inline. */
export function safeDocumentMime(bytes: Buffer): string {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "application/octet-stream";
}

export function safeDownloadName(name: string) {
  const basename = String(name).split(/[\\/]/).pop() ?? "";
  // Keep display names useful while excluding header, control and path syntax.
  const safe = basename.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").replace(/[\ud800-\udfff]/gu, "_").trim().replace(/^\.+|[. ]+$/g, "");
  // Preserve complete code points so RFC 5987 encoding cannot fail on a split emoji.
  return Array.from(safe || "document").slice(0, 200).join("");
}

export function documentExtension(mime: string, originalName: string) {
  const known: Record<string, string> = {
    "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
  };
  if (known[mime]) return known[mime];
  const extension = safeDownloadName(originalName).split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]{1,20}$/.test(extension) && originalName.includes(".") ? extension : null;
}

/** Existing paths are exact aliases, never arbitrary filesystem or remote URLs. */
export function legacyBasename(legacyPath: string) {
  if (typeof legacyPath !== "string" || !legacyPath.startsWith("/uploads/")) {
    throw new DocumentError(404, "Document not found.");
  }
  const name = legacyPath.slice("/uploads/".length);
  if (!name || name === "." || name === ".." || /[\\/\u0000-\u001f\u007f%?#:]/.test(name)) {
    throw new DocumentError(404, "Document not found.");
  }
  return name;
}

export function validateDocumentBytes(bytes: Buffer) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new DocumentError(400, "Choose a non-empty document.");
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new DocumentError(413, "Documents must be 3 MiB or smaller.");
}

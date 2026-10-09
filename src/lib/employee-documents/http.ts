import { getCurrentAuthContext, hasPermission } from "@/lib/auth/server";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";
import { ZodError } from "zod";
import { DocumentError, MAX_DOCUMENT_BYTES, safeDownloadName } from "./model";
import type { DocumentActor, DocumentContent } from "./service";

export const documentHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie",
};
export async function currentDocumentActor(): Promise<DocumentActor> {
  const auth = await getCurrentAuthContext();
  if (!auth) throw new DocumentError(401, "Sign in to access employee documents.");
  if (!hasPermission(auth, AUTH_PERMISSIONS.FILES_MANAGE)) throw new DocumentError(403, "Employee file permission required.");
  return { accountId: auth.accountId, permissions: auth.permissions };
}
export async function documentRequest(request: Request, handle: (actor: DocumentActor) => Promise<Response>): Promise<Response> {
  try {
    const actor = await currentDocumentActor();
    const origin = request.headers.get("origin");
    // Next can construct an internal request URL with a different loopback host.
    // Browsers cannot override Host; compare Origin against the actual request host.
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get("host");
    if (requestHost) { requestUrl.port = ""; requestUrl.host = requestHost; }
    if (request.method !== "GET" && request.method !== "HEAD" && origin && origin !== requestUrl.origin) throw new DocumentError(403, "This request must come from this application.");
    const response = await handle(actor);
    for (const [key, value] of Object.entries(documentHeaders)) response.headers.set(key, value);
    return response;
  } catch (error) {
    const status = error instanceof DocumentError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 503;
    const message = error instanceof DocumentError ? error.message : status === 400 ? "Check the document selection and form values." : "The document request could not be completed. Retry or contact your administrator.";
    return Response.json({ error: message }, { status, headers: documentHeaders });
  }
}
async function boundedBody(request: Request, maximum: number) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) throw new DocumentError(413, "The request is too large. Maximum file size is 3 MiB.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) { await reader.cancel(); throw new DocumentError(413, "The request is too large. Maximum file size is 3 MiB."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks));
}
export async function documentJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DocumentError(415, "A JSON request is required.");
  return JSON.parse(new TextDecoder().decode(await boundedBody(request, 64 * 1024)));
}
export async function documentForm(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data;")) throw new DocumentError(415, "Select a file to upload.");
  const body = await boundedBody(request, MAX_DOCUMENT_BYTES + 128 * 1024);
  try {
    return await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new DocumentError(400, "The upload could not be read. Select the file and retry.");
  }
}
export function documentContentResponse(content: DocumentContent, download = false) {
  const name = safeDownloadName(content.file.fileName);
  const encodedName = encodeURIComponent(name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const inline = !download && /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/.test(content.mime);
  return new Response(new Uint8Array(content.bytes), { headers: {
    ...documentHeaders, "Content-Type": content.mime, "Content-Length": String(content.bytes.length),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodedName}`,
    "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'self'", "X-Frame-Options": "SAMEORIGIN",
  } });
}

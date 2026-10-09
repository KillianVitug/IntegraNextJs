import { File } from "node:buffer";
import { documentForm, documentRequest } from "@/lib/employee-documents/http";
import { DocumentError, MAX_DOCUMENT_BYTES } from "@/lib/employee-documents/model";
import { saveUpload } from "@/lib/employee-documents/service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return documentRequest(request, async actor => {
    const form = await documentForm(request);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new DocumentError(400, "Select a non-empty file to upload.");
    if (file.size > MAX_DOCUMENT_BYTES) throw new DocumentError(413, "Maximum file size is 3 MiB.");
    const field = (name: string) => {
      const value = form.get(name);
      if (value !== null && typeof value !== "string") throw new DocumentError(400, "Invalid upload fields.");
      return value;
    };
    const saved = await saveUpload(actor, {
      id: field("id") ?? "", groupId: field("groupId") ?? "", fileName: field("fileName") || file.name,
      description: field("description"), remarks: field("remarks"),
      bytes: Buffer.from(await file.arrayBuffer()), originalName: file.name,
    });
    return Response.json({ success: true, id: saved.id, filePath: saved.filePath, originalName: file.name, size: saved.fileSize, extension: saved.fileExtension, mime: saved.mimeType });
  });
}

import JSZip from "jszip";
import { z } from "zod";
import { documentJson, documentRequest } from "@/lib/employee-documents/http";
import { DocumentError, MAX_ZIP_BYTES, MAX_ZIP_FILES, safeDownloadName } from "@/lib/employee-documents/model";
import { readContent } from "@/lib/employee-documents/service";
export const runtime = "nodejs";
const selection = z.object({ fileIds: z.array(z.string().uuid()).min(1).max(MAX_ZIP_FILES) }).strict();
export async function POST(request: Request) {
  return documentRequest(request, async actor => {
    const { fileIds } = selection.parse(await documentJson(request));
    if (new Set(fileIds).size !== fileIds.length) throw new DocumentError(400, "Select each document only once.");
    const zip = new JSZip();
    let size = 0;
    for (const id of fileIds) {
      const content = await readContent(actor, id);
      size += content.bytes.length;
      if (size > MAX_ZIP_BYTES) throw new DocumentError(413, "Select fewer documents. ZIP downloads support up to 3 MiB of files.");
      zip.file(id + "-" + safeDownloadName(content.file.fileName), content.bytes);
    }
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return new Response(bytes, { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="employee-documents.zip"' } });
  });
}

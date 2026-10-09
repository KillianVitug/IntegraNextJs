import { documentContentResponse, documentRequest } from "@/lib/employee-documents/http";
import { DocumentError } from "@/lib/employee-documents/model";
import { readLegacyContent } from "@/lib/employee-documents/service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return documentRequest(request, async actor => {
    const parts = (await context.params).path;
    if (parts.length !== 1) throw new DocumentError(404, "Document not found.");
    return documentContentResponse(await readLegacyContent(actor, `/uploads/${parts[0]}`), new URL(request.url).searchParams.get("download") === "1");
  });
}

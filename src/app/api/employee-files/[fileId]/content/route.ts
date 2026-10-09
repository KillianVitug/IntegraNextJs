import { documentContentResponse, documentRequest } from "@/lib/employee-documents/http";
import { readContent } from "@/lib/employee-documents/service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  return documentRequest(request, async actor => documentContentResponse(await readContent(actor, (await context.params).fileId), new URL(request.url).searchParams.get("download") === "1"));
}

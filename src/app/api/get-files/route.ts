import { documentRequest } from "@/lib/employee-documents/http";
import { listFiles } from "@/lib/employee-documents/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return documentRequest(request, async actor => Response.json(await listFiles(actor, new URL(request.url).searchParams.get("groupId") ?? "")));
}

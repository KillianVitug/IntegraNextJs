import { documentJson, documentRequest } from "@/lib/employee-documents/http";
import { saveFolder } from "@/lib/employee-documents/service";
import { insertEmployeeFolderSchema } from "@/zod-schemas/employeeFolder";
export async function POST(request: Request) {
  return documentRequest(request, async actor => Response.json(await saveFolder(actor, insertEmployeeFolderSchema.parse(await documentJson(request)))));
}

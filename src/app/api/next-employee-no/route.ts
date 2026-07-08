// /app/api/next-employee-no/route.ts
import { getNextEmployeeNoPreview } from "@/lib/queries/getNextEmployeeNoPreview";
import { normalizeEmployeeType } from "@/utils/employeeCode";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const employeeType = normalizeEmployeeType(searchParams.get("type"));
    const next = await getNextEmployeeNoPreview(employeeType);

    return new Response(next, {
      headers: { "Content-Type": "text/plain" },
    });
  }

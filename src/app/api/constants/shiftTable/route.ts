import { NextResponse } from "next/server";
import { fetchShiftTables } from "@/lib/queries/fetchLookupData";
import { getCurrentAuthContext } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  const auth = await getCurrentAuthContext();
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "1";
  if ((auth.role !== "ADMIN" && auth.role !== "MANAGER") || (includeArchived && auth.role !== "ADMIN")) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403, headers });
  }
  const rows = await fetchShiftTables({ includeArchived, includeUsage: includeArchived });
  return NextResponse.json(rows, { headers });
}

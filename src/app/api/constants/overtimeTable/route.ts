import { NextResponse } from "next/server";
import { fetchOvertimeRules } from "@/lib/queries/fetchLookupData";

export async function GET() {
  const rows = await fetchOvertimeRules();
  return NextResponse.json(rows, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}

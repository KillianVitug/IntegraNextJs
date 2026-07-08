import { NextRequest, NextResponse } from "next/server";
import { fetchSssContributionBrackets } from "@/lib/queries/fetchLookupData";

export async function GET(request: NextRequest) {
  const versionId = Number(request.nextUrl.searchParams.get("versionId"));

  if (!Number.isInteger(versionId) || versionId <= 0) {
    return NextResponse.json([]);
  }

  const rows = await fetchSssContributionBrackets(versionId);
  return NextResponse.json(rows, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}

import { NextResponse } from "next/server";
import { fetchPositions } from "@/lib/queries/fetchLookupData";

export async function GET() {
  const positions = await fetchPositions();
  return NextResponse.json(positions, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}

import { NextResponse } from "next/server";
import { fetchLeaveTypes } from "@/lib/queries/fetchLookupData";

export async function GET() {
  const leaveTypeRows = await fetchLeaveTypes();
  return NextResponse.json(leaveTypeRows, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}

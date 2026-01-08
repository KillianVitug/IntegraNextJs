import { NextResponse } from "next/server";
import { fetchPositions } from "@/lib/queries/fetchLookupData";

export async function GET() {
  const positions = await fetchPositions();
  return NextResponse.json(positions);
}

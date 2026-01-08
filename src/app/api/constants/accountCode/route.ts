import { NextResponse } from "next/server";
import { fetchAccountCode } from "@/lib/queries/fetchLookupData";

export async function GET() {
  const departments = await fetchAccountCode();
  return NextResponse.json(departments);
}

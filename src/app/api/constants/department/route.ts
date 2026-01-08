import { NextResponse } from "next/server";
import { fetchDepartments } from "@/lib/queries/fetchLookupData";

export async function GET() {
  const departments = await fetchDepartments();
  return NextResponse.json(departments);
}

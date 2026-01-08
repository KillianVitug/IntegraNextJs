// src/app/api/get-file/route.ts
import { NextResponse } from "next/server";
import { getEmployeeFile } from "@/lib/queries/getEmployeeFiles";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId");

  if (!groupId) return NextResponse.json(null);

  const result = await getEmployeeFile(groupId);
  return NextResponse.json(result);
}


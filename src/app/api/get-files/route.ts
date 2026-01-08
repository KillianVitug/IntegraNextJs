// src/app/api/get-files/route.ts
import { NextResponse } from "next/server";
import { getFilesByGroup } from "@/lib/queries/getEmployeeFiles";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId");

  if (!groupId) return NextResponse.json([]);

  const files = await getFilesByGroup(groupId);
  return NextResponse.json(files);
}


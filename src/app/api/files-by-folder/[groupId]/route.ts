import { db } from "@/db";
import { employeeFiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: { groupId: string } }
) {
  const { groupId } = await params;

  const files = await db
    .select({
      filePath: employeeFiles.filePath,
    })
    .from(employeeFiles)
    .where(eq(employeeFiles.groupId, groupId));

  return new Response(JSON.stringify(files), {
    headers: { "Content-Type": "application/json" },
  });
}

import { db } from "@/db";
import { employeeFolders } from "@/db/schema";
import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";

export async function POST(req: Request) {
  const body = await req.json();

  const newId = uuid();

  const result = await db.insert(employeeFolders).values({
    id: newId,
    employeeId: body.employeeId,
    folderName: body.folderName,
    folderType: body.folderType,
    description: body.description,
    remarks: body.remarks,
  }).returning({ id: employeeFolders.id });

  return NextResponse.json({ id: result[0].id });
}

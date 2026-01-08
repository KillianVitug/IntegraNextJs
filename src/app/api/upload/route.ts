import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadDir = path.join(process.cwd(), "public/uploads");
    await mkdir(uploadDir, { recursive: true });

    const serverFileName = `${Date.now()}-${file.name}`;
    const filePath = path.join(uploadDir, serverFileName);

    await writeFile(filePath, buffer);

    return NextResponse.json({
      success: true,
      filePath: `/uploads/${serverFileName}`,
      originalName: file.name,
      size: file.size,
      extension: file.name.split(".").pop(),
      mime: file.type,
    });
  } catch (e) {
    console.error("UPLOAD ERROR:", e);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}

import JSZip from "jszip";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
const { files } = await req.json();
const zip = new JSZip();

for (const filePath of files) {
const fullPath = path.join(process.cwd(), "public", filePath);


if (!fs.existsSync(fullPath)) continue;

const data = fs.readFileSync(fullPath);
zip.file(path.basename(fullPath), data);


}

const buffer = await zip.generateAsync({ type: "nodebuffer" });

// Convert Buffer → Uint8Array
const uint8 = new Uint8Array(buffer);

return new Response(uint8, {
status: 200,
headers: {
"Content-Type": "application/zip",
"Content-Disposition": `attachment; filename="files.zip"`,
},
});
}

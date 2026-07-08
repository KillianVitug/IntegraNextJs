import { NextRequest, NextResponse } from "next/server";
import {
  EmployeeCsvImportError,
  importEmployeesFromCsv,
  parseCsv,
} from "@/app/actions/employeeCSVImport";
import { getCurrentAuthContext } from "@/lib/auth/server";

export async function POST(req: NextRequest) {
  try {
    const auth = await getCurrentAuthContext();
    if (!auth || auth.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file uploaded", errors: ["No file uploaded"] },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseCsv(buffer);
    const result = await importEmployeesFromCsv(rows);

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EmployeeCsvImportError) {
      return NextResponse.json(
        {
          success: false,
          error: err.message,
          errors: err.errors,
        },
        { status: 400 },
      );
    }

    console.error("CSV IMPORT ERROR:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Import failed",
        errors: [err instanceof Error ? err.message : "Import failed"],
      },
      { status: 500 },
    );
  }
}
  

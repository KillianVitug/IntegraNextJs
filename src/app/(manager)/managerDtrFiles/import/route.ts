import { NextRequest, NextResponse } from "next/server";
import { importManagerDtrLogsAction } from "@/app/actions/attendanceImportAction";

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function buildRedirectUrl(
  request: NextRequest,
  params: Record<string, string | number | null | undefined>,
) {
  const url = new URL("/managerDtrFiles", request.url);

  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

function redirectToDtr(
  request: NextRequest,
  params: Record<string, string | number | null | undefined>,
) {
  return NextResponse.redirect(buildRedirectUrl(request, params), 303);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const year = readText(formData, "year");
  const periodId = readText(formData, "periodId");
  const employeeId = readText(formData, "employeeId");
  const baseParams = {
    year,
    periodId,
    employeeId,
  };

  if (!periodId) {
    return redirectToDtr(request, {
      ...baseParams,
      importStatus: "missing-period",
    });
  }

  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length === 0) {
    return redirectToDtr(request, {
      ...baseParams,
      importStatus: "missing-files",
    });
  }

  let imported = 0;
  let denied = 0;

  for (const file of files) {
    try {
      const contentBase64 = Buffer.from(await file.arrayBuffer()).toString(
        "base64",
      );
      await importManagerDtrLogsAction({
        fileName: file.name,
        contentBase64,
        payrollPeriodId: periodId,
        replaceExisting: false,
      });
      imported += 1;
    } catch (error) {
      denied += 1;
      console.error("Manager DTR import failed:", error);
    }
  }

  return redirectToDtr(request, {
    ...baseParams,
    importStatus: denied > 0 ? "partial" : "success",
    imported,
    denied,
  });
}

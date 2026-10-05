import { NextRequest, NextResponse } from "next/server";
import {
  importManagerDtrLogsAction,
  refreshManagerAttendancePeriodSummariesAction,
} from "@/app/actions/attendanceImportAction";
import { buildRequestHostUrl } from "@/lib/http/redirect";

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function buildRedirectUrl(
  request: NextRequest,
  params: Record<string, string | number | null | undefined>,
) {
  const url = buildRequestHostUrl(request, "/managerDtrFiles");

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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Payroll recompute failed.";
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
  let unmatched = 0;
  let matched = 0;
  let payrollRecomputeStatus: string | null = null;
  let payrollRunNumber: number | null = null;
  let payrollRecomputeMessage: string | null = null;
  let importErrorMessage: string | null = null;

  for (const file of files) {
    try {
      const contentBase64 = Buffer.from(await file.arrayBuffer()).toString(
        "base64",
      );
      const result = await importManagerDtrLogsAction({
        fileName: file.name,
        contentBase64,
        payrollPeriodId: periodId,
        replaceExisting: false,
      });
      unmatched += result?.unmatchedRows ?? 0;
      matched += result?.matchedRows ?? 0;
      imported += 1;
    } catch (error) {
      denied += 1;
      importErrorMessage = getErrorMessage(error);
      console.error("Manager DTR import failed:", error);
    }
  }

  if (imported > 0 && matched > 0) {
    try {
      const refreshResult =
        await refreshManagerAttendancePeriodSummariesAction(periodId);
      payrollRecomputeStatus = refreshResult.payrollRecompute.status;
      payrollRunNumber = refreshResult.payrollRecompute.payrollRunNumber ?? null;
      payrollRecomputeMessage = refreshResult.payrollRecompute.message;
    } catch (error) {
      console.error("Manager DTR import payroll recompute failed:", error);
      payrollRecomputeStatus = "failed";
      payrollRecomputeMessage = getErrorMessage(error);
    }
  } else if (imported > 0) {
    payrollRecomputeStatus = "skipped";
    payrollRecomputeMessage =
      "Payroll recompute skipped because no matched DTR rows were imported.";
  } else if (denied > 0) {
    payrollRecomputeStatus = importErrorMessage?.includes("blocked")
      ? "blocked"
      : "failed";
    payrollRecomputeMessage =
      importErrorMessage ?? "DTR import failed before payroll recompute.";
  }

  return redirectToDtr(request, {
    ...baseParams,
    importStatus: imported === 0 && denied > 0 ? "failed" : denied > 0 ? "partial" : "success",
    imported,
    denied,
    unmatched,
    payrollRecomputeStatus,
    payrollRunNumber,
    payrollRecomputeMessage,
  });
}

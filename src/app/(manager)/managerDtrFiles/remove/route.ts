import { NextRequest, NextResponse } from "next/server";
import {
  revertManagerDtrImportBatchAction,
  syncManagerDtrPayrollPeriodAction,
} from "@/app/actions/attendanceImportAction";
import { buildRequestHostUrl } from "@/lib/http/redirect";

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function buildRedirectUrl(
  request: NextRequest,
  params: Record<string, string | number | null | undefined>
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
  params: Record<string, string | number | null | undefined>
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
  const batchId = readText(formData, "batchId");
  const baseParams = {
    year,
    periodId,
    employeeId,
  };

  if (!batchId) {
    return redirectToDtr(request, {
      ...baseParams,
      removeStatus: "missing-batch",
    });
  }

  try {
    const result = await revertManagerDtrImportBatchAction(batchId);
    let payrollRecomputeStatus: string | null = null;
    let payrollRunNumber: number | null = null;
    let payrollRecomputeMessage: string | null = null;

    if (periodId) {
      const payrollRecompute = await syncManagerDtrPayrollPeriodAction(
        periodId,
        { markStale: false }
      );
      payrollRecomputeStatus = payrollRecompute.status;
      payrollRunNumber = payrollRecompute.payrollRunNumber ?? null;
      payrollRecomputeMessage = payrollRecompute.message;
    }

    return redirectToDtr(request, {
      ...baseParams,
      removeStatus: "success",
      removedLogs: result.rawLogCount,
      removedSummaries: result.summaryCount,
      payrollRecomputeStatus,
      payrollRunNumber,
      payrollRecomputeMessage,
    });
  } catch (error) {
    console.error("Manager DTR import removal failed:", error);
    const errorMessage = getErrorMessage(error);
    return redirectToDtr(request, {
      ...baseParams,
      removeStatus: "failed",
      payrollRecomputeStatus: errorMessage.includes("blocked")
        ? "blocked"
        : "failed",
      payrollRecomputeMessage: errorMessage,
    });
  }
}

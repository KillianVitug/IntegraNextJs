import { NextRequest, NextResponse } from "next/server";
import {
  recomputeManagerDtrPayrollAction,
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
    return NextResponse.redirect(
      buildRedirectUrl(request, {
        ...baseParams,
        refreshStatus: "missing-period",
      }),
      303,
    );
  }

  try {
    const result = await refreshManagerAttendancePeriodSummariesAction(periodId);
    let payrollRecomputeStatus = "computed";
    let payrollRunNumber: number | null = null;
    let payrollRecomputeMessage: string | null = null;

    try {
      const payrollResult = await recomputeManagerDtrPayrollAction(periodId);
      payrollRunNumber = payrollResult.payrollRunNumber;
    } catch (error) {
      console.error("Manager DTR payroll recompute failed:", error);
      payrollRecomputeStatus = "failed";
      payrollRecomputeMessage = getErrorMessage(error);
    }

    return NextResponse.redirect(
      buildRedirectUrl(request, {
        ...baseParams,
        refreshStatus: "success",
        summaries: result.summaryCount,
        holdRefreshed: result.refreshedHoldApprovalCount,
        holdDeleted: result.deletedHoldApprovalCount,
        holdOverridesCleared: result.clearedManualHoldOverrideCount,
        payrollRecomputeStatus,
        payrollRunNumber,
        payrollRecomputeMessage,
      }),
      303,
    );
  } catch (error) {
    console.error("Manager DTR summary refresh failed:", error);
    return NextResponse.redirect(
      buildRedirectUrl(request, {
        ...baseParams,
        refreshStatus: "failed",
        payrollRecomputeStatus: "failed",
        payrollRecomputeMessage: getErrorMessage(error),
      }),
      303,
    );
  }
}

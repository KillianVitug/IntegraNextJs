import { NextRequest, NextResponse } from "next/server";
import { submitManagerAttendanceDtrHoldRowsAction } from "@/app/actions/attendanceImportAction";
import { buildRequestHostUrl } from "@/lib/http/redirect";

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readTextList(formData: FormData, name: string) {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readMinutes(formData: FormData, hoursName: string, minutesName: string) {
  const hoursText = readText(formData, hoursName);
  const minutesText = readText(formData, minutesName);
  const hours = hoursText === "" ? 0 : Number.parseInt(hoursText, 10);
  const minutes = minutesText === "" ? 0 : Number.parseInt(minutesText, 10);

  if (
    (hoursText !== "" && !/^\d+$/.test(hoursText)) ||
    (minutesText !== "" && !/^\d+$/.test(minutesText)) ||
    !Number.isSafeInteger(hours) ||
    !Number.isSafeInteger(minutes) ||
    minutes > 59
  ) {
    throw new Error("Enter non-negative whole-number hours and minutes from 0 to 59.");
  }

  return hours * 60 + minutes;
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

function summarizePayrollRecompute(
  recomputeResults: Array<{
    status: string;
    payrollRunNumber?: number | null;
    payrollPeriodCode: string | null;
    message: string;
  }> | undefined
) {
  const results = recomputeResults ?? [];
  if (results.length === 0) {
    return {
      status: "skipped",
      runNumber: null,
      message: "Payroll recompute skipped because no target payroll period changed.",
    };
  }

  const failed = results.find(
    (result) => result.status === "failed" || result.status === "blocked"
  );
  if (failed) {
    return {
      status: failed.status,
      runNumber: failed.payrollRunNumber ?? null,
      message: failed.message,
    };
  }

  const runNumbers = results
    .map((result) => result.payrollRunNumber)
    .filter((runNumber): runNumber is number => runNumber != null);

  return {
    status: "computed",
    runNumber: runNumbers[0] ?? null,
    message:
      results.length === 1
        ? results[0].message
        : `Payroll recomputed for ${results.length} affected period(s): ${results
            .map((result) => result.payrollPeriodCode)
            .filter(Boolean)
            .join(", ")}.`,
  };
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const year = readText(formData, "year");
  const periodId = readText(formData, "periodId");
  const selectedEmployeeId = readText(formData, "selectedEmployeeId");
  const employeeId = readText(formData, "employeeId");
  const targetPayrollPeriodId = readText(formData, "targetPayrollPeriodId");
  const baseParams = {
    year,
    periodId,
    employeeId: selectedEmployeeId,
  };

  try {
    const attendanceDates = readTextList(formData, "attendanceDates");

    if (!periodId) throw new Error("Select a payroll period first.");
    if (!employeeId) throw new Error("Select an employee first.");
    if (attendanceDates.length === 0) {
      throw new Error("No editable Attendance Hold dates were found.");
    }

    const result = await submitManagerAttendanceDtrHoldRowsAction({
      sourcePayrollPeriodId: periodId,
      targetPayrollPeriodId: targetPayrollPeriodId || periodId,
      employeeId,
      attendanceDates,
      workedMinutes: readMinutes(formData, "workedHours", "workedMinutes"),
      lateMinutes: readMinutes(formData, "lateHours", "lateMinutes"),
      undertimeMinutes: readMinutes(
        formData,
        "undertimeHours",
        "undertimeMinutes"
      ),
      overtimeMinutes: readMinutes(formData, "overtimeHours", "overtimeMinutes"),
    });
    const recompute = summarizePayrollRecompute(result.payrollRecompute);

    return NextResponse.redirect(
      buildRedirectUrl(request, {
        ...baseParams,
        holdStatus: "submitted",
        holdMessage: `Attendance Hold saved and approved for ${result.targetPayrollPeriodCode}.`,
        payrollRecomputeStatus: recompute.status,
        payrollRunNumber: recompute.runNumber,
        payrollRecomputeMessage: recompute.message,
      }),
      303
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unable to save Attendance Hold.";
    return NextResponse.redirect(
      buildRedirectUrl(request, {
        ...baseParams,
        holdEditEmployeeId: employeeId,
        holdStatus: "failed",
        holdMessage: errorMessage,
        payrollRecomputeStatus: errorMessage.includes("blocked")
          ? "blocked"
          : "failed",
        payrollRecomputeMessage: errorMessage,
      }),
      303
    );
  }
}

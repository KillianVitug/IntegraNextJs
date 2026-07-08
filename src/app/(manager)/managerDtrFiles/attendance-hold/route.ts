import { NextRequest, NextResponse } from "next/server";
import { submitManagerAttendanceDtrHoldRowsAction } from "@/app/actions/attendanceImportAction";

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
  const url = new URL("/managerDtrFiles", request.url);

  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const year = readText(formData, "year");
  const periodId = readText(formData, "periodId");
  const selectedEmployeeId = readText(formData, "selectedEmployeeId");
  const employeeId = readText(formData, "employeeId");
  const baseParams = {
    year,
    periodId,
    employeeId: selectedEmployeeId,
  };

  try {
    const targetPayrollPeriodId = readText(formData, "targetPayrollPeriodId");
    const attendanceDates = readTextList(formData, "attendanceDates");

    if (!periodId) throw new Error("Select a payroll period first.");
    if (!targetPayrollPeriodId) {
      throw new Error("Select a target payroll period before submitting.");
    }
    if (!employeeId) throw new Error("Select an employee first.");
    if (attendanceDates.length === 0) {
      throw new Error("No editable Attendance Hold dates were found.");
    }

    const result = await submitManagerAttendanceDtrHoldRowsAction({
      sourcePayrollPeriodId: periodId,
      targetPayrollPeriodId,
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

    return NextResponse.redirect(
      buildRedirectUrl(request, {
        ...baseParams,
        holdStatus: "submitted",
        holdMessage: `Attendance Hold submitted for ${result.targetPayrollPeriodCode}.`,
      }),
      303
    );
  } catch (error) {
    return NextResponse.redirect(
      buildRedirectUrl(request, {
        ...baseParams,
        holdEditEmployeeId: employeeId,
        holdStatus: "failed",
        holdMessage:
          error instanceof Error
            ? error.message
            : "Unable to submit Attendance Hold.",
      }),
      303
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { cancelManagerScheduleChangeRequest, submitManagerScheduleChangeRequest, updateManagerScheduleChangeRequest } from "@/app/actions/managerAction";
import { requireManager } from "@/lib/auth/server";
import { buildRequestHostUrl } from "@/lib/http/redirect";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

// These forms belonged to the retired editor. Reject before parsing payloads or
// entering any transaction: direct POSTs must not bypass the Schedules workflow.
async function retiredScheduleEditor() {
  await requireManager();
  return new NextResponse('<!doctype html><html lang="en"><meta charset="utf-8"><title>Schedule editor moved</title><body><h1>Schedule editor moved</h1><p>No schedule changes were saved. Use <a href="/schedules">Schedules (/schedules)</a> to review weekly defaults and period schedules.</p></body></html>', {
    status: 410,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
export async function saveWeeklyScheduleFromRequest(request: NextRequest) { void request; return retiredScheduleEditor(); }
export async function saveBulkWeeklyScheduleFromRequest(request: NextRequest) { void request; return retiredScheduleEditor(); }
export async function savePayrollPeriodScheduleFromRequest(request: NextRequest) { void request; return retiredScheduleEditor(); }
export async function deleteWeeklyScheduleFromRequest(request: NextRequest) { void request; return retiredScheduleEditor(); }
function redirectToManagerSchedules(
  request: NextRequest,
  args: {
    employeeId?: string;
    tab?: string;
    periodId?: string;
    status?: string;
    error?: unknown;
  },
) {
  const url = buildRequestHostUrl(request, "/managerSchedules");
  if (args.employeeId) url.searchParams.set("employeeId", args.employeeId);
  if (args.tab) url.searchParams.set("tab", args.tab);
  if (args.periodId) url.searchParams.set("periodId", args.periodId);
  if (args.status) url.searchParams.set("status", args.status);
  if (args.error) {
    url.searchParams.set(
      "error",
      args.error instanceof Error ? args.error.message : "Unable to save schedule.",
    );
  }

  return NextResponse.redirect(url, 303);
}

function parseEffectiveDates(formData: FormData) {
  return [
    ...new Set(
      formData
        .getAll("effectiveDates")
        .flatMap((value) =>
          typeof value === "string" ? value.split(/[\s,;]+/) : [],
        )
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function buildSchedulePayload(formData: FormData) {
  const effectiveDates = parseEffectiveDates(formData);
  const firstEffectiveDate = effectiveDates[0] ?? "";
  const lastEffectiveDate = effectiveDates[effectiveDates.length - 1] ?? "";

  return {
    employeeId: text(formData, "employeeId"),
    shiftTableId: Number(text(formData, "shiftTableId")),
    shiftSchedule: null,
    effectiveFrom: firstEffectiveDate,
    effectiveTo: lastEffectiveDate,
    effectiveDates,
    graceMinutes: 0,
    restDay: null,
    isFlexible: false,
  };
}

export async function saveScheduleRequestFromRequest(request: NextRequest) {
  const formData = await request.formData();
  const employeeId = text(formData, "employeeId");
  const requestId = text(formData, "requestId");

  try {
    if (requestId) {
      await updateManagerScheduleChangeRequest({
        requestId,
        payload: buildSchedulePayload(formData),
        reason: text(formData, "reason"),
      });
    } else {
      await submitManagerScheduleChangeRequest({
        action: "Create",
        payload: buildSchedulePayload(formData),
        reason: text(formData, "reason"),
      });
    }
  } catch (error) {
    return redirectToManagerSchedules(request, { employeeId, error });
  }

  return redirectToManagerSchedules(request, {
    employeeId,
    status: requestId ? "request-updated" : "request-created",
  });
}

export async function cancelScheduleRequestFromRequest(request: NextRequest) {
  const formData = await request.formData();
  const employeeId = text(formData, "employeeId");

  try {
    await cancelManagerScheduleChangeRequest({
      requestId: text(formData, "requestId"),
    });
  } catch (error) {
    return redirectToManagerSchedules(request, { employeeId, error });
  }

  return redirectToManagerSchedules(request, {
    employeeId,
    status: "request-cancelled",
  });
}

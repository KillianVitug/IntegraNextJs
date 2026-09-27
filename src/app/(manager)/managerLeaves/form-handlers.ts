import { NextRequest, NextResponse } from "next/server";
import {
  cancelManagerLeaveRecord,
  createManagerLeaveRecord,
  updateManagerLeaveRecord,
} from "@/app/actions/managerAction";
import { buildRequestHostUrl } from "@/lib/http/redirect";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function currentYear(formData: FormData) {
  const year = Number(text(formData, "year"));
  return Number.isInteger(year) && year >= 1900 && year <= 2100
    ? year
    : new Date().getFullYear();
}

function estimateDays(startDate: string, endDate: string) {
  if (!startDate) return 1;
  const start = new Date(`${startDate}T00:00:00`);
  const end = endDate ? new Date(`${endDate}T00:00:00`) : start;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;

  const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return diff > 0 ? diff : 1;
}

function redirectToManagerLeaves(
  request: NextRequest,
  args: {
    year: number;
    status?: string;
    error?: unknown;
  },
) {
  const url = buildRequestHostUrl(request, "/managerLeaves");
  url.searchParams.set("year", String(args.year));
  if (args.status) url.searchParams.set("status", args.status);
  if (args.error) {
    url.searchParams.set(
      "error",
      args.error instanceof Error ? args.error.message : "Unable to save request.",
    );
  }

  return NextResponse.redirect(url, 303);
}

function buildLeavePayload(formData: FormData) {
  const leaveStartDate = text(formData, "leaveStartDate");
  const leaveEndDate = text(formData, "leaveEndDate");

  return {
    employeeId: text(formData, "employeeId"),
    dateFiled: text(formData, "dateFiled"),
    leaveStartDate,
    leaveEndDate,
    leaveType: text(formData, "leaveType"),
    noOfDays: estimateDays(leaveStartDate, leaveEndDate),
    dayPart: "FullDay" as const,
    reason: text(formData, "reason"),
  };
}

export async function saveLeaveRequestFromRequest(request: NextRequest) {
  const formData = await request.formData();
  const year = currentYear(formData);
  const id = text(formData, "id");

  try {
    if (id) {
      await updateManagerLeaveRecord({
        ...buildLeavePayload(formData),
        id,
      });
    } else {
      await createManagerLeaveRecord(buildLeavePayload(formData));
    }
  } catch (error) {
    return redirectToManagerLeaves(request, { year, error });
  }

  return redirectToManagerLeaves(request, {
    year,
    status: id ? "updated" : "created",
  });
}

export async function cancelLeaveRequestFromRequest(request: NextRequest) {
  const formData = await request.formData();
  const year = currentYear(formData);

  try {
    await cancelManagerLeaveRecord(Number(text(formData, "id")));
  } catch (error) {
    return redirectToManagerLeaves(request, { year, error });
  }

  return redirectToManagerLeaves(request, { year, status: "cancelled" });
}

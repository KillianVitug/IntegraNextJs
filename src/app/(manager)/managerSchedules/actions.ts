"use server";

import { redirect } from "next/navigation";
import {
  cancelManagerScheduleChangeRequest,
  submitManagerScheduleChangeRequest,
  updateManagerScheduleChangeRequest,
} from "@/app/actions/managerAction";
import {
  deleteEmployeeWeeklyShiftPattern,
  saveEmployeeWeeklyShiftPattern,
} from "@/app/actions/shiftAssignmentAction";

const WEEKDAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function maybeNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function managerSchedulesRedirect(args: {
  employeeId: string;
  status?: string;
  error?: unknown;
}) {
  const params = new URLSearchParams();
  if (args.employeeId) params.set("employeeId", args.employeeId);
  if (args.status) params.set("status", args.status);
  if (args.error) {
    params.set(
      "error",
      args.error instanceof Error ? args.error.message : "Unable to save schedule.",
    );
  }

  const query = params.toString();
  redirect(query ? `/managerSchedules?${query}` : "/managerSchedules");
}

function parseEffectiveDates(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function buildSchedulePayload(formData: FormData) {
  const effectiveDates = parseEffectiveDates(text(formData, "effectiveDates"));
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

export async function saveManagerWeeklyPatternFromForm(formData: FormData) {
  const employeeId = text(formData, "employeeId");

  try {
    await saveEmployeeWeeklyShiftPattern({
      id: maybeNumber(text(formData, "id")),
      employeeId,
      effectiveFrom: text(formData, "effectiveFrom"),
      effectiveTo: text(formData, "effectiveTo") || null,
      days: WEEKDAY_ORDER.map((weekday) => ({
        weekday,
        shiftTableId: maybeNumber(text(formData, `day-${weekday}`)) ?? null,
      })),
    });
  } catch (error) {
    managerSchedulesRedirect({ employeeId, error });
  }

  managerSchedulesRedirect({ employeeId, status: "weekly-saved" });
}

export async function deleteManagerWeeklyPatternFromForm(formData: FormData) {
  const employeeId = text(formData, "employeeId");

  try {
    await deleteEmployeeWeeklyShiftPattern({ id: text(formData, "id") });
  } catch (error) {
    managerSchedulesRedirect({ employeeId, error });
  }

  managerSchedulesRedirect({ employeeId, status: "weekly-deleted" });
}

export async function submitManagerScheduleRequestFromForm(formData: FormData) {
  const employeeId = text(formData, "employeeId");

  try {
    await submitManagerScheduleChangeRequest({
      action: "Create",
      payload: buildSchedulePayload(formData),
      reason: text(formData, "reason"),
    });
  } catch (error) {
    managerSchedulesRedirect({ employeeId, error });
  }

  managerSchedulesRedirect({ employeeId, status: "request-created" });
}

export async function updateManagerScheduleRequestFromForm(formData: FormData) {
  const employeeId = text(formData, "employeeId");

  try {
    await updateManagerScheduleChangeRequest({
      requestId: text(formData, "requestId"),
      payload: buildSchedulePayload(formData),
      reason: text(formData, "reason"),
    });
  } catch (error) {
    managerSchedulesRedirect({ employeeId, error });
  }

  managerSchedulesRedirect({ employeeId, status: "request-updated" });
}

export async function cancelManagerScheduleRequestFromForm(formData: FormData) {
  const employeeId = text(formData, "employeeId");

  try {
    await cancelManagerScheduleChangeRequest({
      requestId: text(formData, "requestId"),
    });
  } catch (error) {
    managerSchedulesRedirect({ employeeId, error });
  }

  managerSchedulesRedirect({ employeeId, status: "request-cancelled" });
}

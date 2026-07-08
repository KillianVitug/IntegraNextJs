"use server";

import { redirect } from "next/navigation";
import {
  cancelManagerLeaveRecord,
  createManagerLeaveRecord,
  updateManagerLeaveRecord,
} from "@/app/actions/managerAction";

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

function managerLeavesRedirect(args: {
  year: number;
  status?: string;
  error?: unknown;
}) {
  const params = new URLSearchParams({ year: String(args.year) });
  if (args.status) params.set("status", args.status);
  if (args.error) {
    params.set(
      "error",
      args.error instanceof Error ? args.error.message : "Unable to save request.",
    );
  }

  redirect(`/managerLeaves?${params.toString()}`);
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

export async function createManagerLeaveRecordFromForm(formData: FormData) {
  const year = currentYear(formData);

  try {
    await createManagerLeaveRecord(buildLeavePayload(formData));
  } catch (error) {
    managerLeavesRedirect({ year, error });
  }

  managerLeavesRedirect({ year, status: "created" });
}

export async function updateManagerLeaveRecordFromForm(formData: FormData) {
  const year = currentYear(formData);

  try {
    await updateManagerLeaveRecord({
      ...buildLeavePayload(formData),
      id: text(formData, "id"),
    });
  } catch (error) {
    managerLeavesRedirect({ year, error });
  }

  managerLeavesRedirect({ year, status: "updated" });
}

export async function cancelManagerLeaveRecordFromForm(formData: FormData) {
  const year = currentYear(formData);

  try {
    await cancelManagerLeaveRecord(Number(text(formData, "id")));
  } catch (error) {
    managerLeavesRedirect({ year, error });
  }

  managerLeavesRedirect({ year, status: "cancelled" });
}

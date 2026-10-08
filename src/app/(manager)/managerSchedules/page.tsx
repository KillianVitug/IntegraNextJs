import { redirect } from "next/navigation";
import { requireManager } from "@/lib/auth/server";

export const metadata = { title: "Schedules" };

export default async function ScheduleEntry({searchParams}: {
  searchParams: Promise<{employeeId?: string; periodId?: string; day?: string}>;
}) {
  await requireManager({redirectTo: "/"});
  const params = await searchParams;
  const query = new URLSearchParams({view: "period"});
  if (params.employeeId) query.set("employeeId", params.employeeId);
  if (params.periodId) query.set("periodId", params.periodId);
  if (params.day) query.set("day", params.day);
  redirect("/schedules?" + query.toString());
}
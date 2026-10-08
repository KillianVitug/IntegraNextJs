import { desc } from "drizzle-orm";
import { db } from "@/db";
import { payrollPeriods, department } from "@/db/schema";
import { requirePermission } from "@/lib/auth/server";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";
import { ProvisionalWorkspace } from "./provisional-workspace";

export const metadata = { title: "Provisional payroll" };
export const maxDuration = 60;
export default async function ProvisionalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission(AUTH_PERMISSIONS.PAYROLL_COMPUTE);
  const params = await searchParams;
  const [periods, departments] = await Promise.all([
    db.select({ id: payrollPeriods.id, code: payrollPeriods.code, startDate: payrollPeriods.startDate, endDate: payrollPeriods.endDate }).from(payrollPeriods).orderBy(desc(payrollPeriods.startDate)),
    db.select({ id: department.id, name: department.name }).from(department),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const defaultPeriod = periods.find(period => period.id === params.periodId) ?? periods.find(period => period.startDate <= today && period.endDate >= today) ?? periods[0];
  return <ProvisionalWorkspace periods={periods} departments={departments} initial={{ ...params, periodId: defaultPeriod?.id ?? "" }} today={today} />;
}

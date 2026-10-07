import { requireAdminActor } from "@/lib/admin";
import { db } from "@/db";
import { payrollPeriods, payrollRuns } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { runPayrollGroup } from "@/lib/payroll/payrollGroupModel";
import { PayrollOutputsPageClient } from "./PayrollOutputsPageClient";

export const metadata = {
  title: "Payroll Outputs",
};

export default async function PayrollOutputsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  await requireAdminActor();
  const params = await searchParams;
  const uuid = /^[0-9a-f-]{36}$/i;
  const periodId = params.periodId && uuid.test(params.periodId) ? params.periodId : null;
  const group = params.group === "Monthly" ? "Monthly" : "Daily";
  const run = periodId ? await db.query.payrollRuns.findFirst({
    where: and(eq(payrollRuns.payrollPeriodId, periodId), params.runId && uuid.test(params.runId) ? eq(payrollRuns.id, params.runId) : sql`${payrollRuns.inputSnapshot}->>'payrollGroup'=${group}`),
    orderBy: desc(payrollRuns.runNumber), with: {payrollPeriod: true},
  }) : undefined;
  const period = run?.payrollPeriod ?? (periodId ? await db.query.payrollPeriods.findFirst({where: eq(payrollPeriods.id, periodId)}) : null);
  const selectedPeriod = period ? {id: period.id, code: period.code, startDate: period.startDate, endDate: period.endDate, adjustedPayDate: period.adjustedPayDate, nominalPayDate: period.nominalPayDate, cycle: period.cycle, status: period.status} : null;
  const selectedRun = run ? {id: run.id, runNumber: run.runNumber, status: run.status, notes: run.notes, computedAt: run.computedAt?.toISOString() ?? null, reviewedAt: run.reviewedAt?.toISOString() ?? null, approvedAt: run.approvedAt?.toISOString() ?? null, postedAt: run.postedAt?.toISOString() ?? null, createdAt: run.createdAt.toISOString(), payrollPeriod: selectedPeriod, payrollGroup: runPayrollGroup(run.inputSnapshot)} : null;

  return (
    <PayrollOutputsPageClient
      selectedPeriod={selectedPeriod}
      selectedRun={selectedRun}
    />
  );
}

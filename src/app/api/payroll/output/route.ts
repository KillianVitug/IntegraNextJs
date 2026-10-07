import { employeeShortfallAmounts, priorShortfallBalance, shortfallPolicyText } from "@/lib/payroll/shortfallModel";
import { getCurrentAuthContext, hasPermission } from "@/lib/auth/server";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";
import { db } from "@/db";
import { payrollArtifacts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getPayrollRegister } from "@/lib/payroll/reports";
import { runPayrollGroup } from "@/lib/payroll/payrollGroupModel";
import { payrollCsv } from "@/lib/payroll/paymentModel";
import { renderPayslips } from "@/lib/payroll/payslipPdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const auth = await getCurrentAuthContext();
  if (!auth) return Response.json({error: "Sign in to download payroll."}, {status: 401, headers});
  if (auth.role !== "ADMIN" || !hasPermission(auth, AUTH_PERMISSIONS.PAYROLL_EXPORT)) return Response.json({error: "Payroll export permission required."}, {status: 403, headers});
  const params = new URL(request.url).searchParams, runId = params.get("runId") ?? "", format = params.get("format"), employeeId = params.get("employeeId") ?? undefined;
  if (!uuid.test(runId) || employeeId && !uuid.test(employeeId)) return Response.json({error: "Invalid payroll selection."}, {status: 400, headers});
  try {
    const run = await getPayrollRegister(runId);
    if (!run) return Response.json({error: "Payroll run not found."}, {status: 404, headers});
    const prefix = `${run.payrollPeriod?.code ?? "payroll"}-${runPayrollGroup(run.inputSnapshot)}-run${run.runNumber}-${run.status}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (format === "payslips") {
      if (employeeId && !run.employees.some(employee => employee.employeeId === employeeId)) return Response.json({error: "Employee not in this run."}, {status: 404, headers});
      return new Response(new Uint8Array(await renderPayslips(run, employeeId)), {headers: {...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${prefix}-payslips.pdf"`}});
    }
    let csv: string;
    if (format === "register") {
      csv = payrollCsv([["Period", "Group", "Run", "Status", "Employee number", "Employee name", "Gross PHP", "Deductions PHP", "Calculated net PHP", "Payment PHP", "Shortfall PHP", "Deducted from earnings PHP", "Prior shortfall recovered PHP", "Prior balance remaining PHP", "Shortfall policy"],
        ...run.employees.sort((a,b) => a.employeeNoSnapshot.localeCompare(b.employeeNoSnapshot)).map(employee => [run.payrollPeriod?.code ?? "", runPayrollGroup(run.inputSnapshot), String(run.runNumber), run.status, employee.employeeNoSnapshot, employee.employeeNameSnapshot, Number(employee.grossPay), Number(employee.totalDeductions), Number(employee.netPay), Math.max(0, Number(employee.netPay)), Math.max(0, -Number(employee.netPay)), employeeShortfallAmounts(employee).collected, employeeShortfallAmounts(employee).recovered, Math.max(0, priorShortfallBalance(run.inputSnapshot, employee.employeeId) - employeeShortfallAmounts(employee).recovered), shortfallPolicyText(run.inputSnapshot, run.status, run.runType)])]);
    } else if (format === "payment") {
      const artifactId = params.get("artifactId") ?? "";
      if (!uuid.test(artifactId)) return Response.json({error: "Prepare a payment list first."}, {status: 400, headers});
      if (!["Approved", "Posted"].includes(run.status)) return Response.json({error: "This run is no longer approved. Review it before using payment files."}, {status: 409, headers});
      const artifact = await db.query.payrollArtifacts.findFirst({where: and(eq(payrollArtifacts.id, artifactId), eq(payrollArtifacts.payrollRunId, run.id))});
      if (!artifact || !["BankFile", "CashPayrollList"].includes(artifact.kind) || typeof artifact.metadata?.paymentListCsv !== "string") return Response.json({error: "This historical artifact has no downloadable file. Prepare a new payment list."}, {status: 404, headers});
      csv = artifact.metadata.paymentListCsv;
    } else return Response.json({error: "Unknown payroll output."}, {status: 400, headers});
    return new Response(csv, {headers: {...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${prefix}-${format}.csv"`}});
  } catch {
    return Response.json({error: "Download failed. Payroll is unchanged; retry this download."}, {status: 503, headers});
  }
}

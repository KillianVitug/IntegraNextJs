"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { PAYROLL_SECTION_PATHS, type PayrollSection } from "./sections";
import { payrollContextHref } from "@/lib/payroll/navigation";

const linkClass = "inline-flex min-h-11 items-center rounded-md border px-3 py-2 text-sm font-medium";

/** One navigation vocabulary. View context stays in the URL, never in global state. */
export function PayrollWorkspaceNav({ activeSection, context }: { activeSection: PayrollSection; context?: Record<string, string | undefined> }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const query = new URLSearchParams(searchParams.toString());
    let changed = false;
    for (const key of ["year", "periodId", "group", "runId"]) {
      const value = context?.[key];
      if (value && !query.get(key)) { query.set(key, value); changed = true; }
    }
    if (changed) window.history.replaceState(null, "", `${window.location.pathname}?${query}${window.location.hash}`);
  }, [context, searchParams]);
  function href(section: PayrollSection) {
    return payrollContextHref(PAYROLL_SECTION_PATHS[section], searchParams.toString(), context);
  }
  function item(section: PayrollSection, label: string, active = activeSection === section) {
    return <Link key={section} href={href(section)} aria-current={active ? "page" : undefined} className={`${linkClass} ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>{label}</Link>;
  }
  return <nav aria-label="Payroll workspaces" className="space-y-2">
    <div className="flex flex-wrap gap-2">
      {item("estimate", "Estimate")}
      {item("run", "Review & finalize")}
      {item("outputs", "Reports & payslips", activeSection === "outputs" || activeSection === "report")}
    </div>
    {(activeSection === "outputs" || activeSection === "report") && <div className="flex flex-wrap gap-2" aria-label="Reports and outputs">{item("outputs", "Payslips & payment lists")}{item("report", "Detailed reports")}</div>}
    <details className="rounded-md border p-2" open={["manual", "accountCodes", "attendance", "attendanceHold", "attendanceBatch"].includes(activeSection) || undefined}>
      <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium">Payroll adjustments</summary>
      <div className="flex flex-wrap gap-2 pt-2">{item("attendanceBatch", "Batch changes & history")}{item("accountCodes", "Add earnings or deductions")}{item("attendance", "Attendance details & totals")}{item("attendanceHold", "Held-time decisions")}{item("manual", "Replace employee payroll")}</div>
      <p className="mt-2 text-xs text-muted-foreground">Attendance facts, total-time adjustments and full payroll replacement are separate decisions.</p>
    </details>
    <details className="rounded-md border p-2" open={["settings", "specialRun", "attendanceSources"].includes(activeSection) || undefined}>
      <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium">Advanced & settings</summary>
      <div className="flex flex-wrap gap-2 pt-2">{item("attendanceSources", "Attendance sources")}{item("specialRun", "Special runs")}{item("settings", "Payroll setup")}<Link className={linkClass} href="/constants/accountCode/form">Account-code definitions</Link></div>
    </details>
  </nav>;
}

type Props = { context?: Record<string, string | undefined>; activeSection: PayrollSection; title: string; description: string; periodCode?: string | null; runLabel?: string | null };
export function PayrollPageNav({ context, activeSection, title, description, periodCode, runLabel }: Props) {
  return <div className="space-y-4">
    <PayrollWorkspaceNav activeSection={activeSection} context={context}/>
    <div className="space-y-2"><h1 className="text-2xl font-bold">{title}</h1><p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span className="rounded-md border px-2 py-1">Period: {periodCode ?? "Not selected"}</span><span className="rounded-md border px-2 py-1">Run: {runLabel ?? "No run"}</span></div>
    </div>
  </div>;
}

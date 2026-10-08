"use client";
import { File } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { NavButtonMenu } from "./NavButtonMenu";
import { payrollContextHref } from "@/lib/payroll/navigation";

export function PayrollHeaderMenu({ attendanceEnabled }: { attendanceEnabled: boolean }) {
  const pathname = usePathname(), params = useSearchParams();
  function href(path: string) {
    return payrollContextHref(path, pathname.startsWith("/payroll") || pathname === "/schedules" ? params.toString() : "");
  }
  return <NavButtonMenu icon={File} label="Payroll" aria-label="Payroll menu" choices={[
    { title: "Estimate", href: href("/payroll/provisional") },
    { title: "Review & finalize", href: href("/payroll") },
    { title: "Reports & payslips", href: href("/payroll/outputs") },
    ...(attendanceEnabled ? [{ title: "Attendance sources", href: href("/payroll/attendance-sources") }, { title: "Batch changes & history", href: href("/payroll/attendance-batch") }] : []),
  ]}/>;
}

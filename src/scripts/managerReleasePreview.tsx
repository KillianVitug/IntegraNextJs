import { createRoot } from "react-dom/client";
import { ManagerDashboard } from "@/app/(manager)/managerHome/dashboard";
import { ManagerMobileNav } from "@/app/(manager)/ManagerMobileNav";
import { ManagerLeaveForm } from "@/app/(manager)/managerLeaves/ManagerLeaveForm";
import { ManagerProvisionalWorkspace } from "@/app/(manager)/managerProvisional/workspace";
import { fixtureEmployees, fixtureLeaveTypes, fixtureOverview } from "./attendanceTest/managerReleaseFixture";

const params = new URLSearchParams(location.search);
const overview = structuredClone(fixtureOverview);
if (params.has("employeeId")) {
  overview.employees = overview.employees.filter(employee => employee.employeeId === params.get("employeeId"));
  overview.issues = overview.issues.filter(issue => issue.employeeId === params.get("employeeId"));
  overview.counts = { ...overview.counts, employees: overview.employees.length, actionEmployees: overview.employees.length, actionDays: overview.employees.length,
    punchProblemDays: overview.issues.filter(issue => issue.code === "punches").length,
    scheduledNoAttendanceDays: overview.issues.filter(issue => issue.code === "scheduled-no-attendance").length };
}
if (params.get("case") === "empty") { overview.employees = []; overview.issues = []; overview.counts = { employees: 0, actionDays: 0, actionEmployees: 0, scheduledNoAttendanceDays: 0, punchProblemDays: 0, scheduleProblemDays: 0, heldDays: 0, overtimeDays: 0 }; }
if (params.get("case") === "unassigned") { overview.departments = []; overview.departmentId = null; }

createRoot(document.getElementById("root")!).render(<>
  <aside className="border-b bg-amber-50 p-3 text-sm text-amber-950">Fictional verification preview. No employee data or real saves.</aside>
  <main className="mx-auto max-w-6xl space-y-4 p-4 pb-28">
    {location.pathname === "/managerLeaves" ? <><h1 className="text-xl font-semibold">Manager leave requests</h1><ManagerLeaveForm employees={fixtureEmployees} leaveTypes={fixtureLeaveTypes} initialState={{ revision: 0, values: { id: "", year: "2026", employeeId: "", leaveType: "", dateFiled: "2026-10-14", leaveStartDate: "2026-10-14", leaveEndDate: "", dayPart: "FullDay", reason: "" } }} /><output id="fixture-receipt" className="block break-all rounded border p-3 text-xs" aria-label="Fictional saved request">No fictional request saved.</output></> :
      location.pathname === "/managerProvisional" ? <ManagerProvisionalWorkspace data={overview} initialDay={params.get("day") ?? undefined} initialView={params.get("view") ?? undefined} focusedEmployeeId={params.get("employeeId") ?? undefined} /> :
        <ManagerDashboard overview={overview} requests={{ leaves: [], schedules: [] }} />}
  </main><ManagerMobileNav />
</>);

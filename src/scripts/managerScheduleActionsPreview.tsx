import { createRoot } from "react-dom/client";
import { ManagerProvisionalWorkspace } from "@/app/(manager)/managerProvisional/workspace";
import { getFixtureOverview, installManagerScheduleFixtureFetch, resetManagerScheduleFixture } from "./attendanceTest/managerSchedulePreviewActions";

const params = new URLSearchParams(location.search);
if (params.get("reset") === "1") { resetManagerScheduleFixture(); params.delete("reset"); history.replaceState(null, "", `${location.pathname}?${params}`); }
installManagerScheduleFixtureFetch();
const overview = getFixtureOverview();
if (params.has("employeeId")) overview.employees = overview.employees.filter(row => row.employeeId === params.get("employeeId"));
createRoot(document.getElementById("root")!).render(<>
  <aside className="border-b bg-amber-50 p-3 text-sm text-amber-950">Fictional schedule workflow preview. No real employee records, database or production writes. Dates are fixed for verification.</aside>
  <main className="mx-auto max-w-6xl space-y-4 p-4 pb-20"><ManagerProvisionalWorkspace data={overview} initialDay={params.get("day") ?? undefined} initialView={params.get("view") ?? undefined} focusedEmployeeId={params.get("employeeId") ?? undefined} /><output id="fixture-receipt" className="block break-all rounded border p-3 text-xs" aria-label="Fictional saved actions">No fictional request saved during this view.</output></main>
</>);

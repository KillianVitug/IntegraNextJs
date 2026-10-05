// Synthetic review fixture for the actual production component. No network or database writes.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EmployeeMatching } from "../app/(ntg)/payroll/attendance-source/employee-matching";
import type { AttendancePerson, EmployeeMatch } from "../lib/payroll/attendanceMatching";

const people: AttendancePerson[] = [
  { sourceId: "404", names: ["Maria Santos"], branches: ["North branch"], punchCount: 18, validCount: 18, lastCapturedAt: "2026-10-05T01:00:00Z" },
  { sourceId: "521", names: ["Carlo Reyes", "Reyes, Carlo"], branches: ["Central branch", "North branch"], punchCount: 24, validCount: 23, lastCapturedAt: "2026-10-04T09:00:00Z" },
  { sourceId: "test-01", names: ["Device test"], branches: ["Central branch"], punchCount: 2, validCount: 0, lastCapturedAt: "2026-09-16T00:00:00Z" },
  { sourceId: "615", names: ["Ana Cruz"], branches: ["South branch"], punchCount: 16, validCount: 16, lastCapturedAt: "2026-10-05T01:00:00Z" },
  { sourceId: "790", names: ["Luis Garcia"], branches: ["East branch"], punchCount: 12, validCount: 12, lastCapturedAt: "2026-10-05T01:00:00Z" },
];
const employees = [
  { id: "maria", employeeNo: "00404", name: "Maria Santos" },
  { id: "carlo", employeeNo: "00521", name: "Carlo Reyes" },
  { id: "ana", employeeNo: "00615", name: "Ana Cruz" },
  { id: "maria-other", employeeNo: "01983", name: "Maria Santos" },
  { id: "luis", employeeNo: "00790", name: "Luis Garcia" },
];
function Preview() {
  const [mappings, setMappings] = useState<EmployeeMatch[]>([{ sourceId: "615", employeeId: "ana" }, { sourceId: "790", employeeId: "inactive-employee" }]);
  const [fail, setFail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
    <header><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Integra · Interactive preview</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Attendance connection</h1><p className="mt-2 text-sm leading-6 text-slate-600">Sample people only. Try choosing a name and confirming an employee match. Nothing is saved to your real app.</p></header>
    <EmployeeMatching people={people} employees={employees} mappings={mappings} busy={busy} periodLabel="2026-10-A" syncPeriod={() => setMessage("Demo only: attendance would now sync for 2026-10-A.")} saveMatch={async (sourceId, employeeId, reason) => {
      setBusy(true);
      await new Promise(resolve => setTimeout(resolve, 250));
      setBusy(false);
      if (fail) return { ok: false, error: "Demo: connection interrupted. Your choices are still here. Turn off simulated failure and try again." };
      setMappings(previous => [...previous.filter(item => item.sourceId !== sourceId), { sourceId, employeeId }]);
      setMessage(`Demo saved: attendance ${sourceId} → ${employees.find(employee => employee.id === employeeId)?.employeeNo}. Evidence: ${reason}`);
      return { ok: true, data: "Match saved for this preview. Next, sync affected periods and refresh the DTR summaries." };
    }} />
    <footer className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={fail} onChange={event => setFail(event.target.checked)} />Simulate a save failure</label><output className="block break-words" aria-live="polite">{message}</output><p>Reload the preview to reset the sample matches.</p></footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);

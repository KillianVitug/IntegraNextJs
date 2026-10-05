// Actual production component; this downloadable fixture has no network/database access.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EmployeeMatching } from "../app/(ntg)/payroll/attendance-source/employee-matching";
import { nameDifferenceWarning, verificationReason, type MatchBoard, type MatchHistoryBatch, type MatchHistoryChange, type MatchMutation, type WorkflowResult } from "../lib/payroll/attendanceMatching";

const employees = [
  { id: "maria", employeeNo: "00404", name: "Maria Santos" },
  { id: "carlo", employeeNo: "00521", name: "Carlo Reyes" },
  { id: "ana", employeeNo: "00615", name: "Ana Cruz" },
  { id: "luis", employeeNo: "00790", name: "Luis Garcia" },
  { id: "jose", employeeNo: "00818", name: "Jose Dela Cruz" },
  { id: "juan", employeeNo: "818", name: "Juan Dela Cruz" },
  { id: "paolo", employeeNo: "00905", name: "Paolo Ramos" },
  { id: "miguel", employeeNo: "00906", name: "Miguel Ramos" },
];
const initial: MatchBoard = { employees, history: [], historyCursor: null, people: [
  ["404", "Maria Santos", "North"], ["521", "REYES, CARLO", "Central"], ["615", "", "South"], ["790", "Luis Garcia", "East"],
  ["818", "J. Dela Cruz", "North"], ["905", "Miguel Ramos", "South"], ["2", "Training account", "TEST"],
].map(([sourceId, personName, branch]) => ({ sourceId, names: [personName], branches: [branch], punchCount: 2, validCount: 2, lastCapturedAt: "2026-10-05T01:00:00Z", employeeId: null, classification: "Active", version: sourceId + "-initial", classificationReason: "", classificationActor: null, classificationAt: null })) };
function Preview() {
  const [board, setBoard] = useState(initial), [fail, setFail] = useState(false);
  async function mutate(request: MatchMutation): Promise<WorkflowResult> {
    if (fail) return { ok: false, error: "Simulated interruption. Your choices remain here; turn off Simulate a save failure and retry." };
    const next: MatchBoard = JSON.parse(JSON.stringify(board));
    const batchId = crypto.randomUUID(), rows: MatchHistoryChange[] = [];
    const selected = request.kind === "Match" ? request.items.map(i => ({ sourceId: i.sourceId, employeeId: i.employeeId, classification: "Active" as const })) : request.kind === "Undo" ? request.items.map(i => { const old = board.history.find(b => b.id === request.batchId)!.changes.find(c => c.id === i.changeId)!; return { sourceId: old.sourceId, employeeId: old.beforeEmployeeId, classification: old.beforeClassification as "Active", reversal: old.id }; }) : [{ sourceId: request.sourceId, employeeId: null, classification: request.kind === "TestOnly" ? "TestOnly" as const : "NeedsReview" as const }];
    let reason = request.kind === "Match" ? verificationReason(request.method, request.note)! : request.reason;
    if (request.kind === "Match") {
      const warned = request.items.filter(i => nameDifferenceWarning(board.people.find(p => p.sourceId === i.sourceId)!, employees.find(e => e.id === i.employeeId)!));
      if (warned.length && request.nameDifferencesAcknowledged !== true) return { ok: false, error: "Acknowledge the highlighted name differences or missing names before saving." };
      if (warned.length) reason += ` Name differences or missing names acknowledged for ${warned.length} selected identities.`;
    }
    for (const entry of selected) {
      const person = next.people.find(p => p.sourceId === entry.sourceId)!;
      const label = (id: string | null) => { const e = employees.find(e => e.id === id); return e ? `${e.name} · ${e.employeeNo}` : null; };
      rows.push({ id: crypto.randomUUID(), sourceId: person.sourceId, sourceName: person.names.join(" / "), beforeEmployeeId: person.employeeId, afterEmployeeId: entry.employeeId, beforeLabel: label(person.employeeId), afterLabel: label(entry.employeeId), beforeClassification: person.classification, afterClassification: entry.classification, canUndo: request.kind === "Match" || request.kind === "Unmatch", reversesChangeId: "reversal" in entry ? String(entry.reversal) : null });
      person.employeeId = entry.employeeId; person.classification = entry.classification; person.version = crypto.randomUUID(); person.classificationReason = reason; person.classificationActor = "Preview admin"; person.classificationAt = new Date().toISOString();
      next.history.forEach(b => b.changes.forEach(c => { if (c.sourceId === person.sourceId) c.canUndo = false; }));
    }
    const batch: MatchHistoryBatch = { id: batchId, kind: request.kind, actor: "Preview admin", reason, createdAt: new Date().toISOString(), changes: rows };
    next.history.unshift(batch); setBoard(next);
    return { ok: true, data: { board: next, batchId, message: "Sample change saved. No live data changed. In production, reconcile affected attendance and payroll separately." } };
  }
  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6"><header><p className="text-xs font-semibold uppercase text-blue-700">Integra · Actual component with synthetic data</p><h1 className="mt-2 text-2xl font-semibold">Attendance connection</h1><p className="mt-2 text-sm text-slate-600">Try batch matching, test-only classification, restoration and undo. This downloadable preview does not connect to the live app.</p></header><EmployeeMatching board={board} busy={false} mutate={mutate} loadHistory={async () => ({ ok: true, data: { history: [], historyCursor: null } })} /><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={fail} onChange={e => setFail(e.target.checked)} />Simulate a save failure</label></main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);

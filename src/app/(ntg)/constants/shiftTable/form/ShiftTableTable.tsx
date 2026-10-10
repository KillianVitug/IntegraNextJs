"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { compareShiftTableSchedules, describeSchedule, shiftTableScheduleSnapshot } from "@/lib/scheduling/presentation";
import type { ShiftTableReadModel } from "@/lib/shifts";

type Props = { rows: ShiftTableReadModel[]; selectedId?: number | null; disabled?: boolean; onRowSelect: (row: ShiftTableReadModel) => void };
export default function ShiftTableTable({ rows, selectedId, disabled, onRowSelect }: Props) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const visible = useMemo(() => rows.filter(row => Boolean(row.archivedAt) === showArchived).sort(compareShiftTableSchedules).filter(row => {
    const display = describeSchedule(shiftTableScheduleSnapshot(row));
    return `${display.label} ${row.code} ${row.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }), [query, rows, showArchived]);
  return <section className="space-y-4 rounded-xl border p-4 sm:p-6" aria-labelledby="shift-catalog-title"><div><h2 id="shift-catalog-title" className="text-xl font-semibold">Schedule catalog</h2><p className="mt-1 text-sm text-muted-foreground">Sorted by work times. Select a schedule to review its breaks and policies.</p></div><div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm" htmlFor="shift-search">Find a schedule<Input id="shift-search" className="mt-1" placeholder="Search times, breaks or previous name" value={query} onChange={event => setQuery(event.target.value)} /></label><label className="text-sm" htmlFor="shift-status">Show<select id="shift-status" className="mt-1 block h-10 rounded border bg-background px-3" value={showArchived ? "archived" : "active"} onChange={event => setShowArchived(event.target.value === "archived")}><option value="active">Active versions</option><option value="archived">Archived versions</option></select></label></div><p className="text-sm text-muted-foreground">{visible.length} {showArchived ? "archived" : "active"} {visible.length === 1 ? "version" : "versions"}</p><ul className="divide-y rounded-lg border">{visible.map(row => { const display = describeSchedule(shiftTableScheduleSnapshot(row)); return <li key={row.id} className={`flex flex-wrap items-start justify-between gap-3 p-4 ${selectedId === row.id ? "bg-blue-50/60" : ""}`}><div className="min-w-0 flex-1"><p className="break-words font-medium">{display.periodsLabel}</p><p className="mt-1 break-words text-sm text-muted-foreground">{display.details.join(" · ")}</p>{display.warnings.map(warning => <p className="mt-1 text-sm text-amber-800" key={warning}>{warning}</p>)}<p className="mt-2 text-xs text-muted-foreground">Version {row.version ?? 1} · {row.archivedAt ? "Archived" : "Active"}{row.usage ? ` · ${row.usage.weeklyDays} weekly days · ${row.usage.datedAssignments} dated assignments · ${row.usage.pendingRequests} pending requests` : ""}</p></div><Button type="button" variant="outline" disabled={disabled} aria-pressed={selectedId === row.id} onClick={() => onRowSelect(row)}>{row.archivedAt ? "View" : "Review / revise"}</Button></li>; })}{!visible.length && <li className="p-5 text-sm text-muted-foreground">No matching schedules.</li>}</ul></section>;
}

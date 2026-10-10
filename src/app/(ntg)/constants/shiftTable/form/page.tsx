"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ShiftTableReadModel } from "@/lib/shifts";
import ShiftTableForm from "./ShiftTableForm";
import ShiftTableTable from "./ShiftTableTable";

export default function ShiftTablePage() {
  const [rows, setRows] = useState<ShiftTableReadModel[]>([]);
  const [selectedRow, setSelectedRow] = useState<ShiftTableReadModel | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const lockRef = useRef(false);
  const dirty = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => { dirty.current = value; }, []);
  const onNavigationLockChange = useCallback((value: boolean) => { lockRef.current = value; setLocked(value); }, []);
  const loadRows = useCallback(async () => {
    const response = await fetch("/api/constants/shiftTable?includeArchived=1", { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "An administrator sign-in is required to manage schedules." : "The schedule catalog could not be loaded.");
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error("The schedule catalog returned an unexpected response.");
    const loaded = data as ShiftTableReadModel[]; setRows(loaded); return loaded;
  }, []);
  const reload = useCallback(async () => { setLoading(true); setError(""); try { await loadRows(); } catch (error) { setError(error instanceof Error ? error.message : "Unable to load schedules."); } finally { setLoading(false); } }, [loadRows]);
  useEffect(() => { void reload(); }, [reload]);
  // Only an explicit catalog selection/reset changes this key. Typing, filtering,
  // receipt readback and initial loading must not move the user's viewport.
  useEffect(() => {
    if (editorKey === 0) return;
    const heading = document.getElementById("shift-editor-title");
    if (!heading) return;
    heading.focus({ preventScroll: true });
    const bounds = heading.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > window.innerHeight) heading.scrollIntoView({ block: "start" });
  }, [editorKey]);
  useEffect(() => {
    const leave = () => {
      if (lockRef.current) { window.alert("Finish saving or retry the pending request or verification before leaving this schedule."); return false; }
      return !dirty.current || window.confirm("Leave this schedule? Unsaved changes will be lost.");
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.href === location.href || anchor.hash && anchor.pathname === location.pathname) return;
      if (!leave()) { event.preventDefault(); event.stopImmediatePropagation(); } else dirty.current = false;
    };
    // Edge/Chromium's Navigation API covers SPA back/forward as well as links.
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => { if (event.cancelable && !leave()) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload); document.addEventListener("click", click, true); navigation?.addEventListener("navigate", navigate);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); navigation?.removeEventListener("navigate", navigate); };
  }, []);
  function select(row: ShiftTableReadModel | null) {
    if (lockRef.current) return;
    if (dirty.current && !window.confirm("Discard the current schedule changes and select another schedule?")) return;
    dirty.current = false; setSelectedRow(row); setEditorKey(value => value + 1);
  }
  return <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-3 sm:p-5"><header><h1 className="text-2xl font-semibold">Reusable schedules</h1><p className="mt-1 text-sm text-muted-foreground">Define work periods once, then assign the appropriate version in Schedules.</p></header>{error && <div className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert"><p className="text-sm text-red-800">{error}</p><Button className="mt-2" variant="outline" onClick={() => void reload()} disabled={loading}>Retry loading</Button></div>}{loading ? <p role="status">Loading schedule catalog…</p> : !error && <><ShiftTableForm key={editorKey} selectedRow={selectedRow} onResetSelection={() => select(null)} onReadback={loadRows} onVerified={row => { dirty.current = false; setSelectedRow(row); }} onDirtyChange={onDirtyChange} onNavigationLockChange={onNavigationLockChange} /><ShiftTableTable rows={rows} selectedId={selectedRow?.id ?? null} disabled={locked} onRowSelect={select} /></>}</main>;
}

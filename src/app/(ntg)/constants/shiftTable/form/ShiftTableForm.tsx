"use client";

import { useEffect, useState } from "react";
import { deleteShiftTableAction, saveShiftTableAction } from "@/app/actions/payrollConfigAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeSchedule, shiftTableScheduleSnapshot } from "@/lib/scheduling/presentation";
import { blankEditorBreak, emptyShiftEditor, newShiftCode, reviewShiftEditor, shiftEditorFromTable, shiftReadbackMatches, unpaidBreak, type BreakPayment, type EditorBreak, type ShiftEditorReview, type ShiftEditorValues } from "@/lib/scheduling/shift-editor";
import type { ShiftTableReadModel } from "@/lib/shifts";

type Receipt = { message: string; requestId: string; action: "created" | "revised" | "archived"; shiftTableId: number; familyId: string; version: number; archivedAt: string | null };
type Command = { kind: "save"; review: ShiftEditorReview } | { kind: "archive"; payload: { id: number; expectedVersion: number; requestId: string } };
type Props = { selectedRow: ShiftTableReadModel | null; onResetSelection: () => void; onReadback: () => Promise<ShiftTableReadModel[]>; onVerified: (row: ShiftTableReadModel) => void; onDirtyChange: (dirty: boolean) => void; onNavigationLockChange: (locked: boolean) => void };

function Presentation({ row }: { row: ShiftTableReadModel }) {
  const display = describeSchedule(shiftTableScheduleSnapshot(row));
  return <div className="space-y-2"><p className="font-semibold">{display.periodsLabel}</p><ul className="space-y-1 text-sm text-muted-foreground">{display.details.map(detail => <li key={detail}>{detail}</li>)}</ul>{display.warnings.map(warning => <p key={warning} className="text-sm text-amber-800">{warning}</p>)}</div>;
}

function PaymentFields({ value, onChange, id }: { value: BreakPayment; onChange: (value: BreakPayment) => void; id: string }) {
  return <div className="flex flex-wrap items-end gap-2"><label className="text-sm" htmlFor={`${id}-pay`}>Break pay<select id={`${id}-pay`} className="mt-1 block h-10 rounded border bg-background px-3" value={value.pay} onChange={event => onChange({ ...value, pay: event.target.value as BreakPayment["pay"] })}><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="partial">Partly paid</option></select></label>{value.pay === "partial" && <label htmlFor={`${id}-minutes`} className="text-sm">Unpaid minutes<Input id={`${id}-minutes`} className="mt-1 w-32" type="number" min="1" step="1" value={value.unpaidMinutes} onChange={event => onChange({ ...value, unpaidMinutes: event.target.value })} /></label>}</div>;
}

function BreakRows({ rows, onChange, category, limit }: { rows: EditorBreak[]; onChange: (rows: EditorBreak[]) => void; category: "ordinary" | "overtime"; limit: number }) {
  const title = category === "ordinary" ? "Break" : "Overtime break";
  return <div className="space-y-3">{rows.map((row, index) => <div key={index} className="flex flex-wrap items-end gap-3 rounded-lg border p-3"><label htmlFor={`${category}-${index}-from`} className="text-sm">{title} {index + 1} from<Input id={`${category}-${index}-from`} className="mt-1 w-36" type="time" value={row.fromTime} onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, fromTime: event.target.value } : item))} /></label><label htmlFor={`${category}-${index}-to`} className="text-sm">To<Input id={`${category}-${index}-to`} className="mt-1 w-36" type="time" value={row.toTime} onChange={event => onChange(rows.map((item, i) => i === index ? { ...item, toTime: event.target.value } : item))} /></label><PaymentFields id={`${category}-${index}`} value={row} onChange={payment => onChange(rows.map((item, i) => i === index ? { ...item, ...payment } : item))} /><Button type="button" variant="outline" onClick={() => onChange(rows.filter((_, i) => i !== index))} aria-label={`Remove ${title.toLowerCase()} ${index + 1}`}>Remove</Button></div>)}<Button type="button" variant="outline" disabled={rows.length >= limit} onClick={() => onChange([...rows, blankEditorBreak()])}>Add {title.toLowerCase()}</Button></div>;
}

export default function ShiftTableForm({ selectedRow, onResetSelection, onReadback, onVerified, onDirtyChange, onNavigationLockChange }: Props) {
  const [values, setValues] = useState<ShiftEditorValues>(emptyShiftEditor);
  const [baseline, setBaseline] = useState(() => JSON.stringify(emptyShiftEditor()));
  const [notices, setNotices] = useState<string[]>([]);
  const [duplicate, setDuplicate] = useState(false);
  const [command, setCommand] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [verified, setVerified] = useState(false);
  const [verificationNote, setVerificationNote] = useState("");
  const archived = Boolean(selectedRow?.archivedAt) && !duplicate;
  const dirty = duplicate || JSON.stringify(values) !== baseline || Boolean(command) || Boolean(receipt && !verified);
  const locked = busy || uncertain || Boolean(receipt && !verified);

  useEffect(() => {
    const loaded = selectedRow ? shiftEditorFromTable(selectedRow) : { values: emptyShiftEditor(), notices: [] };
    setValues(loaded.values); setBaseline(JSON.stringify(loaded.values)); setNotices(loaded.notices);
    setDuplicate(false); setCommand(null); setError(""); setUncertain(false);
    setReceipt(current => current?.shiftTableId === selectedRow?.id ? current : null);
  }, [selectedRow]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onNavigationLockChange(locked); }, [locked, onNavigationLockChange]);

  function reviewSave() {
    setError(""); setReceipt(null); setVerified(false);
    try {
      const original = selectedRow && !duplicate ? selectedRow : null;
      const review = reviewShiftEditor(values, { requestId: crypto.randomUUID(), code: original?.code ?? newShiftCode(crypto.randomUUID()), ...(original ? { id: original.id, expectedVersion: original.version ?? 1, description: original.description } : {}) });
      setCommand({ kind: "save", review }); setUncertain(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Review the schedule times and breaks."); }
  }

  async function verify(result: Receipt, pending: Command | null) {
    const rows = await onReadback();
    const row = rows.find(item => item.id === result.shiftTableId && item.version === result.version && item.familyId === result.familyId);
    if (!row || result.action === "archived" && !row.archivedAt) throw new Error("The save receipt is confirmed, but the saved version could not be verified in the catalog. Retry verification.");
    if (pending?.kind === "save") {
      const expected = pending.review.preview;
      if (!shiftReadbackMatches(row, expected)) throw new Error("The save receipt is confirmed, but readback differs from the reviewed schedule. Reload and review before using this version.");
    }
    setVerificationNote(result.action !== "archived" && row.archivedAt ? "This saved version has since been archived or replaced. Its saved values were verified; select the current version from the catalog for new assignments." : "");
    setVerified(true); setCommand(null); setUncertain(false); onDirtyChange(false); onVerified(row);
  }

  async function submitCommand() {
    if (!command || busy) return;
    setBusy(true); setError("");
    let saved: Receipt | null = null;
    try {
      const result = command.kind === "save" ? await saveShiftTableAction(command.review.payload) : await deleteShiftTableAction(command.payload);
      if (!result?.data) { setUncertain(false); setError(result?.serverError ?? "The request was rejected. Return to editing and review the times, breaks and current version."); return; }
      saved = result.data as Receipt; setReceipt(saved); setUncertain(false);
      await verify(saved, command);
    } catch (error) {
      setUncertain(!saved);
      setError(saved ? (error instanceof Error ? error.message : "Saved, but verification could not finish. Retry verification.") : "No save receipt was received. Retry this same request to safely recover its outcome.");
    } finally { setBusy(false); }
  }

  async function retryVerification() {
    if (!receipt || busy) return;
    setBusy(true); setError("");
    try { await verify(receipt, command); } catch (error) { setError(error instanceof Error ? error.message : "Verification is unavailable. Your saved receipt is retained."); } finally { setBusy(false); }
  }
  async function refreshCatalog() {
    setBusy(true);
    try { await onReadback(); setError("Catalog refreshed. Your entries are retained. If this version was revised elsewhere, select its current version from the catalog before revising it."); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to refresh the catalog. Your entries are retained."); }
    finally { setBusy(false); }
  }
  function duplicateSchedule() { setDuplicate(true); setCommand(null); setReceipt(null); setVerified(false); setError(""); setUncertain(false); }

  return <section className="space-y-5 rounded-xl border p-4 sm:p-6" aria-labelledby="shift-editor-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="shift-editor-title" tabIndex={-1} className="text-xl font-semibold">{duplicate ? "Duplicate schedule" : selectedRow ? archived ? "Archived schedule" : "Revise schedule" : "New schedule"}</h2><p className="mt-1 text-sm text-muted-foreground">Choose work times and breaks. Each saved version is reusable when assigning employee schedules.</p>{selectedRow && <p className="mt-1 text-xs text-muted-foreground">Version {selectedRow.version ?? 1}{selectedRow.archivedAt ? " · Archived" : " · Active"}</p>}</div>{selectedRow && <Button type="button" variant="outline" disabled={busy || Boolean(command) || Boolean(receipt && !verified)} onClick={duplicateSchedule}>Duplicate as new schedule</Button>}</div>
    {selectedRow?.usage && <p className="text-sm text-muted-foreground">Existing references: {selectedRow.usage.weeklyDays} weekly days · {selectedRow.usage.datedAssignments} dated assignments · {selectedRow.usage.pendingRequests} pending requests. Saved period snapshots may also use this version.</p>}
    {notices.map(notice => <p key={notice} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>)}
    {archived && selectedRow ? <Presentation row={selectedRow} /> : <form onSubmit={event => { event.preventDefault(); reviewSave(); }} className="space-y-5"><fieldset className="space-y-5" disabled={busy || Boolean(command) || Boolean(receipt)}>
      <section className="space-y-3"><div><h3 className="font-semibold">Work periods</h3><p className="text-sm text-muted-foreground">Enter periods in order. Times after midnight belong to the next day. Each gap requires OUT and IN.</p></div>
        {values.periods.map((period, index) => <div key={index} className="space-y-3"><div className="flex flex-wrap items-end gap-3 rounded-lg border p-3"><label htmlFor={`period-${index}-from`} className="text-sm">Period {index + 1} from<Input id={`period-${index}-from`} className="mt-1 w-36" type="time" value={period.fromTime} onChange={event => setValues(current => ({ ...current, periods: current.periods.map((item, i) => i === index ? { ...item, fromTime: event.target.value } : item) }))} /></label><label htmlFor={`period-${index}-to`} className="text-sm">To<Input id={`period-${index}-to`} className="mt-1 w-36" type="time" value={period.toTime} onChange={event => setValues(current => ({ ...current, periods: current.periods.map((item, i) => i === index ? { ...item, toTime: event.target.value } : item) }))} /></label>{values.periods.length > 1 && <Button type="button" variant="outline" onClick={() => setValues(current => ({ ...current, periods: current.periods.filter((_, i) => i !== index), gaps: current.gaps.filter((_, i) => i !== Math.max(0, index - 1)) }))} aria-label={`Remove period ${index + 1}`}>Remove</Button>}</div>{index < values.gaps.length && <div className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/40 p-3"><p className="text-sm">Split gap {period.toTime || "?"}–{values.periods[index + 1].fromTime || "?"}<span className="block text-xs text-muted-foreground">OUT then IN required</span></p><PaymentFields id={`gap-${index}`} value={values.gaps[index]} onChange={value => setValues(current => ({ ...current, gaps: current.gaps.map((item, i) => i === index ? value : item) }))} /></div>}</div>)}
        <Button type="button" variant="outline" disabled={values.gaps.length + values.regularBreaks.length >= 5} onClick={() => setValues(current => ({ ...current, periods: [...current.periods, { fromTime: "", toTime: "" }], gaps: [...current.gaps, unpaidBreak()] }))}>Add work period</Button>
      </section>
      <section className="space-y-3"><div><h3 className="font-semibold">Breaks within work periods</h3><p className="text-sm text-muted-foreground">Paid, partly paid or unpaid breaks. These do not add a required OUT/IN pair.</p></div><BreakRows rows={values.regularBreaks} category="ordinary" limit={5 - values.gaps.length} onChange={regularBreaks => setValues(current => ({ ...current, regularBreaks }))} /><p className="text-xs text-muted-foreground">{values.gaps.length + values.regularBreaks.length} of 5 regular break slots used, including split gaps.</p></section>
      <section className="space-y-3"><div><h3 className="font-semibold">Overtime breaks</h3><p className="text-sm text-muted-foreground">Shown separately from scheduled work periods. Keep them outside other break windows.</p></div><BreakRows rows={values.overtimeBreaks} category="overtime" limit={2} onChange={overtimeBreaks => setValues(current => ({ ...current, overtimeBreaks }))} /></section>
      <p className="rounded-lg bg-muted/40 p-3 text-sm">This version uses an 8-hour normal day. Scheduled paid time above 8 hours is overtime; payable overtime still follows attendance and approval rules.</p><Button type="submit">Review {selectedRow && !duplicate ? "new version" : "schedule"}</Button>
    </fieldset></form>}
    {command && !receipt && <section className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/30 p-4" aria-label="Review schedule change"><h3 className="font-semibold">{command.kind === "archive" ? "Review archive" : "Review before saving"}</h3>{command.kind === "save" ? <div className="grid gap-4 lg:grid-cols-2">{selectedRow && <div><p className="mb-2 text-sm font-medium">{duplicate ? "Copied from" : "Current version"}</p><Presentation row={selectedRow} /></div>}<div><p className="mb-2 text-sm font-medium">{duplicate || !selectedRow ? "New schedule" : "New version"}</p><Presentation row={command.review.preview} /></div></div> : selectedRow && <Presentation row={selectedRow} />}<p className="text-sm">{command.kind === "archive" ? "This version will stop appearing in new selections. Existing employee assignments and captured period schedules retain it." : "Saving adds a catalog version. Existing employee assignments and captured period schedules keep their reviewed values. Apply the new version separately in Schedules."}</p><div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={() => void submitCommand()}>{busy ? "Saving…" : uncertain ? "Retry same request" : command.kind === "archive" ? "Archive version" : "Save reviewed version"}</Button><Button type="button" variant="outline" disabled={busy || uncertain} onClick={() => { setCommand(null); setError(""); }}>Return to editing</Button></div></section>}
    {receipt && <section className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-4" role="status"><p className="font-medium">{receipt.message}</p><p className="text-sm">Version {receipt.version} · {verified ? "Saved version verified in the catalog." : "Save receipt confirmed; catalog verification pending."}</p><p className="break-all text-xs text-muted-foreground">Receipt {receipt.requestId}</p>{!verified && <Button type="button" variant="outline" disabled={busy} onClick={() => void retryVerification()}>{busy ? "Verifying…" : "Retry verification"}</Button>}</section>}
    {verificationNote && receipt && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{verificationNote}</p>}
    {error && <div role="alert" className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p>{error}</p>{!uncertain && !receipt && <Button type="button" variant="outline" disabled={busy} onClick={() => void refreshCatalog()}>Refresh catalog</Button>}</div>}
    {receipt && verified && !archived && <Button type="button" variant="outline" onClick={() => { setReceipt(null); setVerified(false); }}>Revise this saved version</Button>}
    <div className="flex flex-wrap gap-2">{selectedRow && !archived && !duplicate && !command && !receipt && <Button type="button" variant="outline" disabled={busy || dirty} onClick={() => { setCommand({ kind: "archive", payload: { id: selectedRow.id, expectedVersion: selectedRow.version ?? 1, requestId: crypto.randomUUID() } }); setError(""); }}>Archive version</Button>}<Button type="button" variant="outline" disabled={busy || uncertain || Boolean(receipt && !verified)} onClick={onResetSelection}>{receipt && verified ? "Create another schedule" : "New / clear selection"}</Button></div>
  </section>;
}

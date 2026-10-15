"use client";
import { shiftTableScheduleLabel } from "@/lib/scheduling/presentation";
import { scheduleLabel } from "@/lib/scheduling/model";
import type { ScheduleSnapshot } from "@/lib/scheduling/workspace-types";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  approveManagerScheduleChangeRequest,
  denyManagerScheduleChangeRequest,
  listAdminScheduleChangeRequests,
  voidApprovedManagerScheduleChangeRequest,
} from "@/app/actions/managerScheduleApprovalAction";
import type { fetchShiftTables } from "@/lib/queries/fetchLookupData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";

type RequestRow = Awaited<ReturnType<typeof listAdminScheduleChangeRequests>>[number];
type ShiftTableOption = Awaited<ReturnType<typeof fetchShiftTables>>[number];

function formatShiftTableLabel(
  shiftTableId: number | null,
  shiftTableMap: Map<number, ShiftTableOption>,
) {
  if (shiftTableId == null) return "Captured day schedule";
  const shiftTable = shiftTableMap.get(shiftTableId);
  if (!shiftTable) {
    return `Unknown shift table (#${shiftTableId})`;
  }

  return shiftTableScheduleLabel(shiftTable);
}

function operationLabel(request: RequestRow) {
  const kind = request.payload.scheduleOperation?.kind;
  return kind === "cover" ? "Arrange cover" : kind === "swap" ? "Swap schedules" : kind === "adjust" ? "Change this day" : request.action;
}
function ScheduleValue({ value }: { value: ScheduleSnapshot }) {
  return <div><p>{scheduleLabel(value)}</p>{value.designatedRestDay && <p className="font-medium">Designated rest day retained</p>}
    {value.breaks.map((item, index) => <p className="text-xs" key={index}>{item.label}: {item.fromTime}–{item.toTime} · {item.deduct ? `${item.deductHours * 60 + item.deductMinutes} min unpaid` : "Paid"}{item.requiresPunches ? " · OUT and IN required" : ""}</p>)}</div>;
}

function formatCoverage(request: RequestRow | null) {
  if (!request) return "";
  const effectiveDates = [...new Set(request.payload.effectiveDates ?? [])]
    .filter(Boolean)
    .sort();

  if (effectiveDates.length === 1) {
    return effectiveDates[0];
  }

  if (effectiveDates.length > 1 && effectiveDates.length <= 4) {
    return effectiveDates.join(", ");
  }

  if (effectiveDates.length > 4) {
    return `${effectiveDates.length} dates: ${effectiveDates
      .slice(0, 3)
      .join(", ")}...`;
  }

  return `${request.payload.effectiveFrom}${
    request.payload.effectiveTo ? ` to ${request.payload.effectiveTo}` : ""
  }`;
}

function getStatusClasses(status: RequestRow["status"]) {
  if (status === "Pending") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  }

  if (status === "Approved") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }

  if (status === "Cancelled") {
    return "bg-muted text-muted-foreground";
  }

  if (status === "Voided") {
    return "bg-slate-200 text-slate-700 dark:bg-slate-900 dark:text-slate-300";
  }

  return "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
}

export function ScheduleRequestQueue({
  requests,
  shiftTables,
}: {
  requests: RequestRow[];
  shiftTables: ShiftTableOption[];
}) {
  const router = useRouter();
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [restWorkReviewed, setRestWorkReviewed] = useState(false);
  const [restWorkBasis, setRestWorkBasis] = useState<"" | "voluntary-written" | "exception-reviewed">("");
  const [restWorkEvidence, setRestWorkEvidence] = useState("");
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const shiftTableMap = new Map(
    shiftTables.map((shiftTable) => [shiftTable.id, shiftTable]),
  );
  const selectedRequest =
    requests.find((request) => request.id === selectedRequestId) ?? null;
  const canDecide = selectedRequest?.status === "Pending";
  const operation = selectedRequest?.payload.scheduleOperation;
  const restReviewIncomplete = Boolean(operation?.requiresRestReview && (!restWorkReviewed || !restWorkBasis || !restWorkEvidence.trim()));
  const selectedShift = selectedRequest?.payload.shiftTableId != null ? shiftTableMap.get(selectedRequest.payload.shiftTableId) : null;
  const unavailableShift = Boolean(canDecide && !operation && selectedRequest?.action !== "Delete" && (!selectedShift || selectedShift.archivedAt));
  const canVoid =
    selectedRequest?.status === "Approved" && selectedRequest.action === "Create" && !operation;
  const canEditDecisionNote = canDecide || canVoid;

  function selectRequest(request: RequestRow) {
    if (isPending) return;
    setSelectedRequestId(request.id);
    setDecisionNote(request.decisionNote ?? "");
    setRestWorkReviewed(false);
    setRestWorkBasis(""); setRestWorkEvidence("");
    setError("");
  }

  function cancelSelection() {
    setSelectedRequestId(null);
    setDecisionNote("");
    setRestWorkReviewed(false);
    setRestWorkBasis(""); setRestWorkEvidence("");
    setError("");
  }

  function approve() {
    if (!selectedRequest || !canDecide || unavailableShift || restReviewIncomplete) return;
    setError("");

    startTransition(async () => {
      try {
        await approveManagerScheduleChangeRequest({
          requestId: selectedRequest.id,
          decisionNote,
          restWorkReviewed,
          restWorkBasis: restWorkBasis || undefined,
          restWorkEvidence,
        });
        toast.success("Schedule request approved.");
        cancelSelection();
        router.refresh();
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unable to approve request. Your selection is retained.");
        toast.error(
          error instanceof Error ? error.message : "Unable to approve request.",
        );
      }
    });
  }

  function deny() {
    if (!selectedRequest || !canDecide) return;
    const note = decisionNote.trim();
    if (!note && !operation) {
      toast.error("A denial note is required.");
      return;
    }

    startTransition(async () => {
      setError("");
      try {
        await denyManagerScheduleChangeRequest({
          requestId: selectedRequest.id,
          decisionNote: note,
        });
        toast.success("Schedule request denied.");
        cancelSelection();
        router.refresh();
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unable to deny request. Your selection is retained.");
        toast.error(
          error instanceof Error ? error.message : "Unable to deny request.",
        );
      }
    });
  }

  function voidRequest() {
    if (!selectedRequest || !canVoid) return;
    const note = decisionNote.trim();
    if (!note) {
      toast.error("A void reason is required.");
      return;
    }
    if (!window.confirm("Void this approved schedule override?")) return;

    startTransition(async () => {
      try {
        await voidApprovedManagerScheduleChangeRequest({
          requestId: selectedRequest.id,
          reason: note,
        });
        toast.success("Approved schedule override voided.");
        cancelSelection();
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to void approved schedule override.",
        );
      }
    });
  }

  return (
    <div>
      <div className="border-b p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium">Employee</label>
            <Input
              value={
                selectedRequest
                  ? `${selectedRequest.lastName}, ${selectedRequest.firstName}`
                  : ""
              }
              placeholder="Select a request"
              readOnly
              className="cursor-not-allowed bg-muted text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Department</label>
            <Input
              value={
                selectedRequest
                  ? `${selectedRequest.departmentCode ?? "-"} | ${
                      selectedRequest.departmentName ?? "-"
                    }`
                  : ""
              }
              readOnly
              className="cursor-not-allowed bg-muted text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Requested By</label>
            <Input
              value={selectedRequest?.requesterEmail ?? ""}
              readOnly
              className="cursor-not-allowed bg-muted text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Coverage</label>
            <Input
              value={formatCoverage(selectedRequest)}
              readOnly
              className="cursor-not-allowed bg-muted text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Shift Table</label>
            <Input
              value={
                selectedRequest
                  ? formatShiftTableLabel(
                      selectedRequest.payload.shiftTableId,
                      shiftTableMap,
                    )
                  : ""
              }
              readOnly
              className="cursor-not-allowed bg-muted text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Status</label>
            <Input
              value={selectedRequest?.status ?? ""}
              readOnly
              className="cursor-not-allowed bg-muted text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Action</label>
            <Input
              value={selectedRequest ? operationLabel(selectedRequest) : ""}
              readOnly
              className="cursor-not-allowed bg-muted text-muted-foreground"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-medium">Reason</label>
            <Textarea
              value={selectedRequest?.reason ?? ""}
              readOnly
              className="min-h-20 cursor-not-allowed bg-muted text-muted-foreground"
            />
          </div>
          <div>
            <label htmlFor="schedule-decision-note" className="mb-2 block text-sm font-medium">Decision Note</label>
            <Textarea
              id="schedule-decision-note"
              value={decisionNote}
              onChange={(event) => setDecisionNote(event.target.value)}
              placeholder={
                canVoid ? "Required when voiding" : operation ? "Optional review note" : "Required when denying"
              }
              readOnly={!canEditDecisionNote}
              className={
                !canEditDecisionNote
                  ? "min-h-20 cursor-not-allowed bg-muted text-muted-foreground"
                  : "min-h-20"
              }
            />
          </div>
        </div>

        {operation && selectedRequest && <section aria-label="Captured schedule changes" className="mt-4 space-y-3 rounded-lg border p-3">
          <h2 className="font-semibold">{operationLabel(selectedRequest)} · {operation.day}</h2>
          {operation.kind === "cover" && <p className="text-sm">Coverage retains the unavailable employee's original schedule and attendance/leave review.</p>}
          {operation.requestReasons.map(reason => <p className="text-sm" key={reason}>{reason}</p>)}
          {operation.cells.map(cell => <article key={`${cell.employeeId}-${cell.day}`} className="rounded border p-3 text-sm">
            <h3 className="font-semibold">{selectedRequest.operationEmployees.find(person => person.id === cell.employeeId)?.name ?? "Employee record unavailable"} · {cell.day}</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2"><div><p className="font-medium">Before</p><ScheduleValue value={cell.before} /></div><div><p className="font-medium">Requested</p><ScheduleValue value={cell.after} /></div></div>
          </article>)}
          {canDecide && operation.requiresRestReview && <fieldset className="space-y-3 rounded border p-3 text-sm" disabled={isPending}><legend className="font-medium">Rest-day work review</legend>
            <label className="block">Basis<select className="mt-1 min-h-11 w-full rounded border bg-background px-3" value={restWorkBasis} onChange={event => setRestWorkBasis(event.target.value as typeof restWorkBasis)}><option value="">Choose the reviewed basis</option><option value="voluntary-written">Employee's written willingness</option><option value="exception-reviewed">Applicable rest-day work exception reviewed</option></select></label>
            <label className="block">Evidence or record reference<textarea className="mt-1 min-h-20 w-full rounded border bg-background p-3" maxLength={1000} value={restWorkEvidence} onChange={event => setRestWorkEvidence(event.target.value)} placeholder="Reference the written willingness or the facts supporting the applicable exception." /></label>
            <label className="flex min-h-11 items-start gap-2"><input type="checkbox" className="mt-1" checked={restWorkReviewed} onChange={event => setRestWorkReviewed(event.target.checked)} /><span>I reviewed the rest-day arrangement and its evidence. The original rest-day designation stays on the schedule; this does not approve or determine pay.</span></label>
          </fieldset>}
          <p className="text-xs text-muted-foreground">Approval applies these captured values together only if current inputs still match. Derived attendance inputs are refreshed; official payroll requires recalculation and review. Later corrections retain this history.</p>
        </section>}
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="mt-3 rounded border border-red-400 p-3 text-sm">{error}</p>}
        {unavailableShift && <p role="status" className="mt-3 text-sm text-amber-700 dark:text-amber-300">This request uses an archived or unavailable schedule version. Its original details are retained. Deny it with an explanation, then prepare the replacement in <a className="underline" href="/schedules">Schedules</a>.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" disabled={!canDecide || unavailableShift || isPending || restReviewIncomplete} onClick={approve}>
            Approve
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canDecide || isPending}
            onClick={deny}
          >
            Deny
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canVoid || isPending}
            onClick={voidRequest}
          >
            Void
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!selectedRequest || isPending}
            onClick={cancelSelection}
          >
            Cancel
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Requested By</TableHead>
              <TableHead>Shift Table</TableHead>
              <TableHead>Coverage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => (
              <TableRow
                key={request.id}
                className={`cursor-pointer hover:bg-muted/60 ${
                  selectedRequestId === request.id ? "bg-muted/60" : ""
                }`}
                onClick={() => selectRequest(request)}
              >
                <TableCell>
                  <button type="button" disabled={isPending} className="min-h-11 text-left font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 disabled:opacity-50" onClick={event => { event.stopPropagation(); selectRequest(request); }}>
                    {request.lastName}, {request.firstName}
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {formatEmployeeNoDisplay(request.employeeNo)}
                  </div>
                </TableCell>
                <TableCell>
                  {request.departmentCode ?? "-"} | {request.departmentName ?? "-"}
                </TableCell>
                <TableCell>{request.requesterEmail}</TableCell>
                <TableCell>
                  {request.payload.scheduleOperation ? operationLabel(request) : formatShiftTableLabel(request.payload.shiftTableId, shiftTableMap)}
                </TableCell>
                <TableCell>{formatCoverage(request)}</TableCell>
                <TableCell>
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${getStatusClasses(
                      request.status,
                    )}`}
                  >
                    {request.status}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="max-w-[260px] truncate" title={request.reason ?? ""}>
                    {request.reason ?? "-"}
                  </div>
                  {request.decisionNote ? (
                    <div className="mt-1 max-w-[260px] truncate text-xs text-muted-foreground">
                      Decision: {request.decisionNote}
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No manager schedule requests found.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

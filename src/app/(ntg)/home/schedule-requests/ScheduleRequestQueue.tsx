"use client";

import { useState, useTransition } from "react";
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
  shiftTableId: number,
  shiftTableMap: Map<number, ShiftTableOption>,
) {
  const shiftTable = shiftTableMap.get(shiftTableId);
  if (!shiftTable) {
    return `Unknown shift table (#${shiftTableId})`;
  }

  return `${shiftTable.code} | ${shiftTable.description}`;
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
  const shiftTableMap = new Map(
    shiftTables.map((shiftTable) => [shiftTable.id, shiftTable]),
  );
  const selectedRequest =
    requests.find((request) => request.id === selectedRequestId) ?? null;
  const canDecide = selectedRequest?.status === "Pending";
  const canVoid =
    selectedRequest?.status === "Approved" && selectedRequest.action === "Create";
  const canEditDecisionNote = canDecide || canVoid;

  function selectRequest(request: RequestRow) {
    setSelectedRequestId(request.id);
    setDecisionNote(request.decisionNote ?? "");
  }

  function cancelSelection() {
    setSelectedRequestId(null);
    setDecisionNote("");
  }

  function approve() {
    if (!selectedRequest || !canDecide) return;

    startTransition(async () => {
      try {
        await approveManagerScheduleChangeRequest({
          requestId: selectedRequest.id,
          decisionNote,
        });
        toast.success("Schedule request approved.");
        cancelSelection();
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Unable to approve request.",
        );
      }
    });
  }

  function deny() {
    if (!selectedRequest || !canDecide) return;
    const note = decisionNote.trim();
    if (!note) {
      toast.error("A denial note is required.");
      return;
    }

    startTransition(async () => {
      try {
        await denyManagerScheduleChangeRequest({
          requestId: selectedRequest.id,
          decisionNote: note,
        });
        toast.success("Schedule request denied.");
        cancelSelection();
        router.refresh();
      } catch (error) {
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
              value={selectedRequest?.action ?? ""}
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
            <label className="mb-2 block text-sm font-medium">Decision Note</label>
            <Textarea
              value={decisionNote}
              onChange={(event) => setDecisionNote(event.target.value)}
              placeholder={
                canVoid ? "Required when voiding" : "Required when denying"
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

        <div className="mt-4 flex gap-2">
          <Button type="button" disabled={!canDecide || isPending} onClick={approve}>
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
                  <div className="font-medium">
                    {request.lastName}, {request.firstName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatEmployeeNoDisplay(request.employeeNo)}
                  </div>
                </TableCell>
                <TableCell>
                  {request.departmentCode ?? "-"} | {request.departmentName ?? "-"}
                </TableCell>
                <TableCell>{request.requesterEmail}</TableCell>
                <TableCell>
                  {formatShiftTableLabel(request.payload.shiftTableId, shiftTableMap)}
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

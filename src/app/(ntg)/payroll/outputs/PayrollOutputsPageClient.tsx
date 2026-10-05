"use client";

import { useEffect, useRef, useState } from "react";
import {
  generateBankBatchAction,
  generateCashBatchAction,
  generateGlJournalAction,
  generateStatutoryPackageAction,
  getPayrollControlBundleAction,
  publishPayslipsAction,
} from "@/app/actions/payrollAction";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PayrollPageNav } from "../PayrollPageNav";
import type { PayrollPeriodSummary, PayrollRunView } from "../types";

type LoadStatus = "idle" | "loading" | "ready" | "error";
type PayrollControlBundleView = Awaited<
  ReturnType<typeof getPayrollControlBundleAction>
>;
type PayrollControlState = {
  status: LoadStatus;
  runId: string | null;
  data: PayrollControlBundleView | null;
  error: string | null;
};

type Props = {
  selectedPeriod: PayrollPeriodSummary | null;
  selectedRun: PayrollRunView | null;
};

const STATUTORY_PACKAGE_OPTIONS = [
  { kind: "SssContribution", label: "SSS Contribution" },
  { kind: "SssLoan", label: "SSS Loan" },
  { kind: "PhilhealthEprs", label: "PhilHealth EPRS" },
  { kind: "PagibigMcrf", label: "Pag-IBIG MCRF" },
  { kind: "Bir1601C", label: "BIR 1601-C" },
  { kind: "Bir1604C", label: "BIR 1604-C" },
  { kind: "Bir2316", label: "BIR 2316" },
  { kind: "Dole13thMonth", label: "DOLE 13th Month" },
] as const;

const moneyFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

function toNumber(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: string | number | null | undefined) {
  return moneyFormatter.format(toNumber(value));
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getToneClass(status: string | null | undefined) {
  if (status === "Posted" || status === "Processed" || status === "Approved") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (status === "Draft" || status === "Reviewed" || status === "Generated") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  }
  if (status === "Void" || status === "Reversed" || status === "Failed") {
    return "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
  }
  return "bg-muted text-muted-foreground";
}

function getArtifactKindLabel(kind: string) {
  const statutory = STATUTORY_PACKAGE_OPTIONS.find((option) => option.kind === kind);
  if (statutory) return statutory.label;
  if (kind === "CashPayrollList") return "Cash Payroll List";
  if (kind === "BankFile") return "Bank File";
  if (kind === "GlJournal") return "GL Journal";
  if (kind === "PayrollRegister") return "Payroll Register";
  return kind;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function PayrollOutputsPageClient({ selectedPeriod, selectedRun }: Props) {
  const [controlState, setControlState] = useState<PayrollControlState>({
    status: "idle",
    runId: null,
    data: null,
    error: null,
  });
  const [actionState, setActionState] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, PayrollControlState>>({});
  const selectedRunId = selectedRun?.id ?? null;
  const currentBundle =
    controlState.runId === selectedRunId ? controlState.data : null;

  async function refreshControlBundle(runId = selectedRunId) {
    if (!runId) return null;
    const bundle = await getPayrollControlBundleAction(runId);
    const nextState: PayrollControlState = {
      status: "ready",
      runId,
      data: bundle,
      error: null,
    };
    cacheRef.current[`control:${runId}`] = nextState;
    setControlState(nextState);
    return bundle;
  }

  useEffect(() => {
    if (!selectedRunId) {
      setControlState({ status: "idle", runId: null, data: null, error: null });
      return;
    }

    const cacheKey = `control:${selectedRunId}`;
    const cached = cacheRef.current[cacheKey];
    if (cached) {
      setControlState(cached);
      return;
    }

    let cancelled = false;
    setControlState({
      status: "loading",
      runId: selectedRunId,
      data: null,
      error: null,
    });

    void (async () => {
      try {
        const bundle = await getPayrollControlBundleAction(selectedRunId);
        if (cancelled) return;
        const nextState: PayrollControlState = {
          status: "ready",
          runId: selectedRunId,
          data: bundle,
          error: null,
        };
        cacheRef.current[cacheKey] = nextState;
        setControlState(nextState);
      } catch (error) {
        if (cancelled) return;
        setControlState({
          status: "error",
          runId: selectedRunId,
          data: null,
          error: getErrorMessage(error, "Unable to load payroll outputs."),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  async function runOutputAction(
    label: string,
    callback: () => Promise<unknown>,
    successMessage: string
  ) {
    if (!selectedRunId) return;
    try {
      setActionState(label);
      await callback();
      delete cacheRef.current[`control:${selectedRunId}`];
      await refreshControlBundle(selectedRunId);
      toast.success(successMessage);
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to generate payroll output."));
    } finally {
      setActionState(null);
    }
  }

  return (
    <div className="space-y-6">
      <PayrollPageNav
        activeSection="outputs"
        title="Payroll Outputs"
        description="Generate payslips, disbursement batches, accounting journals, statutory filing packages, and review output history."
        periodCode={selectedPeriod?.code}
        runLabel={selectedRun ? `#${selectedRun.runNumber} (${selectedRun.status})` : null}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Output Actions</CardTitle>
          <CardDescription>
            Outputs can be generated after the selected run is approved or posted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedRun ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Compute a payroll run before generating outputs.
            </div>
          ) : !["Approved", "Posted"].includes(selectedRun.status) ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              Outputs can be generated after the run is Approved or Posted.
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Button
                  type="button"
                  onClick={() =>
                    void runOutputAction(
                      "publish-payslips",
                      () => publishPayslipsAction(selectedRun.id),
                      "Payslips published."
                    )
                  }
                  disabled={actionState !== null}
                >
                  {actionState === "publish-payslips"
                    ? "Publishing..."
                    : "Publish Payslips"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void runOutputAction(
                      "generate-bank",
                      () => generateBankBatchAction(selectedRun.id),
                      "Bank file generated."
                    )
                  }
                  disabled={actionState !== null}
                >
                  Generate Bank File
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void runOutputAction(
                      "generate-cash",
                      () => generateCashBatchAction(selectedRun.id),
                      "Cash payroll list generated."
                    )
                  }
                  disabled={actionState !== null}
                >
                  Generate Cash List
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void runOutputAction(
                      "generate-gl",
                      () => generateGlJournalAction(selectedRun.id),
                      "GL journal generated."
                    )
                  }
                  disabled={actionState !== null}
                >
                  Generate GL Journal
                </Button>
              </div>

              <div className="rounded-lg border p-3">
                <div className="mb-3 text-sm font-semibold">
                  Statutory And Compliance Packages
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {STATUTORY_PACKAGE_OPTIONS.map((option) => (
                    <Button
                      key={option.kind}
                      type="button"
                      variant="outline"
                      onClick={() =>
                        void runOutputAction(
                          `generate-${option.kind}`,
                          () =>
                            generateStatutoryPackageAction(
                              selectedRun.id,
                              option.kind
                            ),
                          `${option.label} package generated.`
                        )
                      }
                      disabled={actionState !== null}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {controlState.status === "loading" ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading payroll outputs...
          </CardContent>
        </Card>
      ) : controlState.status === "error" ? (
        <Card>
          <CardContent className="py-10">
            <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
              {controlState.error ?? "Unable to load payroll outputs."}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Generated Artifacts</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kind</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>File</TableHead>
                        <TableHead>Generated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(currentBundle?.artifacts ?? []).map((artifact) => (
                        <TableRow key={artifact.id}>
                          <TableCell className="font-medium">
                            {getArtifactKindLabel(artifact.kind)}
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "rounded-full px-2 py-1 text-xs font-medium",
                                getToneClass(artifact.status)
                              )}
                            >
                              {artifact.status}
                            </span>
                          </TableCell>
                          <TableCell>{artifact.fileName ?? "-"}</TableCell>
                          <TableCell>{formatDateTime(artifact.generatedAt)}</TableCell>
                        </TableRow>
                      ))}
                      {(currentBundle?.artifacts.length ?? 0) === 0 && (
                        <EmptyRow colSpan={4} message="No artifacts generated for this run yet." />
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Disbursement And GL</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Employees</TableHead>
                        <TableHead>Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(currentBundle?.disbursements ?? []).map((batch) => (
                        <TableRow key={batch.id}>
                          <TableCell>{batch.batchType}</TableCell>
                          <TableCell>{batch.status}</TableCell>
                          <TableCell>{batch.employeeCount}</TableCell>
                          <TableCell>{formatMoney(batch.totalNetPay)}</TableCell>
                        </TableRow>
                      ))}
                      {(currentBundle?.disbursements.length ?? 0) === 0 && (
                        <EmptyRow colSpan={4} message="No disbursement batches yet." />
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Journal</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Debits</TableHead>
                        <TableHead>Credits</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(currentBundle?.journals ?? []).map((journal) => (
                        <TableRow key={journal.id}>
                          <TableCell>GL Journal</TableCell>
                          <TableCell>{journal.status}</TableCell>
                          <TableCell>{formatMoney(journal.totalDebits)}</TableCell>
                          <TableCell>{formatMoney(journal.totalCredits)}</TableCell>
                        </TableRow>
                      ))}
                      {(currentBundle?.journals.length ?? 0) === 0 && (
                        <EmptyRow colSpan={4} message="No GL journal generated yet." />
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Statutory Filing Tracker</CardTitle>
              <CardDescription>
                Filing packages start as generated records and can later move
                through submitted, paid, and reconciled operations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Package</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Coverage</TableHead>
                      <TableHead>Amount Due</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(currentBundle?.statutoryPackages ?? []).map((filing) => (
                      <TableRow key={filing.id}>
                        <TableCell className="font-medium">
                          {getArtifactKindLabel(filing.kind)}
                        </TableCell>
                        <TableCell>{filing.status}</TableCell>
                        <TableCell>
                          {filing.periodStart} to {filing.periodEnd}
                        </TableCell>
                        <TableCell>{formatMoney(filing.amountDue)}</TableCell>
                        <TableCell>{formatDateTime(filing.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                    {(currentBundle?.statutoryPackages.length ?? 0) === 0 && (
                      <EmptyRow colSpan={5} message="No statutory filing packages generated yet." />
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Audit History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Status Change</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(currentBundle?.events ?? []).map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="font-medium">
                          {event.eventType}
                        </TableCell>
                        <TableCell>
                          {[event.fromStatus, event.toStatus].filter(Boolean).join(" -> ") ||
                            "-"}
                        </TableCell>
                        <TableCell>{event.actorUserId}</TableCell>
                        <TableCell>{event.notes ?? "-"}</TableCell>
                        <TableCell>{formatDateTime(event.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                    {(currentBundle?.events.length ?? 0) === 0 && (
                      <EmptyRow colSpan={5} message="No payroll run events recorded yet." />
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  );
}

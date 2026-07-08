"use client";

import { useEffect, useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/components/inputs/InputWithLabel";
import {
  getEmployeeLoanDeductionHistory,
  getEmployeeLoanSchedule,
  skipLoanInstallmentAction,
} from "@/app/actions/loanAction";
import {
  type EmployeeLoanDeductionHistoryPage,
  type EmployeeLoanScheduleRow,
} from "@/zod-schemas/employeeLoan";
import { getPayrollCodeDetails } from "@/lib/utils";

interface LoanFormTableProps {
  loanId?: string;
  reloadFlag: number;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function LoanFormTable({ loanId, reloadFlag }: LoanFormTableProps) {
  const router = useRouter();
  const [historyPage, setHistoryPage] = useState<EmployeeLoanDeductionHistoryPage | null>(
    null
  );
  const [scheduleRows, setScheduleRows] = useState<EmployeeLoanScheduleRow[]>([]);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isScheduleLoading, setIsScheduleLoading] = useState(false);
  const [scheduleReloadFlag, setScheduleReloadFlag] = useState(0);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [skippingInstallmentId, setSkippingInstallmentId] = useState<string | null>(
    null
  );

  const { execute: skipInstallment, status: skipStatus } = useAction(
    skipLoanInstallmentAction,
    {
      onSuccess: (res) => {
        setSkippingInstallmentId(null);
        const data = res?.data;

        if (!data) return;

        if ("error" in data && data.error) {
          alert(data.error);
          return;
        }

        if ("message" in data && data.message) {
          alert(data.message);
        }

        setScheduleReloadFlag((current) => current + 1);
        router.refresh();
      },
      onError: () => {
        setSkippingInstallmentId(null);
        alert("Error skipping installment. Please try again.");
      },
    }
  );

  useEffect(() => {
    setPage(1);
  }, [loanId, reloadFlag]);

  useEffect(() => {
    if (!loanId || !showSchedule) return;

    let cancelled = false;

    async function fetchSchedule() {
      setIsScheduleLoading(true);
      try {
        const data = await getEmployeeLoanSchedule(loanId!);
        if (!cancelled) {
          setScheduleRows(data);
        }
      } finally {
        if (!cancelled) {
          setIsScheduleLoading(false);
        }
      }
    }

    void fetchSchedule();

    return () => {
      cancelled = true;
    };
  }, [loanId, reloadFlag, scheduleReloadFlag, showSchedule]);

  useEffect(() => {
    if (!loanId || !showHistory) return;

    let cancelled = false;

    async function fetchHistory() {
      setIsLoading(true);
      try {
        const data = await getEmployeeLoanDeductionHistory(loanId!, page);
        if (!cancelled) {
          setHistoryPage(data);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchHistory();

    return () => {
      cancelled = true;
    };
  }, [loanId, page, reloadFlag, scheduleReloadFlag, showHistory]);

  if (!loanId) return null;

  function handleSkipInstallment(row: EmployeeLoanScheduleRow) {
    if (!loanId) return;

    const reason = window.prompt(
      `Reason for skipping installment #${row.installmentNo} (${row.payrollCode})`
    );
    const skipReason = reason?.trim();

    if (reason == null) return;

    if (!skipReason) {
      alert("Skip reason is required.");
      return;
    }

    setSkippingInstallmentId(row.id);
    skipInstallment({
      loanId,
      installmentId: row.id,
      skipReason,
    });
  }

  const rows = historyPage?.rows ?? [];
  const currentPage = historyPage?.page ?? page;
  const totalPages = historyPage?.totalPages ?? 1;
  const totalRows = historyPage?.totalRows ?? 0;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowSchedule((current) => !current)}
          aria-pressed={showSchedule}
        >
          {showSchedule ? "Hide Loan Expected Schedule" : "Loan Expected Schedule"}
        </Button>
      </div>

      {showSchedule ? (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Loan Schedule</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payroll Code</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Installment #</TableHead>
                <TableHead>Scheduled Amount</TableHead>
                <TableHead>Balance After</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isScheduleLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : scheduleRows.length > 0 ? (
                scheduleRows.map((row) => {
                  const canSkip = row.status === "Pending" || row.status === "Due";
                  const isSkipping =
                    skipStatus === "executing" && skippingInstallmentId === row.id;

                  return (
                    <TableRow key={row.id}>
                      <TableCell>{row.payrollCode}</TableCell>
                      <TableCell>{formatDate(row.dueDate)}</TableCell>
                      <TableCell>{row.installmentNo}</TableCell>
                      <TableCell>{formatMoney(row.scheduledAmount)}</TableCell>
                      <TableCell>
                        {row.balanceAfter == null ? "-" : formatMoney(row.balanceAfter)}
                      </TableCell>
                      <TableCell>{row.status}</TableCell>
                      <TableCell>
                        {canSkip ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={skipStatus === "executing"}
                            onClick={() => handleSkipInstallment(row)}
                          >
                            {isSkipping ? "Skipping..." : "Skip"}
                          </Button>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No installments have been scheduled for this loan.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </>
      ) : null}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowHistory((current) => !current)}
          aria-pressed={showHistory}
        >
          {showHistory ? "Hide Loan Deduction History" : "Loan Deduction History"}
        </Button>
      </div>

      {showHistory ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payment Date</TableHead>
                <TableHead>Payroll Code</TableHead>
                <TableHead>Covered Period</TableHead>
                <TableHead>Installment #</TableHead>
                <TableHead>Deducted Amount</TableHead>
                <TableHead>Balance After</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : rows.length > 0 ? (
                rows.map((row) => {
                  const payrollDetails = row.payrollCode
                    ? getPayrollCodeDetails(row.payrollCode)
                    : null;

                  return (
                    <TableRow key={row.id}>
                      <TableCell>{formatDate(row.paymentDate)}</TableCell>
                      <TableCell>{row.payrollCode ?? "-"}</TableCell>
                      <TableCell>{payrollDetails?.period ?? "-"}</TableCell>
                      <TableCell>{row.installmentNo ?? "-"}</TableCell>
                      <TableCell>{formatMoney(row.deductedAmount)}</TableCell>
                      <TableCell>
                        {row.balanceAfter == null
                          ? "-"
                          : formatMoney(row.balanceAfter)}
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No deductions have been posted for this loan.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">
              Page {currentPage} of {Math.max(1, totalPages)} [{totalRows} total rows]
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isLoading || currentPage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isLoading || currentPage >= totalPages}
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
              >
                Next
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PayrollPageNav } from "../PayrollPageNav";
import { PAYROLL_SECTION_PATHS, type PayrollSection } from "../sections";
import type {
  PayrollPeriodSummary,
  PayrollRunLineView,
  PayrollRunView,
} from "../types";

type Props = {
  selectedPeriod: PayrollPeriodSummary | null;
  selectedRun: PayrollRunView | null;
};

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

function getThirteenthMonthEligibleTotal(run: PayrollRunView | null) {
  return (run?.employees ?? []).reduce(
    (total, employee) =>
      total +
      employee.lines
        .filter(isThirteenthMonthEligibleLine)
        .reduce((lineTotal, line) => lineTotal + toNumber(line.amount), 0),
    0
  );
}

function isThirteenthMonthEligibleLine(line: PayrollRunLineView) {
  return line.lineType === "Earning" && line.month13thEligible;
}

export function PayrollSpecialRunPageClient({ selectedPeriod, selectedRun }: Props) {
  const searchParams = useSearchParams();
  const eligibleTotal = getThirteenthMonthEligibleTotal(selectedRun);

  function getHref(section: PayrollSection) {
    const queryString = searchParams.toString();
    const path = PAYROLL_SECTION_PATHS[section];
    return queryString ? `${path}?${queryString}` : path;
  }

  return (
    <div className="space-y-6">
      <PayrollPageNav
        context={{periodId:selectedPeriod?.id,year:selectedPeriod?.startDate.slice(0,4),runId:selectedRun?.id,group:selectedRun?.payrollGroup??undefined}}
        activeSection="specialRun"
        title="Special Run"
        description="Prepare non-standard payroll scenarios such as 13th month, final pay, and supplemental or off-cycle runs."
        periodCode={selectedPeriod?.code}
        runLabel={selectedRun ? `#${selectedRun.runNumber} (${selectedRun.status})` : null}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>13th Month Pay</CardTitle>
            <CardDescription>
              Preview eligible earnings from the selected run and generate the
              DOLE 13th Month package from Payroll Outputs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Selected Run Eligible Earnings
              </div>
              <div className="mt-1 text-lg font-semibold">
                {formatMoney(eligibleTotal)}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Estimated one-twelfth basis: {formatMoney(eligibleTotal / 12)}
              </div>
            </div>
            <Button asChild variant="outline" disabled={!selectedRun}>
              <Link href={getHref("outputs")}>Open Payroll Outputs</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Final Pay</CardTitle>
            <CardDescription>
              Use this checkpoint for separated employees, leave encashment, loan
              balance review, and tax adjustment before posting.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="rounded-lg border p-3">
              Final Pay run type exists in payroll storage. Continue in Manual
              Payroll to prepare employee-specific override values.
            </div>
            <Button asChild variant="outline">
              <Link href={getHref("manual")}>Open Manual Payroll</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Supplemental / Off-Cycle</CardTitle>
            <CardDescription>
              Use account-code rows and manual payroll entries for bonus,
              correction, retro pay, reimbursement, or special deduction runs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="rounded-lg border p-3">
              OffCycle and Supplemental run types exist in payroll storage. Use
              Payroll Account Code rows to stage the values for the period.
            </div>
            <Button asChild variant="outline" disabled={!selectedPeriod}>
              <Link href={getHref("accountCodes")}>Open Account Codes</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

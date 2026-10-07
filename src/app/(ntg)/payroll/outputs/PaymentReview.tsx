"use client";
import { useEffect, useRef, useState } from "react";
import { generateBankBatchAction, generateCashBatchAction, getPayrollPaymentReviewAction } from "@/app/actions/payrollAction";
import { Button } from "@/components/ui/button";
import type { PaymentMode } from "@/lib/payroll/paymentModel";

type Review = Awaited<ReturnType<typeof getPayrollPaymentReviewAction>>;
const money = (value: number) => new Intl.NumberFormat("en-PH", {style: "currency", currency: "PHP"}).format(value);

export function PayrollDownloadLink({url, children}: {url: string; children: React.ReactNode}) {
  return <Button asChild variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal text-center"><a href={url} download>{children}</a></Button>;
}

export function PaymentReview({runId, status, onGenerated}: {runId: string; status: string; onGenerated: () => Promise<unknown>}) {
  const [review, setReview] = useState<Review | null>(null);
  const [unassignedMode, setUnassignedMode] = useState<PaymentMode | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [prepared, setPrepared] = useState<{artifactId: string | null; totalNetPay: string; employeeCount: number} | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setReview(null); setError(null); setPrepared(null);
    void getPayrollPaymentReviewAction(runId).then(value => {if (active) {
      setReview(value);
      const remembered=value.preparedLists[0]?.unassignedMode;
      setUnassignedMode(current=>current||(remembered==="Bank"||remembered==="Cash"?remembered:""));
    }}).catch(() => {if (active) setError("Payment review could not load. Retry; this does not change payroll.");});
    return () => {active = false;};
  }, [runId, status, retry]);
  useEffect(() => {if (error) errorRef.current?.focus();}, [error]);
  async function action(name: string, operation: () => Promise<unknown>) {
    setBusy(name); setError(null);
    try {await operation();setReview(await getPayrollPaymentReviewAction(runId));} catch (cause) {
      try {setReview(await getPayrollPaymentReviewAction(runId));} catch {/* Keep the local receipt when a status read also fails. */}
      setError(cause instanceof Error ? cause.message : "The response was interrupted. Check the prepared lists below before retrying.");
    } finally {setBusy(null);}
  }
  const unassignedCount = review?.rows.filter(row => Number(row.netPay) > 0 && !row.paymentMode).length ?? 0;
  const canPrepare = ["Approved", "Posted"].includes(status) && (!unassignedCount || !!unassignedMode) && !!review;
  return <section aria-labelledby="payment-review-title" className="min-w-0 space-y-3 rounded-lg border p-4">
    <h2 id="payment-review-title" className="text-lg font-semibold">Payment review</h2>
    <p className="text-sm text-muted-foreground">Review downloads are available before approval. Preparing a list does not transfer money. A bank-specific upload format must be confirmed with your bank.</p>
    {error && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded border border-red-400 p-3 text-sm"><p>{error}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)} disabled={!!busy}>Refresh status</Button></div>}
    {!review ? <p role="status">Loading payment review…</p> : <>
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>Positive payments<strong className="block">{money(review.payable)} · {review.positiveCount} people</strong></div>
        <div>Calculated net<strong className="block">{money(review.net)}</strong></div>
        <div>Deduction shortfalls<strong className="block">{money(review.shortfall)} · {review.shortfalls.length} people</strong></div>
        <div>Zero net<strong className="block">{review.zeroCount} people</strong></div>
      </div>
      {review.preparedLists.length>0&&<div aria-label="Prepared payment lists" className="space-y-2 rounded border border-emerald-500 p-3 text-sm"><strong>Prepared payment lists</strong><p>Saved lists remain available after leaving this page. Preparing or downloading a list does not transfer money.</p>{review.preparedLists.map(list=><div key={list.id} className="flex min-w-0 flex-wrap items-center gap-2"><span>{list.batchType} · {list.employeeCount} people · {money(Number(list.totalNetPay))}</span><PayrollDownloadLink url={`/api/payroll/output?runId=${runId}&format=payment&artifactId=${list.artifactId}`}>Download {list.batchType} list</PayrollDownloadLink></div>)}</div>}
      {review.shortfalls.length > 0 && <div className="rounded border border-amber-400 p-3 text-sm"><p className="font-semibold">No transfer for employees with a deduction shortfall</p>{review.shortfalls.map(row => <p key={row.employeeId}>{row.name} ({row.employeeNo}): {money(row.amount)}</p>)}<p className="mt-2">{review.policyText}</p></div>}
      {review.recoveries.length > 0 && <details className="rounded border p-3 text-sm">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">Deductions now and carried balances · {review.recoveries.length} people</summary>
        <p className="mb-2 text-muted-foreground">{status === "Posted" ? "Amounts recorded by this payroll." : "Preview only; posting records the recovery."} Current deductions come first; prior shortfalls use remaining positive pay. Original contributions are not charged a second time.</p>
        <ul className="space-y-3">{review.recoveries.map(row => <li key={row.employeeId} className="break-words border-t pt-2"><strong>{row.name}</strong><br/>Deducted from earnings: {money(row.collected)} · Prior shortfall recovered: {money(row.recovered)}<br/>Prior balance remaining: {money(row.remaining)} · New shortfall: {money(row.carriedForward)}</li>)}</ul>
      </details>}
      {unassignedCount > 0 && <label className="block text-sm">Pay {unassignedCount} employees with no assigned payment method by
        <select aria-label="Payment method for unassigned employees" value={unassignedMode} onChange={event => {setUnassignedMode(event.target.value as PaymentMode | ""); setPrepared(null);}} className="mt-1 block min-h-11 w-full rounded border bg-background px-3 md:max-w-xs">
          <option value="">Choose payment method</option><option value="Bank">Bank</option><option value="Cash">Cash</option>
        </select><span className="text-xs text-muted-foreground">Applies to this output; employee profiles are unchanged. Existing Bank/Cash assignments are respected.</span>
      </label>}
      <div className="flex flex-wrap gap-2">
        <PayrollDownloadLink url={`/api/payroll/output?runId=${runId}&format=register`}>Download register CSV</PayrollDownloadLink>
        <PayrollDownloadLink url={`/api/payroll/output?runId=${runId}&format=payslips`}>Download {status === "Posted" ? "payslips" : "preview payslips"} PDF</PayrollDownloadLink>
        {(["Bank", "Cash"] as const).map(mode => <Button key={mode} disabled={!!busy || !canPrepare} onClick={() => void action(mode, async () => {
          const batch = await (mode === "Bank" ? generateBankBatchAction : generateCashBatchAction)(runId, unassignedMode || undefined);
          setPrepared(batch); await onGenerated();
        })}>Prepare {mode.toLowerCase()} payment list</Button>)}
      </div>
      {!["Approved", "Posted"].includes(status) && <p className="text-sm">Approve this run to prepare its final payment list.</p>}
      {busy && <p role="status" className="text-sm">Working on {busy}…</p>}
      {prepared?.artifactId && <div role="status" className="space-y-2 rounded border p-3 text-sm"><p>Prepared {prepared.employeeCount} payments totaling {money(Number(prepared.totalNetPay))}.</p><PayrollDownloadLink url={`/api/payroll/output?runId=${runId}&format=payment&artifactId=${prepared.artifactId}`}>Download payment list CSV</PayrollDownloadLink></div>}
      <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3">Review {review.positiveCount} payment recipients</summary><ul className="space-y-2">{review.rows.filter(row => Number(row.netPay) > 0).map(row => <li key={row.employeeId} className="break-words border-t py-2"><strong>{row.employeeNameSnapshot}</strong> · {row.employeeNoSnapshot}<br/>{money(Number(row.netPay))} · {(row.paymentMode ?? unassignedMode) || "Choose method"} · {row.bankAccountLast4 ? `Account ending ${row.bankAccountLast4}` : "No bank account"}</li>)}</ul></details>
    </>}
  </section>;
}

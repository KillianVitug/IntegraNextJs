"use client";
import React from "react";
import type { ProvisionalDay, ProvisionalEmployee } from "@/lib/payroll/provisionalTypes";
import { formatWorkday } from "@/lib/payroll/dateDisplay";
import { findingsForProvisionalView, matchingProvisionalDays, provisionalCountLabel, provisionalViewDescriptions, provisionalViewLabels, provisionalViews, summarizeProvisionalView, type ProvisionalReviewScope, type ProvisionalView } from "@/lib/payroll/provisionalReview";

const button = "inline-flex min-h-11 items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600";
const primary: ProvisionalView[] = ["all", "attention", "scheduled-no-attendance"];

export function ProvisionalReviewFilters({ rows, view, scope, onChange }: { rows: ProvisionalEmployee[]; view: ProvisionalView; scope: ProvisionalReviewScope; onChange: (view: ProvisionalView) => void }) {
  const count = (value: ProvisionalView) => { const result = summarizeProvisionalView(rows, value, scope); return provisionalCountLabel(result.employeeCount, result.dayCount, !["all", "no-work", "pay"].includes(value)); };
  return <div className="min-w-0 space-y-2" aria-label="Employee view">
    <div className="flex flex-wrap gap-2">{primary.map(value => <button key={value} className={`${button} min-w-0 flex-col items-start text-left ${view === value ? "bg-blue-700 text-white" : ""}`} aria-pressed={view === value} onClick={() => onChange(value)}><span>{provisionalViewLabels[value]}</span><span className="text-xs font-normal">{count(value)}</span></button>)}</div>
    <details className="min-w-0 rounded-lg border px-3" open={!primary.includes(view)}><summary className="flex min-h-11 cursor-pointer items-center font-semibold">More filters{!primary.includes(view) ? ` · ${provisionalViewLabels[view]}` : ""}</summary>
      <label className="mb-3 block min-w-0 text-xs">Review category<select className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm" value={primary.includes(view) ? "" : view} onChange={event => { if (event.target.value) onChange(event.target.value as ProvisionalView); }}><option value="">Choose a filter</option>{provisionalViews.filter(value => !primary.includes(value)).map(value => <option key={value} value={value}>{provisionalViewLabels[value]} · {count(value)}</option>)}</select></label>
    </details>
    <p className="text-xs text-muted-foreground">{provisionalViewDescriptions[view]}</p>
  </div>;
}

export function ProvisionalReviewDayList({ row, view, scope, onOpen, holdHref }: { row: ProvisionalEmployee; view: ProvisionalView; scope: ProvisionalReviewScope; onOpen: (day: string, edit: "attendance" | "schedule") => void; holdHref: (day: string) => string }) {
  const days = matchingProvisionalDays(row, view, scope);
  if (!days.length) return null;
  const renderDay = (day: ProvisionalDay) => <li key={day.date} className="min-w-0 rounded-lg bg-muted/30 px-3 py-2 text-sm">
    <time dateTime={day.date} className="font-medium">{formatWorkday(day.date)}</time>
    <ul className="mt-1 space-y-2">{findingsForProvisionalView(day, view, scope).map(finding => <li key={finding.code} className="flex min-w-0 flex-wrap items-center justify-between gap-2"><div className="min-w-0 flex-1 basis-48"><p className="break-words text-xs text-muted-foreground">{finding.label}</p>{finding.code === "corrected" && day.review?.correctedAt && <p className="mt-1 text-xs text-muted-foreground">Saved {new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(day.review.correctedAt))} Philippine time</p>}</div>{finding.destination === "hold" ? <a className={button} href={holdHref(day.date)}>{finding.action}</a> : <button className={button} onClick={() => onOpen(day.date, finding.edit)}>{finding.action}</button>}</li>)}</ul>
  </li>;
  return <div className="mt-3 space-y-2"><ul className="space-y-2">{days.slice(0, 2).map(renderDay)}</ul>{days.length > 2 && <details><summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">View {days.length - 2} more matching workday{days.length - 2 === 1 ? "" : "s"}</summary><ul className="space-y-2">{days.slice(2).map(renderDay)}</ul></details>}</div>;
}

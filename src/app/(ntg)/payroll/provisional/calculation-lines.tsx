"use client";

import { useState } from "react";
import type { ProvisionalLine } from "@/lib/payroll/provisionalTypes";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const dateFormatter = new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
function dateLabel(day: string) {
  const value = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(value.getTime()) ? dateFormatter.format(value) : day;
}
function duration(minutes: number) {
  const absolute = Math.abs(minutes), hours = Math.floor(absolute / 60), remainder = Number((absolute % 60).toFixed(2));
  return `${minutes < 0 ? "−" : ""}${hours ? `${hours}h${remainder ? " " : ""}` : ""}${remainder || !hours ? `${remainder}m` : ""}`;
}
type Props = {
  lines: ProvisionalLine[];
  period: { startDate: string; endDate: string };
  asOfDate: string;
  scenario: "recorded" | "forecast";
  availableWorkDates: string[];
  onOpenDay: (day: string) => void;
};
type Group = { key: string; title: string; day?: string; periodLabel: string; lines: ProvisionalLine[] };

function quantityLabel(line: ProvisionalLine) {
  const details = line.details;
  if (details?.quantityMinutes != null) return duration(details.quantityMinutes);
  if (line.quantity == null) return null;
  const unit = details?.quantityUnit;
  return unit ? `${line.quantity} ${unit}` : `Quantity ${line.quantity}`;
}

export function CalculationLines({ lines, period, asOfDate, scenario, availableWorkDates, onOpenDay }: Props) {
  const [accounting, setAccounting] = useState(false);
  const groups = new Map<string, Group>();
  for (const line of lines) {
    const details = line.details;
    const employer = line.lineType === "Employer Contribution", information = line.lineType === "Information";
    const day = !employer && !information && details?.scope === "day" ? details.workDate : undefined;
    const range = !employer && !information && details?.scope === "range" && details.startDate && details.endDate ? `${details.startDate}:${details.endDate}` : undefined;
    const start = details?.startDate ?? period.startDate, end = details?.endDate ?? period.endDate;
    const periodLabel = `${dateLabel(start)} - ${dateLabel(end)}`;
    const key = employer ? `4:${start}:${end}` : information ? `5:${start}:${end}` : day ? `1:${day}` : range ? `2:${range}` : `3:${start}:${end}`;
    const title = employer ? "Employer contributions" : information ? "Other information" : day ? dateLabel(day) : range ? `${dateLabel(details!.startDate!)} - ${dateLabel(details!.endDate!)}` : "Period earnings and deductions";
    if (!groups.has(key)) groups.set(key, { key, title, day, periodLabel, lines: [] });
    groups.get(key)!.lines.push(line);
  }
  return <div className="min-w-0 space-y-3">
    <p className="text-xs text-muted-foreground">{scenario === "recorded" ? `Recorded work through ${dateLabel(asOfDate)}. Period items follow their own pay rules.` : "Projected work is labelled below; completed work and period items retain their own basis."}</p>
    {lines.length === 0 ? <p className="py-3 text-sm text-muted-foreground">No calculation entries for this estimate.</p> : <>
      <button type="button" aria-pressed={accounting} className="inline-flex min-h-11 items-center rounded px-1 text-xs text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300" onClick={() => setAccounting(value => !value)}>{accounting ? "Hide accounting details" : "Show accounting details"}</button>
      {[...groups.values()].sort((a, b) => a.key.localeCompare(b.key)).map(group => <section key={group.key} aria-label={group.title} className="min-w-0 border-t pt-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <h4 className="text-sm font-semibold">{group.day ? <time dateTime={group.day}>{group.title}</time> : group.title}</h4>
          {group.day && availableWorkDates.includes(group.day) && <button type="button" onClick={() => onOpenDay(group.day!)} aria-label={`View attendance for ${group.title}`} className="inline-flex min-h-11 items-center text-xs text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-300">View attendance</button>}
        </div>
        {group.key.startsWith("3:") && <p className="text-xs text-muted-foreground">{group.periodLabel}</p>}
        {group.key.startsWith("4:") && <p className="text-xs text-muted-foreground">{group.periodLabel} · Paid by the employer; not deducted from employee pay.</p>}
        <ul className="divide-y">{group.lines.map((line, index) => {
          const details = line.details, quantity = quantityLabel(line);
          return <li key={`${line.code}:${index}`} className="min-w-0 py-3 text-sm">
            <div className="flex min-w-0 items-start justify-between gap-3"><p className="min-w-0 break-words font-medium">{line.description || line.code}</p><span className="shrink-0 tabular-nums">{money(line.amount)}</span></div>
            <p className="mt-1 text-xs text-muted-foreground">{line.lineType}{quantity ? ` · ${quantity}` : ""}{details?.formula ? ` at ${money(details.formula.hourlyRate)}/hour` : ""}{details?.projected ? " · Projected work" : ""}</p>
            {details?.actualLateMinutes != null && <p className="mt-1 text-xs">Actual lateness: {duration(details.actualLateMinutes)}{details.penaltyMinutes ? ` · Accumulated-lateness penalty applied: ${duration(details.penaltyMinutes)}` : ""}</p>}
            {details?.dueDate && <p className="mt-1 text-xs">Due {dateLabel(details.dueDate)}</p>}
            {details?.notes.map((note, noteIndex) => <p key={noteIndex} className="mt-1 text-xs text-muted-foreground">{note}</p>)}
            {accounting && <p className="mt-2 break-words text-xs text-muted-foreground">Account {line.code}{line.quantity != null ? ` · Stored quantity ${line.quantity}` : ""}{line.rate != null ? ` · Stored rate ${money(line.rate)}` : ""}. Amount shown is the calculation result.</p>}
          </li>;
        })}</ul>
      </section>)}
    </>}
  </div>;
}

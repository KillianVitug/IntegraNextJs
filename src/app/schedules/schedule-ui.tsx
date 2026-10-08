"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export const inputClass = "min-h-10 min-w-0 max-w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

export const ScheduleButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }>(function ScheduleButton({ primary, className = "", ...props }, ref) {
  return <button ref={ref} type="button" {...props} className={`min-h-10 rounded-md border px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${primary ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"} ${className}`} />;
});

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1 text-sm font-medium"><span>{label}</span>{children}</label>;
}

export function ScheduleNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`break-words rounded-md border p-3 text-sm ${error ? "border-destructive bg-destructive/5 text-destructive" : "border-blue-300 bg-blue-50 text-slate-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100"}`}>{children}</div>;
}

export const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export function calendarDate(day: string, weekday = false) {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return day;
  return new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", month: "short", day: "numeric", ...(weekday ? { weekday: "short" as const } : { year: "numeric" as const }) }).format(parsed);
}

export function calendarWeeks(dates: string[]) {
  const weeks: string[][] = [];
  for (const date of dates) {
    if (!weeks.length || new Date(`${date}T12:00:00Z`).getUTCDay() === 1) weeks.push([]);
    weeks[weeks.length - 1].push(date);
  }
  return weeks;
}

export function manilaTimestamp(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export function cellKey(employeeId: string, day: string) { return `${employeeId}:${day}`; }

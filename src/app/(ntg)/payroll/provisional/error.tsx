"use client";
export default function ErrorView({ reset }: { reset: () => void }) { return <div role="alert" className="space-y-3 rounded-xl border p-5"><h1 className="text-xl font-semibold">Provisional payroll could not load</h1><p>No payroll was created. Retry loading this view.</p><button className="min-h-11 rounded border px-4" onClick={reset}>Try again</button></div>; }

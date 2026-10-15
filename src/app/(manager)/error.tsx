"use client";

export default function ManagerError({ reset }: { reset: () => void }) {
  return <section role="alert" className="space-y-3 rounded-lg border p-5">
    <h1 className="text-xl font-semibold">This workspace could not load</h1>
    <p>Current records and review counts could not be verified. Reload to try again.</p>
    <button type="button" className="min-h-11 rounded-md border px-4 font-medium" onClick={reset}>Try again</button>
    <p className="text-sm text-muted-foreground">If this continues, ask your administrator to check access and service availability.</p>
  </section>;
}

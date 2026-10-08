export default function SchedulesLoading() {
  return <main className="mx-auto w-full max-w-[1600px] space-y-4 p-4 sm:p-6" aria-busy="true" aria-label="Loading schedules"><h1 className="text-2xl font-semibold">Schedules</h1><p className="text-sm text-muted-foreground" role="status">Loading your branch schedules…</p><div className="h-28 animate-pulse rounded-xl bg-muted" /><div className="h-80 animate-pulse rounded-xl bg-muted" /></main>;
}

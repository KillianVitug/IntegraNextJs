"use client";

import { ScheduleButton } from "./schedule-ui";

export default function SchedulesError({ reset }: { error: Error; reset: () => void }) {
  return <main className="mx-auto w-full max-w-3xl space-y-4 p-4"><h1 className="text-xl font-semibold">Schedules could not load</h1><p role="alert">The request did not complete. Saved schedules and drafts are retained.</p><ScheduleButton primary onClick={reset}>Try loading schedules again</ScheduleButton></main>;
}

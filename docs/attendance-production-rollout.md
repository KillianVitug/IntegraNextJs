# Attendance production rollout

The owner authorized completing production attendance activation on 3 October 2026,
after merging PR #1. This supersedes the earlier Preview-only instructions.

Production uses the existing Integra Neon main database. Before applying migration
0119, a private production backup was restored locally and the additive migration
was rehearsed. All 93 existing table-data checksums matched the restored copy.
The production migration added six attendance source/audit tables and the API enum;
all 93 prior tables' data and 116 historical ledger entries were preserved. Only
the reviewed additive migration was applied; older migrations were not replayed.
Full historical migration-source reconciliation remains separate maintenance work.

## Connection and schedule

Production requires `ATTENDANCE_SOURCE_ENABLED=true`, the existing attendance
origin and payroll-read token, an active administrator `ATTENDANCE_SYNC_ACTOR_ID`,
and a separate random `CRON_SECRET`. Keep secrets outside source control.
`ATTENDANCE_VERCEL_CRON_ENABLED=true` enables authenticated GET invocations.
The Vercel configuration invokes reconciliation every 15 minutes. The route has
a five-minute limit, retains the bounded 45-day period window, and preserves the
existing locking, repeat-sync, posted-input and source-exception safeguards.
Reconciliation does not compute, approve, post or pay payroll.

`ATTENDANCE_SOURCE_START_DATE` optionally limits automatic and manual syncing to
periods beginning on or after an explicit YYYY-MM-DD date. Invalid dates fail
closed. Blank retains the earlier behavior. Use this control to preserve periods
already reviewed before cutover. Pulls still include the neighboring day needed
for overnight review; that does not import into an earlier payroll period.

Set `ATTENDANCE_API_REQUIRED_PERIOD_IDS` for the first production period before
its initial sync, so an absent first pull cannot silently use file-only input.
Check employee mappings against the live roster. Unresolved identities remain in
the source inbox and block payroll readiness; do not guess assignments or clear
clock/VOID exceptions merely to make calculation succeed.

## Verification and recovery

Verify the first production sync and a repeat, including stable raw IDs, no
duplicates/orphans, unchanged earlier payroll and protected original table data.
Check authenticated scheduled execution and unauthenticated 401/no-store responses.
Confirm the actual scheduled run in Vercel and source history after deployment.
The owner report records the exact deployment, cutoff, mappings and counts.

To pause future pulls, disable the cron adapter and source flags and redeploy.
Keep API-required period configuration and imported history in place. This pauses
ingestion; it does not reverse attendance or change payroll postings.

Platform behavior: [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
[cron scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

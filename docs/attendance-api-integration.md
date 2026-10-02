# Attendance API contribution — review before enabling

Prepared 1 October 2026 against Integra commit `28012ea2b930ab68d86f1cc59d42ef27ee2cfd6b`, branch `codex/attendance-api-integration`. This contribution is proposed for maintainer review and staging acceptance; it does not include a production migration or deployment. The connection is disabled unless `ATTENDANCE_SOURCE_ENABLED=true`.

## What changes

An administrator can map stable attendance IDs to Integra employees, reconcile a selected payroll period, inspect recent source punches, and refresh the existing DTR summaries. A server-only HTTP client pulls the attendance API's version 2 with its separate read-only key. Neither database credentials nor face photos are shared. Payroll calculations remain Integra's responsibility.

The connection preserves the selected payroll period when opened from Payroll and when returning. It offers a payroll-year selector and shows every period in that year, including historical/custom test periods; future seeded years cannot hide current periods behind a global row limit. A direct visit defaults to the current Manila period (then latest past or earliest upcoming within the chosen year). `npm run verify:attendance-source-periods` checks future-year crowding, explicit links, empty/invalid selections and return navigation.

Six additive tables retain source events, their original payload and revisions, employee mappings, sync history and each period's raw-log projection. The existing import format enum gains `API`. CSV/TXT parsing is unchanged. Source data is fetched completely before one transaction changes payroll input; repeat pulls do not duplicate punches. VOID removes its derived raw log but preserves source history. Restore and employee reattribution rebuild the affected projection. A one-day buffer handles overnight punches across payroll-period boundaries; capture time is explicitly converted from UTC to Manila wall time.

Closed periods and any period containing posted payroll retain their original payroll input. Later source differences are recorded as exceptions. Changed draft input clears affected summaries and marks Draft/Reviewed/Approved payroll Stale. Payroll calculation checks source exceptions and summary freshness both before calculation and inside its commit transaction. Partial summary refreshes cannot declare a whole period current.

## Review and staging steps

1. Rebase the contribution onto the maintainer's current branch. Check migration numbering against ongoing work; `0119` follows the inspected `0118`. Do not replace another developer's migration or schema snapshot.
2. Back up an isolated staging database. Review and apply `src/db/migrations/0119_attendance_source.sql` using the repository's migration runner. Keep the feature disabled while migrating and checking existing payroll flows. The enum/table addition must not be reversed by deleting payroll history.
3. Configure the server with the example below. Use staging credentials first. Never prefix these variables with `NEXT_PUBLIC_`, commit their actual values or send them to a browser.
4. Enable in staging. Visit `/payroll/attendance-source`, verify ID mappings in person against the employee roster, and sync a small open period. Resolve same-employee/date CSV/TXT overlap before switching that scope to API input; overlap deliberately rolls back the pull.
5. Resolve attendance clock/review flags at the attendance dashboard, sync again, refresh the entire period's summaries, review DTR and payroll differences, and only then follow the normal payroll approval flow.
6. Run the tests below and the maintainer's complete payroll simulation against its staging fixtures. Compare actual overnight, cross-branch and correction examples, and verify disabled-mode behavior in the hosted app before enabling production.

```dotenv
ATTENDANCE_SOURCE_ENABLED=false
ATTENDANCE_SOURCE_ORIGIN=https://attendance-pilot.wecaredrug.workers.dev
ATTENDANCE_SOURCE_TOKEN=
ATTENDANCE_SYNC_SECRET=
ATTENDANCE_SYNC_ACTOR_ID=
ATTENDANCE_VERCEL_CRON_ENABLED=false
CRON_SECRET=
```

`ATTENDANCE_SOURCE_TOKEN` is the existing attendance **payroll-only** read key, supplied privately by the owner. `ATTENDANCE_SYNC_SECRET` is a separate random secret of at least 32 characters. `ATTENDANCE_SYNC_ACTOR_ID` must identify an existing authorized service/admin account so audit records have a valid actor. The shorter domain can replace the origin after HTTPS, Access exceptions and API reads pass there; keep the current origin until then.

## Scheduling

The private POST trigger at `/api/attendance-source/reconcile` uses `Authorization: Bearer <ATTENDANCE_SYNC_SECRET>`. For Vercel Cron, a GET adapter uses Vercel's `CRON_SECRET` and additionally requires `ATTENDANCE_VERCEL_CRON_ENABLED=true`. Both require the source feature flag and a configured secret of at least 32 characters. GET and POST credentials are checked separately; neither accepts a secret in the URL. No active `vercel.json` cron configuration or live schedule is supplied.

Before reconciling, the scheduler verifies that `ATTENDANCE_SYNC_ACTOR_ID` belongs to an active, non-deleted administrator using Integra's assigned permission groups and legacy fallback rules. Missing, disabled, deleted and non-admin actors are rejected. It selects periods whose end date is on/after today minus 45 days and whose start date is on/before today, including closed periods for late-change detection. More than 24 matching periods is refused rather than silently truncated. Results are not cached and failures omit private diagnostics. Earlier periods may already have committed when a later one fails; repeats are reconciled idempotently. Monitor non-2xx responses and inspect sync history.

Vercel Cron runs only against production deployments, so preview acceptance uses a manual authenticated invocation. Frequency and function duration must fit the actual project plan and measured workload; do not assume hourly availability on Hobby. See [Vercel preview and release preparation](vercel-attendance-preview.md). The schedule remains inactive until separate production acceptance.

## Validation and remaining acceptance

`npm run verify:attendance-source` runs synthetic PGlite tests applying the actual new migration: pagination/partial HTTP failure, leading-zero IDs, UTC/Manila, idempotency, VOID/restore, reattribution, disappearance rollback, closed/posted freezes, immutable history, stale-summary/payroll commit guards, unmapped quarantine, overnight boundaries/summary input and file-import overlap. `npm run verify:attendance-parser`, `npx tsc --noEmit`, and `npm run build` passed. Next.js reported a workspace-root warning because this isolated clone is nested inside another repository; the build completed. These tests do not connect to production. PGlite is a development dependency only; its fixture creates the relevant existing columns and is not a substitute for running the complete migration history against staging.

`npm run verify:attendance-scheduler` checks the actual GET/POST rejection paths and the shared runner's authorization, missing audit account, period limit, non-cacheable response and redacted failures. `npm run verify:attendance-test-setup` includes active/inactive/deleted/non-admin scheduler-account fixtures as well as the guarded CLI checks.

Before production, the maintainer must verify hosted authentication, full summary/manual-payroll refresh, migration rollback operations, large-period execution time and deployment scheduler limits. The source client bounds a pull, but changed rows still require database writes; this is not a measured 30-branch throughput certification. Existing repository dependency advisories need the team's separate review; this contribution does not force unrelated dependency upgrades.

**Conservative exception policy:** a person whose entire projected attendance is cleared, an unmatched boundary punch, or any unresolved source exception blocks API-dependent payroll calculation. There is deliberately no generic “ignore” button. Fully voided employee-periods require a payroll-approved zero-attendance/absence resolution workflow before this feature is enabled for such periods. Until the maintainer agrees and verifies that workflow, keep the connector disabled for production. Historical posted changes require the existing adjustment process; never reopen or silently rewrite posted pay.

## Disable/recover

Stop the scheduler and set `ATTENDANCE_SOURCE_ENABLED=false`. Retain the additive tables and audit history. Already projected raw logs remain, so reconcile/remove them through an audited staging-tested recovery procedure before importing overlapping files. Disabling the feature does not undo previously paid payroll. Restore from the database backup only under the team's normal recovery procedure; do not drop tables or delete production attendance to resolve a test failure.

## Host-timezone regression checks

Run `npm run verify:attendance-timezones` with the existing dependencies. The test launches isolated processes in UTC, Asia/Manila and America/New_York, using synthetic in-memory PGlite only. It checks persisted API rows, day/overnight shifts, explicit source offsets, host DST transition dates, repeat-sync stability, and unchanged stored timestamps. No live credentials or migrations are used.

Attendance `logDate`/`logTime` are the canonical Manila civil clock for calculation, ordering and overnight grouping. Calculation-only UTC dates prevent the host offset or daylight-saving rules from changing worked/night minutes. Original `loggedAt` values, source payloads and existing database column types are retained; no stored-row rewrite is required. Recompute affected draft summaries through the normal reviewed workflow after acceptance; posted payroll remains protected. These tests do not certify live Neon connectivity, the full production schema, or payroll/net-pay recalculation.

## Guarded command-line test preparation

See [attendance-test-cli.md](attendance-test-cli.md) for isolated configuration, the independently verified Neon endpoint pin, read-only preflight/comparison and explicit scoped test writes. The trust anchor is blank; live use stays blocked until verified setup.

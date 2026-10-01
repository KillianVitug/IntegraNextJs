# Guarded attendance source-to-test verification

This CLI prepares a manual check against Neon project `quiet-wildflower-71375304`, branch `attendance-test` (`br-dark-field-a1zdusec`). It reads the existing attendance API and can import into one explicitly selected test period. It never migrates a database, changes the attendance source, creates accounts, runs a scheduler, refreshes stored summaries or computes/posts pay.

## Current state

The endpoint trust anchor is deliberately blank. Every command stops before opening the private configuration or making a connection until the exact test endpoint has been independently verified. In the owner's existing checkout, the payroll-only source key is already saved privately and a read-only API pull succeeded on 1 October 2026. Do not request or create a replacement key. The test database connection, endpoint pin, employee mappings, period and audit actor remain to be configured. The test branch already exists; do not create another branch based on older planning notes.

## One-time secure setup

1. In the existing authorized Neon dashboard, independently verify project `quiet-wildflower-71375304`, branch ID `br-dark-field-a1zdusec`, branch name `attendance-test`, and its compute endpoint. Record the exact endpoint ID, allowed direct/pooled hostnames, database name and UTC verification time in `src/scripts/attendanceTest/destination.ts`. This is a reviewed, nonsecret trust anchor. Do not derive it from the URL you are trying to validate. Never pin parent `main`. A database name or user-supplied branch label does not establish branch identity; this CLI cannot discover that association from PostgreSQL. No new Neon API key is needed. If the endpoint changes, stop and independently verify the replacement.
2. An empty `.attendance-test/config.local.json` is supplied locally. Its directory is Git-ignored and restricted to Windows owner **Admin** and SYSTEM; run the live CLI as that owner. A restricted Codex sandbox does not automatically receive access. The shareable empty template is `scripts/attendance-test.config.example.json`. Git ignore alone is not an access-control boundary; when preparing another checkout, create a restricted private directory before copying the template. Enter the test-only `databaseUrl` and existing payroll read key as `sourceToken` there directly. Never paste them into chat, a command argument, repository files, reports or terminal output. Do not copy production `.env.local`. The URL must exactly match the pinned host/database and require TLS (`sslmode=require` or `verify-full`; optional `channel_binding=require`). Other URL options are refused.
3. Initially run `preflight`. It reads schema metadata in a read-only transaction and reports missing/incompatible columns, the API enum and required 0119 constraints. It does not apply migrations or certify the entire production schema/history. Review the test database migration ledger and recovery point before applying the authorized test migration; the normal migration runner processes all pending migrations.
4. Select a clean existing **Open** test payroll period (maximum 32 inclusive dates) with no payroll runs, file-import batches or existing summaries for the mapped employees. Record its `periodId`, exact `periodStart` and `periodEnd`, plus an existing active administrator's `actorUserId`. The CLI verifies the administrator using the application's permission-group/fallback rules. This is an audited operator identity, not a login bypass for production. We can inspect these identifiers after the connection is available; no new account is automatically created.
5. Fill `mappings` with `{ "sourceEmployeeId": "...", "employeeId": "...", "reason": "identity verified against the roster" }`. Use attendance IDs as strings; preserve leading zeros. `employeeId` is the payroll UUID. Confirm actual identities rather than matching names/codes blindly. Existing conflicting mappings are refused. The full source pull, including the one-day boundary buffer, must fit the explicit mappings; the CLI never silently filters employees from the reconciler's full-period snapshot.
6. Fill at least one `comparisons` item with `{ "sourceEmployeeId": "...", "attendanceDate": "YYYY-MM-DD", "checkInTime": "08:00", "checkOutTime": "17:00", "breakMinutes": 60, "expectedWorkedMinutes": 480 }`. Use independently checked times and expected minutes for the real case. Overnight cases are supported. These explicit test shifts exercise the production attendance calculator; they do not substitute for all employee schedules, leave/holiday overrides or final net-pay acceptance.

The attendance origin is already fixed to `https://attendance-pilot.wecaredrug.workers.dev`; version 2 is read via GET, with an identifying User-Agent and no redirects. The source key is the existing read-only payroll credential, not a Cloudflare administrator/device/archive key. No source mutations are supported. Scheduler secrets and scheduler actor configuration are unnecessary.

## Windows commands

Run in `C:\Users\Admin\Documents\android-attendance\tmp\integra-attendance-integration`. Use the already-installed Node 24 runtime; the older Node on PATH is unsuitable. In the Codex environment:

```powershell
$testNode = $env:CODEX_TASK_WORKSPACE_NODE
& $testNode --version
& $testNode .\scripts\attendance-test.cjs preflight
& $testNode .\scripts\attendance-test.cjs compare
```

If that environment variable is absent, use the existing verified runtime's full path, currently `C:\Users\Admin\AppData\Local\OpenAI\Codex\runtimes\cua_node\154806497bb51bae\bin\node.exe`. No install/build is required. The launcher supplies a clean environment, strips inherited database/source credentials, proxies and Node preload options, and prevents dotenv development fallback. Invoke the launcher, not `main.ts` directly.

`preflight` is the default and reads schema only. `compare` additionally reads the API, checks the chosen scope and reports current source/imported counts and hours. Both database transactions are read-only. Review the comparison before opting into a write. Replace the placeholder below with the same selected UUID in the private config:

```powershell
& $testNode .\scripts\attendance-test.cjs sync --write-test=br-dark-field-a1zdusec --period=CHOSEN-PERIOD-UUID
```

The write command rechecks scope inside a transaction, refuses shared events projected into another period, creates only missing confirmed mappings, and calls the existing reconciler. Mapping changes, history and raw imports roll back together if guards or comparison fail. It refuses unresolved source exceptions and a cleared employee-period. It never creates a payroll period. There is no automatic second write: rerun the exact command explicitly to prove repeat imports project zero new raw rows. A repeat still records an audited sync run.

Reports go to the ignored private directory and stdout. They contain counts, explicit comparison IDs/dates, minutes/hours, duplicate groups, orphan rows and pass/fail findings, plus up to 50 paired source/imported punch samples. Names, raw payloads, mapping reasons, URLs and credential values are omitted. Counts cover the full snapshot; `imported` counts projected raw rows and `totalApiRawRows` also includes orphan rows. The test refuses more than 2,000 source or projected records; choose a smaller period. Unexpected error details are suppressed. `writesCommitted: null` means a transaction failed with an uncertain outcome (for example a connection loss during commit); inspect the test database before interpreting or repeating it. A report-file failure after a successful commit is reported with `writesCommitted: true`.

## Local verification

`npm run verify:attendance-test-setup` runs in-memory PGlite synthetic fixtures, including the actual 0119 migration **only in that disposable fixture**. It checks destination/scope rejection, environment isolation, redaction, read-only enforcement, schema differences, atomic rollback, comparison accuracy and repeat imports. Use Node 24 when running npm commands. The existing source/parser and timezone suites remain applicable. Synthetic success does not verify live credentials, Neon endpoint ownership, hosted login or final payroll results.

# Attendance integration review — 3 October 2026

This update repairs review/approval safeguards without adding another migration.
Keep the integration PR in draft until the outstanding acceptance below is complete.

## Implemented

- Review, Approve, Post and Void now read and update under one transaction, using
  the same advisory input lock as reconciliation/mapping and locking period then run.
  Stale payroll cannot advance. Held DTR is checked through that transaction.
- Computation records its durable attendance input version in its existing
  `Computed` audit event. Review/Approve/Post validate it against current source
  input, summary readiness and exception counts. Unchanged repeat pulls do not
  invalidate the snapshot. Older API calculations without that evidence must be
  recomputed. Existing posted runs retain idempotent Post behavior.
- Changing a mapping immediately clears summary readiness and review/approval
  on affected open, unposted periods. Same-identity verification does not invalidate
  payroll. Original punches remain until reconciliation; closed/posted input stays
  unchanged. A mapping change during a pull requires another pull.
- A failed/in-progress newer sync cannot fall back silently to an older success.
  Explicitly configured API-required periods cannot compute before first success,
  including when the connector is disabled. Existing API batches also block that
  disabled-mode fallback. Legacy file-only periods are retained.
- Payroll/connector actions return allowlisted business-validation messages as
  structured results. Unexpected internal errors remain redacted. The payroll UI
  checks the result before showing success; mapping/sync outcomes use readable text.
- API batches cannot use generic file Revert, on the server or in the payroll UI.
  Employee mapping is searchable and source exception categories have next steps.

## Required-period configuration and cutoff procedure

`ATTENDANCE_API_REQUIRED_PERIOD_IDS` is a comma-separated list of payroll period
UUIDs that must use API input. Configure it before preparing those periods, keep
those IDs during a connector outage, and add subsequent periods during cutoff
preparation. Blank preserves legacy file-only periods that have never attempted
an API sync. Invalid configuration fails closed. This is an explicit server-side
rollout control; there is not yet an operator source-selection or branch-readiness
registry. No hosted variable was changed by this update.

Before final sync, HR must confirm each participating branch phone has uploaded
its pending records, record the cutoff confirmation in the operating log, resolve
exceptions, refresh DTR, and recompute. A successful server pull cannot establish
that an offline phone is empty. Automated branch telemetry is not implemented here.

## Verification

The six existing suites pass: source, parser, period selector, 18 timezone cases,
30 guarded setup checks and scheduler. New `verify:attendance-release-guards`
exercises the real transition function with in-memory SQL: first-sync requirements,
disabled/invalid configuration, stale rejection, old/current input snapshots,
unchanged repeats, same/different mapping saves, exceptions at all three forward
transitions, failed/pending retries, posted preservation, and safe error envelopes.
The synthetic posting fixture records one 250 loan payment, changes balance
1,000 to 750, marks its installment Paid and leaves a repeated Post idempotent.
The test stubs only the Next navigation import; any authentication redirect fails.
It does not simulate browser login or prove locking with two PostgreSQL connections.

Type checking and the full Next production build (including lint) pass. The
read-only endpoint-pinned Neon preflight reports compatible required columns,
types/nullability and connector keys. No live migration or data write was made.
The old narrow CLI comparison stops with `test_scope_has_existing_summaries` and
`previous_import_outside_employee_scope`; it predates the expanded hosted test
dataset. Its scope was not weakened and no new real-source acceptance is claimed.

The prior 2 October hosted test at `033fd0e` completed fictional CSV -> DTR ->
Draft -> Review -> Approve -> Post, with independently expected 23,650 net and
one synthetic loan deduction. The original Preview was restored. That test does
not validate this new UI/transaction code, real-source net pay, statutory deductions
or every manual editor. New hosted acceptance is still required.

## What still prevents full acceptance

1. Killian's newer database migration source is absent from published main and
   development (both `28012ea` at this review). The copied test database has newer
   payroll objects/history. Obtain that code, reconcile migration order and rehearse
   the combined chain on an isolated copy. Do not rename 0119 or rewrite history
   based on guesses. No production migration is approved by these tests.
2. Resolve real identity, clock, boundary and all-VOID employee-period cases with
   authorized evidence. Historical ID 1 cannot be assigned from a name guess.
   An approved absence/exclusion/replacement policy is still needed for all-VOID
   cases; this update supplies no generic override. Complete clean real API ->
   DTR -> independently expected draft pay after that work.
3. Validate the new messages, mapping invalidation and direct transition rejection
   on a test Preview, plus simultaneous PostgreSQL sessions, representative volume
   and phone-width operation. Scheduling stays inactive pending its own diagnostics.

Payslip release, payment tracking, closing, and linked post-posting adjustments
remain separate work with the maintainer. This change does not claim those features.

## Separate timezone contribution

Branch `codex/payroll-manila-clock-fix`, commit `60f67b8`, extracts the three shared
calculation files onto main with a standalone 45-case test, existing parser checks
in three host timezones, documentation and a passing full build. It has no API
connector, schema change, dependency addition or scheduler. If merged first,
reconcile the integration branch afterward; do not blindly reapply its shared
calculation diff. Neither branch has been merged by this work.

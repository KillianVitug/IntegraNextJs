# Attendance integration: isolated Neon acceptance

Verified on 1 October 2026. This contribution remains a draft; the owner expressly excluded merging. Production payroll and the attendance source were not modified. Private credentials, employee records, backup files and detailed punch reports are excluded from the repository.

## Recovery and schema

The authorized Neon dashboard independently identified project `quiet-wildflower-71375304`, branch `attendance-test` (`br-dark-field-a1zdusec`), endpoint `ep-silent-cherry-a15ljl8p`, database `neondb`. Both direct and pooled hostnames are pinned. This association was checked before connecting.

A private PostgreSQL 17.11 custom-format backup was restored into a temporary, password-protected local instance bound to loopback. The restore contained 307 employees, 93 public tables and 116 migration ledger records. The attendance migration succeeded in that restored copy; the temporary server was stopped.

Only `0119_attendance_source.sql` was then applied to the pinned Neon test branch. Its normalized SHA-256 is `00037476d1f42c73d36139856d91656af75aa0186f97d8bc664c43debb28cba2`. The six source tables and API enum passed the CLI schema preflight. Before/after checksums matched for the data in every pre-existing public table, and all 116 historical ledger rows were preserved. One new ledger entry records the attendance migration.

The copied database contains newer payroll schema work absent from the reviewed repository: 12 additional tables and 13 additional columns. Its latest preceding migration hash is `3b77d332c5a7532bf2c5adc2a518a93007c51eae55761dec5a5981b231fa8514`, timestamp `1790561146688`. None of those objects were changed. The maintainer must reconcile this newer work and migration numbering before merging or migrating production. Historical migrations were not replayed and `drizzle push` was not used.

## Two real source-to-test reconciliations

A dedicated one-day test period covers 29 September, with the required 28–30 September source buffer. Eighteen roster mappings were checked; ambiguous identities were confirmed with the owner. One historical source identity was deliberately left unmapped because the old test identity and later records disagree. It never obtained a payroll employee or raw attendance row.

The existing read-only API returned the same complete 77-record snapshot on both pulls. A private acceptance manifest fixed its content hash, exact held event IDs, intended period, mappings, expected exceptions and independent hours cases before writes. The existing production reconciler processed the full snapshot without filtering records. A separate acceptance harness tested quarantine behavior; the shipped strict CLI and production payroll guards were not relaxed.

| Check | First sync | Repeat sync |
| --- | ---: | ---: |
| Complete source records received | 77 | 77 |
| Source revisions added | 77 | 0 |
| Raw punches added | 58 | 0 |
| Total eligible raw punches | 58 | 58 |
| Held or VOID records retained without raw input | 19 | 19 |
| Duplicate event IDs/raw hashes/orphan rows | 0 | 0 |
| Source/import field mismatches | 0 | 0 |

All raw IDs and rows were identical after the repeat. Three independent scheduled-hours comparisons matched source and imported data: **480, 478 and 364 minutes**, using a test 08:00–17:00 schedule and 60-minute break. Integra's existing scheduled-window policy uses whole clock minutes while retaining raw seconds. An initial second-precision expected value failed and the transaction rolled back; reviewing that existing policy corrected the test expectation without changing payroll rules.

The period correctly remains blocked for payroll: 2 unmatched punches, 6 withheld punches, 3 boundary-review punches and 1 completely cleared employee. These categories overlap and are not a partition of the 19 held/VOID records. The integration did not resolve or dismiss those source issues, refresh persisted summaries, or compute/post pay. Two committed sync runs and a test-labeled audit entry per run provide traceability under an existing active administrator account. Earlier unsuccessful assertions were independently confirmed to have rolled back before retries.

## Synthetic scenarios on the actual Neon schema

Nine additional checks passed inside one rollback-only transaction on the test branch: a cross-branch 22:00–06:00 overnight shift yielded 480 minutes; stale summaries blocked payroll; repeated pulls preserved raw rows; late uploads added only new punches; identity corrections reassigned input and marked draft payroll stale; full VOID cleared input and blocked the employee-period; restore preserved original history; incomplete snapshots failed without deleting prior input; posted payroll retained its exact input while later changes were flagged.

Every synthetic employee, period, punch and payroll fixture was rolled back. Before/after data checksums matched across all 14 affected tables. The synthetic Posted fixture tests input protection; it does not establish net-pay correctness or execute a payment. No attendance-source writes occurred.

## Remaining acceptance

The Vercel Git integration automatically built a protected PR Preview. The invited GitHub/Neon user still lacks access to Vercel team `vitugs-projects`, project `integra-next-js`; project navigation shows Not Found while signed in. No Vercel environment settings were changed, and the Preview's database binding is unverified. Follow [the Preview setup guide](vercel-attendance-preview.md) after access is granted or have the project owner perform that setup.

Hosted normal-admin sign-in, mapping UI, DTR refresh and independently expected draft net-pay comparisons remain outstanding. Resolve real attendance exceptions and the completely cleared employee-period workflow before production acceptance. Choose a production audit actor and scheduler cadence with the operator. Both scheduler activation and merging remain excluded from this test work.

# Attendance resolution release candidate

This release adds an administrator workspace for attendance suggestions, evidence-based corrections, mixed batches, durable delivery/retry, coverage of employees without punches and linked adjustment cases for posted payroll.

The default `ATTENDANCE_WORKBENCH_ENABLED` flag is off. During staged verification set `ATTENDANCE_WORKBENCH_APPROVALS_ENABLED=false`; this pauses new approvals while keeping delivery recovery and history available. Duplicate policy remains Suggest only. Actual attendance corrections and payroll recomputation are separate administrator actions.

## Deployment dependencies

1. Back up and rehearse both databases.
2. Apply Attendance `0006_resolution_plans.sql`, deploy the compatible Worker and confirm authenticated v3 reads plus read-only correction context.
3. Apply only Integra `0123_attendance_workbench.sql` and its journal entry transactionally. Do not run the historical migration chain against production.
4. Deploy this application with activation off. Verify staged admin screens and compatibility, then activate the approved workflow.
5. Sync and repeat-sync affected periods, check projections and unchanged payroll/correction decisions, and observe one scheduled run. No real corrections should be approved merely to test deployment.

The companion source package, guarded migration/deployment scripts, exact backup/ledger rehearsal evidence, complete scenario matrix and rollout/recovery runbook are in the Android Attendance integration project's release artifacts. The phone-accessible screen evidence and release report are at https://chatgpt.com/space/page_85514a36f0c881918c9043bb13c04c75 (private owner access).

## Verification

Focused matching, source, resolution, duplicate, scheduler, DTR and payroll regression checks passed. Workbench database fixtures cover exact timestamps, missing records, per-row evidence, acknowledgment, stale evidence, concurrency, lost responses, related-employee atomic plans and Undo, cross-period restart, late originals, competing file inputs and posted payroll preservation. Actual components were exercised at 320, 390 and 1280 pixels. Types, lint and the production build passed.

Fresh production backups were restored in isolation; the exact additive migrations preserved all existing tables and historical ledger entries. Live activation and post-release scheduled-run verification remain rollout steps.

## Recovery

Pause new approvals, inspect source plan status and reconcile pending deliveries before changing versions. Retain additive tables and audit history. After effective capture corrections exist, retain v3 support; do not simply disable the reader or revert to an incompatible earlier build. Prefer a compatible forward fix and audited Undo. Never overwrite newly captured attendance with an old database backup. Posted payroll remains immutable; use linked adjustment cases.

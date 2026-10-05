# Resolve attendance before payroll

Open **Payroll Menu → Attendance review & sync**, then choose the payroll year and period. The payroll workspace also links to the same period from a permanent attendance-readiness card.

1. **Sync attendance now** to load current source records and employee mappings.
2. Open an employee case under **Attendance review**. Original attendance shows the full date and Manila time for every punch; neighboring dates are labeled as context. Inspect the actual dates before handling an overnight shift.
3. For a missing IN or OUT, enter only a verified date/time supported by evidence. Save a proposal, review it, then explicitly approve it. A proposal alone does not add payable time. Unknown times remain unresolved; scheduled times are not automatically filled in.
4. For duplicate or test punches, select the exact original records and explain the evidence. Review and approve the correction. A separate restricted server connection submits VOID/RESTORE to Attendance, retaining the original captures. Test-only identity classification alone does not erase historical punches.
5. **Sync attendance now** again after approval. Then **Refresh DTR summaries**, inspect the DTR, and return to payroll to **Recompute and review**.

Errors remain visible on the page. Failed computation leaves the existing run unchanged. Counts can overlap because one punch may have more than one issue.

## History and reversal

Manual DTR and no-attendance approvals can be reversed from history, reopening the review and invalidating summaries/open payroll until resync. Source corrections already accepted by Attendance remain in its audit trail: after syncing, explicitly propose and approve the opposite action on the affected records. Retry uses the original request IDs and skips confirmed records. Stopping a failed retry does not undo records already corrected.

Source changes or changed employee mappings expire earlier evidence. Closed or posted payroll cannot be altered through this workflow. All current review actions require an Integra administrator; organizations needing separate preparer/reviewer personnel must apply that operating policy when assigning reviews.

## Production configuration

Apply additive migration `0121_attendance_resolution.sql` using the reviewed backup/rehearsal workflow. Configure a new, unique server-only key as `INTEGRA_CORRECTION_TOKEN` in Attendance and `ATTENDANCE_CORRECTION_TOKEN` in Integra Production. Never reuse the read-sync, device or archive key. Missing correction configuration leaves source correction buttons disabled while read synchronization continues.

The correction endpoint only accepts authenticated server requests for specific existing-event VOID/RESTORE, with expected identity, source timestamp and correction version. No original capture is overwritten, and it cannot create punches, reassign identities, or retrieve photos.

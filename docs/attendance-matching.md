# Attendance employee matching

Open **Payroll → Attendance connection** as an administrator. The connection must be enabled and have synced attendance records.

## Verify a batch

1. Open **Suggested**. Suggestions require a unique matching employee number (leading zeros are ignored) and agreeing full names. Equal numbers with conflicting or missing names stay in **Needs review**. Nobody is selected or matched automatically.
2. Select individual people or **Select all suggestions**, then **Review matches**. Review the attendance person and Integra employee side by side.
3. Choose the verification method, optionally add a batch note, and confirm that every selected identity is correct. **Other evidence** requires a note. Save up to 100 people together.
4. For a conflict, open **Needs review → Review match**, search for the confirmed employee, verify the identity, and **Add verified person to batch**. Differences require human confirmation; mixed people sharing one attendance ID require correction in Attendance first.
5. After saving, sync each affected period, refresh DTR summaries, and recompute/review affected open payroll. Matching applies across periods. Closed or posted payroll remains unchanged and requires a separate reviewed correction.

If a person, employee roster or mapping changes during review, the server rejects the entire selected batch. Refresh and review again. A failed save keeps the selection and entered evidence available to retry.

## Test identities

On an unmatched row choose **Mark as test only**, record why, confirm, and select **Move to Test only**. The identity leaves Suggested, Needs review and the selected batch, and appears under **Test only**. A matched identity must first have its match removed. This changes only the attendance identity's matching classification; it does not change the Integra employee record or void attendance punches.

To correct a classification, open **Test only → Restore to Needs review**, give a reason, and confirm. The identity returns for fresh manual verification rather than being automatically suggested. Original history is retained. Existing practice punches and payroll exceptions require separately reviewed corrections in Attendance and a fresh period sync.

## Correct a mistaken match

- **Matched → Change employee** stages a replacement for verification.
- **Matched → Remove match** returns the identity to Needs review.
- **Undo last batch** or **Match history → Review reversal** lets you select one, several, or all available changes. Review the previous mapping shown, give a reason, and confirm. Undo restores the prior mapping or unmatched state, not merely deletion.

Later edits and inactive prior employees block an old reversal. The batch either succeeds completely or saves nothing. Reversals and original changes remain in history with reasons, administrator identifiers and Manila timestamps. Older history can be loaded. Earlier mappings remain changeable/removable even though they predate batch history.

## Release and data controls

Migration `0120_attendance_matching_workflow` adds three empty classification/history tables. It does not classify any real identity, modify existing matches or alter punches/payroll. Deploy it before this application build; old application code remains compatible. No sample choices are seeded into production.

All writes require administrator access and the enabled connection. A shared attendance/payroll input lock serializes batch mutations, sync and payroll input checks; employee row locks keep reviewed roster values stable during writes. Open payroll input is invalidated on mapping changes. Identity revisions also require a fresh sync after removal/restoration, including when the old mapping no longer exists. Closed/Posted periods are preserved.

The person list includes all stored source identities, older records, void-only identities and inactive previous mappings. Test-only identities remain explicit in matching/detail UI, while unresolved punches remain counted and withheld by existing reconciliation rules.

## Verification

- `verify:attendance-batch-matching`: isolated SQL tests for all-or-nothing saves, full/partial reversals, stale submissions, concurrent-state rejection, inactive prior employees, test classification/restoration, no silent exception suppression, freshness checks, history pagination and Posted preservation.
- `verify:attendance-matching`, `verify:attendance-release-guards`, and `verify:attendance-source`: existing identity, lifecycle and reconciliation regressions.
- TypeScript, targeted lint and production build.
- `src/scripts/attendanceMatchingPreview.tsx`: actual component with fictional people and a simulated callback, with no connection to live data. Browser checks cover required confirmation, failed-save retry, batch save, partial undo, individual conflict review, test-only/restore and 320/390px layouts. Authenticated production acceptance requires normal administrator sign-in; the fixture does not establish it.

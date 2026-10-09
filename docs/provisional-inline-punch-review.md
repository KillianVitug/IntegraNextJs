# Inline provisional punch corrections

Implemented locally on 9 October 2026. Deployment is explicitly deferred.

Choosing a punch correction keeps the saved punch, pending values and selected action in one row, stacking within that punch on phones. The action control displays the selected outcome instead of reverting to its placeholder. Direction and time corrections can coexist; repeated selections preserve entered values and stable IDs instead of appending duplicates. Opposite Void/Restore and Exclude/Retain choices replace their pending counterpart. Undo removes a local pending edit; saved attendance and original captures are retained.

The provisional editor reuses the existing correction fields, optional notes, history and validation. Only exact inline-rendered edits are hidden from the separate plan panel. Manual additions, no-attendance decisions and unavailable targets remain accessible there, and the panel opens for additional changes. Plan notes, ownership, rejection state, stale evidence and day context remain available. The missing-punch form opens on request. Opening it after a preview clears that preview while preserving the current draft and request identity.

Review still saves a draft and requests the authoritative preview. Confirmation remains a separate action. This change does not modify server authorization, payroll calculations, source captures, database schema, or posting behavior.

## Verification

- 12 focused model regressions: source identity and day scope, repeated action preservation, legacy duplicates, opposite actions, combined direction/time, per-edit removal, empty draft and retained stale evidence versions.
- Six actual-client before/after journeys at 320, 390 and 1280 pixels, using fictional browser adapters through the saved-result callback. At every width the new pending edit remained in the same capture row and was visible immediately after selection; the original edit needed an additional explicit scroll shortcut. Both versions retained separate review and confirmation.
- Nine additional browser checks: stable edit IDs, combined time/direction and reload, optional-note preview invalidation, selective Undo, opposite action replacement, Undo all, editable manual addition, required actual time, and adding a punch after preview.
- Existing AttendanceWorkbench, AttendanceWorkbenchAdvanced, AttendanceBatchReview, Stage6aCleanup and PayrollNavigation regressions, TypeScript, changed-source lint and isolated production build passed.

Browser journeys record two clicks, one ArrowDown key, one direct navigation and one focus shortcut each; the baseline uses two explicit scroll shortcuts and the candidate one. Browser auto-scroll and application preview navigation also occur. These are automation observations, not physical-phone taps, measured human speed or a claim of fewer save steps. Additional regression interactions are not a usability benchmark. No database/server acceptance or deployment was performed for this client presentation change. The build retains the checkout's known Windows standalone symlink-copy warning limitation.

Run the pure regression with `node --import tsx src/scripts/verifyProvisionalPunchEdits.ts`. Run the isolated UI checks with `node scripts/check-provisional-punch-ui.cjs`; `CHROME_PATH` may override the local Chrome executable and `PUNCH_UI_OUTPUT` selects the evidence directory. The runner pins the original UI commit; `PUNCH_UI_BASE_REF` intentionally overrides that baseline. It intercepts read/action imports and makes no payroll connection. The parent workspace's `tools/attendance_workbench_checks.cjs` provides the existing focused suite/types/lint/isolated build checks.

Phone previews and downloads: https://chatgpt.com/space/page_5ff7574e36048191bee21bd65226d349

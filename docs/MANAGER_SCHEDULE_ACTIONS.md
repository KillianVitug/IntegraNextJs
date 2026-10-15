# Manager schedule actions — 15 October 2026

Implementation candidate on `codex/manager-schedule-actions`, based on `0df2dd92b714a820596cdf067ca8abe80c4ffea8`. This document records the implemented source behavior. Integrated check results, observed browser journeys and remaining acceptance limits are maintained in the parent workspace's `artifacts/manager-schedule-actions-20261015/` report and review kit. No production deployment or business-data change has been performed for this candidate.

Read [PHILIPPINE_LABOR_COMPLIANCE.md](PHILIPPINE_LABOR_COMPLIANCE.md) before related changes. The parent workspace's `docs/MASTER_PLAN.md` remains the current checkpoint while this checkout is used there; [MANAGER_FIRST_RELEASE.md](MANAGER_FIRST_RELEASE.md) describes the earlier release boundary, not this candidate's final verification.

## Implemented behavior

- `/managerProvisional` offers **Change schedule**, **Arrange cover**, **Swap schedules** and **View history** within an eligible employee/date detail. Today/future planning is separate from completed-workday attention counts. Count cards filter the list; specific findings are visible before opening a day.
- An adjustment uses an existing shift or date-specific start/end. The preview shows exact dates, overnight endings and inherited breaks. Weekly defaults and shared shift definitions are separate operations. Arbitrary break authoring is not added here.
- Cover assigns the working shift to a replacement in the same branch/date. The original employee's schedule and absence/leave evidence remain intact. Both employee dates receive linked history; coverage does not mean the absence finding is resolved.
- A swap previews and saves both employees' schedules atomically. Start cover/swap from a working shift; an unconfigured counterpart cannot participate in a swap. Cross-branch and cross-date operations are outside this slice.
- Applied changes refresh affected attendance inputs and make affected Draft/Reviewed official runs stale where applicable. They do not post official payroll. Manager responses contain no financial figures. A changed schedule does not itself resolve missing punches, held evidence or the existing conservative partial-leave review.
- Date history shows before/after schedule snapshots, breaks, editor identity, saved time and a linked operation reference. Applied revisions are paginated. Review requests are labelled as a recent summary of up to 20. A manager can see their own bounded optional note; unrestricted Admin notes are not returned. Reversals require a new revision.

## Ownership, permissions and recovery

Integra owns schedule assignments, local effective inputs, review requests and their audit trail. Original attendance captures remain evidence; these operations do not write corrections to the phone attendance source. Managers retain their current branch/employee scope, while Payroll Admin owns final attendance and financial decisions.

The server authenticates commands and rechecks current scope, schedule/draft versions, linked employees and protected payroll targets, including relevant overnight neighbors. Closed periods and Approved/Posted runs remain protected. Ordinary permitted changes can apply directly. Reviewed work and specific rest/leave arrangements use a pending request without changing canonical inputs first; old manager scheduling entry points cannot bypass the reviewed boundary.

Approved-leave and overlapping-shift conflicts block the affected working schedule. Pending leave or an unresolved weekly-rest arrangement must be resolved before Admin acceptance. Work proposed on a designated rest day retains the recipient's designation and requires specific Admin review of the arrangement and supporting basis; an approval checkbox alone does not establish lawful entitlement. Ordinary manager notes remain optional. This is not a blanket evidence or approval requirement for all schedule changes.

Commands, paired changes, revisions, derived refresh and receipts share the established transaction/locking path. Same-request retries check durable receipts. Unknown outcomes retain the request identity; a failed refresh is shown separately from a saved operation. Pending requests can be cancelled only by their owner while still Pending and within current linked scope. Admin acceptance checks the requester again and rejects stale captured schedules. Denial/cancellation and applied reversals retain history.

The manager view reloads the authoritative selection after a saved receipt without remounting local search/filter state. It pins the affected date so a cleared finding does not remove the result immediately. A pending request is labelled pending rather than saved as an active schedule or resolved as an attendance issue.

## Source map

| Responsibility | Source |
|---|---|
| Manager list, counts, planning filter and safe overview refresh | [`workspace.tsx`](../src/app/(manager)/managerProvisional/workspace.tsx) |
| Inline editor, previews, history and retry/cancellation UI | [`schedule-day-actions.tsx`](../src/app/schedules/schedule-day-actions.tsx) |
| Shared snapshots, recipient rest designation and public contracts | [`model.ts`](../src/lib/scheduling/model.ts), [`workspace-types.ts`](../src/lib/scheduling/workspace-types.ts) |
| Authorized schedule operations, conflicts, transactions, history and receipts | [`service.ts`](../src/lib/scheduling/service.ts), [`scheduleWorkspaceAction.ts`](../src/app/actions/scheduleWorkspaceAction.ts) |
| Admin pending-operation review and decisions | [`managerScheduleApprovalAction.ts`](../src/app/actions/managerScheduleApprovalAction.ts), [`ScheduleRequestQueue.tsx`](../src/app/(ntg)/home/schedule-requests/ScheduleRequestQueue.tsx) |
| Nonfinancial attendance projection | [`oversight.ts`](../src/lib/manager/oversight.ts), [`oversight-types.ts`](../src/lib/manager/oversight-types.ts) |
| Isolated backend and action checks | [`verifyManagerScheduleActions.ts`](../src/scripts/verifyManagerScheduleActions.ts), [`verifyManagerScheduleApproval.ts`](../src/scripts/verifyManagerScheduleApproval.ts) |
| Actual-component fictional browser fixture | [`managerScheduleActionsPreview.tsx`](../src/scripts/managerScheduleActionsPreview.tsx), [`managerSchedulePreviewActions.ts`](../src/scripts/attendanceTest/managerSchedulePreviewActions.ts) |

The fictional fixture has no production database/action boundary and replaces overview fetches. Its session storage contains only invented schedules. It demonstrates UI behavior, not production transaction correctness or human-speed savings.

## Labor/pay evidence and limits

The accompanying review checked these primary references on **15 October 2026**:

- [Labor Code, Articles 82–88](https://lawphil.net/statutes/presdecs/pd1974/pd_442a_1974.html): applicable coverage, required/permitted work, normal hours, overtime and the cross-day undertime/overtime offset prohibition. Editing a planned shift cannot itself erase actual compensable work.
- [Omnibus Rules, Book III](https://lawphil.net/statutes/repacts/ra1989/omnibus_labor_1989.html): Rule I sections 3–8 on working time/breaks; Rule III sections 3–7 on weekly rest, notice and rest-day work; Rule X recordkeeping provisions. Preserve original evidence, schedule designation and revisions.
- [DOLE 2024 statutory monetary benefits handbook](https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf): working-time, break and rest-day guidance used in the review. Actual arrangements, employee coverage and more favorable company/CBA terms still matter.

The app's conflict checks, review routing and audit trail are implemented product safeguards, not legal certification. No employee-specific entitlement is decided by this document. Dinalupihan - 2's intended-break/assignment acceptance, partial-leave payroll correctness and source freshness/backlog acceptance remain separate.

## Verification and manual acceptance

The parent runner `tools/release/manager-schedule-actions-checks.cjs` runs isolated backend/action regressions, existing safeguards, types, changed-file lint and an isolated build. The parent browser runner is `tools/release/manager-schedule-actions-ui.cjs`. Final results belong in the parent release report; this document does not assert that the full candidate has passed.

Use fictional/restored data for mutation tests. A local application can still point at production. Before an authorized release:

1. Change an ordinary recorded date and a today/future date; inspect inherited breaks, an overnight example, refreshed findings and history after reload. Confirm missing punches remain unresolved.
2. Arrange cover and verify the original schedule/absence/leave remains unchanged. Swap two schedules and prove both sides save together, with linked history.
3. Exercise approved leave, overlapping/overnight hours, designated rest and weekly-rest concerns. Confirm truthful blocked/pending status and safe Admin acceptance/denial; cancel an owned Pending request.
4. Change scope or a schedule concurrently, revoke manager authority before save, and test Closed/Approved/Posted protection. Reject stale review snapshots and preserve unrelated drafts.
5. Interrupt submission and cancellation responses, retry the same identity, and fail then retry overview refresh. Check a single committed operation, retained input and no duplicate review request.
6. Inspect manager HTML/RSC/API fields, paginated older history, mobile layout, visible keyboard focus and actual manager-phone behavior. Record observed clicks/keys, entries, navigation, waits, retries and scrolling; compare the same completed journey before claiming an improvement.

Carry this document, the existing compliance/project guidance, reviewed `.agents/skills/` and the necessary verification tooling into any independently used checkout. None of this documentation authorizes deployment, production recalculation or historical schedule changes.

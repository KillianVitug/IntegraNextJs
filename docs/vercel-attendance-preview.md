# Vercel preview and release preparation

The owner authorized test setup and publication to draft PR #1, expressly excluding the merge. Work stays on `codex/attendance-api-integration`. Do not merge, push to `main`, change the production branch, use `vercel --prod`, or enable production syncing as part of this test.

## Existing destination and access

- Repository: `KillianVitug/IntegraNextJs`; draft PR: https://github.com/KillianVitug/IntegraNextJs/pull/1.
- Neon project: Integra (`quiet-wildflower-71375304`). Existing branch: `attendance-test` (`br-dark-field-a1zdusec`), created from current main's schema and data. Integra Simulation is an older, different test project.
- The exact test compute endpoint was independently verified in Neon on 1 October 2026 and is recorded in the checked-in trust anchor. Reverify any replacement endpoint; never copy the production connection. The private test connection is configured locally, but Vercel's branch-specific database binding remains unverified.
- The Vercel project/team must actually host this repository and be accessible to the operator. A different project under the operator's personal account is not a substitute.

Verified progress and limits are in [the 1 October test evidence](attendance-test-evidence-20261001.md): backup/restore, test migration, two real reconciliations and rollback-only Neon scenarios passed. The team is `vitugs-projects` and the project is `integra-next-js`; operator access and branch-specific Preview configuration remain pending.

## Database preparation

1. Verify branch identity, direct/pooled endpoint, database and current branch recovery availability in Neon. Preserve a recoverable pre-migration state before writes; record its identifier/time privately. Do not reset/recreate the existing test branch.
2. Read the actual schema and `drizzle.__drizzle_migrations` ledger. Compare with the repository through `0118`; resolve unexpected differences before running anything. The ordinary runner applies every pending migration, not only `0119`.
3. Apply the additive `0119_attendance_source.sql` only to the independently pinned test destination after reviewing the pending migration list. Preserve the migration ledger consistently. Do not use `drizzle push` or blindly replay historical migrations.
4. Run the guarded CLI preflight, inspect the copied employee roster, choose/prepare a small clean Open test period and an existing active admin audit account, and confirm source/payroll identities. Do not infer identity from equal numeric IDs alone.
5. Fill the private mappings and independently calculated shift examples. Compare, sync explicitly, and repeat once. Check zero duplicate/orphan rows, unchanged repeated raw IDs, correct branch/direction/date/time and expected worked minutes. Leave source-side review decisions untouched.
6. Exercise VOID/restore, late upload, overnight, correction, file overlap and posted-pay protection with synthetic fixtures. Real-source records remain read-only. A successful CLI check does not certify complete payroll/net pay.

## Preview configuration

Scope variables to **Preview / `codex/attendance-api-integration`**. Do not replace shared Preview defaults or Production values.

| Variable | Preview value/purpose |
| --- | --- |
| `DATABASE_URL` | Private connection to the verified `attendance-test` endpoint; never the parent main endpoint |
| `ATTENDANCE_SOURCE_ENABLED` | `false` for baseline checks; `true` only after test migration/preflight succeeds |
| `ATTENDANCE_SOURCE_ORIGIN` | `https://attendance-pilot.wecaredrug.workers.dev` |
| `ATTENDANCE_SOURCE_TOKEN` | Existing privately saved payroll-only read key |
| `ATTENDANCE_VERCEL_CRON_ENABLED` | `false` for ordinary manual UI acceptance |
| `ATTENDANCE_SYNC_ACTOR_ID` | Existing active admin account UUID, needed only for scheduler tests |
| `CRON_SECRET` | Private random value of at least 32 characters, needed only for Vercel GET tests |
| `ATTENDANCE_SYNC_SECRET` | Separate private value, needed only if using the POST scheduler |

Preserve the application's required authentication settings using preview-safe values. Keep deployment protection enabled. Do not weaken login or copy production session tokens to obtain test access. Retain the standard employee/admin role checks. Audit mail/file integrations before exercising flows that could send messages or change shared storage; the attendance sync itself sends neither email nor photos.

After setting the branch-specific environment, redeploy that branch as a **Preview** and verify the deployed commit and destination. Environment edits do not update an existing deployment. Never print credentials in build output or PR comments.

## Hosted acceptance

1. With the feature disabled, sign in normally and verify existing payroll/file imports still work. GET/POST reconcile return 401; no connection link or API sync is available.
2. Enable only in the branch-specific preview and redeploy. Sign in as an existing test administrator. Verify employee/non-admin sessions cannot access mapping/sync actions.
3. Open `/payroll/attendance-source`, inspect mappings/history and repeat the selected period sync. Check no duplicate punches and that source exceptions remain visible.
4. Refresh the **entire** period's summaries using the normal UI. Compare DTR worked/late/undertime/night hours against independent expectations, including actual schedules, breaks, leave and holidays.
5. Compute a draft payroll in the isolated branch and compare expected gross/net amounts and deductions. Do not post a real payroll or trigger payment. Check that changed input invalidates draft summaries/runs, and that copied posted payroll remains unchanged.
6. For scheduler acceptance only, provide the test audit account and test `CRON_SECRET`, temporarily enable the GET flag in this preview, and manually invoke with the Bearer header. Verify unauthorized requests fail and authorized requests create the expected sync history. Return the preview GET flag to `false` afterward. Vercel Cron does not automatically run on Preview.
7. Save redacted acceptance evidence: commit/deployment, endpoint/branch identity, migration state, first/repeat counts, expected/actual hours and net-pay differences. Keep names, pay amounts and punch-level details private where appropriate.

## Production handoff, after maintainer review

Production migration, merge/deploy and activation remain a separate step. Before it, agree on the unresolved all-VOID employee-period absence/zero-attendance workflow. The current implementation blocks such unresolved payroll input rather than calculating an assumed amount.

Select a schedule compatible with the Vercel plan and measured duration. For example, this is a **future configuration fragment**, not an installed scheduler:

```json
{
  "crons": [
    { "path": "/api/attendance-source/reconcile", "schedule": "0 21 * * *" }
  ]
}
```

This example is daily 05:00 Manila (21:00 UTC the previous day); invocation timing depends on the plan. Merge into any existing Vercel configuration only during the later approved rollout. Configure production `CRON_SECRET`, an active audit actor and both required feature flags only after acceptance. Never reuse the attendance API key as the cron secret. Monitor failed/slow syncs and unresolved source exceptions. Keep manual period sync available for older periods.

To stop future syncing, disable cron and both source/GET flags, then redeploy. This preserves imported records and audit history; it does not undo payroll or remove prior imports. Use the verified recovery point and reviewed recovery procedure for database rollback.

## Platform references

- [Vercel Preview environments](https://vercel.com/docs/deployments/environments) and [branch-scoped environment variables](https://vercel.com/docs/environment-variables).
- [Vercel Cron GET requests](https://vercel.com/docs/cron-jobs), [authorization and operation](https://vercel.com/docs/cron-jobs/manage-cron-jobs), and [plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- [Deployment protection](https://vercel.com/docs/deployment-protection).

This runbook describes the complete setup sequence. Use the linked test evidence for completed database checks; hosted Preview and full payroll acceptance remain outstanding.

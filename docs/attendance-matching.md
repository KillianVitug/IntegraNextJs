# Attendance employee matching

Open **Payroll → Attendance connection** as an administrator. The connection must already be enabled and have synced attendance records.

1. In **Needs a match**, choose an attendance person by name. Their attendance ID, recorded names, branches and punch counts are filled in automatically.
2. Compare **Possible matches**, or search by Integra employee name/number. Suggestions are clues; nobody is selected automatically. Check the employee number when names are the same.
3. Choose **How did you check?**, add a note when useful (required for Other evidence), confirm the identity checkbox, and select **Confirm employee match**.
4. Continue with **Next person**. Under **Update a payroll period**, sync each affected period, refresh its DTR summaries, and review in payroll before recomputing.

The **Matched** tab allows review or correction of an existing match. Changes apply to that attendance ID across periods and can make existing open payroll stale. Unknown/test people should remain unmatched while HR or the branch supervisor checks the source. Different actual people sharing one attendance ID need source correction first.

The person list groups all stored source events, including identities absent from the latest 500-punch detail view and identities with only voided punches. A mapping to an inactive employee reappears under Needs a match. Existing admin, audit, invalidation and posted-payroll protections still apply; matching does not clear source flags or compute/approve/pay payroll.

## Verification

- `verify:attendance-matching`: in-memory SQL tests for all-period grouping, older/void-only identities, name variants, ambiguous suggestions, large numeric ID precision and evidence requirements.
- `verify:attendance-release-guards`: existing mapping audit/invalidation and payroll transition protection tests.
- Production build, TypeScript and lint checks.
- `src/scripts/attendanceMatchingPreview.tsx` renders the actual matching component with synthetic people and a simulated save callback. It is a review fixture, not a production route. Desktop and 390px viewport checks cover no automatic selection, required evidence, failure/retry, counts/next person, saved-match correction and phone navigation without horizontal overflow.

Real employee assignments require an administrator's identity verification. Synthetic UI checks do not establish authenticated production workflow acceptance.

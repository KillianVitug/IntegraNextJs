# Integra manager release

Read [docs/MANAGER_FIRST_RELEASE.md](docs/MANAGER_FIRST_RELEASE.md) for current scope,
verification and deployment status. This checkout also follows its parent
workspace's AGENTS.md and docs/MASTER_PLAN.md while used inside that workspace.
Preserve unrelated changes and distinguish plans from implemented/verified work.

For the local manager schedule-actions candidate, also read
[docs/MANAGER_SCHEDULE_ACTIONS.md](docs/MANAGER_SCHEDULE_ACTIONS.md). Its local
verification does not imply production deployment.

For every app analysis or change, assess Philippine labor-rights/pay impact. For
attendance, schedules, working time, overtime, undertime, lateness, breaks, leave,
wages, deductions, benefits or approvals, read
[docs/PHILIPPINE_LABOR_COMPLIANCE.md](docs/PHILIPPINE_LABOR_COMPLIANCE.md) and verify
affected rules against current primary sources. Include labels, defaults, rounding,
filters and data flows that can affect or misrepresent entitlement. Distinguish
law, company/CBA benefits, adopted product policy and implemented behavior. Record
sources, dates, coverage, assumptions and unresolved legal issues. Existing code,
passing tests or owner approval do not establish legal compliance. Scale review to
the change; unrelated technical/cosmetic work needs no blanket legal-approval gate.
Carry these notes into any independently used checkout.

Use isolated fictional/restored data for test writes; a local server can still
point to production. Preserve original captures, audit history and protected payroll.
Keep manager responses explicitly nonfinancial and enforce scope on the server.
Use reusable checks with compact results and detailed logs. Record observed UI
actions and distinguish automated shortcuts from measured human/phone journeys.
Provide phone-accessible review downloads. This task authorizes implementation;
deployment, production migration and financial actions remain separate.

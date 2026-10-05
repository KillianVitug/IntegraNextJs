# Integra HRMS And Payroll Roadmap

Last updated: 2026-10-01

## Purpose

This document is the official roadmap for making Integra a fully integrated
HRMS and payroll program. It is grounded in the current Next.js application,
Drizzle schema, payroll engine, role-based route groups, and verification
scripts already present in the project.

The roadmap optimizes for a payroll-first Philippine HRMS for a single company.
The first priority is not to become a broad recruitment suite or multi-tenant
SaaS platform. The first priority is to make employee records, timekeeping,
leave, schedules, loans, payroll, payslips, statutory compliance, outputs,
access control, and audit work together end to end.

## Operating Model

- Company model: single Philippine employer with departments and branches.
- Payroll model: semi-monthly payroll remains the v1 default.
- Role model: Employee, Manager, HR Admin, and System Admin.
- Integration priority: biometrics/DTR import, bank and cash disbursement,
  GL journal export, and government/statutory output packages.
- Browser requirement: critical workflows must remain progressively enhanced,
  following the Firefox 66 compatibility direction in `docs/firefox-66-compatibility.md`.

## Current Project Foundation

Integra already has major parts of the HRMS and payroll platform in place.

- Employee route group:
  - `/employeeHome`
  - `/employeeProfile`
  - `/employeeLeaves`
  - `/employeeLeaves/form`
  - `/employeePayslips`
- Manager route group:
  - `/managerHome`
  - `/managerCalendar`
  - `/managerLeaves`
  - `/managerSchedules`
  - `/managerDtrFiles`
- Admin route group:
  - `/home`
  - `/employeeMaster`
  - `/leaves`
  - `/salaryAdjustment`
  - `/payroll`
  - `/payroll/report`
  - `/payroll/outputs`
  - `/payroll/special-run`
  - `/loans`
  - `/employeeFiles`
  - `/access-management`
  - `/branchCalendar`
  - `/shiftAssignments`
  - `/weeklyShiftPatterns`
  - `/constants/*`
- Payroll and HR tables already cover employees, salary, tax profiles,
  shifts, weekly patterns, attendance imports, attendance summaries, DTR
  overrides, leave records, leave ledger, leave encashment, loans, statutory
  rules, payroll periods, payroll runs, payroll run lines, payslip publication,
  payroll artifacts, disbursements, journals, filings, auth, permissions, and
  audit events.
- Verification scripts already cover payroll, attendance parsing, statutory
  rules, leave, loans, salary normalization, manager legacy browser behavior,
  and HRMS audit flows.

## Product Principles

- One employee record should drive HR, timekeeping, leave, payroll, files,
  access, and reports.
- Payroll must be reproducible from stored snapshots, not only from current
  employee setup records.
- Every payroll-impacting action must be traceable by actor, timestamp,
  status, source table, and reason where applicable.
- Managers must only see and act on employees in assigned departments.
- Employees must only see their own profile, requests, payslips, loans, and
  files unless explicitly allowed by policy.
- Critical HR and manager workflows must work with server-rendered HTML,
  native links, forms, and route handlers before client-side enhancement.
- Payroll outputs must become real downloadable artifacts, not only database
  records.

## End-To-End Workflow Target

### 1. Employee Lifecycle

Target flow:

1. HR Admin creates or imports an employee in `/employeeMaster`.
2. HR completes general info, department, position, salary, statutory numbers,
   tax profile, payroll mode, payroll terms, bank account, timekeeping ID, and
   leave group.
3. System creates or links an auth account through `/access-management`.
4. Employee claims the account through the onboarding/login flow.
5. Employee can view profile, file leave, view payslips, view loan schedules,
   and access permitted files.
6. HR manages status changes, salary changes, department movement, separation,
   offboarding, final pay, and account deactivation.

Required completion:

- Add a real employee dashboard for `/employeeHome`.
- Add employee-facing loan page at `/employeeLoans`.
- Add employee-facing files page at `/employeeProfileFiles`.
- Add profile-change request workflow for employee-submitted corrections.
- Add offboarding/final-pay workflow connected to payroll.

### 2. Employee Self-Service

Target flow:

1. Employee logs in and lands on `/employeeHome`.
2. Dashboard shows profile status, leave balance, pending requests, latest
   payslip, active loan balance, and payroll cutoff notices.
3. Employee files leave from `/employeeLeaves/form`.
4. Employee tracks leave status in `/employeeLeaves`.
5. Employee views published payslips in `/employeePayslips`.
6. Employee views loans, deductions, and balances in `/employeeLoans`.
7. Employee views or uploads allowed employee files in `/employeeProfileFiles`.

Required completion:

- Replace the placeholder employee home page.
- Add self-service loan and file routes currently referenced by the employee
  header.
- Add notification records for leave status, payslip publication, payroll
  posting, account events, and DTR issues.

### 3. Manager Operations

Target flow:

1. Manager logs in and lands on `/managerHome`.
2. Manager sees assigned departments and employees only.
3. Manager reviews team calendar in `/managerCalendar`.
4. Manager files or manages department leave requests in `/managerLeaves`.
5. Manager maintains weekly and payroll-period schedules in
   `/managerSchedules`.
6. Manager imports and reviews DTR files in `/managerDtrFiles`.
7. Manager submits schedule requests and DTR hold/correction items for admin
   action where required.

Required completion:

- Keep department scoping enforced through manager department assignments.
- Preserve no-JavaScript manager flows verified by
  `tests/e2e/manager-legacy-browser.spec.ts`.
- Add clearer manager dashboard signals for attendance exceptions, pending
  leaves, pending schedule requests, and payroll readiness issues.

### 4. Attendance And DTR Processing

Target flow:

1. Payroll periods are seeded for the year.
2. Admin or manager imports biometrics/DTR files.
3. System parses CSV/TXT rows into raw logs.
4. System matches logs to employees using timekeeping IDs or employee keys.
5. System creates attendance daily summaries for each employee and date.
6. Admin or manager reviews unmatched logs, duplicate punches, missing punches,
   late, undertime, overtime, rest day, holiday, and held DTR rows.
7. Corrections and overrides are reviewed and approved.
8. Attendance period is ready for payroll computation.

Required completion:

- Formalize a payroll-period attendance close checklist.
- Add adapter boundaries for different biometric file formats.
- Improve DTR diagnostics for unmatched employees and invalid source files.
- Add approval and audit consistency for DTR overrides and held rows.

### 5. Leave Management

Target flow:

1. HR configures leave types and policies.
2. System grants or accrues leave through the leave ledger.
3. Employee, manager, or HR files leave.
4. HR or authorized reviewer approves, denies, cancels, or voids leave.
5. Payroll consumes approved leave as paid leave, unpaid leave, LWOP, or
   encashment depending on policy and account-code mapping.
6. Leave balances remain traceable through ledger entries.

Required completion:

- Keep leave ledger as the source of leave balance truth.
- Connect leave encashment to payroll outputs and employee visibility.
- Add leave liability and utilization reports.

### 6. Loans And Recurring Deductions

Target flow:

1. HR creates employee loan in `/loans`.
2. System generates installments by payroll code and deduction schedule.
3. Payroll picks due installments into payroll run lines.
4. Posting payroll creates loan payment records and marks installments paid.
5. HR can skip, adjust, reloan, or settle loans with full audit history.
6. Employee can view loan balance and deduction history.

Required completion:

- Add employee loan self-service page.
- Add loan reconciliation and exception reports.
- Keep payroll-linked installment changes audited.

### 7. Payroll Processing

Target flow:

1. HR seeds payroll periods.
2. HR imports and reviews attendance.
3. HR checks employee and statutory readiness.
4. HR computes or recomputes a payroll run.
5. HR reviews employee-level payroll details and line items.
6. HR applies manual payroll entries, payroll exceptions, overtime overrides,
   loan changes, and account-code imports where needed.
7. Payroll run moves through Draft, Reviewed, Approved, Posted, Void, or
   Reversal.
8. Maker-checker controls prevent the same actor from performing incompatible
   review, approve, and post actions.
9. Posted payroll updates payroll-linked records such as loans and published
   outputs.

Required completion:

- Keep semi-monthly payroll as v1.
- Complete regular, manual, supplemental, off-cycle, final pay, reversal, and
  13th-month payroll scenarios.
- Expand payroll preflight checks until payroll blockers are clear and
  actionable.
- Make payroll run events the operational timeline for every run.

### 8. Payroll Outputs And Compliance

Target flow:

1. Approved or posted payroll run can generate outputs.
2. System creates payslips, payroll register, bank file, cash payroll list,
   GL journal, and statutory filing packages.
3. Generated records become downloadable artifacts.
4. HR publishes payslips to employees.
5. HR tracks disbursement, filing, payment, reconciliation, reversal, and void
   statuses.

Required completion:

- Store real generated files and expose download routes.
- Complete PNB bank file and cash payroll list generation.
- Complete balanced GL journal export with configurable account mapping.
- Complete statutory package outputs:
  - SSS contribution
  - SSS loan
  - PhilHealth EPRS
  - Pag-IBIG MCRF
  - BIR 1601-C
  - BIR 1604-C
  - BIR 2316
  - DOLE 13th month report
- Track statutory package lifecycle: Generated, Submitted, Paid, Reconciled,
  Voided.

### 9. Admin, Access, Audit, And Reporting

Target flow:

1. System Admin manages accounts, groups, status, sessions, and resets in
   `/access-management`.
2. HR Admin manages employee, payroll, timekeeping, leave, loan, file, and
   constant modules.
3. Managers work only in scoped department workspaces.
4. Employees work only in self-service pages.
5. Audit events record sensitive changes.
6. Dashboards and reports expose operational readiness and payroll results.

Required completion:

- Expand audit coverage beyond payroll and access into employee, leave, files,
  salary, constants, DTR, and integrations.
- Replace `/home/applications` redirect with a unified request and approval
  queue.
- Add reports for payroll register, agency deduction summary, loan deduction
  summary, leave utilization, leave liability, employee readiness, attendance
  exceptions, headcount by department, and payroll variance.

## Phased Implementation Roadmap

### Phase 0: Stabilize The Current Baseline

Goal: make the current system coherent, documented, and testable.

Deliverables:

- Keep this `roadmap.md` as the official roadmap.
- Update `README.md` so it describes Integra instead of the default Next.js
  starter.
- Fix route/menu mismatches:
  - Implement `/employeeLoans`.
  - Implement `/employeeProfileFiles`.
  - Replace placeholder `/employeeHome`.
  - Replace `/home/applications` redirect with a real application queue.
- Keep existing dirty worktree changes intact; do not revert unrelated work.
- Run baseline checks before release:
  - `npm run lint`
  - `npm run build`
  - `npm run e2e:hrms-audit`
  - `npm run e2e:manager-legacy`

Acceptance:

- All header and sidebar links resolve to real pages.
- Employee, Manager, and Admin users land on useful dashboards.
- No critical route returns app error or not-found for visible navigation.

### Phase 1: HR Master Data And Access Foundation

Goal: make employee records the shared source of truth.

Deliverables:

- Complete employee readiness dashboard.
- Complete onboarding and account claim flow.
- Add profile-change request workflow.
- Add employment status/offboarding flow.
- Harden permission gates per route and server action.
- Expand admin audit events.

Acceptance:

- Every payroll-eligible employee can be checked for missing setup data.
- HR can explain why an employee is or is not payroll-ready.
- Employee account lifecycle is traceable from creation to disablement.

### Phase 2: Employee Self-Service Completion

Goal: make employee-facing HR and payroll useful without admin assistance.

Deliverables:

- Employee dashboard.
- Employee leave status and balance view.
- Employee loan view.
- Employee files view/upload policy.
- Payslip printable/downloadable view.
- In-app and email notifications.

Acceptance:

- Employee can complete common self-service scenarios without HR opening the
  admin modules.
- Published payslips are visible only to the correct employee.
- Employee requests have clear status history.

### Phase 3: Manager Workspace Completion

Goal: make managers effective department operators.

Deliverables:

- Manager dashboard signals for team attendance, leave, schedule, and payroll
  readiness.
- Schedule request workflow with admin approval.
- DTR review and hold workflows.
- Team calendar with shifts, rest days, holidays, and leaves.
- No-JavaScript fallbacks for critical manager forms.

Acceptance:

- Manager can operate assigned departments without seeing other departments.
- Schedule and DTR changes remain auditable.
- Manager workflows pass Firefox 66 compatibility checks.

### Phase 4: Attendance Close And Payroll Readiness

Goal: make timekeeping reliable before payroll computation.

Deliverables:

- Payroll-period attendance close checklist.
- Biometric adapter interface.
- Improved unmatched and duplicate log diagnostics.
- DTR correction approval flow.
- Attendance lock/readiness status per payroll period.

Acceptance:

- Payroll can clearly block on unresolved attendance issues.
- Resolved DTR issues are traceable to actor, reason, and source row.
- Attendance summaries are stable inputs for payroll.

### Phase 5: Payroll Scenario Completion

Goal: cover all core payroll run types and adjustments.

Deliverables:

- Regular payroll.
- Manual payroll.
- Supplemental/off-cycle payroll.
- Final pay.
- Reversal run.
- 13th month.
- Salary adjustment.
- Loan deductions.
- Recurring entries.
- Leave encashment.
- Statutory contributions and BIR withholding.

Acceptance:

- Payroll can process normal and exception scenarios from one workspace.
- Payroll run statuses and maker-checker controls are enforced.
- Payroll outputs match payroll run snapshots.

### Phase 6: Outputs, Compliance, And Integrations

Goal: turn payroll results into usable files and compliance packages.

Deliverables:

- Artifact download and storage interface.
- Payslip PDF generation and publication.
- Bank and cash disbursement files.
- GL journal export with configurable account mapping.
- Statutory filing package exports.
- Filing, payment, reconciliation, and void tracking.

Acceptance:

- HR can generate, download, publish, and audit payroll outputs.
- GL journals balance before export.
- Statutory packages are generated from posted or approved payroll snapshots.

### Phase 7: Reporting, Monitoring, And Production Operations

Goal: make Integra production-operable.

Deliverables:

- Operational dashboards.
- Payroll and HR reports.
- Data integrity checks.
- Import/export history.
- Backup and restore procedures.
- Production runbook.
- Security review checklist.

Acceptance:

- HR can monitor payroll readiness before cutoff.
- Admin can audit who changed sensitive records and when.
- Production support has documented procedures for payroll-critical failures.

## Integration Roadmap

Priority order:

1. Biometrics and DTR import adapters.
2. Bank file and cash payroll list generation.
3. GL journal export.
4. Government/statutory filing packages.
5. Email and in-app notification outbox.
6. Optional analytics and BI exports.

Integration rules:

- Each integration must have preview, generate, audit, and revert/void behavior
  where applicable.
- Exports must be based on stored payroll snapshots.
- Failed imports must produce diagnostics that HR can act on.
- Generated files must be attached to payroll artifacts or integration batch
  records.

## Testing And Verification Plan

Required checks:

- `npm run lint`
- `npm run build`
- `npm run verify:attendance-parser`
- `npm run verify:leave-functionality`
- `npm run verify:loan-functionality`
- `npm run verify:salary-normalization`
- `npm run verify:payroll-account-code-import`
- `npm run verify:statutory-rate-import`
- `npm run e2e:hrms-audit`
- `npm run e2e:manager-legacy`

Scenario tests to add or expand:

- Employee account claim, login, dashboard, leave request, payslip view, loan
  view, and file view.
- Manager department scoping, schedule request, DTR import, DTR correction, and
  team calendar.
- Admin employee creation, readiness checks, payroll compute, review, approve,
  post, publish, outputs, and reversal.
- Compliance output generation for SSS, PhilHealth, Pag-IBIG, BIR, and DOLE.
- Permission checks for every role and protected server action.

## Definition Of Fully Integrated V1

Integra can be considered fully integrated for v1 when:

- Employee master data flows into attendance, leave, loans, payroll, payslips,
  files, access, and reports.
- Employee, Manager, HR Admin, and System Admin each have complete dashboards
  and workflows for their role.
- Attendance and DTR data can be imported, reviewed, corrected, approved, and
  used by payroll.
- Leave balances and leave requests affect payroll correctly.
- Loans and recurring deductions affect payroll and update balances on post.
- Payroll can run through compute, review, approve, post, publish, output, and
  reversal with audit history.
- Payslips, bank/cash disbursement files, GL journals, and statutory packages
  are generated as real artifacts.
- Audit, permission, and readiness checks are strong enough for production use.
- The HRMS audit and manager legacy-browser test suites pass consistently.


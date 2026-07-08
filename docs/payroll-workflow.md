# Payroll Workflow

## What Changed

The payroll module now stores operational payroll data in transaction tables instead of depending only on employee setup records.

### Attendance Flow

- `attendance_import_batches` tracks each CSV or TXT upload.
- `attendance_raw_logs` stores every parsed biometric row linked to a batch.
- `attendance_daily_summaries` stores one summarized attendance record per employee per day.
- `employee_shift_assignments` is the new schedule master that defines the expected shift, hours, break, grace period, and rest day.

### Payroll Flow

- `payroll_periods` stores the generated semi-monthly payroll calendar.
- `payroll_runs` stores each computed run for a payroll period and its workflow status.
- `payroll_run_employees` stores the payroll snapshot per employee for a run.
- `payroll_run_lines` stores the detailed earnings, deductions, employer shares, taxes, and loan lines for each employee snapshot.

### Leave Flow

- `leave_types` replaces hard-coded leave labels with configurable lookup data.
- `employees_leave_records.leaveTypeId` links leave requests to the new lookup table.
- `leave_balance_ledger` stores accrual and usage movements so payroll can treat paid and unpaid leave differently.

### Loan Flow

- `loan_installments` turns a loan into payroll-linked scheduled deductions.
- `loan_payments` stores the actual payment entries created when a payroll run is posted.
- `employees_loans.payrollDateDeduction` now acts as the first scheduled deduction anchor instead of being the only payroll reference.

### Statutory Flow

- `statutory_rule_versions` stores effectivity windows for rule sets.
- `sss_contribution_brackets`, `philhealth_contribution_rates`, `pagibig_contribution_rates`, and `bir_withholding_tax_brackets` store the actual tables used by the payroll engine.

## Runtime Workflow

1. Seed `payroll_periods` for the target year.
2. Import biometric files into `attendance_import_batches` and `attendance_raw_logs`.
3. Build day-level attendance into `attendance_daily_summaries`.
4. Compute a `payroll_run` for the selected payroll period.
5. Store each employee result in `payroll_run_employees`.
6. Store the detailed breakdown in `payroll_run_lines`.
7. Review, approve, and then post the run.
8. On post, due `loan_installments` are marked paid and matching `loan_payments` are created.

## Current UI Entry Point

The first working payroll UI is now available at `/payroll`.

It currently supports:

- seeding payroll periods by year
- selecting a payroll period
- importing attendance files for that period
- computing or recomputing a payroll run
- moving the run through review, approval, post, and void states
- inspecting employee-level payroll totals
- inspecting detailed payroll line items
- reviewing recent attendance import batches

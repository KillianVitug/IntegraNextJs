CREATE TABLE monthly_payroll_settings (
 employee_id uuid NOT NULL REFERENCES employees(id),
 effective_month date NOT NULL CHECK (extract(day from effective_month) = 1),
 payout_half text NOT NULL DEFAULT 'B' CHECK (payout_half IN ('A','B')),
 actor text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(employee_id,effective_month)
);
--> statement-breakpoint
-- Historical mixed runs keep their Legacy identity. New groups post independently;
-- employee-level overlap is also checked under the payroll advisory lock.
DROP INDEX IF EXISTS uq_payroll_run_posted_regular_period;
CREATE UNIQUE INDEX uq_payroll_run_posted_regular_period
 ON payroll_runs(payroll_period_id, (coalesce(input_snapshot->>'payrollGroup','Legacy')))
 WHERE run_type = 'Regular' AND status = 'Posted';

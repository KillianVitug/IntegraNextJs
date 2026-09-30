ALTER TYPE attendance_import_format ADD VALUE IF NOT EXISTS 'API';
--> statement-breakpoint
CREATE TABLE attendance_source_mappings (source_employee_id text PRIMARY KEY, employee_id uuid NOT NULL REFERENCES employees(id), actor_user_id text NOT NULL, reason text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE attendance_source_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id), state text NOT NULL, actor_user_id text NOT NULL, from_date text NOT NULL, through_date text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, counts jsonb, error text);
CREATE INDEX attendance_source_runs_period ON attendance_source_runs(payroll_period_id,started_at);
CREATE TABLE attendance_source_events (event_id uuid PRIMARY KEY, source_employee_id text NOT NULL, captured_at timestamptz NOT NULL, payload jsonb NOT NULL, first_payload jsonb NOT NULL, revision integer NOT NULL DEFAULT 1, seen_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX attendance_source_events_employee ON attendance_source_events(source_employee_id,captured_at);
CREATE TABLE attendance_source_revisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES attendance_source_events(event_id), run_id uuid NOT NULL REFERENCES attendance_source_runs(id), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX attendance_source_revisions_event ON attendance_source_revisions(event_id,created_at);
CREATE TABLE attendance_source_projections (payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id), event_id uuid NOT NULL REFERENCES attendance_source_events(event_id), raw_log_id integer REFERENCES attendance_raw_logs(id) ON DELETE RESTRICT, employee_id uuid REFERENCES employees(id), payload_hash text NOT NULL, PRIMARY KEY(payroll_period_id,event_id));
CREATE TABLE attendance_source_periods (payroll_period_id uuid PRIMARY KEY REFERENCES payroll_periods(id), input_run_id uuid NOT NULL REFERENCES attendance_source_runs(id), summaries_run_id uuid REFERENCES attendance_source_runs(id));

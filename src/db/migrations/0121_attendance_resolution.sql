CREATE TABLE attendance_resolutions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id),
 source_employee_id text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('Manual','NoAttendance','SourceVoid','SourceRestore')),
 state text NOT NULL CHECK (state IN ('Pending','Approved','Sending','Applied','Failed','Expired','Reversed','Rejected')),
 source_version text NOT NULL, employee_id uuid REFERENCES employees(id),
 reason text NOT NULL, evidence text NOT NULL,
 manual_punches jsonb NOT NULL DEFAULT '[]', event_ids jsonb NOT NULL DEFAULT '[]',
 source_requests jsonb NOT NULL DEFAULT '[]', result text,
 actor_user_id text NOT NULL, reviewer_user_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_resolutions_period ON attendance_resolutions(payroll_period_id,updated_at,id);
CREATE TABLE attendance_resolution_logs (
 resolution_id uuid NOT NULL REFERENCES attendance_resolutions(id),
 punch_index integer NOT NULL,
 raw_log_id integer NOT NULL REFERENCES attendance_raw_logs(id) ON DELETE RESTRICT,
 PRIMARY KEY (resolution_id,punch_index)
);

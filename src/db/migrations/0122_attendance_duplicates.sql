CREATE TABLE attendance_duplicate_policy (
  id text PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  mode text NOT NULL DEFAULT 'Suggest' CHECK (mode IN ('Off','Suggest','Automatic')),
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  enabled_after timestamptz,
  actor_user_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE attendance_resolutions ADD COLUMN duplicate_metadata jsonb;
CREATE TABLE attendance_duplicate_checks (
  payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id),
  kept_event_id uuid NOT NULL,
  source_version text NOT NULL,
  policy_revision text NOT NULL,
  result text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(payroll_period_id,kept_event_id)
);

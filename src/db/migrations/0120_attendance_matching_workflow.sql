CREATE TABLE attendance_source_identities (
  source_employee_id text PRIMARY KEY,
  classification text NOT NULL DEFAULT 'Active' CHECK (classification IN ('Active','TestOnly','NeedsReview')),
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_user_id text NOT NULL, reason text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE attendance_match_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('Match','Unmatch','Undo','TestOnly','Restore')),
  actor_user_id text NOT NULL, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendance_match_batches_created ON attendance_match_batches(created_at,id);
CREATE TABLE attendance_match_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES attendance_match_batches(id),
  source_employee_id text NOT NULL, source_name text NOT NULL,
  before_employee_id uuid REFERENCES employees(id), after_employee_id uuid REFERENCES employees(id),
  before_employee_label text, after_employee_label text,
  before_classification text NOT NULL, after_classification text NOT NULL,
  after_revision uuid NOT NULL,
  reverses_change_id uuid REFERENCES attendance_match_changes(id),
  UNIQUE(batch_id,source_employee_id)
);
CREATE INDEX attendance_match_changes_batch ON attendance_match_changes(batch_id);
CREATE INDEX attendance_match_changes_source ON attendance_match_changes(source_employee_id);

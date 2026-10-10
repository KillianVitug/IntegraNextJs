-- Existing numeric IDs, names, times, break rows and assignment references stay intact.
ALTER TABLE shift_tables ADD COLUMN family_id uuid NOT NULL DEFAULT gen_random_uuid();
--> statement-breakpoint
ALTER TABLE shift_tables ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE shift_tables ADD COLUMN archived_at timestamptz;
--> statement-breakpoint
ALTER TABLE shift_tables ADD COLUMN calculation_policy text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE shift_tables ADD COLUMN punch_policy text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE shift_tables ADD CONSTRAINT shift_table_positive_version CHECK (version > 0);
--> statement-breakpoint
ALTER TABLE shift_tables ADD CONSTRAINT shift_table_calculation_policy CHECK (calculation_policy IN ('legacy','eight_hour_day'));
--> statement-breakpoint
ALTER TABLE shift_tables ADD CONSTRAINT shift_table_punch_policy CHECK (punch_policy IN ('legacy','outer','split_gaps'));
--> statement-breakpoint
ALTER TABLE shift_tables DROP CONSTRAINT IF EXISTS shift_tables_code_unique;
--> statement-breakpoint
DROP INDEX IF EXISTS uq_shift_table_code;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_shift_table_active_code ON shift_tables(code) WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_shift_table_family_version ON shift_tables(family_id,version);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_shift_table_active_family ON shift_tables(family_id) WHERE archived_at IS NULL;
--> statement-breakpoint
ALTER TABLE shift_table_breaks ADD COLUMN requires_punches boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE employee_shift_assignments ADD COLUMN calculation_policy text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE employee_shift_assignments ADD COLUMN punch_policy text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE employee_weekly_shift_pattern_days ADD COLUMN calculation_policy text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE employee_weekly_shift_pattern_days ADD COLUMN punch_policy text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
-- No historical break windows are inferred or recreated here.
ALTER TABLE employee_weekly_shift_pattern_days ADD COLUMN definition_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE attendance_daily_summaries ADD COLUMN calculation_policy text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
CREATE TABLE shift_catalog_receipts (
 request_id uuid PRIMARY KEY, actor_user_id varchar(255) NOT NULL, request_digest varchar(64) NOT NULL,
 receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

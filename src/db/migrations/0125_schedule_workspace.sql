ALTER TABLE employee_shift_assignments ADD COLUMN schedule_decision_id uuid;
--> statement-breakpoint
ALTER TABLE employee_shift_assignments ADD COLUMN confirmed_schedule jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_confirmed_schedule_employee_day ON employee_shift_assignments(employee_id,effective_from) WHERE schedule_decision_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE employee_weekly_shift_pattern_days ADD COLUMN schedule_state varchar(20);
--> statement-breakpoint
CREATE TABLE schedule_workspace_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), department_id integer NOT NULL REFERENCES department(id),
 period_id uuid NOT NULL REFERENCES payroll_periods(id), revision integer NOT NULL DEFAULT 1,
 source_digest varchar(64) NOT NULL, cells jsonb NOT NULL, updated_by_user_id varchar(255) NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_schedule_workspace_draft_scope ON schedule_workspace_drafts(department_id,period_id);
--> statement-breakpoint
CREATE TABLE schedule_decision_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL,
 employee_id uuid NOT NULL REFERENCES employees(id), day date NOT NULL,
 department_id integer NOT NULL REFERENCES department(id), period_id uuid NOT NULL REFERENCES payroll_periods(id),
 snapshot jsonb NOT NULL, default_snapshot jsonb NOT NULL, previous_snapshot jsonb NOT NULL,
 actor_user_id varchar(255) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX idx_schedule_decision_employee_day ON schedule_decision_revisions(employee_id,day);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_schedule_decision_request_day ON schedule_decision_revisions(request_id,employee_id,day);
--> statement-breakpoint
CREATE TABLE schedule_request_receipts (
 request_id uuid PRIMARY KEY, actor_user_id varchar(255) NOT NULL, request_digest varchar(64) NOT NULL,
 receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

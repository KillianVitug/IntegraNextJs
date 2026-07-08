CREATE TYPE "public"."shift_break_slot" AS ENUM('mid_break', 'break_1', 'break_2', 'break_3', 'break_4', 'ot_break_1', 'ot_break_2');--> statement-breakpoint
CREATE TABLE "shift_table_breaks" (
	"id" serial PRIMARY KEY NOT NULL,
	"shift_table_id" integer NOT NULL,
	"slot_key" "shift_break_slot" NOT NULL,
	"label" varchar(80) NOT NULL,
	"from_time" time NOT NULL,
	"to_time" time NOT NULL,
	"deduct" boolean DEFAULT false NOT NULL,
	"deduct_hours" integer DEFAULT 0 NOT NULL,
	"deduct_minutes" integer DEFAULT 0 NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(40) NOT NULL,
	"description" varchar(120) NOT NULL,
	"regular_start_time" time NOT NULL,
	"regular_end_time" time NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shift_tables_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ADD COLUMN "shift_table_id" integer;--> statement-breakpoint
ALTER TABLE "shift_table_breaks" ADD CONSTRAINT "shift_table_breaks_shift_table_id_shift_tables_id_fk" FOREIGN KEY ("shift_table_id") REFERENCES "public"."shift_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shift_table_break_shift_table_id" ON "shift_table_breaks" USING btree ("shift_table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shift_table_break_slot" ON "shift_table_breaks" USING btree ("shift_table_id","slot_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shift_table_code" ON "shift_tables" USING btree ("code");--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ADD CONSTRAINT "employee_shift_assignments_shift_table_id_shift_tables_id_fk" FOREIGN KEY ("shift_table_id") REFERENCES "public"."shift_tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shift_assignment_shift_table_id" ON "employee_shift_assignments" USING btree ("shift_table_id");
import { pgTable, text, uuid, timestamp, jsonb, integer, primaryKey, index } from "drizzle-orm/pg-core";
import { employees, payrollPeriods, attendanceRawLogs } from "./schema";
// Additive tables: a disabled connector never queries them.
export const attendanceSourceMappings = pgTable("attendance_source_mappings", {
  sourceEmployeeId: text("source_employee_id").primaryKey(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  actorUserId: text("actor_user_id").notNull(),
  reason: text("reason").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const attendanceSourceRuns = pgTable("attendance_source_runs", {
  id: uuid("id").primaryKey().defaultRandom(), payrollPeriodId: uuid("payroll_period_id").notNull().references(() => payrollPeriods.id),
  state: text("state").notNull(), actorUserId: text("actor_user_id").notNull(),
  fromDate: text("from_date").notNull(), throughDate: text("through_date").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }), counts: jsonb("counts"), error: text("error"),
}, t => [index("attendance_source_runs_period").on(t.payrollPeriodId,t.startedAt)]);
export const attendanceSourceEvents = pgTable("attendance_source_events", {
  eventId: uuid("event_id").primaryKey(), sourceEmployeeId: text("source_employee_id").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  payload: jsonb("payload").notNull(), firstPayload: jsonb("first_payload").notNull(),
  revision: integer("revision").notNull().default(1), seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("attendance_source_events_employee").on(t.sourceEmployeeId,t.capturedAt)]);
export const attendanceSourceRevisions = pgTable("attendance_source_revisions", {
  id: uuid("id").primaryKey().defaultRandom(), eventId: uuid("event_id").notNull().references(() => attendanceSourceEvents.eventId), runId: uuid("run_id").notNull().references(() => attendanceSourceRuns.id),
  payload: jsonb("payload").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("attendance_source_revisions_event").on(t.eventId,t.createdAt)]);
export const attendanceSourceProjections = pgTable("attendance_source_projections", {
  payrollPeriodId: uuid("payroll_period_id").notNull().references(() => payrollPeriods.id), eventId: uuid("event_id").notNull().references(() => attendanceSourceEvents.eventId),
  rawLogId: integer("raw_log_id").references(() => attendanceRawLogs.id, {onDelete:"restrict"}), employeeId: uuid("employee_id").references(() => employees.id), payloadHash: text("payload_hash").notNull(),
}, t => [primaryKey({ columns: [t.payrollPeriodId, t.eventId] })]);
export const attendanceSourcePeriods = pgTable("attendance_source_periods", {
  payrollPeriodId: uuid("payroll_period_id").primaryKey().references(() => payrollPeriods.id), inputRunId: uuid("input_run_id").notNull().references(() => attendanceSourceRuns.id), summariesRunId: uuid("summaries_run_id").references(() => attendanceSourceRuns.id),
});

// Classification never changes source evidence or suppresses payroll exceptions.
export const attendanceSourceIdentities = pgTable("attendance_source_identities", {
  sourceEmployeeId: text("source_employee_id").primaryKey(),
  classification: text("classification").notNull().default("Active"),
  revision: uuid("revision").notNull().defaultRandom(),
  actorUserId: text("actor_user_id").notNull(),
  reason: text("reason").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const attendanceMatchBatches = pgTable("attendance_match_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("attendance_match_batches_created").on(t.createdAt, t.id)]);
export const attendanceMatchChanges = pgTable("attendance_match_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull().references(() => attendanceMatchBatches.id),
  sourceEmployeeId: text("source_employee_id").notNull(),
  sourceName: text("source_name").notNull(),
  beforeEmployeeId: uuid("before_employee_id").references(() => employees.id),
  afterEmployeeId: uuid("after_employee_id").references(() => employees.id),
  beforeEmployeeLabel: text("before_employee_label"),
  afterEmployeeLabel: text("after_employee_label"),
  beforeClassification: text("before_classification").notNull(),
  afterClassification: text("after_classification").notNull(),
  afterRevision: uuid("after_revision").notNull(),
  reversesChangeId: uuid("reverses_change_id"),
}, t => [index("attendance_match_changes_batch").on(t.batchId), index("attendance_match_changes_source").on(t.sourceEmployeeId)]);

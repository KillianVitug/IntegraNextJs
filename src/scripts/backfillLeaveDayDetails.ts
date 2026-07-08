import { config } from "dotenv";
import { sql } from "drizzle-orm";
import type { DbClient } from "../db";

type ParsedArgs = {
  apply: boolean;
  year: number | null;
  help: boolean;
};

type LeavePreviewRow = {
  id: number;
  employee_id: string;
  date_filed: string;
  leave_start_date: string | null;
  leave_end_date: string | null;
  leave_type_id: number | null;
  leave_status: "Pending" | "Approved" | "Denied" | "Cancelled" | "Voided";
  existing_days: string;
};

function printUsage() {
  console.log(`
Usage:
  npm run backfill:leave-day-details -- [--apply] [--year YYYY]

Examples:
  npm run backfill:leave-day-details
  npm run backfill:leave-day-details -- --apply --year 2026
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    apply: false,
    year: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    if (token === "--apply") {
      parsed.apply = true;
      continue;
    }

    if (token === "--year") {
      const value = argv[index + 1];
      if (!value) throw new Error("--year requires a four-digit year.");
      parsed.year = Number(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (
    parsed.year != null &&
    (!Number.isInteger(parsed.year) || parsed.year < 2000 || parsed.year > 2100)
  ) {
    throw new Error("--year must be between 2000 and 2100.");
  }

  return parsed;
}

async function loadPreviewRows(database: DbClient, year: number | null) {
  const result = await database.execute(sql`
    select
      lr.id,
      lr.employee_id,
      lr.date_filed,
      lr.leave_start_date,
      lr.leave_end_date,
      lr.leave_type_id,
      lr.leave_status,
      lr.no_of_days as existing_days
    from employees_leave_records lr
    where not exists (
      select 1
      from employee_leave_record_days lrd
      where lrd.leave_record_id = lr.id
    )
    and (
      ${year}::int is null
      or extract(year from lr.date_filed) = ${year}::int
    )
    order by lr.date_filed, lr.id
  `);

  return (result.rows ?? result) as LeavePreviewRow[];
}

async function previewBackfill(rows: LeavePreviewRow[]) {
  const { buildLeaveDayDetails, summarizeLeaveDayDetails } = await import(
    "../lib/payroll/leave"
  );
  let chargeable = 0;
  let skippedZero = 0;
  let totalOldDays = 0;
  let totalNewDays = 0;

  for (const row of rows) {
    const details = await buildLeaveDayDetails({
      employeeId: row.employee_id,
      startDate: row.leave_start_date ?? row.date_filed,
      endDate: row.leave_end_date,
      dayPart: "FullDay",
    });
    const computedDays = summarizeLeaveDayDetails(details);

    totalOldDays += Number(row.existing_days ?? 0);
    totalNewDays += computedDays;

    if (computedDays <= 0) skippedZero += 1;
    else chargeable += 1;
  }

  return {
    chargeable,
    skippedZero,
    totalOldDays,
    totalNewDays,
  };
}

async function applyBackfill(database: DbClient, rows: LeavePreviewRow[]) {
  const { replaceLeaveRecordDayDetails, syncLeaveLedgerForRecord } = await import(
    "../lib/payroll/leave"
  );

  return database.transaction(async (tx) => {
    let updated = 0;
    let skippedZero = 0;
    let ledgerSynced = 0;

    for (const row of rows) {
      try {
        await replaceLeaveRecordDayDetails({
          leaveRecordId: row.id,
          employeeId: row.employee_id,
          startDate: row.leave_start_date ?? row.date_filed,
          endDate: row.leave_end_date,
          leaveTypeId: row.leave_type_id,
          dayPart: "FullDay",
          database: tx,
        });
        updated += 1;

        if (row.leave_status === "Approved") {
          await syncLeaveLedgerForRecord(row.id, tx);
          ledgerSynced += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("no chargeable working day")) {
          skippedZero += 1;
          continue;
        }

        throw error;
      }
    }

    return { updated, skippedZero, ledgerSynced };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  config({ path: ".env.local" });
  const { db } = await import("../db");
  const rows = await loadPreviewRows(db, args.year);
  const preview = await previewBackfill(rows);

  console.log(`${args.apply ? "APPLY" : "DRY RUN"}: leave day detail backfill`);
  console.log(`Year filter: ${args.year ?? "all"}`);
  console.log(`Records without day details: ${rows.length}`);
  console.log(`Chargeable records: ${preview.chargeable}`);
  console.log(`Skipped zero-charge records: ${preview.skippedZero}`);
  console.log(`Old total days: ${preview.totalOldDays.toFixed(2)}`);
  console.log(`New computed chargeable days: ${preview.totalNewDays.toFixed(2)}`);

  if (!args.apply) {
    console.log("No changes were written. Pass --apply to backfill day details.");
    return;
  }

  const applied = await applyBackfill(db, rows);
  console.log("Leave day detail backfill complete.");
  console.log(`Records updated: ${applied.updated}`);
  console.log(`Approved ledger rows synced: ${applied.ledgerSynced}`);
  console.log(`Skipped zero-charge records: ${applied.skippedZero}`);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Leave day detail backfill failed unexpectedly."
  );
  process.exit(1);
});

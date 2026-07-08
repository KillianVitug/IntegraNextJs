import assert from "node:assert/strict";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import type { DbClient } from "../db";

type ParsedArgs = {
  apply: boolean;
  year: number;
  asOf: string;
  help: boolean;
};

type PreviewRow = {
  employee_id: string;
  employee_no: string;
  leave_type_id: number;
  leave_code: string;
  leave_name: string;
  annual_entitlement: string;
  default_sick_leave: string | null;
  default_vacation_leave: string | null;
  carryover_limit: string;
  expiry_month: number;
  expiry_day: number;
  grant_key: string;
  carryover_key: string;
  expiry_key: string;
  grant_exists: boolean;
  carryover_exists: boolean;
  expiry_exists: boolean;
  previous_balance: string;
};

function getLeaveQuantityForDayPart(dayPart: "FullDay" | "AM" | "PM") {
  return dayPart === "FullDay" ? 1 : 0.5;
}

function getAnnualLeaveGrantQuantity(args: {
  leaveCode: string;
  leaveTypeAnnualEntitlement?: string | number | null;
  slvlGroupEntitlement?: {
    defaultSickLeave: string | null;
    defaultVacationLeave: string | null;
  };
}) {
  if (args.leaveCode === "SL") {
    return Number(args.slvlGroupEntitlement?.defaultSickLeave ?? 0);
  }

  if (args.leaveCode === "VL") {
    return Number(args.slvlGroupEntitlement?.defaultVacationLeave ?? 0);
  }

  return Number(args.leaveTypeAnnualEntitlement ?? 0);
}

function printUsage() {
  console.log(`
Usage:
  npm run leave:annual-grant -- [--apply] [--year YYYY] [--as-of YYYY-MM-DD]

Examples:
  npm run leave:annual-grant
  npm run leave:annual-grant -- --apply --year 2026 --as-of 2026-01-01
`);
}

function validateDateString(value: string, label: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`${label} must use YYYY-MM-DD format.`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${label} is not a valid calendar date.`);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const today = new Date().toISOString().slice(0, 10);
  const parsed: ParsedArgs = {
    apply: false,
    year: Number(today.slice(0, 4)),
    asOf: today,
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

    if (token === "--as-of") {
      const value = argv[index + 1];
      if (!value) throw new Error("--as-of requires a YYYY-MM-DD value.");
      parsed.asOf = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isInteger(parsed.year) || parsed.year < 2000 || parsed.year > 2100) {
    throw new Error("--year must be between 2000 and 2100.");
  }
  validateDateString(parsed.asOf, "as-of date");

  return parsed;
}

function assertFixtures() {
  assert.equal(getLeaveQuantityForDayPart("FullDay"), 1);
  assert.equal(getLeaveQuantityForDayPart("AM"), 0.5);
  assert.equal(
    getAnnualLeaveGrantQuantity({
      leaveCode: "SL",
      slvlGroupEntitlement: {
        defaultSickLeave: "5.00",
        defaultVacationLeave: "5.00",
      },
    }),
    5
  );
  assert.equal(
    getAnnualLeaveGrantQuantity({
      leaveCode: "VL",
      slvlGroupEntitlement: {
        defaultSickLeave: "0.00",
        defaultVacationLeave: "0.00",
      },
    }),
    0
  );
}

function dateFromPolicy(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) {
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function grantQuantity(row: PreviewRow) {
  return getAnnualLeaveGrantQuantity({
    leaveCode: row.leave_code,
    leaveTypeAnnualEntitlement: row.annual_entitlement,
    slvlGroupEntitlement: {
      defaultSickLeave: row.default_sick_leave,
      defaultVacationLeave: row.default_vacation_leave,
    },
  });
}

function carryoverQuantity(row: PreviewRow) {
  return Math.min(
    Math.max(0, Number(row.previous_balance ?? 0)),
    Math.max(0, Number(row.carryover_limit ?? 0))
  );
}

function expiryQuantity(row: PreviewRow) {
  return Math.max(0, Number(row.previous_balance ?? 0) - carryoverQuantity(row));
}

function summarize(rows: PreviewRow[]) {
  const summary = new Map<
    string,
    {
      grants: number;
      grantDays: number;
      existingGrants: number;
      carryovers: number;
      carryoverDays: number;
      expiries: number;
      expiryDays: number;
    }
  >();

  for (const row of rows) {
    const current =
      summary.get(row.leave_code) ?? {
        grants: 0,
        grantDays: 0,
        existingGrants: 0,
        carryovers: 0,
        carryoverDays: 0,
        expiries: 0,
        expiryDays: 0,
      };
    const grant = grantQuantity(row);
    const carryover = carryoverQuantity(row);
    const expiry = expiryQuantity(row);

    if (grant > 0 && !row.grant_exists) {
      current.grants += 1;
      current.grantDays += grant;
    }
    if (grant > 0 && row.grant_exists) current.existingGrants += 1;
    if (carryover > 0 && !row.carryover_exists) {
      current.carryovers += 1;
      current.carryoverDays += carryover;
    }
    if (expiry > 0 && !row.expiry_exists) {
      current.expiries += 1;
      current.expiryDays += expiry;
    }

    summary.set(row.leave_code, current);
  }

  return summary;
}

function printSummary(mode: "DRY RUN" | "APPLY", year: number, rows: PreviewRow[]) {
  console.log(`${mode}: annual leave grant/carryover/expiry`);
  console.log(`Year: ${year}`);
  console.log(`Active employee/leave-type rows scanned: ${rows.length}`);

  for (const [code, item] of summarize(rows)) {
    console.log(
      `${code}: grants ${item.grants} (${item.grantDays.toFixed(
        2
      )} days), existing grants ${item.existingGrants}, carryovers ${
        item.carryovers
      } (${item.carryoverDays.toFixed(2)} days), expiries ${
        item.expiries
      } (${item.expiryDays.toFixed(2)} days)`
    );
  }
}

async function loadPreviewRows(database: DbClient, year: number) {
  const previousYear = year - 1;
  const result = await database.execute(sql`
    select
      e.id as employee_id,
      e.employee_no,
      lt.id as leave_type_id,
      lt.code as leave_code,
      lt.name as leave_name,
      lt.annual_entitlement,
      sg.default_sick_leave,
      sg.default_vacation_leave,
      lp.carryover_limit,
      lp.expiry_month,
      lp.expiry_day,
      concat('leave-grant:', ${year}::int, ':', e.id, ':', lt.id) as grant_key,
      concat('leave-carryover:', ${year}::int, ':', e.id, ':', lt.id) as carryover_key,
      concat('leave-expiry:', ${previousYear}::int, ':', e.id, ':', lt.id) as expiry_key,
      grant_row.id is not null as grant_exists,
      carry_row.id is not null as carryover_exists,
      expiry_row.id is not null as expiry_exists,
      coalesce(prev_balance.previous_balance, 0) as previous_balance
    from employees e
    left join employees_salary es on es.employee_id = e.id
    left join slvl_group sg on sg.id = es.slvl_group_id
    cross join leave_types lt
    left join leave_policies lp on lp.leave_type_id = lt.id
    left join leave_balance_ledger grant_row
      on grant_row.idempotency_key = concat('leave-grant:', ${year}::int, ':', e.id, ':', lt.id)
    left join leave_balance_ledger carry_row
      on carry_row.idempotency_key = concat('leave-carryover:', ${year}::int, ':', e.id, ':', lt.id)
    left join leave_balance_ledger expiry_row
      on expiry_row.idempotency_key = concat('leave-expiry:', ${previousYear}::int, ':', e.id, ':', lt.id)
    left join lateral (
      select coalesce(sum(lbl.quantity), 0) as previous_balance
      from leave_balance_ledger lbl
      where lbl.employee_id = e.id
        and lbl.leave_type_id = lt.id
        and (
          lbl.period_year = ${previousYear}::int
          or (lbl.period_year is null and extract(year from lbl.entry_date) = ${previousYear}::int)
        )
    ) prev_balance on true
    where e.deleted_at is null
      and lt.requires_balance = true
    order by lt.code, e.employee_type, e.employee_no
  `);

  return (result.rows ?? result) as PreviewRow[];
}

async function applyAnnualGrant(database: DbClient, year: number, rows: PreviewRow[]) {
  const previousYear = year - 1;
  const grantDate = `${year}-01-01`;

  return database.transaction(async (tx) => {
    let grants = 0;
    let carryovers = 0;
    let expiries = 0;

    for (const row of rows) {
      const grant = grantQuantity(row);
      if (grant > 0 && !row.grant_exists) {
        await tx.execute(sql`
          insert into leave_balance_ledger (
            employee_id, leave_type_id, entry_date, transaction_type, quantity,
            period_year, idempotency_key, source_table, source_id, remarks
          )
          values (
            ${row.employee_id}, ${row.leave_type_id}, ${grantDate}::date, 'Grant',
            ${grant.toFixed(2)}::numeric, ${year}::int, ${row.grant_key},
            'annual_leave_grant', ${String(year)}, 'Annual leave grant'
          )
          on conflict do nothing
        `);
        grants += 1;
      }

      const carryover = carryoverQuantity(row);
      if (carryover > 0 && !row.carryover_exists) {
        await tx.execute(sql`
          insert into leave_balance_ledger (
            employee_id, leave_type_id, entry_date, transaction_type, quantity,
            period_year, idempotency_key, source_table, source_id, remarks
          )
          values (
            ${row.employee_id}, ${row.leave_type_id}, ${grantDate}::date, 'Carryover',
            ${carryover.toFixed(2)}::numeric, ${year}::int, ${row.carryover_key},
            'annual_leave_carryover', ${String(year)}, 'Annual leave carryover'
          )
          on conflict do nothing
        `);
        carryovers += 1;
      }

      const expiry = expiryQuantity(row);
      if (expiry > 0 && !row.expiry_exists) {
        const expiryDate = dateFromPolicy(
          previousYear,
          row.expiry_month ?? 12,
          row.expiry_day ?? 31
        );
        await tx.execute(sql`
          insert into leave_balance_ledger (
            employee_id, leave_type_id, entry_date, transaction_type, quantity,
            period_year, idempotency_key, source_table, source_id, remarks
          )
          values (
            ${row.employee_id}, ${row.leave_type_id}, ${expiryDate}::date, 'Expiry',
            ${(-expiry).toFixed(2)}::numeric, ${previousYear}::int, ${row.expiry_key},
            'annual_leave_expiry', ${String(previousYear)}, 'Annual leave expiry'
          )
          on conflict do nothing
        `);
        expiries += 1;
      }
    }

    return { grants, carryovers, expiries };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  assertFixtures();
  config({ path: ".env.local" });

  const { db } = await import("../db");
  const { ensureDefaultLeaveTypes } = await import("../lib/payroll/leave");
  await ensureDefaultLeaveTypes();

  const previewRows = await loadPreviewRows(db, args.year);
  printSummary(args.apply ? "APPLY" : "DRY RUN", args.year, previewRows);

  if (!args.apply) {
    console.log("No changes were written. Pass --apply to insert ledger rows.");
    return;
  }

  const applied = await applyAnnualGrant(db, args.year, previewRows);
  console.log("Annual leave processing complete.");
  console.log(`Grant rows inserted: ${applied.grants}`);
  console.log(`Carryover rows inserted: ${applied.carryovers}`);
  console.log(`Expiry rows inserted: ${applied.expiries}`);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Annual leave grant failed unexpectedly."
  );
  process.exit(1);
});

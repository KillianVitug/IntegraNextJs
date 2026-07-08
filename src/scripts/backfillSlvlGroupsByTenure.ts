import assert from "node:assert/strict";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import type { DbClient } from "../db";

type ParsedArgs = {
  apply: boolean;
  asOf: string;
  help: boolean;
};

type SlvlGroupName = "SLVL-0" | "SLVL-1";

type EmployeeSlvlPreviewRow = {
  employee_id: string;
  employee_no: string;
  date_hired: string | null;
  salary_employee_id: string | null;
  current_slvl_group_id: number | null;
};

const DEFAULT_AS_OF_DATE = "2026-05-29";
const SLVL_0_ID = 0;
const SLVL_1_ID = 1;

function printUsage() {
  console.log(`
Usage:
  npm run backfill:slvl-groups -- [--apply] [--as-of YYYY-MM-DD]

Examples:
  npm run backfill:slvl-groups
  npm run backfill:slvl-groups -- --apply --as-of 2026-05-29
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    apply: false,
    asOf: DEFAULT_AS_OF_DATE,
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

    if (token === "--as-of") {
      const value = argv[index + 1];
      if (!value) throw new Error("--as-of requires a YYYY-MM-DD value.");
      parsed.asOf = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  validateDateString(parsed.asOf, "as-of date");

  return parsed;
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

function subtractOneYear(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  let cutoff = new Date(Date.UTC(year - 1, month - 1, day));

  if (cutoff.getUTCMonth() !== month - 1) {
    cutoff = new Date(Date.UTC(year - 1, month, 0));
  }

  return cutoff.toISOString().slice(0, 10);
}

export function classifySlvlGroupByHireDate(
  dateHired: string | null | undefined,
  cutoffDate: string,
): SlvlGroupName | null {
  if (!dateHired) return null;
  return dateHired <= cutoffDate ? "SLVL-1" : "SLVL-0";
}

function assertClassificationFixtures() {
  assert.equal(classifySlvlGroupByHireDate("2025-05-29", "2025-05-29"), "SLVL-1");
  assert.equal(classifySlvlGroupByHireDate("2025-05-30", "2025-05-29"), "SLVL-0");
  assert.equal(classifySlvlGroupByHireDate(null, "2025-05-29"), null);
}

function groupIdForName(groupName: SlvlGroupName) {
  return groupName === "SLVL-1" ? SLVL_1_ID : SLVL_0_ID;
}

function summarizeRows(rows: EmployeeSlvlPreviewRow[], cutoffDate: string) {
  const summary = {
    slvl0: 0,
    slvl1: 0,
    missingDateHired: 0,
    missingSalaryRows: 0,
    alreadyCorrect: 0,
    changing: 0,
  };

  for (const row of rows) {
    const targetGroup = classifySlvlGroupByHireDate(row.date_hired, cutoffDate);

    if (!targetGroup) {
      summary.missingDateHired += 1;
      continue;
    }

    const targetGroupId = groupIdForName(targetGroup);
    if (targetGroup === "SLVL-1") summary.slvl1 += 1;
    if (targetGroup === "SLVL-0") summary.slvl0 += 1;
    if (row.salary_employee_id == null) summary.missingSalaryRows += 1;
    if (row.current_slvl_group_id === targetGroupId) {
      summary.alreadyCorrect += 1;
    } else {
      summary.changing += 1;
    }
  }

  return summary;
}

function printSummary(args: {
  mode: "DRY RUN" | "APPLY";
  asOfDate: string;
  cutoffDate: string;
  summary: ReturnType<typeof summarizeRows>;
}) {
  console.log(`${args.mode}: Backfill SL/VL groups by tenure`);
  console.log(`As of date: ${args.asOfDate}`);
  console.log(`One-year cutoff: ${args.cutoffDate}`);
  console.log(`SLVL-1 target rows: ${args.summary.slvl1}`);
  console.log(`SLVL-0 target rows: ${args.summary.slvl0}`);
  console.log(`Missing salary rows to create: ${args.summary.missingSalaryRows}`);
  console.log(`Already correct: ${args.summary.alreadyCorrect}`);
  console.log(`Rows changing: ${args.summary.changing}`);
  console.log(`Missing date_hired skipped: ${args.summary.missingDateHired}`);
}

async function assertSlvlGroupsExist(database: DbClient) {
  const result = await database.execute(sql`
    select id, name
    from slvl_group
    where name in ('SLVL-0', 'SLVL-1')
    order by id
  `);
  const rows = (result.rows ?? result) as Array<{ id: number; name: string }>;
  const groupsByName = new Map(rows.map((row) => [row.name, row.id]));

  assert.equal(groupsByName.get("SLVL-0"), SLVL_0_ID, "SLVL-0 must exist with id 0.");
  assert.equal(groupsByName.get("SLVL-1"), SLVL_1_ID, "SLVL-1 must exist with id 1.");
}

async function loadPreviewRows(database: DbClient) {
  const result = await database.execute(sql`
    select
      e.id as employee_id,
      e.employee_no,
      egi.date_hired,
      es.employee_id as salary_employee_id,
      es.slvl_group_id as current_slvl_group_id
    from employees e
    left join employees_general_info egi on e.id = egi.employee_id
    left join employees_salary es on e.id = es.employee_id
    where e.deleted_at is null
    order by e.employee_type, e.employee_no
  `);

  return (result.rows ?? result) as EmployeeSlvlPreviewRow[];
}

async function applyBackfill(database: DbClient, cutoffDate: string) {
  return database.transaction(async (tx) => {
    const result = await tx.execute(sql`
      insert into employees_salary (employee_id, slvl_group_id)
      select
        e.id,
        case
          when egi.date_hired <= ${cutoffDate}::date then ${SLVL_1_ID}::integer
          else ${SLVL_0_ID}::integer
        end
      from employees e
      inner join employees_general_info egi on e.id = egi.employee_id
      where e.deleted_at is null
        and egi.date_hired is not null
      on conflict (employee_id) do update
        set slvl_group_id = excluded.slvl_group_id,
            updated_at = now()
      returning slvl_group_id
    `);

    const rows = (result.rows ?? result) as Array<{ slvl_group_id: number }>;

    return rows.reduce(
      (summary, row) => {
        if (row.slvl_group_id === SLVL_1_ID) summary.slvl1 += 1;
        if (row.slvl_group_id === SLVL_0_ID) summary.slvl0 += 1;
        return summary;
      },
      { slvl0: 0, slvl1: 0 },
    );
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  assertClassificationFixtures();
  config({ path: ".env.local" });

  const { db } = await import("../db");
  const cutoffDate = subtractOneYear(args.asOf);

  await assertSlvlGroupsExist(db);

  const previewRows = await loadPreviewRows(db);
  const previewSummary = summarizeRows(previewRows, cutoffDate);
  printSummary({
    mode: args.apply ? "APPLY" : "DRY RUN",
    asOfDate: args.asOf,
    cutoffDate,
    summary: previewSummary,
  });

  if (!args.apply) {
    console.log("No changes were written. Pass --apply to update the database.");
    return;
  }

  const applied = await applyBackfill(db, cutoffDate);

  console.log("Backfill complete.");
  console.log(`SLVL-1 updated: ${applied.slvl1}`);
  console.log(`SLVL-0 updated: ${applied.slvl0}`);
  console.log(`Missing date_hired skipped: ${previewSummary.missingDateHired}`);
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "SL/VL backfill failed unexpectedly.",
  );
  process.exit(1);
});

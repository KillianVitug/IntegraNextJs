import { db } from "@/db";
import {
  accountCode,
  birWithholdingTaxBrackets,
  leaveTypes,
  pagibigContributionRates,
  philhealthContributionRates,
  sssContributionBrackets,
  statutoryRuleVersions,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  ensureDefaultLeaveTypes,
  getMappedLeavePayrollAccountCode,
  LEAVE_PAYROLL_ACCOUNT_CODES,
} from "./leave";

function money(value: number) {
  return value.toFixed(2);
}

function rate(value: number) {
  return value.toFixed(6);
}

function generateSss2025Rows() {
  const rows: Array<{
    rangeFrom: string;
    rangeTo: string;
    salaryCredit: string;
    employeeShare: string;
    employerShare: string;
    ecShare: string;
  }> = [];

  for (let msc = 5000; msc <= 35000; msc += 500) {
    const isFirst = msc === 5000;
    const isLast = msc === 35000;

    rows.push({
      rangeFrom: money(isFirst ? 0 : msc - 250),
      rangeTo: money(isLast ? 999999.99 : msc + 249.99),
      salaryCredit: money(msc),
      employeeShare: money(msc * 0.05),
      employerShare: money(msc * 0.1),
      ecShare: money(msc < 15000 ? 10 : 30),
    });
  }

  return rows;
}

export async function ensureDefaultStatutoryRules() {
  const existing = await db.select().from(statutoryRuleVersions);
  if (existing.length > 0) return existing;

  const [sssVersion, philhealthVersion, pagibigVersion, taxVersion] =
    await db
      .insert(statutoryRuleVersions)
      .values([
        {
          ruleType: "SSS",
          code: "SSS-2025-SEMI",
          description: "Default semi-monthly SSS rules seeded for 2025 onward",
          payrollTerms: "Semi-Monthly",
          effectiveFrom: "2025-01-01",
          isDefault: true,
        },
        {
          ruleType: "PHILHEALTH",
          code: "PHILHEALTH-2024-SEMI",
          description: "Default semi-monthly PhilHealth rules seeded from UHC IRR",
          payrollTerms: "Semi-Monthly",
          effectiveFrom: "2024-01-01",
          isDefault: true,
        },
        {
          ruleType: "PAGIBIG",
          code: "PAGIBIG-2024-SEMI",
          description: "Default semi-monthly Pag-IBIG rules seeded for capped contributions",
          payrollTerms: "Semi-Monthly",
          effectiveFrom: "2024-01-01",
          isDefault: true,
        },
        {
          ruleType: "TAX",
          code: "BIR-2023-SEMI",
          description: "Default semi-monthly withholding rules effective January 1, 2023",
          payrollTerms: "Semi-Monthly",
          effectiveFrom: "2023-01-01",
          isDefault: true,
        },
      ])
      .returning();

  await db.insert(sssContributionBrackets).values(
    generateSss2025Rows().map((row) => ({
      versionId: sssVersion.id,
      ...row,
    }))
  );

  await db.insert(philhealthContributionRates).values({
    versionId: philhealthVersion.id,
    monthlyBasicSalaryFloor: money(10000),
    monthlyBasicSalaryCeiling: money(100000),
    premiumRate: rate(0.05),
    employeeShareRate: rate(0.5),
    employerShareRate: rate(0.5),
  });

  await db.insert(pagibigContributionRates).values([
    {
      versionId: pagibigVersion.id,
      rangeFrom: money(0),
      rangeTo: money(1500),
      employeeRate: rate(0.01),
      employerRate: rate(0.02),
      maxCompensationBase: money(10000),
    },
    {
      versionId: pagibigVersion.id,
      rangeFrom: money(1500.01),
      rangeTo: money(999999.99),
      employeeRate: rate(0.02),
      employerRate: rate(0.02),
      maxCompensationBase: money(10000),
    },
  ]);

  await db.insert(birWithholdingTaxBrackets).values([
    {
      versionId: taxVersion.id,
      payrollTerms: "Semi-Monthly",
      compensationFrom: money(0),
      compensationTo: money(10417),
      baseTax: money(0),
      overPercentage: rate(0),
    },
    {
      versionId: taxVersion.id,
      payrollTerms: "Semi-Monthly",
      compensationFrom: money(10417),
      compensationTo: money(16667),
      baseTax: money(0),
      overPercentage: rate(0.15),
    },
    {
      versionId: taxVersion.id,
      payrollTerms: "Semi-Monthly",
      compensationFrom: money(16667),
      compensationTo: money(33333),
      baseTax: money(937.5),
      overPercentage: rate(0.2),
    },
    {
      versionId: taxVersion.id,
      payrollTerms: "Semi-Monthly",
      compensationFrom: money(33333),
      compensationTo: money(83333),
      baseTax: money(4270.83),
      overPercentage: rate(0.25),
    },
    {
      versionId: taxVersion.id,
      payrollTerms: "Semi-Monthly",
      compensationFrom: money(83333),
      compensationTo: money(333333),
      baseTax: money(16770.83),
      overPercentage: rate(0.3),
    },
    {
      versionId: taxVersion.id,
      payrollTerms: "Semi-Monthly",
      compensationFrom: money(333333),
      compensationTo: null,
      baseTax: money(91770.83),
      overPercentage: rate(0.35),
    },
  ]);

  return db.select().from(statutoryRuleVersions);
}

export async function ensureDefaultLeavePayrollAccountCodes() {
  const desiredCodes = LEAVE_PAYROLL_ACCOUNT_CODES.map((mapping) => mapping.code);
  const existingAccountRows = await db
    .select()
    .from(accountCode)
    .where(inArray(accountCode.accountCode, desiredCodes));
  const existingCodes = new Set(
    existingAccountRows.map((row) => row.accountCode.trim())
  );

  const missingAccountRows = LEAVE_PAYROLL_ACCOUNT_CODES.filter(
    (mapping) => !existingCodes.has(mapping.code)
  );

  if (missingAccountRows.length > 0) {
    await db.insert(accountCode).values(
      missingAccountRows.map((mapping) => ({
        accountCode: mapping.code,
        accountType: "Paid Leaves" as const,
        description: mapping.description,
        month13thPay: true,
        nonTaxable: false,
        deminimis: false,
        healthInsurance: false,
      }))
    );
  }

  const accountRows = await db
    .select()
    .from(accountCode)
    .where(inArray(accountCode.accountCode, desiredCodes));
  const accountByCode = new Map(
    accountRows.map((row) => [row.accountCode.trim(), row] as const)
  );
  const leaveTypeRows = await db.select().from(leaveTypes);

  for (const leaveType of leaveTypeRows) {
    const mappedCode = getMappedLeavePayrollAccountCode({
      leaveType: leaveType.code,
      leaveTypeLookup: leaveType,
    });
    if (!mappedCode) continue;

    const mappedAccount = accountByCode.get(mappedCode);
    if (!mappedAccount || leaveType.accountCodeId === mappedAccount.id) continue;

    await db
      .update(leaveTypes)
      .set({
        accountCodeId: mappedAccount.id,
        updatedAt: new Date(),
      })
      .where(eq(leaveTypes.id, leaveType.id));
  }
}

export async function ensurePayrollFoundationData() {
  await ensureDefaultLeaveTypes();
  await ensureDefaultLeavePayrollAccountCodes();
  await ensureDefaultStatutoryRules();
}

export async function getStatutoryRuleVersionByCode(code: string) {
  return db.query.statutoryRuleVersions.findFirst({
    where: eq(statutoryRuleVersions.code, code),
  });
}

"use server";

import { unstable_cache } from "next/cache";
import { db } from "@/db";
import {
    accountCode,
    birWithholdingTaxBrackets,
    customPayrollDefinitions,
    department,
    holidayTypeAccountCodes,
    holidayTypeEnum,
    leaveTypes,
    leavePolicies,
    overtimeRules,
    pagibigContributionRates,
    philhealthContributionRates,
    position,
    shiftTableBreaks,
    shiftTables,
    slvlGroup,
    sssContributionBrackets,
    statutoryRuleVersions,
    tardinessRules,
    undertimeRules,
} from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { buildShiftTableReadModel } from "@/lib/shifts";
import {
  fetchHolidayTemplates,
  fetchHolidayYearCalendar,
} from "@/lib/holidays";

function toNumber(value: string | number | null | undefined) {
  if (value == null) return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export const fetchDepartments = unstable_cache(
  async () => {
    try {
      return await db.select().from(department);
    } catch (error) {
      console.error("Error fetching departments:", error);
      return [];
    }
  },
  ["departments"],
  { tags: ["departments"] }
);

export const fetchSlVl = unstable_cache(
  async () => {
    try {
      return await db.select().from(slvlGroup);
    } catch (error) {
      console.error("Error fetching slvlGroups:", error);
      return [];
    }
  },
  ["slvl-groups"],
  { tags: ["slvl-groups"] }
);

export const fetchPositions = unstable_cache(
  async () => {
    try {
      return await db.select().from(position);
    } catch (error) {
      console.error("Error fetching positions:", error);
      return [];
    }
  },
  ["positions"],
  { tags: ["positions"] }
);

export const fetchAccountCode = unstable_cache(
  async () => {
    try {
      return await db.select().from(accountCode);
    } catch (error) {
      console.error("Error fetching accountCodes:", error);
      return [];
    }
  },
  ["account-codes"],
  { tags: ["account-codes"] }
);

export const fetchCustomPayrollCodes = unstable_cache(
  async () => {
    return db
      .select({
        id: customPayrollDefinitions.id,
        code: customPayrollDefinitions.code,
        description: customPayrollDefinitions.description,
        rateDivisor: customPayrollDefinitions.rateDivisor,
      })
      .from(customPayrollDefinitions);
  },
  ["custom-payroll-codes"],
  { tags: ["custom-payroll-codes"] }
);

export const fetchLeaveTypes = unstable_cache(
  async () => {
    const rows = await db
      .select({
        leaveType: leaveTypes,
        policy: leavePolicies,
        linkedAccountCode: accountCode.accountCode,
        linkedAccountDescription: accountCode.description,
      })
      .from(leaveTypes)
      .leftJoin(leavePolicies, eq(leavePolicies.leaveTypeId, leaveTypes.id))
      .leftJoin(accountCode, eq(leaveTypes.accountCodeId, accountCode.id))
      .orderBy(asc(leaveTypes.code));

    return rows.map((row) => ({
      ...row.leaveType,
      annualEntitlement: toNumber(row.leaveType.annualEntitlement) ?? 0,
      carryoverLimit: toNumber(row.policy?.carryoverLimit) ?? 0,
      expiryMonth: row.policy?.expiryMonth ?? 12,
      expiryDay: row.policy?.expiryDay ?? 31,
      encashmentEnabled: row.policy?.encashmentEnabled ?? false,
      encashmentTaxable: row.policy?.encashmentTaxable ?? true,
      encashmentMonth13thEligible:
        row.policy?.encashmentMonth13thEligible ?? false,
      encashmentAccountCodeId: row.policy?.encashmentAccountCodeId ?? null,
      halfDayAllowed: row.policy?.halfDayAllowed ?? true,
      excludeRestDaysAndHolidays:
        row.policy?.excludeRestDaysAndHolidays ?? true,
      payrollAccountCode: row.linkedAccountCode ?? null,
      payrollAccountDisplay: row.linkedAccountCode
        ? row.linkedAccountDescription
          ? `${row.linkedAccountCode} | ${row.linkedAccountDescription}`
          : row.linkedAccountCode
        : null,
    }));
  },
  ["leave-types"],
  { tags: ["leave-types"] }
);

export async function fetchHolidayCalendar(year?: number) {
  return fetchHolidayYearCalendar(year);
}

export { fetchHolidayTemplates };

export const fetchHolidayTypeAccountCodes = unstable_cache(
  async () => {
    const holidayAccountCode = alias(accountCode, "holiday_account_code");
    const holidayOvertimeAccountCode = alias(
      accountCode,
      "holiday_overtime_account_code"
    );
    const restDayHolidayAccountCode = alias(
      accountCode,
      "rest_day_holiday_account_code"
    );
    const restDayHolidayOvertimeAccountCode = alias(
      accountCode,
      "rest_day_holiday_overtime_account_code"
    );
    const rows = await db
      .select({
        mapping: holidayTypeAccountCodes,
        linkedAccountCode: holidayAccountCode.accountCode,
        linkedAccountDescription: holidayAccountCode.description,
        linkedOvertimeAccountCode: holidayOvertimeAccountCode.accountCode,
        linkedOvertimeAccountDescription: holidayOvertimeAccountCode.description,
        linkedRestDayAccountCode: restDayHolidayAccountCode.accountCode,
        linkedRestDayAccountDescription: restDayHolidayAccountCode.description,
        linkedRestDayOvertimeAccountCode:
          restDayHolidayOvertimeAccountCode.accountCode,
        linkedRestDayOvertimeAccountDescription:
          restDayHolidayOvertimeAccountCode.description,
      })
      .from(holidayTypeAccountCodes)
      .leftJoin(
        holidayAccountCode,
        eq(holidayTypeAccountCodes.accountCodeId, holidayAccountCode.id)
      )
      .leftJoin(
        holidayOvertimeAccountCode,
        eq(
          holidayTypeAccountCodes.overtimeAccountCodeId,
          holidayOvertimeAccountCode.id
        )
      )
      .leftJoin(
        restDayHolidayAccountCode,
        eq(
          holidayTypeAccountCodes.restDayAccountCodeId,
          restDayHolidayAccountCode.id
        )
      )
      .leftJoin(
        restDayHolidayOvertimeAccountCode,
        eq(
          holidayTypeAccountCodes.restDayOvertimeAccountCodeId,
          restDayHolidayOvertimeAccountCode.id
        )
      )
      .orderBy(asc(holidayTypeAccountCodes.holidayType));
    const rowByHolidayType = new Map(
      rows.map((row) => [row.mapping.holidayType, row])
    );

    return holidayTypeEnum.enumValues.map((holidayType, index) => {
      const row = rowByHolidayType.get(holidayType);
      const accountDisplay = row?.linkedAccountCode
        ? row.linkedAccountDescription
          ? `${row.linkedAccountCode} | ${row.linkedAccountDescription}`
          : row.linkedAccountCode
        : null;
      const overtimeAccountDisplay = row?.linkedOvertimeAccountCode
        ? row.linkedOvertimeAccountDescription
          ? `${row.linkedOvertimeAccountCode} | ${row.linkedOvertimeAccountDescription}`
          : row.linkedOvertimeAccountCode
        : null;
      const restDayAccountDisplay = row?.linkedRestDayAccountCode
        ? row.linkedRestDayAccountDescription
          ? `${row.linkedRestDayAccountCode} | ${row.linkedRestDayAccountDescription}`
          : row.linkedRestDayAccountCode
        : null;
      const restDayOvertimeAccountDisplay = row?.linkedRestDayOvertimeAccountCode
        ? row.linkedRestDayOvertimeAccountDescription
          ? `${row.linkedRestDayOvertimeAccountCode} | ${row.linkedRestDayOvertimeAccountDescription}`
          : row.linkedRestDayOvertimeAccountCode
        : null;

      return {
        id: row?.mapping.id ?? -(index + 1),
        holidayType,
        accountCodeId: row?.mapping.accountCodeId ?? null,
        overtimeAccountCodeId: row?.mapping.overtimeAccountCodeId ?? null,
        restDayAccountCodeId: row?.mapping.restDayAccountCodeId ?? null,
        restDayOvertimeAccountCodeId:
          row?.mapping.restDayOvertimeAccountCodeId ?? null,
        createdAt: row?.mapping.createdAt ?? new Date(0),
        updatedAt: row?.mapping.updatedAt ?? new Date(0),
        accountCode: row?.linkedAccountCode ?? null,
        accountDescription: row?.linkedAccountDescription ?? null,
        accountDisplay,
        overtimeAccountCode: row?.linkedOvertimeAccountCode ?? null,
        overtimeAccountDescription:
          row?.linkedOvertimeAccountDescription ?? null,
        overtimeAccountDisplay,
        restDayAccountCode: row?.linkedRestDayAccountCode ?? null,
        restDayAccountDescription:
          row?.linkedRestDayAccountDescription ?? null,
        restDayAccountDisplay,
        restDayOvertimeAccountCode:
          row?.linkedRestDayOvertimeAccountCode ?? null,
        restDayOvertimeAccountDescription:
          row?.linkedRestDayOvertimeAccountDescription ?? null,
        restDayOvertimeAccountDisplay,
      };
    });
  },
  ["holiday-type-account-codes"],
  { tags: ["holiday-type-account-codes"] }
);

export const fetchShiftTables = unstable_cache(
  async () => {
    const [shiftRows, breakRows] = await Promise.all([
      db.select().from(shiftTables).orderBy(asc(shiftTables.code)),
      db
        .select()
        .from(shiftTableBreaks)
        .orderBy(asc(shiftTableBreaks.shiftTableId), asc(shiftTableBreaks.sortOrder)),
    ]);

    const breaksByShiftTableId = new Map<number, typeof shiftTableBreaks.$inferSelect[]>();

    for (const breakRow of breakRows) {
      const current = breaksByShiftTableId.get(breakRow.shiftTableId) ?? [];
      current.push(breakRow);
      breaksByShiftTableId.set(breakRow.shiftTableId, current);
    }

    return shiftRows.map((shiftTable) =>
      buildShiftTableReadModel({
        shiftTable,
        breaks: breaksByShiftTableId.get(shiftTable.id) ?? [],
      })
    );
  },
  ["shift-tables"],
  { tags: ["shift-tables"] }
);

export const fetchUndertimeRules = unstable_cache(
  async () => {
    const rows = await db
      .select()
      .from(undertimeRules)
      .orderBy(asc(undertimeRules.minutesFrom), asc(undertimeRules.minutesTo));

    return rows.map((row) => ({
      ...row,
      rateMultiplier: toNumber(row.rateMultiplier) ?? 0,
    }));
  },
  ["undertime-rules"],
  { tags: ["undertime-rules"] }
);

export const fetchOvertimeRules = unstable_cache(
  async () => {
    const rows = await db
      .select()
      .from(overtimeRules)
      .orderBy(
        asc(overtimeRules.category),
        asc(overtimeRules.minutesFrom),
        asc(overtimeRules.minutesTo)
      );

    return rows.map((row) => ({
      ...row,
      rateMultiplier: toNumber(row.rateMultiplier) ?? 0,
    }));
  },
  ["overtime-rules"],
  { tags: ["overtime-rules"] }
);

export const fetchTardinessRules = unstable_cache(
  async () => {
    const rows = await db
      .select()
      .from(tardinessRules)
      .orderBy(asc(tardinessRules.minutesFrom), asc(tardinessRules.minutesTo));

    return rows.map((row) => ({
      ...row,
      rateMultiplier: toNumber(row.rateMultiplier) ?? 0,
    }));
  },
  ["tardiness-rules"],
  { tags: ["tardiness-rules"] }
);

export const fetchStatutoryRuleVersions = unstable_cache(
  async (ruleType?: "SSS" | "PHILHEALTH" | "PAGIBIG" | "TAX") => {
    if (ruleType) {
      return db
        .select()
        .from(statutoryRuleVersions)
        .where(eq(statutoryRuleVersions.ruleType, ruleType))
        .orderBy(
          asc(statutoryRuleVersions.ruleType),
          desc(statutoryRuleVersions.effectiveFrom),
          asc(statutoryRuleVersions.code)
        );
    }

    return db
      .select()
      .from(statutoryRuleVersions)
      .orderBy(
        asc(statutoryRuleVersions.ruleType),
        desc(statutoryRuleVersions.effectiveFrom),
        asc(statutoryRuleVersions.code)
      );
  },
  ["statutory-rule-versions"],
  { tags: ["statutory-rule-versions"] }
);

export const fetchSssContributionBrackets = unstable_cache(
  async (versionId: number) => {
    const rows = await db
      .select()
      .from(sssContributionBrackets)
      .where(eq(sssContributionBrackets.versionId, versionId))
      .orderBy(asc(sssContributionBrackets.rangeFrom));

    return rows.map((row) => ({
      ...row,
      rangeFrom: toNumber(row.rangeFrom) ?? 0,
      rangeTo: toNumber(row.rangeTo) ?? 0,
      salaryCredit: toNumber(row.salaryCredit) ?? 0,
      employeeShare: toNumber(row.employeeShare) ?? 0,
      employerShare: toNumber(row.employerShare) ?? 0,
      ecShare: toNumber(row.ecShare) ?? 0,
    }));
  },
  ["sss-brackets"],
  { tags: ["sss-brackets"] }
);

export const fetchPhilhealthContributionRates = unstable_cache(
  async (versionId: number) => {
    const rows = await db
      .select()
      .from(philhealthContributionRates)
      .where(eq(philhealthContributionRates.versionId, versionId))
      .orderBy(asc(philhealthContributionRates.monthlyBasicSalaryFloor));

    return rows.map((row) => ({
      ...row,
      monthlyBasicSalaryFloor: toNumber(row.monthlyBasicSalaryFloor) ?? 0,
      monthlyBasicSalaryCeiling: toNumber(row.monthlyBasicSalaryCeiling) ?? 0,
      premiumRate: toNumber(row.premiumRate) ?? 0,
      employeeShareRate: toNumber(row.employeeShareRate) ?? 0,
      employerShareRate: toNumber(row.employerShareRate) ?? 0,
    }));
  },
  ["philhealth-rates"],
  { tags: ["philhealth-rates"] }
);

export const fetchPagibigContributionRates = unstable_cache(
  async (versionId: number) => {
    const rows = await db
      .select()
      .from(pagibigContributionRates)
      .where(eq(pagibigContributionRates.versionId, versionId))
      .orderBy(asc(pagibigContributionRates.rangeFrom));

    return rows.map((row) => ({
      ...row,
      rangeFrom: toNumber(row.rangeFrom) ?? 0,
      rangeTo: toNumber(row.rangeTo) ?? 0,
      employeeRate: toNumber(row.employeeRate) ?? 0,
      employerRate: toNumber(row.employerRate) ?? 0,
      maxCompensationBase: toNumber(row.maxCompensationBase),
    }));
  },
  ["pagibig-rates"],
  { tags: ["pagibig-rates"] }
);

export const fetchBirWithholdingTaxBrackets = unstable_cache(
  async (versionId: number) => {
    const rows = await db
      .select()
      .from(birWithholdingTaxBrackets)
      .where(
        and(
          eq(birWithholdingTaxBrackets.versionId, versionId),
          eq(birWithholdingTaxBrackets.payrollTerms, "Semi-Monthly")
        )
      )
      .orderBy(asc(birWithholdingTaxBrackets.compensationFrom));

    return rows.map((row) => ({
      ...row,
      compensationFrom: toNumber(row.compensationFrom) ?? 0,
      compensationTo: toNumber(row.compensationTo),
      baseTax: toNumber(row.baseTax) ?? 0,
      overPercentage: toNumber(row.overPercentage) ?? 0,
    }));
  },
  ["bir-tax-brackets"],
  { tags: ["bir-tax-brackets"] }
);

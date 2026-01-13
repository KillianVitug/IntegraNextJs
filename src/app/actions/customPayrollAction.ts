"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  customPayrollDefinitions,
  employeeContributionGroups,
  employeeContributionFlags,
  basisOfComputationEnum,
  contributionTypeEnum,
} from "@/db/schema";
import { CustomPayrollPayload } from "@/zod-schemas/payrollCodeCustom";

type ContributionType = (typeof contributionTypeEnum.enumValues)[number];

interface ContributionFlags {
  scheduleAlways: boolean;
  scheduleEndOfMonth: boolean;
  scheduleFirstPayroll: boolean;
  scheduleSecondPayroll: boolean;
  scheduleThirdPayroll: boolean;
  scheduleForthPayroll?: boolean;

  pagibigMaxContribution?: boolean;
  pagibigDeductShare?: boolean;

  peraaComputeBoth?: boolean;
  peraaComputeEmployer?: boolean;

  taxFixedPercentage?: boolean;
  taxFixedValue?: number;
  taxMonthEndAdjustment?: boolean;

  flag1?: boolean;
  flag2?: boolean;
  flag3?: boolean;
}

interface ContributionData {
  basisOfComputation: (typeof basisOfComputationEnum.enumValues)[number];
  basisValue: number | null;
  approximationPercent: number;
  percentage: number | null;
  fixedAmount: number | null;
  minimum: number | null;
  maximum: number | null;
  fixedEmployeeShare: number;
  fixedEmployerShare: number;
  fixedECShare: number;
  scheduleFlags: {
    always: boolean;
    endOfMonth: boolean;
    firstPayroll: boolean;
    secondPayroll: boolean;
    thirdPayroll: boolean;
    forthPayroll?: boolean;
  };
  flags?: ContributionFlags;
}

export async function createCustomPayrollCode(payload: CustomPayrollPayload) {
  return db.transaction(async (tx) => {
    // 1️⃣ Insert Payroll Master
    const [definition] = await tx
      .insert(customPayrollDefinitions)
      .values({
        code: payload.code,
        description: payload.description ?? null,
        rateDivisor: payload.rateDivisor?.toString() ?? null,
        hourlyRateDivisor: payload.hourlyRateDivisor?.toString() ?? null,
      })
      .returning({ id: customPayrollDefinitions.id });

    // 2️⃣ Insert Contributions & Flags
    for (const [type, data] of Object.entries(payload.contributions) as [ContributionType, ContributionData][]) {
      const [group] = await tx
        .insert(employeeContributionGroups)
        .values({
          payrollCode: definition.id,
          contributionType: type,
          basisOfComputation: data.basisOfComputation,
          basisValue: data.basisValue?.toString() ?? null,
          approximationPercent: data.approximationPercent.toString(),
          percentage: data.percentage?.toString() ?? null,
          fixedAmount: data.fixedAmount?.toString() ?? null,
          minimum: data.minimum?.toString() ?? null,
          maximum: data.maximum?.toString() ?? null,
          fixedEmployeeShare: data.fixedEmployeeShare.toString(),
          fixedEmployerShare: data.fixedEmployerShare.toString(),
          fixedECShare: data.fixedECShare.toString(),
        })
        .returning({ id: employeeContributionGroups.id });

      await tx.insert(employeeContributionFlags).values({
        groupId: group.id,
        scheduleAlways: data.scheduleFlags.always,
        scheduleEndOfMonth: data.scheduleFlags.endOfMonth,
        scheduleFirstPayroll: data.scheduleFlags.firstPayroll,
        scheduleSecondPayroll: data.scheduleFlags.secondPayroll,
        scheduleThirdPayroll: data.scheduleFlags.thirdPayroll,
        scheduleForthPayroll: data.scheduleFlags.forthPayroll ?? false,

        pagibigMaxContribution: data.flags?.pagibigMaxContribution ?? false,
        pagibigDeductShare: data.flags?.pagibigDeductShare ?? false,
        peraaComputeBoth: data.flags?.peraaComputeBoth ?? false,
        peraaComputeEmployer: data.flags?.peraaComputeEmployer ?? false,
        taxFixedPercentage: data.flags?.taxFixedPercentage ?? false,
         taxFixedValue: data.flags?.taxFixedValue?.toString() ?? null, 
        taxMonthEndAdjustment: data.flags?.taxMonthEndAdjustment ?? false,
        flag1: data.flags?.flag1 ?? false,
        flag2: data.flags?.flag2 ?? false,
        flag3: data.flags?.flag3 ?? false,
      });
    }

    return definition.id;
  });
}

export async function updateCustomPayrollCode(id: number, payload: CustomPayrollPayload) {
  return db.transaction(async (tx) => {
    // 1️⃣ Update Payroll Master
    await tx
      .update(customPayrollDefinitions)
      .set({
        code: payload.code,
        description: payload.description ?? null,
        rateDivisor: payload.rateDivisor?.toString() ?? null,
        hourlyRateDivisor: payload.hourlyRateDivisor?.toString() ?? null,
      })
      .where(eq(customPayrollDefinitions.id, id));

    // 2️⃣ Delete existing contributions and flags
    await tx
      .delete(employeeContributionGroups)
      .where(eq(employeeContributionGroups.payrollCode, id));

    // 3️⃣ Re-insert Contributions & Flags
    for (const [type, data] of Object.entries(payload.contributions) as [ContributionType, ContributionData][]) {
      const [group] = await tx
        .insert(employeeContributionGroups)
        .values({
          payrollCode: id,
          contributionType: type,
          basisOfComputation: data.basisOfComputation,
          basisValue: data.basisValue?.toString() ?? null,
          approximationPercent: data.approximationPercent.toString(),
          percentage: data.percentage?.toString() ?? null,
          fixedAmount: data.fixedAmount?.toString() ?? null,
          minimum: data.minimum?.toString() ?? null,
          maximum: data.maximum?.toString() ?? null,
          fixedEmployeeShare: data.fixedEmployeeShare.toString(),
          fixedEmployerShare: data.fixedEmployerShare.toString(),
          fixedECShare: data.fixedECShare.toString(),
        })
        .returning({ id: employeeContributionGroups.id });

      await tx.insert(employeeContributionFlags).values({
        groupId: group.id,
        scheduleAlways: data.scheduleFlags.always,
        scheduleEndOfMonth: data.scheduleFlags.endOfMonth,
        scheduleFirstPayroll: data.scheduleFlags.firstPayroll,
        scheduleSecondPayroll: data.scheduleFlags.secondPayroll,
        scheduleThirdPayroll: data.scheduleFlags.thirdPayroll,
        scheduleForthPayroll: data.scheduleFlags.forthPayroll ?? false,

        pagibigMaxContribution: data.flags?.pagibigMaxContribution ?? false,
        pagibigDeductShare: data.flags?.pagibigDeductShare ?? false,
        peraaComputeBoth: data.flags?.peraaComputeBoth ?? false,
        peraaComputeEmployer: data.flags?.peraaComputeEmployer ?? false,
        taxFixedPercentage: data.flags?.taxFixedPercentage ?? false,
         taxFixedValue: data.flags?.taxFixedValue?.toString() ?? null, 
        taxMonthEndAdjustment: data.flags?.taxMonthEndAdjustment ?? false,
        flag1: data.flags?.flag1 ?? false,
        flag2: data.flags?.flag2 ?? false,
        flag3: data.flags?.flag3 ?? false,
      });
    }
  });
}

export async function deleteCustomPayrollCode(id: number) {
  await db.delete(customPayrollDefinitions).where(eq(customPayrollDefinitions.id, id));
}

export async function getCustomPayroll(id: number) {
  return db.query.customPayrollDefinitions.findFirst({
    where: (t, { eq }) => eq(t.id, id),
    with: {
      contributionGroups: {
        with: { flags: true },
      },
    },
  });
}

export async function getCustomPayrollForEdit(id: number) {
    // const res = await getCustomPayroll(id);
  
    return {
    //   code: res.code,
    //   description: res.description,
    //   rateDivisor: res.rateDivisor,
    //   hourlyRateDivisor: res.hourlyRateDivisor,
    //   contributions: Object.fromEntries(
    //     res.contributionGroups.map((g) => [
    //       g.contributionType,
    //       {
    //         basisOfComputation: g.basisOfComputation,
    //         basisValue: g.basisValue,
    //         approximationPercent: g.approximationPercent,
    //         percentage: g.percentage,
    //         fixedAmount: g.fixedAmount,
    //         minimum: g.minimum,
    //         maximum: g.maximum,
    //         fixedEmployeeShare: g.fixedEmployeeShare,
    //         fixedEmployerShare: g.fixedEmployerShare,
    //         fixedECShare: g.fixedECShare,
    //         scheduleFlags: {
    //           always: g.flags.scheduleAlways,
    //           endOfMonth: g.flags.scheduleEndOfMonth,
    //           firstPayroll: g.flags.scheduleFirstPayroll,
    //           secondPayroll: g.flags.scheduleSecondPayroll,
    //           thirdPayroll: g.flags.scheduleThirdPayroll,
    //           forthPayroll: g.flags.scheduleForthPayroll,
    //         },
    //         flags: g.flags,
    //       },
    //     ])
    //   ),
    };
  }
  
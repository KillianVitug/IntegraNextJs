"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recordAdminAuditEvent, requireAdminActor } from "@/lib/admin";
import {
  customPayrollDefinitions,
  employeeContributionGroups,
  employeeContributionFlags,
} from "@/db/schema";
import {
  type CustomPayrollPayload,
  customPayrollContributionKeys,
} from "@/zod-schemas/payrollCodeCustom";

type ContributionType = (typeof customPayrollContributionKeys)[number];
type ContributionData = CustomPayrollPayload["contributions"][ContributionType];

const emptyToNull = (value?: string | number | null) =>
  value === "" ? null : value;

export async function createCustomPayrollCode(payload: CustomPayrollPayload) {
  const actor = await requireAdminActor();
  const definitionId = await db.transaction(async (tx) => {
    const [definition] = await tx
      .insert(customPayrollDefinitions)
      .values({
        code: payload.code,
        description: payload.description ?? null,
        rateDivisor: payload.rateDivisor?.toString() ?? null,
        hourlyRateDivisor: payload.hourlyRateDivisor?.toString() ?? null,
      })
      .returning({ id: customPayrollDefinitions.id });

    for (const type of customPayrollContributionKeys) {
      const data: ContributionData = payload.contributions[type];

      const [group] = await tx
        .insert(employeeContributionGroups)
        .values({
          payrollCode: definition.id,
          contributionType: type,
          basisOfComputation: data.basisOfComputation,
          approximationPercent: data.approximationPercent.toString(),
          basisValue: emptyToNull(data.basisValue)?.toString() ?? null,
          percentage: emptyToNull(data.percentage)?.toString() ?? null,
          fixedAmount: emptyToNull(data.fixedAmount)?.toString() ?? null,
          minimum: emptyToNull(data.minimum)?.toString() ?? null,
          maximum: emptyToNull(data.maximum)?.toString() ?? null,
          fixedEmployeeShare:
            emptyToNull(data.fixedEmployeeShare)?.toString() ?? null,
          fixedEmployerShare:
            emptyToNull(data.fixedEmployerShare)?.toString() ?? null,
          fixedECShare: emptyToNull(data.fixedECShare)?.toString() ?? null,
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

  await recordAdminAuditEvent({
    actorUserId: actor.userId,
    entityType: "custom_payroll_definition",
    entityId: definitionId,
    action: "custom_payroll.created",
    details: { code: payload.code },
  });
  revalidatePath("/constants/payrollCode");
  revalidateTag("custom-payroll-codes");
  return definitionId;
}

export async function updateCustomPayrollCode(
  id: number,
  payload: CustomPayrollPayload
) {
  const actor = await requireAdminActor();
  await db.transaction(async (tx) => {
    await tx
      .update(customPayrollDefinitions)
      .set({
        code: payload.code,
        description: payload.description ?? null,
        rateDivisor: payload.rateDivisor?.toString() ?? null,
        hourlyRateDivisor: payload.hourlyRateDivisor?.toString() ?? null,
      })
      .where(eq(customPayrollDefinitions.id, id));

    await tx
      .delete(employeeContributionGroups)
      .where(eq(employeeContributionGroups.payrollCode, id));

    for (const type of customPayrollContributionKeys) {
      const data: ContributionData = payload.contributions[type];

      const [group] = await tx
        .insert(employeeContributionGroups)
        .values({
          payrollCode: id,
          contributionType: type,
          basisOfComputation: data.basisOfComputation,
          approximationPercent: data.approximationPercent.toString(),
          basisValue: emptyToNull(data.basisValue)?.toString() ?? null,
          percentage: emptyToNull(data.percentage)?.toString() ?? null,
          fixedAmount: emptyToNull(data.fixedAmount)?.toString() ?? null,
          minimum: emptyToNull(data.minimum)?.toString() ?? null,
          maximum: emptyToNull(data.maximum)?.toString() ?? null,
          fixedEmployeeShare:
            emptyToNull(data.fixedEmployeeShare)?.toString() ?? null,
          fixedEmployerShare:
            emptyToNull(data.fixedEmployerShare)?.toString() ?? null,
          fixedECShare: emptyToNull(data.fixedECShare)?.toString() ?? null,
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

  await recordAdminAuditEvent({
    actorUserId: actor.userId,
    entityType: "custom_payroll_definition",
    entityId: id,
    action: "custom_payroll.updated",
    details: { code: payload.code },
  });
  revalidatePath("/constants/payrollCode");
  revalidateTag("custom-payroll-codes");
}

export async function deleteCustomPayrollCode(id: number) {
  const actor = await requireAdminActor();
  await db
    .delete(customPayrollDefinitions)
    .where(eq(customPayrollDefinitions.id, id));

  await recordAdminAuditEvent({
    actorUserId: actor.userId,
    entityType: "custom_payroll_definition",
    entityId: id,
    action: "custom_payroll.deleted",
  });
  revalidatePath("/constants/payrollCode");
  revalidateTag("custom-payroll-codes");
}

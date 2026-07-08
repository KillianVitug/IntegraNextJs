"use server";

import { revalidateTag } from "next/cache";
import { db } from "@/db";
import {
  birWithholdingTaxBrackets,
  pagibigContributionRates,
  philhealthContributionRates,
  sssContributionBrackets,
  statutoryRuleVersions,
} from "@/db/schema";
import { recordAdminAuditEvent, requireAdminActor } from "@/lib/admin";
import { actionClient } from "@/lib/safe-action";
import { and, eq, ne } from "drizzle-orm";
import { flattenValidationErrors } from "next-safe-action";
import {
  deleteBirWithholdingTaxBracketSchema,
  insertBirWithholdingTaxBracketSchema,
  type InsertBirWithholdingTaxBracketSchemaType,
} from "@/zod-schemas/birWithholdingTaxBracket";
import {
  deletePagibigContributionRateSchema,
  insertPagibigContributionRateSchema,
  type InsertPagibigContributionRateSchemaType,
} from "@/zod-schemas/pagibigContributionRate";
import {
  deletePhilhealthContributionRateSchema,
  insertPhilhealthContributionRateSchema,
  type InsertPhilhealthContributionRateSchemaType,
} from "@/zod-schemas/philhealthContributionRate";
import {
  deleteSssContributionBracketSchema,
  insertSssContributionBracketSchema,
  type InsertSssContributionBracketSchemaType,
} from "@/zod-schemas/sssContributionBracket";
import {
  deleteStatutoryRuleVersionSchema,
  insertStatutoryRuleVersionSchema,
  type InsertStatutoryRuleVersionSchemaType,
} from "@/zod-schemas/statutoryRuleVersion";

type StatutoryRuleType = "SSS" | "PHILHEALTH" | "PAGIBIG" | "TAX";

function decimalMoney(value: number | null | undefined) {
  if (value == null) return null;
  return value.toFixed(2);
}

function decimalRate(value: number | null | undefined) {
  if (value == null) return null;
  return value.toFixed(6);
}

function dateValueOrMax(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).getTime() : Number.POSITIVE_INFINITY;
}

function rangesOverlap(
  firstStart: string,
  firstEnd: string | null,
  secondStart: string,
  secondEnd: string | null
) {
  const firstStartTime = new Date(`${firstStart}T00:00:00`).getTime();
  const firstEndTime = dateValueOrMax(firstEnd);
  const secondStartTime = new Date(`${secondStart}T00:00:00`).getTime();
  const secondEndTime = dateValueOrMax(secondEnd);

  return firstStartTime <= secondEndTime && secondStartTime <= firstEndTime;
}

async function getStatutoryRuleVersionForType(
  versionId: number,
  ruleType: StatutoryRuleType
) {
  const version = await db.query.statutoryRuleVersions.findFirst({
    where: and(
      eq(statutoryRuleVersions.id, versionId),
      eq(statutoryRuleVersions.ruleType, ruleType)
    ),
  });

  return version ?? null;
}

async function getVersionById(versionId: number) {
  return db.query.statutoryRuleVersions.findFirst({
    where: eq(statutoryRuleVersions.id, versionId),
  });
}

async function getVersionDeleteDependencies(versionId: number) {
  const [sssRow, philhealthRow, pagibigRow, taxRow] = await Promise.all([
    db.query.sssContributionBrackets.findFirst({
      where: eq(sssContributionBrackets.versionId, versionId),
    }),
    db.query.philhealthContributionRates.findFirst({
      where: eq(philhealthContributionRates.versionId, versionId),
    }),
    db.query.pagibigContributionRates.findFirst({
      where: eq(pagibigContributionRates.versionId, versionId),
    }),
    db.query.birWithholdingTaxBrackets.findFirst({
      where: eq(birWithholdingTaxBrackets.versionId, versionId),
    }),
  ]);

  return {
    hasChildren: Boolean(sssRow || philhealthRow || pagibigRow || taxRow),
  };
}

async function getProtectedVersionMessage(versionId: number) {
  const version = await getVersionById(versionId);

  if (!version) {
    return "Selected statutory rule version was not found.";
  }

  if (version.isDefault) {
    return "Default seeded statutory versions and their rows cannot be deleted.";
  }

  return null;
}

async function ensureVersionWindowDoesNotOverlap(
  payload: Pick<
    InsertStatutoryRuleVersionSchemaType,
    "id" | "ruleType" | "payrollTerms" | "effectiveFrom" | "effectiveTo"
  >
) {
  const existingVersions = payload.id
    ? await db
        .select()
        .from(statutoryRuleVersions)
        .where(
          and(
            eq(statutoryRuleVersions.ruleType, payload.ruleType),
            eq(statutoryRuleVersions.payrollTerms, payload.payrollTerms),
            ne(statutoryRuleVersions.id, payload.id)
          )
        )
    : await db
        .select()
        .from(statutoryRuleVersions)
        .where(
          and(
            eq(statutoryRuleVersions.ruleType, payload.ruleType),
            eq(statutoryRuleVersions.payrollTerms, payload.payrollTerms)
          )
        );

  const overlappingVersion = existingVersions.find((version) =>
    rangesOverlap(
      payload.effectiveFrom,
      payload.effectiveTo,
      version.effectiveFrom,
      version.effectiveTo
    )
  );

  if (overlappingVersion) {
    return `Effective dates overlap with version ${overlappingVersion.code}.`;
  }

  return null;
}

export const saveStatutoryRuleVersionAction = actionClient
  .metadata({ actionName: "saveStatutoryRuleVersionAction" })
  .schema(insertStatutoryRuleVersionSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: InsertStatutoryRuleVersionSchemaType }) => {
      const actor = await requireAdminActor();
      const payload: typeof statutoryRuleVersions.$inferInsert = {
        ruleType: parsedInput.ruleType,
        code: parsedInput.code,
        description: parsedInput.description ?? null,
        payrollTerms: "Semi-Monthly",
        effectiveFrom: parsedInput.effectiveFrom,
        effectiveTo: parsedInput.effectiveTo ?? null,
        isDefault: parsedInput.isDefault ?? false,
      };

      const overlapMessage = await ensureVersionWindowDoesNotOverlap({
        ...parsedInput,
        payrollTerms: "Semi-Monthly",
      });

      if (overlapMessage) {
        return { error: overlapMessage };
      }

      if (parsedInput.id && parsedInput.id > 0) {
        const existingVersion = await getVersionById(parsedInput.id);

        if (!existingVersion) {
          return { error: "Statutory rule version not found." };
        }

        if (existingVersion.ruleType !== parsedInput.ruleType) {
          const dependencies = await getVersionDeleteDependencies(parsedInput.id);
          if (dependencies.hasChildren) {
            return {
              error:
                "You cannot change the rule type of a version that already has statutory rows.",
            };
          }
        }

        try {
          await db
            .update(statutoryRuleVersions)
            .set({
              ...payload,
              updatedAt: new Date(),
            })
            .where(eq(statutoryRuleVersions.id, parsedInput.id));

          await recordAdminAuditEvent({
            actorUserId: actor.userId,
            entityType: "statutory_rule_version",
            entityId: parsedInput.id,
            action: "statutory_rule_version.updated",
            details: { code: parsedInput.code, ruleType: parsedInput.ruleType },
          });

          revalidateTag("statutory-rule-versions");
          return { message: `Statutory version ${parsedInput.code} updated.` };
        } catch (error: unknown) {
          if (
            error instanceof Error &&
            error.message.includes("duplicate key value")
          ) {
            return { error: "Version code already exists." };
          }

          return { error: "Unable to update statutory rule version." };
        }
      }

      try {
        const [created] = await db
          .insert(statutoryRuleVersions)
          .values(payload)
          .returning({ id: statutoryRuleVersions.id });
        await recordAdminAuditEvent({
          actorUserId: actor.userId,
          entityType: "statutory_rule_version",
          entityId: created.id,
          action: "statutory_rule_version.created",
          details: { code: parsedInput.code, ruleType: parsedInput.ruleType },
        });
        revalidateTag("statutory-rule-versions");
        return { message: `Statutory version ${parsedInput.code} created.` };
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.message.includes("duplicate key value")
        ) {
          return { error: "Version code already exists." };
        }

        return { error: "Unable to create statutory rule version." };
      }
    }
  );

export const deleteStatutoryRuleVersionAction = actionClient
  .metadata({ actionName: "deleteStatutoryRuleVersionAction" })
  .schema(deleteStatutoryRuleVersionSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const protectedMessage = await getProtectedVersionMessage(parsedInput.id);
    if (protectedMessage) {
      return { error: protectedMessage };
    }

    const dependencies = await getVersionDeleteDependencies(parsedInput.id);
    if (dependencies.hasChildren) {
      return {
        error:
          "Delete the related contribution or withholding rows first before deleting this version.",
      };
    }

    await db
      .delete(statutoryRuleVersions)
      .where(eq(statutoryRuleVersions.id, parsedInput.id));

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "statutory_rule_version",
      entityId: parsedInput.id,
      action: "statutory_rule_version.deleted",
    });

    revalidateTag("statutory-rule-versions");
    return { message: "Statutory rule version deleted." };
  });

async function ensureVersionMatches(
  versionId: number,
  ruleType: StatutoryRuleType
) {
  const version = await getStatutoryRuleVersionForType(versionId, ruleType);
  if (!version) {
    return {
      version: null,
      error: `Selected version is not a ${ruleType} statutory rule version.`,
    };
  }

  return { version, error: null };
}

export const saveSssContributionBracketAction = actionClient
  .metadata({ actionName: "saveSssContributionBracketAction" })
  .schema(insertSssContributionBracketSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: InsertSssContributionBracketSchemaType }) => {
      const actor = await requireAdminActor();
      const { error } = await ensureVersionMatches(parsedInput.versionId, "SSS");
      if (error) return { error };

      const payload: typeof sssContributionBrackets.$inferInsert = {
        versionId: parsedInput.versionId,
        rangeFrom: decimalMoney(parsedInput.rangeFrom)!,
        rangeTo: decimalMoney(parsedInput.rangeTo)!,
        salaryCredit: decimalMoney(parsedInput.salaryCredit)!,
        employeeShare: decimalMoney(parsedInput.employeeShare)!,
        employerShare: decimalMoney(parsedInput.employerShare)!,
        ecShare: decimalMoney(parsedInput.ecShare)!,
      };

      if (parsedInput.id && parsedInput.id > 0) {
        await db
          .update(sssContributionBrackets)
          .set(payload)
          .where(eq(sssContributionBrackets.id, parsedInput.id));

        await recordAdminAuditEvent({
          actorUserId: actor.userId,
          entityType: "sss_contribution_bracket",
          entityId: parsedInput.id,
          action: "sss_contribution_bracket.updated",
          details: { versionId: parsedInput.versionId },
        });

        revalidateTag("sss-brackets");
        return { message: "SSS contribution bracket updated." };
      }

      const [created] = await db
        .insert(sssContributionBrackets)
        .values(payload)
        .returning({ id: sssContributionBrackets.id });
      await recordAdminAuditEvent({
        actorUserId: actor.userId,
        entityType: "sss_contribution_bracket",
        entityId: created.id,
        action: "sss_contribution_bracket.created",
        details: { versionId: parsedInput.versionId },
      });
      revalidateTag("sss-brackets");
      return { message: "SSS contribution bracket created." };
    }
  );

export const deleteSssContributionBracketAction = actionClient
  .metadata({ actionName: "deleteSssContributionBracketAction" })
  .schema(deleteSssContributionBracketSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const row = await db.query.sssContributionBrackets.findFirst({
      where: eq(sssContributionBrackets.id, parsedInput.id),
    });

    if (!row) return { error: "SSS contribution bracket not found." };

    const protectedMessage = await getProtectedVersionMessage(row.versionId);
    if (protectedMessage) return { error: protectedMessage };

    await db
      .delete(sssContributionBrackets)
      .where(eq(sssContributionBrackets.id, parsedInput.id));

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "sss_contribution_bracket",
      entityId: parsedInput.id,
      action: "sss_contribution_bracket.deleted",
      details: { versionId: row.versionId },
    });

    revalidateTag("sss-brackets");
    return { message: "SSS contribution bracket deleted." };
  });

export const savePhilhealthContributionRateAction = actionClient
  .metadata({ actionName: "savePhilhealthContributionRateAction" })
  .schema(insertPhilhealthContributionRateSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: InsertPhilhealthContributionRateSchemaType }) => {
      const actor = await requireAdminActor();
      const { error } = await ensureVersionMatches(parsedInput.versionId, "PHILHEALTH");
      if (error) return { error };

      const existingRateForVersion = parsedInput.id
        ? await db.query.philhealthContributionRates.findFirst({
            where: and(
              eq(philhealthContributionRates.versionId, parsedInput.versionId),
              ne(philhealthContributionRates.id, parsedInput.id)
            ),
          })
        : await db.query.philhealthContributionRates.findFirst({
            where: eq(philhealthContributionRates.versionId, parsedInput.versionId),
          });

      if (existingRateForVersion) {
        return {
          error: "Only one PhilHealth contribution rate row is allowed per version.",
        };
      }

      const payload: typeof philhealthContributionRates.$inferInsert = {
        versionId: parsedInput.versionId,
        monthlyBasicSalaryFloor: decimalMoney(parsedInput.monthlyBasicSalaryFloor)!,
        monthlyBasicSalaryCeiling: decimalMoney(parsedInput.monthlyBasicSalaryCeiling)!,
        premiumRate: decimalRate(parsedInput.premiumRate)!,
        employeeShareRate: decimalRate(parsedInput.employeeShareRate)!,
        employerShareRate: decimalRate(parsedInput.employerShareRate)!,
      };

      if (parsedInput.id && parsedInput.id > 0) {
        await db
          .update(philhealthContributionRates)
          .set(payload)
          .where(eq(philhealthContributionRates.id, parsedInput.id));

        await recordAdminAuditEvent({
          actorUserId: actor.userId,
          entityType: "philhealth_contribution_rate",
          entityId: parsedInput.id,
          action: "philhealth_contribution_rate.updated",
          details: { versionId: parsedInput.versionId },
        });

        revalidateTag("philhealth-rates");
        return { message: "PhilHealth contribution rate updated." };
      }

      const [created] = await db
        .insert(philhealthContributionRates)
        .values(payload)
        .returning({ id: philhealthContributionRates.id });
      await recordAdminAuditEvent({
        actorUserId: actor.userId,
        entityType: "philhealth_contribution_rate",
        entityId: created.id,
        action: "philhealth_contribution_rate.created",
        details: { versionId: parsedInput.versionId },
      });
      revalidateTag("philhealth-rates");
      return { message: "PhilHealth contribution rate created." };
    }
  );

export const deletePhilhealthContributionRateAction = actionClient
  .metadata({ actionName: "deletePhilhealthContributionRateAction" })
  .schema(deletePhilhealthContributionRateSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const row = await db.query.philhealthContributionRates.findFirst({
      where: eq(philhealthContributionRates.id, parsedInput.id),
    });

    if (!row) return { error: "PhilHealth contribution rate not found." };

    const protectedMessage = await getProtectedVersionMessage(row.versionId);
    if (protectedMessage) return { error: protectedMessage };

    await db
      .delete(philhealthContributionRates)
      .where(eq(philhealthContributionRates.id, parsedInput.id));

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "philhealth_contribution_rate",
      entityId: parsedInput.id,
      action: "philhealth_contribution_rate.deleted",
      details: { versionId: row.versionId },
    });

    revalidateTag("philhealth-rates");
    return { message: "PhilHealth contribution rate deleted." };
  });

export const savePagibigContributionRateAction = actionClient
  .metadata({ actionName: "savePagibigContributionRateAction" })
  .schema(insertPagibigContributionRateSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: InsertPagibigContributionRateSchemaType }) => {
      const actor = await requireAdminActor();
      const { error } = await ensureVersionMatches(parsedInput.versionId, "PAGIBIG");
      if (error) return { error };

      const payload: typeof pagibigContributionRates.$inferInsert = {
        versionId: parsedInput.versionId,
        rangeFrom: decimalMoney(parsedInput.rangeFrom)!,
        rangeTo: decimalMoney(parsedInput.rangeTo)!,
        employeeRate: decimalRate(parsedInput.employeeRate)!,
        employerRate: decimalRate(parsedInput.employerRate)!,
        maxCompensationBase: decimalMoney(parsedInput.maxCompensationBase),
      };

      if (parsedInput.id && parsedInput.id > 0) {
        await db
          .update(pagibigContributionRates)
          .set(payload)
          .where(eq(pagibigContributionRates.id, parsedInput.id));

        await recordAdminAuditEvent({
          actorUserId: actor.userId,
          entityType: "pagibig_contribution_rate",
          entityId: parsedInput.id,
          action: "pagibig_contribution_rate.updated",
          details: { versionId: parsedInput.versionId },
        });

        revalidateTag("pagibig-rates");
        return { message: "Pag-IBIG contribution rate updated." };
      }

      const [created] = await db
        .insert(pagibigContributionRates)
        .values(payload)
        .returning({ id: pagibigContributionRates.id });
      await recordAdminAuditEvent({
        actorUserId: actor.userId,
        entityType: "pagibig_contribution_rate",
        entityId: created.id,
        action: "pagibig_contribution_rate.created",
        details: { versionId: parsedInput.versionId },
      });
      revalidateTag("pagibig-rates");
      return { message: "Pag-IBIG contribution rate created." };
    }
  );

export const deletePagibigContributionRateAction = actionClient
  .metadata({ actionName: "deletePagibigContributionRateAction" })
  .schema(deletePagibigContributionRateSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const row = await db.query.pagibigContributionRates.findFirst({
      where: eq(pagibigContributionRates.id, parsedInput.id),
    });

    if (!row) return { error: "Pag-IBIG contribution rate not found." };

    const protectedMessage = await getProtectedVersionMessage(row.versionId);
    if (protectedMessage) return { error: protectedMessage };

    await db
      .delete(pagibigContributionRates)
      .where(eq(pagibigContributionRates.id, parsedInput.id));

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "pagibig_contribution_rate",
      entityId: parsedInput.id,
      action: "pagibig_contribution_rate.deleted",
      details: { versionId: row.versionId },
    });

    revalidateTag("pagibig-rates");
    return { message: "Pag-IBIG contribution rate deleted." };
  });

export const saveBirWithholdingTaxBracketAction = actionClient
  .metadata({ actionName: "saveBirWithholdingTaxBracketAction" })
  .schema(insertBirWithholdingTaxBracketSchema, {
    handleValidationErrorsShape: async (ve) =>
      flattenValidationErrors(ve).fieldErrors,
  })
  .action(
    async ({ parsedInput }: { parsedInput: InsertBirWithholdingTaxBracketSchemaType }) => {
      const actor = await requireAdminActor();
      const { error } = await ensureVersionMatches(parsedInput.versionId, "TAX");
      if (error) return { error };

      const payload: typeof birWithholdingTaxBrackets.$inferInsert = {
        versionId: parsedInput.versionId,
        payrollTerms: "Semi-Monthly",
        compensationFrom: decimalMoney(parsedInput.compensationFrom)!,
        compensationTo: decimalMoney(parsedInput.compensationTo),
        baseTax: decimalMoney(parsedInput.baseTax)!,
        overPercentage: decimalRate(parsedInput.overPercentage)!,
      };

      if (parsedInput.id && parsedInput.id > 0) {
        await db
          .update(birWithholdingTaxBrackets)
          .set(payload)
          .where(eq(birWithholdingTaxBrackets.id, parsedInput.id));

        await recordAdminAuditEvent({
          actorUserId: actor.userId,
          entityType: "bir_withholding_tax_bracket",
          entityId: parsedInput.id,
          action: "bir_withholding_tax_bracket.updated",
          details: { versionId: parsedInput.versionId },
        });

        revalidateTag("bir-tax-brackets");
        return { message: "BIR withholding tax bracket updated." };
      }

      const [created] = await db
        .insert(birWithholdingTaxBrackets)
        .values(payload)
        .returning({ id: birWithholdingTaxBrackets.id });
      await recordAdminAuditEvent({
        actorUserId: actor.userId,
        entityType: "bir_withholding_tax_bracket",
        entityId: created.id,
        action: "bir_withholding_tax_bracket.created",
        details: { versionId: parsedInput.versionId },
      });
      revalidateTag("bir-tax-brackets");
      return { message: "BIR withholding tax bracket created." };
    }
  );

export const deleteBirWithholdingTaxBracketAction = actionClient
  .metadata({ actionName: "deleteBirWithholdingTaxBracketAction" })
  .schema(deleteBirWithholdingTaxBracketSchema)
  .action(async ({ parsedInput }) => {
    const actor = await requireAdminActor();
    const row = await db.query.birWithholdingTaxBrackets.findFirst({
      where: eq(birWithholdingTaxBrackets.id, parsedInput.id),
    });

    if (!row) return { error: "BIR withholding tax bracket not found." };

    const protectedMessage = await getProtectedVersionMessage(row.versionId);
    if (protectedMessage) return { error: protectedMessage };

    await db
      .delete(birWithholdingTaxBrackets)
      .where(eq(birWithholdingTaxBrackets.id, parsedInput.id));

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "bir_withholding_tax_bracket",
      entityId: parsedInput.id,
      action: "bir_withholding_tax_bracket.deleted",
      details: { versionId: row.versionId },
    });

    revalidateTag("bir-tax-brackets");
    return { message: "BIR withholding tax bracket deleted." };
  });

import {
  type CustomPayrollContributionKey,
  type CustomPayrollContributions,
  type CustomPayrollPayload,
  type SelectCustomPayrollWithRelations,
  customPayrollContributionKeys,
} from "@/zod-schemas/payrollCodeCustom";

const money = (value: unknown): string | null =>
  value == null ? null : String(value);

function createBaseContribution(): CustomPayrollContributions["SSS"] {
  return {
    scheduleFlags: {
      always: true,
      endOfMonth: false,
      firstPayroll: false,
      secondPayroll: false,
      thirdPayroll: false,
      forthPayroll: false,
    },
    basisOfComputation: "Gross Pay",
    basisValue: "0",
    approximationPercent: 100,
    percentage: "0",
    fixedAmount: "0",
    minimum: "0",
    maximum: "0",
    fixedEmployeeShare: "0",
    fixedEmployerShare: "0",
    fixedECShare: "0",
    flags: {
      flag1: false,
      flag2: false,
      flag3: false,
    },
  };
}

export function createDefaultCustomPayrollContributions(): CustomPayrollContributions {
  const sss = createBaseContribution();
  const philhealth = createBaseContribution();
  const pagibigBase = createBaseContribution();
  const peraaBase = createBaseContribution();
  const taxBase = createBaseContribution();

  return {
    SSS: sss,
    PHILHEALTH: philhealth,
    PAGIBIG: {
      ...pagibigBase,
      flags: {
        ...pagibigBase.flags,
        pagibigMaxContribution: false,
        pagibigDeductShare: false,
      },
    },
    PERAA: {
      ...peraaBase,
      approximationPercent: 0,
      flags: {
        ...peraaBase.flags,
        peraaComputeBoth: false,
        peraaComputeEmployer: false,
      },
    },
    TAX: {
      ...taxBase,
      approximationPercent: 0,
      flags: {
        ...taxBase.flags,
        taxFixedPercentage: false,
        taxFixedValue: "0",
        taxMonthEndAdjustment: false,
      },
    },
  };
}

export function createEmptyCustomPayrollPayload(): CustomPayrollPayload {
  return {
    code: "",
    description: null,
    rateDivisor: null,
    hourlyRateDivisor: null,
    contributions: createDefaultCustomPayrollContributions(),
  };
}

function mapScheduleFlags(
  flags?: SelectCustomPayrollWithRelations["contributionGroups"][number]["flags"]
) {
  return {
    always: flags?.scheduleAlways ?? true,
    endOfMonth: flags?.scheduleEndOfMonth ?? false,
    firstPayroll: flags?.scheduleFirstPayroll ?? false,
    secondPayroll: flags?.scheduleSecondPayroll ?? false,
    thirdPayroll: flags?.scheduleThirdPayroll ?? false,
    forthPayroll: flags?.scheduleForthPayroll ?? false,
  };
}

function mapContributionFlags(
  flags?: SelectCustomPayrollWithRelations["contributionGroups"][number]["flags"]
) {
  return {
    pagibigMaxContribution: !!flags?.pagibigMaxContribution,
    pagibigDeductShare: !!flags?.pagibigDeductShare,
    peraaComputeBoth: !!flags?.peraaComputeBoth,
    peraaComputeEmployer: !!flags?.peraaComputeEmployer,
    taxFixedPercentage: !!flags?.taxFixedPercentage,
    taxFixedValue: money(flags?.taxFixedValue),
    taxMonthEndAdjustment: !!flags?.taxMonthEndAdjustment,
    flag1: !!flags?.flag1,
    flag2: !!flags?.flag2,
    flag3: !!flags?.flag3,
  };
}

function mergeContributionGroup(
  current: CustomPayrollContributions[CustomPayrollContributionKey],
  group: SelectCustomPayrollWithRelations["contributionGroups"][number]
) {
  return {
    ...current,
    basisOfComputation: group.basisOfComputation,
    basisValue: money(group.basisValue),
    approximationPercent: Number(
      group.approximationPercent ?? current.approximationPercent
    ),
    percentage: money(group.percentage),
    fixedAmount: money(group.fixedAmount),
    minimum: money(group.minimum),
    maximum: money(group.maximum),
    fixedEmployeeShare: money(group.fixedEmployeeShare),
    fixedEmployerShare: money(group.fixedEmployerShare),
    fixedECShare: money(group.fixedECShare),
    scheduleFlags: {
      ...current.scheduleFlags,
      ...mapScheduleFlags(group.flags),
    },
    flags: {
      ...current.flags,
      ...mapContributionFlags(group.flags),
    } as typeof current.flags,
  } as typeof current;
}

export function mapPayrollToForm(
  dbResult: SelectCustomPayrollWithRelations
): CustomPayrollPayload {
  const contributions = createDefaultCustomPayrollContributions();

  for (const group of dbResult.contributionGroups) {
    const contributionType = group.contributionType as CustomPayrollContributionKey;
    contributions[contributionType] = mergeContributionGroup(
      contributions[contributionType],
      group
    );
  }

  return {
    code: dbResult.code,
    description: dbResult.description,
    rateDivisor: money(dbResult.rateDivisor),
    hourlyRateDivisor: money(dbResult.hourlyRateDivisor),
    contributions,
  };
}

export { customPayrollContributionKeys };

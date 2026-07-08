import { basisOfComputationEnum } from "@/db/schema";
import { Control, useWatch } from "react-hook-form";
import {
  type CustomPayrollContributionKey,
  type CustomPayrollPayload,
} from "@/zod-schemas/payrollCodeCustom";

/**
 * Drizzle enum → union type
 */
export type BasisOfComputation =
  (typeof basisOfComputationEnum.enumValues)[number];

export type ContributionField =
  | "basisValue"
  | "approximationPercent"
  | "percentage"
  | "fixedEmployeeShare"
  | "fixedEmployerShare"
  | "fixedECShare";

type ContributionPath = `contributions.${CustomPayrollContributionKey}`;

  export const BASIS_RULES: Record<
  BasisOfComputation,
  { editable: readonly ContributionField[] }
> = {
  "Gross Pay": { editable: [] },
  "Actual Basic Pay": { editable: [] },
  "Monthly Rate": { editable: [] },
  "Fixed Monthly Salary": { editable: ["basisValue"] },
  "Fixed Contribution": {
    editable: [
      "basisValue",
      "fixedEmployeeShare",
      "fixedEmployerShare",
      "fixedECShare",
    ],
  },
};

export function useContributionDisabler(
  control: Control<CustomPayrollPayload>,
  basePath: ContributionPath
) {
  const basis = useWatch({
    control,
    name: `${basePath}.basisOfComputation` as const,
    defaultValue: "Gross Pay" as BasisOfComputation,
  });

  const taxFixedPercentage = useWatch({
    control,
    name: `${basePath}.flags.taxFixedPercentage` as const,
  }) as boolean | undefined;

  const editable = BASIS_RULES[basis].editable;

  return (field: ContributionField) => {
    // 🔒 Always disable approximation %
    if (field === "approximationPercent") return true;

    // 🧾 TAX rules
    if (basePath.endsWith(".TAX")) {
      if (field === "percentage") return !taxFixedPercentage;
    }

    return !editable.includes(field);
  };
}

export const PAGIBIG_RULES: Record<
  BasisOfComputation,
  {
    maxContribution: boolean;
    deductShare: "always" | "whenMaxTrue" | "never";
  }
> = {
  "Gross Pay": {
    maxContribution: true,
    deductShare: "whenMaxTrue",
  },
  "Actual Basic Pay": {
    maxContribution: true,
    deductShare: "whenMaxTrue",
  },
  "Monthly Rate": {
    maxContribution: true,
    deductShare: "whenMaxTrue",
  },
  "Fixed Monthly Salary": {
    maxContribution: true,
    deductShare: "always",
  },
  "Fixed Contribution": {
    maxContribution: false,
    deductShare: "never",
  },
};

export function usePagibigDisabler(
  control: Control<CustomPayrollPayload>,
  basePath: `contributions.PAGIBIG`
) {
  const basis = useWatch({
    control,
    name: `${basePath}.basisOfComputation` as const,
    defaultValue: "Gross Pay" as BasisOfComputation,
  });

  const maxContribution = useWatch({
    control,
    name: `${basePath}.flags.pagibigMaxContribution` as const,
  }) as boolean;

  const rule = PAGIBIG_RULES[basis];

  const isMaxContributionDisabled = !rule.maxContribution;

  const isDeductShareDisabled =
    rule.deductShare === "never"
      ? true
      : rule.deductShare === "always"
      ? false
      : !maxContribution; // whenMaxTrue

  return {
    isMaxContributionDisabled,
    isDeductShareDisabled,
  };
}

export function usePeraaExclusiveFlags(
  control: Control<CustomPayrollPayload>,
  basePath: `contributions.PERAA`
) {
  const computeBoth = useWatch({
    control,
    name: `${basePath}.flags.peraaComputeBoth` as const,
  }) as boolean;

  const computeEmployer = useWatch({
    control,
    name: `${basePath}.flags.peraaComputeEmployer` as const,
  }) as boolean;

  return {
    computeBoth,
    computeEmployer,
  };
}


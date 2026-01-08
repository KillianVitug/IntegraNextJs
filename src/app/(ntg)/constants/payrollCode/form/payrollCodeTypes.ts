export type PayrollCodeFormValues = {
    code: string;
    description: string;
    rateDivisor: number | null;
    hourlyRateDivisor: number | null;
    contributions: {
      SSS: ContributionGroup;
      PHILHEALTH: ContributionGroup;
      PAGIBIG: ContributionGroup & {
        flags: {
          pagibigMaxContribution: boolean;
          pagibigDeductShare: boolean;
        };
      };
      PERAA: ContributionGroup & {
        flags: {
          peraaComputeBoth: boolean;
          peraaComputeEmployer: boolean;
        };
      };
      TAX: ContributionGroup & {
        flags: {
          taxFixedPercentage: boolean;
          taxFixedValue: number | null;
          taxMonthEndAdjustment: boolean;
        };
      };
    };
  };
  
  type ContributionGroup = {
    schedule: string;
    basisOfComputation: string;
    basisValue: number | null;
    approximationPercent: number;
    fixedEmployeeShare: string;
    fixedEmployerShare: string;
    fixedECShare: string;
    flags: Record<string, any>;
  };
  
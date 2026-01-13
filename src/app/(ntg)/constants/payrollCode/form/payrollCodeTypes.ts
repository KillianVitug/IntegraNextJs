export type PayrollCodeFormValues = {
  code: string;
  description: string | null;
  rateDivisor: string | null;
  hourlyRateDivisor: string | null;
  contributions: {
    SSS: ContributionGroup;
    PHILHEALTH: ContributionGroup;
    PAGIBIG: ContributionGroup & { flags: PayrollFlags & PagibigFlags };
    PERAA: ContributionGroup & { flags: PayrollFlags & PeraaFlags };
    TAX: ContributionGroup & { flags: PayrollFlags & TaxFlags };
  };
};
  
  type ContributionGroup = {
    basisOfComputation: string;
    basisValue: string | null;
    approximationPercent: string | null;
    percentage: string | null;
    fixedAmount: string | null;
    minimum: string | null;
    maximum: string | null;
    fixedEmployeeShare: string | null;
    fixedEmployerShare: string | null;
    fixedECShare: string | null;
    flags: PayrollFlags;
  };
  
  
  export type BaseScheduleFlags = {
    scheduleAlways: boolean;
    scheduleEndOfMonth: boolean;
    scheduleFirstPayroll: boolean;
    scheduleSecondPayroll: boolean;
    scheduleThirdPayroll: boolean;
    scheduleForthPayroll: boolean;
  };
  
  export type PagibigFlags = {
    pagibigMaxContribution: boolean;
    pagibigDeductShare: boolean;
  };
  
  export type PeraaFlags = {
    peraaComputeBoth: boolean;
    peraaComputeEmployer: boolean;
  };
  
  export type TaxFlags = {
    taxFixedPercentage: boolean;
    taxFixedValue: string | null;   // must be string because DB decimal
    taxMonthEndAdjustment: boolean;
  };
  
  export type PayrollFlags =
    & BaseScheduleFlags
    & Partial<PagibigFlags>
    & Partial<PeraaFlags>
    & Partial<TaxFlags>;
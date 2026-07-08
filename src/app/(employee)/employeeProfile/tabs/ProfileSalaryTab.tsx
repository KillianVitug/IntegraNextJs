"use client";

import type { SelectEmployeeWithRelationsSchemaType } from "@/zod-schemas/employee";
import { ProfileField } from "../components/ProfileField";
import { displayValue, formatMoneyValue } from "../utils";

type Props = {
  employee: SelectEmployeeWithRelationsSchemaType;
  slvlGroups: { id: number; name: string }[];
  customPayrollCodes: {
    id: number;
    code: string;
    description: string | null;
    rateDivisor: string | null;
  }[];
};

export default function ProfileSalaryTab({
  employee,
  slvlGroups,
  customPayrollCodes,
}: Props) {
  const salary = employee.salary;
  const slvlGroupName = salary?.slvlGroupId
    ? slvlGroups.find((group) => group.id === salary.slvlGroupId)?.name ?? "-"
    : "-";
  const customPayrollCode = salary?.customPayrollId
    ? customPayrollCodes.find((p) => p.id === salary.customPayrollId)?.code ?? "-"
    : "-";

  return (
    <div className="p-4">
      <div className="grid grid-cols-3 gap-3 mb-6">
        <ProfileField
          label="Daily Rate"
          value={formatMoneyValue(salary?.dailyRate)}
        />
        <ProfileField
          label="Monthly Rate"
          value={formatMoneyValue(salary?.monthlyRate)}
        />
        <ProfileField
          label="Rate Divisor"
          value={formatMoneyValue(salary?.rateDivisor)}
        />
      </div>
      <hr className="p-2" />
      <div className="grid grid-cols-3 gap-3 mb-6">
        <ProfileField
          label="Daily Allowance"
          value={formatMoneyValue(salary?.dailyAllowance)}
        />
        <ProfileField
          label="Monthly Allowance"
          value={formatMoneyValue(salary?.monthlyAllowance)}
        />
        <ProfileField
          label="Billing Rate"
          value={formatMoneyValue(salary?.billingRate)}
        />
        <ProfileField label="COLA" value={formatMoneyValue(salary?.cola)} />
        <ProfileField label="SLVL Group" value={displayValue(slvlGroupName)} />
      </div>
      <hr className="p-2" />
      <div className="grid grid-cols-3 gap-3">
        <ProfileField
          label="Custom Payroll Code"
          value={displayValue(customPayrollCode)}
        />
        <ProfileField
          label="Custom Payroll Description"
          value={displayValue(salary?.customPayrollDescription)}
        />
      </div>
    </div>
  );
}

"use client";

import type { SelectEmployeeWithRelationsSchemaType } from "@/zod-schemas/employee";
import { ProfileField } from "../components/ProfileField";
import { displayValue, formatDateValue } from "../utils";

type Props = {
  employee: SelectEmployeeWithRelationsSchemaType;
  departments: { id: number; name: string }[];
};

export default function ProfileGeneralTab({ employee, departments }: Props) {
  const general = employee.generalInfo;
  const departmentName = general?.departmentId
    ? departments.find((dept) => dept.id === general.departmentId)?.name ?? "-"
    : "-";

  return (
    <div className="p-4">
      <div className="grid grid-cols-3 gap-3 mb-6">
        <ProfileField
          label="Date Hired"
          value={formatDateValue(general?.dateHired)}
        />
        <ProfileField
          label="Separation Date"
          value={formatDateValue(general?.separationDate)}
        />
        <ProfileField label="Payroll Mode" value={displayValue(general?.payrollMode)} />
        <ProfileField
          label="Payroll Terms"
          value={displayValue(general?.payrollTerms)}
        />
        <ProfileField label="Category" value={displayValue(general?.category)} />
        <ProfileField label="Department" value={departmentName} />
        <ProfileField
          label="Employment Status"
          value={displayValue(general?.employmentStatus)}
        />
        <ProfileField
          label="Confidentiality Level"
          value={displayValue(general?.confidentialityLevel)}
        />
        <ProfileField
          label="Clearance Date"
          value={formatDateValue(general?.clearanceDate)}
        />
      </div>
      <hr className="p-2" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="grid grid-cols-1 gap-3">
          <ProfileField label="SSS No." value={displayValue(general?.sssNumber)} />
          <ProfileField
            label="Tax ID No."
            value={displayValue(general?.taxIdNumber)}
          />
          <ProfileField
            label="Pag-Ibig No."
            value={displayValue(general?.pagIbigNumber)}
          />
        </div>

        <div className="grid grid-cols-1 gap-3">
          <ProfileField
            label="Tax Status"
            value={displayValue(general?.taxStatus)}
          />
          <ProfileField
            label="Phil-Health No."
            value={displayValue(general?.philhealthNumber)}
          />
          <ProfileField
            label="PERRA ID No."
            value={displayValue(general?.perraIdNumber)}
          />
        </div>
      </div>
    </div>
  );
}

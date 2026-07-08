"use client";

import type { SelectEmployeeWithRelationsSchemaType } from "@/zod-schemas/employee";
import { ProfileField } from "../components/ProfileField";
import { displayValue, formatDateValue } from "../utils";

type Props = {
  employee: SelectEmployeeWithRelationsSchemaType;
  positions: { id: number; name: string }[];
};

export default function ProfileReferenceTab({ employee, positions }: Props) {
  const refs = employee.otherReferences;
  const positionName = refs?.positionId
    ? positions.find((pos) => pos.id === refs.positionId)?.name ?? "-"
    : "-";

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-3">
        <ProfileField label="Bank Code" value={displayValue(refs?.bankCode)} />
        <ProfileField
          label="Bank Account No."
          value={displayValue(refs?.bankAccountNo)}
        />
        <ProfileField label="Position" value={displayValue(positionName)} />
        <ProfileField label="Address" value={displayValue(refs?.address)} />
        <ProfileField label="Email" value={displayValue(refs?.email)} />
        <ProfileField
          label="Telephone No."
          value={displayValue(refs?.telephoneNo)}
        />
        <ProfileField
          label="Birthday"
          value={formatDateValue(refs?.birthday)}
        />
        <ProfileField label="Age" value={displayValue(refs?.age)} />
        <ProfileField
          label="Civil Status"
          value={displayValue(refs?.civilStatus)}
        />
        <ProfileField label="Gender" value={displayValue(refs?.gender)} />
      </div>
    </div>
  );
}

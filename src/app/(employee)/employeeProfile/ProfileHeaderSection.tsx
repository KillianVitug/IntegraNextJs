"use client";

import type { SelectEmployeeWithRelationsSchemaType } from "@/zod-schemas/employee";
import { formatEmployeeNoDisplay } from "@/utils/employeeDisplay";
import { ProfileField } from "./components/ProfileField";
import { displayValue } from "./utils";

type Props = {
  employee: SelectEmployeeWithRelationsSchemaType;
};

export default function ProfileHeaderSection({ employee }: Props) {
  const employeeNo = formatEmployeeNoDisplay(employee.employeeNo);

  return (
    <div className="flex flex-col gap-1 sm:px-8">
      <div>
        <h2 className="text-2xl font-bold">Employee Profile</h2>
        <p className="text-muted-foreground">
          Employee No: {displayValue(employeeNo)}
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-8 mb-6">
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <ProfileField
            label="Employee No"
            value={displayValue(employeeNo)}
          />
          <ProfileField
            label="First Name"
            value={displayValue(employee.firstName)}
          />
          <ProfileField
            label="Last Name"
            value={displayValue(employee.lastName)}
          />
        </div>

        <div className="flex flex-col gap-4 w-full max-w-xs">
          <ProfileField
            label="Middle Name"
            value={displayValue(employee.middleName)}
          />
          <ProfileField
            label="Middle Initial"
            value={displayValue(employee.middleInitial)}
          />
          <ProfileField label="Suffix" value={displayValue(employee.suffix)} />
        </div>

        <div className="flex flex-col w-full max-w-xs min-h-[200px]">
          <div className="flex-1 border rounded-lg bg-muted flex items-center justify-center mb-2">
            <span className="text-sm text-muted-foreground">
              Employee Photo
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

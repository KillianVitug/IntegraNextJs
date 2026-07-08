import { leaveStatusEnum } from "@/db/schema";

export type LeaveRecord = {
    id: number;
    employeeId: string;
    employeeNo: string | null;
    employeeType: string | null;
    firstName: string | null;
    lastName: string | null;
    dateFiled: string;
    leaveStartDate: string;
    leaveEndDate: string | null;
    leaveType: string;
    leaveTypeName?: string | null;
    dayPart: "FullDay" | "AM" | "PM";
    noOfDays: number;
    reason: string;
    leaveStatus: typeof leaveStatusEnum.enumValues[number];
  };

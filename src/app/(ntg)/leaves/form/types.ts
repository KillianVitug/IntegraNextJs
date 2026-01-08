import { leaveTypeEnum, leaveStatusEnum } from "@/db/schema";

export type LeaveRecord = {
    id: number;
    employeeId: string;
    employeeNo: string;
    firstName: string; 
    lastName: string;  
    dateFiled: string;
    leaveType: typeof leaveTypeEnum.enumValues[number];
    noOfDays: number;
    reason: string;
    leaveStatus: typeof leaveStatusEnum.enumValues[number];
};


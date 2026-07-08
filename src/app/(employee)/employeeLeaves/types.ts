export type LeaveUsageSummary = {
  entitledSickLeave: number;
  entitledVacationLeave: number;
  usedSickLeave: number;
  usedVacationLeave: number;
};

export type EmployeeServiceSummary = {
  employeeNo: string;
  fullName: string;
  dateHired: string | null;
  department: string | null;

};

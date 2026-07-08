import { InsertEmployeeSchemaType } from "@/zod-schemas/employee";

export const defaultGeneralInfo = {
    // employeeId: undefined, 
    payrollMode: undefined,
    payrollTerms: undefined,
    category: undefined,
    employmentStatus: undefined,
    confidentialityLevel: undefined,
    taxStatus: undefined,
    dateHired: null,
    separationDate: null,
    sssNumber: "",
    taxIdNumber: "",
    pagIbigNumber: "",
    philhealthNumber: "",
    perraIdNumber: "",
    clearanceDate: null,
};

export const defaultSalary = {
    // employeeId: undefined,
    dailyRate: "0", 
    monthlyRate: "0", 
    monthlyAllowance: "0", 
    dailyAllowance: "0", 
    cola: "0", 
    rateDivisor: "0",
    billingRate: "0", 
    ignoreDtrForMonthlyRate: false,
    ignoreContributionDeduction: false,
    customPayrollId: null,
    customPayrollDescription: "",
    slvlGroupId: "",
  };
  

export const defaultOtherReferences = {
    // employeeId: undefined,
    positionId: null,
    bankCode: "Philippine National Bank - (PNB)"  as const,
    bankAccountNo: "",
    address: "",
    email:"",
    telephoneNo: "",
    birthday: null,
    age: 0,
    civilStatus: null,
    gender: null,
};



export const defaultTimekeeping = {
    // employeeId: undefined,
    timekeepingId: "",
    shiftSchedule: null,
    checkInTime: null,
    checkOutTime: null,
    restDay: null,
    hoursWorked: 0,
    minutesWorked: 0,
};

export const defaultEmployeeValues: InsertEmployeeSchemaType = {
    employeeType: "EMP",
    firstName: "",
    lastName: "",
    middleName: "",
    middleInitial: "",
    suffix: "",
    generalInfo: defaultGeneralInfo,
    salary: defaultSalary,
    otherReferences: defaultOtherReferences,
    timekeeping: defaultTimekeeping,
    recurringEntries: [],
};

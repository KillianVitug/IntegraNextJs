import { InsertEmployeeSchemaType } from "@/zod-schemas/employee";

export const defaultGeneralInfo = {
    employeeId: undefined, 
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
    employeeId: undefined,
    dailyRate: null, 
    monthlyRate: null, 
    monthlyAllowance: null, 
    dailyAllowance: null, 
    cola: null, 
    rateDivisor: null,
    billingRate: null, 
    customPayrollCode: "",
    customPayrollDescription: "",
    slvlGroupId: null,
  };
  

export const defaultOtherReferences = {
    employeeId: undefined,
    positionId: null,
    bankCode: "",
    bankAccountNo: "",
    address: "",
    telephoneNo: "",
    birthday: null,
    age: null,
    civilStatus: null,
    gender: null,
};

export const defaultTimekeeping = {
    employeeId: undefined,
    timekeepingId: "",
    shiftSchedule: null,
    checkInTime: null,
    checkOutTime: null,
    restDay: null,
    hoursWorked: "",
    minutesWorked: "",
};

export const defaultEmployeeValues: InsertEmployeeSchemaType = {
    employeeNo: "",
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

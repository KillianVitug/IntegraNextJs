// src/app/actions/salaryAdjustAction.ts
"use server"

import { db } from "@/db";
import { employees, employeesSalary, employeesSalaryAdjustments } from "@/db/schema";
import { eq, gte, lte, and, like } from "drizzle-orm";
import { type UpdateEmployeeSalarySchemaType } from "@/zod-schemas/employeeSalary";

// Fetch all employees for dropdown
export async function getAllEmployees() {
    const results = await db
      .select({
        id: employees.id,
        employeeNo: employees.employeeNo,
        firstName: employees.firstName,
        lastName: employees.lastName,
        middleName: employees.middleName,
      })
      .from(employees)
      .orderBy(employees.lastName);
  
    // Compose fullName in JS
    return results.map(emp => ({
      id: emp.id,
      employeeNo: emp.employeeNo,
      fullName: `${emp.lastName}, ${emp.firstName} ${emp.middleName ?? ""}`.trim(),
    }));
  }

  export async function getEmployeeSalaryById(employeeId: string) {
    const results = await db
      .select()
      .from(employeesSalary)
      .where(eq(employeesSalary.employeeId, employeeId))
      .limit(1);
  
    return results[0] ?? null;
  }

  // Update salary info
 // Update salary info and create adjustment record
export async function updateEmployeeSalary(
  employeeId: string, 
  newSalary: UpdateEmployeeSalarySchemaType, 
  payrollCode: string
) {
  // Get current salary info for comparison
  const currentSalary = await getEmployeeSalaryById(employeeId);
  
  // Convert empty values to "0"
  const processedSalary = {
    dailyRate: newSalary.dailyRate || "0",
    monthlyRate: newSalary.monthlyRate || "0",
    monthlyAllowance: newSalary.monthlyAllowance || "0",
    dailyAllowance: newSalary.dailyAllowance || "0",
    rateDivisor: newSalary.rateDivisor || "0",
    billingRate: newSalary.billingRate || "0",
    customPayrollCode: payrollCode, // Set the custom payroll code
  };

// 1) Update the main employeesSalary
await db
.update(employeesSalary)
.set(processedSalary)
.where(eq(employeesSalary.employeeId, employeeId));

// 2) Overwrite existing adjustment record for (employeeId, payrollCode) OR insert if none exists
const existing = await db
.select({ id: employeesSalaryAdjustments.id })
.from(employeesSalaryAdjustments)
.where(
  and(
    eq(employeesSalaryAdjustments.employeeId, employeeId),
    eq(employeesSalaryAdjustments.payrollCode, payrollCode)
  )
)
.limit(1);

const adjustmentPayload = {
employeeId,
payrollCode,
oldDailyRate: currentSalary?.dailyRate ?? "0",
oldMonthlyRate: currentSalary?.monthlyRate ?? "0",
oldMonthlyAllowance: currentSalary?.monthlyAllowance ?? "0",
oldDailyAllowance: currentSalary?.dailyAllowance ?? "0",
oldRateDivisor: currentSalary?.rateDivisor ?? "0",
oldBillingRate: currentSalary?.billingRate ?? "0",
newDailyRate: processedSalary.dailyRate,
newMonthlyRate: processedSalary.monthlyRate,
newMonthlyAllowance: processedSalary.monthlyAllowance,
newDailyAllowance: processedSalary.dailyAllowance,
newRateDivisor: processedSalary.rateDivisor,
newBillingRate: processedSalary.billingRate,
};

if (existing[0]) {
await db
  .update(employeesSalaryAdjustments)
  .set(adjustmentPayload)
  .where(eq(employeesSalaryAdjustments.id, existing[0].id));
} else {
await db.insert(employeesSalaryAdjustments).values(adjustmentPayload);
}

return processedSalary;
}

// Get salary adjustment history
export async function getSalaryAdjustmentHistory(payrollCode?: string) {
  const query = db
    .select({
      id: employeesSalaryAdjustments.id,
      employeeId: employeesSalaryAdjustments.employeeId,
      payrollCode: employeesSalaryAdjustments.payrollCode,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      middleName: employees.middleName,
      oldDailyRate: employeesSalaryAdjustments.oldDailyRate,
      oldMonthlyRate: employeesSalaryAdjustments.oldMonthlyRate,
      oldMonthlyAllowance: employeesSalaryAdjustments.oldMonthlyAllowance,
      oldDailyAllowance: employeesSalaryAdjustments.oldDailyAllowance,
      oldRateDivisor: employeesSalaryAdjustments.oldRateDivisor,
      oldBillingRate: employeesSalaryAdjustments.oldBillingRate,
      newDailyRate: employeesSalaryAdjustments.newDailyRate,
      newMonthlyRate: employeesSalaryAdjustments.newMonthlyRate,
      newMonthlyAllowance: employeesSalaryAdjustments.newMonthlyAllowance,
      newDailyAllowance: employeesSalaryAdjustments.newDailyAllowance,
      newRateDivisor: employeesSalaryAdjustments.newRateDivisor,
      newBillingRate: employeesSalaryAdjustments.newBillingRate,
      adjustmentDate: employeesSalaryAdjustments.adjustmentDate,
    })
    .from(employeesSalaryAdjustments)
    .leftJoin(employees, eq(employeesSalaryAdjustments.employeeId, employees.id))
    .orderBy(employeesSalaryAdjustments.adjustmentDate);

  if (payrollCode) {
    query.where(eq(employeesSalaryAdjustments.payrollCode, payrollCode));
  }

  const results = await query;

  return results.map(record => ({
    ...record,
    fullName: `${record.lastName}, ${record.firstName} ${record.middleName ?? ""}`.trim(),
  }));
}

// Get salary adjustment history by year
export async function getSalaryAdjustmentHistoryByYear(year: number) {
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

  const results = await db
    .select({
      id: employeesSalaryAdjustments.id,
      employeeId: employeesSalaryAdjustments.employeeId,
      payrollCode: employeesSalaryAdjustments.payrollCode,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName,
      lastName: employees.lastName,
      middleName: employees.middleName,
      oldDailyRate: employeesSalaryAdjustments.oldDailyRate,
      oldMonthlyRate: employeesSalaryAdjustments.oldMonthlyRate,
      oldMonthlyAllowance: employeesSalaryAdjustments.oldMonthlyAllowance,
      oldDailyAllowance: employeesSalaryAdjustments.oldDailyAllowance,
      oldRateDivisor: employeesSalaryAdjustments.oldRateDivisor,
      oldBillingRate: employeesSalaryAdjustments.oldBillingRate,
      newDailyRate: employeesSalaryAdjustments.newDailyRate,
      newMonthlyRate: employeesSalaryAdjustments.newMonthlyRate,
      newMonthlyAllowance: employeesSalaryAdjustments.newMonthlyAllowance,
      newDailyAllowance: employeesSalaryAdjustments.newDailyAllowance,
      newRateDivisor: employeesSalaryAdjustments.newRateDivisor,
      newBillingRate: employeesSalaryAdjustments.newBillingRate,
      adjustmentDate: employeesSalaryAdjustments.adjustmentDate,
    })
    .from(employeesSalaryAdjustments)
    .leftJoin(employees, eq(employeesSalaryAdjustments.employeeId, employees.id))
    .where(
      and(
        like(employeesSalaryAdjustments.payrollCode, `${year}-%`) // ? match only that year’s payroll codes
      )
    )
    .orderBy(employeesSalaryAdjustments.adjustmentDate);

  return results.map(record => ({
    ...record,
    fullName: `${record.lastName}, ${record.firstName} ${record.middleName ?? ""}`.trim(),
  }));
}


export type SalaryAdjustmentResultsType = Awaited<ReturnType<typeof getSalaryAdjustmentHistory>>

export async function deleteSalaryAdjustmentAndRestore(
  employeeId: string,
  payrollCode: string
) {
  // 1️⃣ Get the salary adjustment record for this employee & payroll code
  const adjustment = await db
    .select()
    .from(employeesSalaryAdjustments)
    .where(
      and(
        eq(employeesSalaryAdjustments.employeeId, employeeId),
        eq(employeesSalaryAdjustments.payrollCode, payrollCode)
      )
    )
    .limit(1);

  if (!adjustment[0]) {
    throw new Error("No salary adjustment record found for this employee & payroll code");
  }

  const oldSalary = {
    dailyRate: adjustment[0].oldDailyRate || "0",
    monthlyRate: adjustment[0].oldMonthlyRate || "0",
    monthlyAllowance: adjustment[0].oldMonthlyAllowance || "0",
    dailyAllowance: adjustment[0].oldDailyAllowance || "0",
    rateDivisor: adjustment[0].oldRateDivisor || "0",
    billingRate: adjustment[0].oldBillingRate || "0",
  };

  // 2️⃣ Restore the old salary in employeesSalary
  await db
    .update(employeesSalary)
    .set(oldSalary)
    .where(eq(employeesSalary.employeeId, employeeId));

  // 3️⃣ Remove the adjustment record
  await db
    .delete(employeesSalaryAdjustments)
    .where(
      and(
        eq(employeesSalaryAdjustments.employeeId, employeeId),
        eq(employeesSalaryAdjustments.payrollCode, payrollCode)
      )
    );

  return { success: true, restoredSalary: oldSalary };
}
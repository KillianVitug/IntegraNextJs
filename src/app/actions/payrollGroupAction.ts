"use server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminAuditEvents, employees, employeesSalary, payrollPeriods, payrollRuns, payrollRunEmployees } from "@/db/schema";
import { monthlyPayrollSettings } from "@/db/payrollGroupSchema";
import { requirePermission } from "@/lib/auth/server";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";
import { earningMonth, runPayrollGroup } from "@/lib/payroll/payrollGroupModel";
import { monthlyPayouts, payrollGroupsInstalled } from "@/lib/payroll/payrollGroups";
import { lockAttendancePayrollInput } from "@/lib/payroll/attendanceSourceGuard";
import { PayrollValidationError, payrollActionResult } from "@/lib/payroll/validation";

export async function getMonthlyPayrollSettingsAction(periodId:string) {
 await requirePermission(AUTH_PERMISSIONS.PAYROLL_COMPUTE);
 const period=await db.query.payrollPeriods.findFirst({where:eq(payrollPeriods.id,periodId)});
 if(!period)throw new PayrollValidationError("Payroll period not found.");
 const month=earningMonth(period),choices=await monthlyPayouts(month);
 const rows=await db.select({id:employees.id,no:employees.employeeNo,first:employees.firstName,last:employees.lastName,rate:employeesSalary.monthlyRate}).from(employees)
  .innerJoin(employeesSalary,eq(employeesSalary.employeeId,employees.id)).where(and(isNull(employees.deletedAt),eq(employees.employeeType,"EMP"),sql`${employeesSalary.monthlyRate}>0`));
 return {installed:await payrollGroupsInstalled(),month,cycle:period.cycle,employees:rows.map(r=>({...r,half:choices.get(r.id)??"B" as const}))};
}
export async function saveMonthlyPayrollSettingsAction(periodId:string,employeeIds:string[],half:"A"|"B") {
 const actor=await requirePermission(AUTH_PERMISSIONS.PAYROLL_COMPUTE);
 return payrollActionResult(()=>db.transaction(async tx=>{
  await lockAttendancePayrollInput(tx);
  if(!["A","B"].includes(half)||!employeeIds.length||employeeIds.length>500||employeeIds.some(id=>!/^[\da-f-]{36}$/i.test(id)))throw new PayrollValidationError("Select employees and a valid payout half.");
  if(!await payrollGroupsInstalled(tx))throw new PayrollValidationError("The payroll-group migration must be installed before saving payout settings.");
  const [period]=await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id,periodId));if(!period)throw new PayrollValidationError("Payroll period not found.");
  const month=earningMonth(period),ids=[...new Set(employeeIds)];
  const members=await tx.select({id:employees.id}).from(employees).innerJoin(employeesSalary,eq(employeesSalary.employeeId,employees.id)).where(and(inArray(employees.id,ids),isNull(employees.deletedAt),sql`${employeesSalary.monthlyRate}>0`));
  if(members.length!==ids.length)throw new PayrollValidationError("One or more selected employees are no longer monthly salaried.");
  const posted=await tx.select({id:payrollRuns.id}).from(payrollRuns).innerJoin(payrollPeriods,eq(payrollPeriods.id,payrollRuns.payrollPeriodId)).innerJoin(payrollRunEmployees,eq(payrollRunEmployees.payrollRunId,payrollRuns.id))
   .where(and(eq(payrollPeriods.year,period.year),eq(payrollPeriods.month,period.month),eq(payrollRuns.status,"Posted"),inArray(payrollRunEmployees.employeeId,ids),sql`${payrollRuns.inputSnapshot}->>'payrollGroup'='Monthly'`));
  if(posted.length)throw new PayrollValidationError("A selected employee's monthly payout is already posted. Choose a later earning month.");
  await tx.insert(monthlyPayrollSettings).values(ids.map(employeeId=>({employeeId,effectiveMonth:`${month}-01`,payoutHalf:half,actor:actor.accountId}))).onConflictDoUpdate({target:[monthlyPayrollSettings.employeeId,monthlyPayrollSettings.effectiveMonth],set:{payoutHalf:half,actor:actor.accountId,updatedAt:new Date()}});
  await tx.update(payrollRuns).set({status:"Stale",reviewedAt:null,reviewedByUserId:null,approvedAt:null,approvedByUserId:null,updatedAt:new Date()}).where(and(inArray(payrollRuns.status,["Draft","Reviewed","Approved"]),sql`${payrollRuns.inputSnapshot}->>'payrollGroup'='Monthly'`,sql`${payrollRuns.inputSnapshot}->>'earningMonth'>=${month}`));
  await tx.insert(adminAuditEvents).values({actorUserId:actor.accountId,entityType:"monthly_payroll_settings",entityId:month,action:"payroll.monthly_payout_changed",details:JSON.stringify({employeeIds:ids,half,effectiveMonth:month})});
  return `${ids.length} monthly payout settings saved, effective ${month}.`;
 }));
}

export async function payrollGroupHistoryAction(periodId:string) {
 await requirePermission(AUTH_PERMISSIONS.PAYROLL_COMPUTE);
 const rows=await db.select().from(payrollRuns).where(eq(payrollRuns.payrollPeriodId,periodId)).orderBy(desc(payrollRuns.createdAt));
 return rows.map(r=>({id:r.id,number:r.runNumber,status:r.status,group:runPayrollGroup(r.inputSnapshot)}));
}

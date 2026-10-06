import "server-only";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { monthlyPayrollSettings } from "@/db/payrollGroupSchema";
import { employeesSalary, payrollPeriods, payrollRunEmployees, payrollRunLines, payrollRuns } from "@/db/schema";
import { resolutionDigest } from "./attendanceResolution";
import { earningMonth, payrollGroup, runPayrollGroup, type MonthlyPayoutHalf } from "./payrollGroupModel";

export async function payrollGroupsInstalled(database:DbClient=db) {
 const result=await database.execute(sql`select to_regclass('public.monthly_payroll_settings') is not null as installed`);
 return (result.rows[0] as {installed?:boolean}|undefined)?.installed===true;
}
/** A monetary edit in either half also affects the month's single salary payout. */
export function payrollInputPeriodScope(periodId:string) {
 return sql`(${payrollRuns.payrollPeriodId}=${periodId} or (${payrollRuns.inputSnapshot}->>'payrollGroup'='Monthly' and ${payrollRuns.inputSnapshot}->>'earningMonth'=(select concat(year,'-',lpad(month::text,2,'0')) from payroll_periods where id=${periodId})))`;
}
export async function monthlyPayouts(month:string,database:DbClient=db) {
 if(!await payrollGroupsInstalled(database))return new Map<string,MonthlyPayoutHalf>();
 const rows=await database.select().from(monthlyPayrollSettings).where(lte(monthlyPayrollSettings.effectiveMonth,`${month}-01`)).orderBy(desc(monthlyPayrollSettings.effectiveMonth));
 const choices=new Map<string,MonthlyPayoutHalf>();for(const row of rows)if(!choices.has(row.employeeId))choices.set(row.employeeId,row.payoutHalf);return choices;
}
export async function postedMonthPayments(period:{year:number;month:number},employeeIds:string[],database:DbClient=db) {
 if(!employeeIds.length)return {digest:resolutionDigest([]),employees:[],lines:[]};
 const rows=await database.select({employee:payrollRunEmployees,runId:payrollRuns.id}).from(payrollRunEmployees)
  .innerJoin(payrollRuns,eq(payrollRuns.id,payrollRunEmployees.payrollRunId)).innerJoin(payrollPeriods,eq(payrollPeriods.id,payrollRuns.payrollPeriodId))
  .where(and(inArray(payrollRunEmployees.employeeId,employeeIds),eq(payrollRuns.status,"Posted"),eq(payrollPeriods.year,period.year),eq(payrollPeriods.month,period.month),eq(payrollRuns.runType,"Regular")));
 const ids=rows.map(r=>r.employee.id);
 const lines=ids.length?await database.select().from(payrollRunLines).where(inArray(payrollRunLines.payrollRunEmployeeId,ids)):[];
 return {digest:resolutionDigest([earningMonth(period),rows.sort((a,b)=>a.employee.id.localeCompare(b.employee.id)),lines.sort((a,b)=>a.id.localeCompare(b.id))]),employees:rows.map(r=>r.employee),lines};
}

/** Select the employee's group, with legacy fallback for historic mixed runs. */
export async function employeePayrollRun(periodId:string,employeeId:string,database:DbClient=db) {
 const [salary]=await database.select().from(employeesSalary).where(eq(employeesSalary.employeeId,employeeId));
 const group=payrollGroup(salary);
 const rows=await database.select().from(payrollRuns).where(eq(payrollRuns.payrollPeriodId,periodId)).orderBy(desc(payrollRuns.createdAt));
 return rows.find(r=>runPayrollGroup(r.inputSnapshot)===group)??rows.find(r=>runPayrollGroup(r.inputSnapshot)==="Legacy")??null;
}

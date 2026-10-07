import assert from "node:assert/strict";
import { db } from "@/db";
import { employees, employeesGeneralInfo, employeesSalary, payrollPeriods, attendanceImportBatches, attendanceRawLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
async function main(){
 const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(url.pathname,"/payroll_stage6_acceptance_20261007");
 const result=await db.transaction(async tx=>{
  const [period]=await tx.select().from(payrollPeriods).where(eq(payrollPeriods.code,"2026-06-B"));assert.ok(period);
  let [person]=await tx.select().from(employees).where(eq(employees.employeeNo,"S6-FICTIONAL"));
  if(!person){
   [person]=await tx.insert(employees).values({employeeNo:"S6-FICTIONAL",firstName:"Stage Six",lastName:"Example"}).returning();
   await tx.insert(employeesGeneralInfo).values({employeeId:person.id,dateHired:"2026-06-28",separationDate:"2026-06-30",payrollTerms:"Semi-Monthly"});
   const [batch]=await tx.insert(attendanceImportBatches).values({payrollPeriodId:period.id,sourceFileName:"Stage 6 fictional GUI captures.csv",sourceFormat:"CSV",status:"Processed",totalRows:5,matchedRows:5}).returning();
   const captures=[{day:"28",time:"17:06:13",direction:"OUT" as const},{day:"29",time:"10:30:00",direction:"IN" as const},{day:"29",time:"11:00:00",direction:"OUT" as const},{day:"30",time:"10:30:00",direction:"IN" as const},{day:"30",time:"11:00:00",direction:"OUT" as const}];
   await tx.insert(attendanceRawLogs).values(captures.map(c=>({batchId:batch.id,employeeId:person.id,employeeNo:person.employeeNo,direction:c.direction,logDate:`2026-06-${c.day}`,logTime:c.time,loggedAt:new Date(`2026-06-${c.day}T${c.time}+08:00`),rawText:"Explicit fictional Stage 6 acceptance capture"})));
  }
  // A fictional salary is needed by the existing manual-payroll refresh after DTR rebuild.
  await tx.insert(employeesSalary).values({employeeId:person.id,dailyRate:"800.0000",rateDivisor:"26.00"}).onConflictDoNothing({target:employeesSalary.employeeId});
  return {periodId:period.id,employeeId:person.id};
 });
 console.log(JSON.stringify({fictional:true,...result,url:`http://127.0.0.1:3020/payroll/attendance-source?year=2026&periodId=${result.periodId}&employeeId=${result.employeeId}&day=2026-06-28`}));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});

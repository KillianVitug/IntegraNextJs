import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { payrollPeriods, payrollRuns } from "@/db/schema";
import { lockAttendancePayrollInput } from "./attendanceSourceGuard";
import { PayrollValidationError } from "./validation";

/** All inputs and financial refresh writes share one locked transaction. The
 * callback must use its supplied client, including any nested calculation reads. */
export async function withAttendanceFinancialRefresh<T>(database:typeof db,periodId:string,refresh:(tx:Parameters<Parameters<typeof db.transaction>[0]>[0])=>Promise<T>):Promise<T> {
  return database.transaction(async tx=>{
    await lockAttendancePayrollInput(tx);
    const [period]=await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id,periodId)).for("update");
    if(!period||period.status!=="Open")throw new PayrollValidationError("This payroll period is closed. Use an explicit adjustment if needed; posted payroll is unchanged.");
    const protectedRuns=await tx.select({id:payrollRuns.id}).from(payrollRuns).where(and(eq(payrollRuns.payrollPeriodId,periodId),inArray(payrollRuns.status,["Approved","Posted"]),sql`coalesce(${payrollRuns.inputSnapshot}->>'payrollGroup','Legacy') <> 'Monthly'`));
    if(protectedRuns.length)throw new PayrollValidationError("Daily payroll is approved or posted. Attendance display remains available; financial refresh requires an open editable payroll.");
    return refresh(tx);
  });
}

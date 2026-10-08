import { db } from "@/db";
import { payrollPeriods } from "@/db/schema";
import { requireAdminActor } from "@/lib/admin";
import { selectAttendanceSourcePeriod } from "@/lib/payroll/attendanceSourcePeriods";
import { renderPayrollWorkspacePage } from "../page-loader";
import { AttendanceSourcePanel } from "../attendance-source/panel";
export const maxDuration=60;
export default async function AttendanceSourcesPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
 await requireAdminActor();
 const [params,periods]=await Promise.all([searchParams,db.select({id:payrollPeriods.id,code:payrollPeriods.code,year:payrollPeriods.year,startDate:payrollPeriods.startDate,endDate:payrollPeriods.endDate}).from(payrollPeriods)]);
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const selection=selectAttendanceSourcePeriod(periods,params,today);
 const files=await renderPayrollWorkspacePage({activeSection:"attendanceSources",searchParams:Promise.resolve({...params,year:String(selection.year),periodId:selection.periodId}),embedded:true});
 return <AttendanceSourcePanel key={`${selection.year}:${selection.periodId}`} periods={periods} year={selection.year} periodId={selection.periodId} today={today} files={files}/>;
}

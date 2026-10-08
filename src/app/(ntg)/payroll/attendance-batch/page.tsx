import { notFound } from "next/navigation";
import { db } from "@/db";
import { payrollPeriods } from "@/db/schema";
import { requireAdminActor } from "@/lib/admin";
import { attendanceSourceEnabled } from "@/lib/payroll/attendanceSourceSync";
import { selectAttendanceSourcePeriod } from "@/lib/payroll/attendanceSourcePeriods";
import { AttendanceReviewPage } from "../attendance-source/review-page";
export const maxDuration=60;
export default async function AttendanceBatchPage({searchParams}:{searchParams:Promise<{year?:string;periodId?:string}>}) {
 await requireAdminActor();if(!attendanceSourceEnabled())notFound();
 const [params,periods]=await Promise.all([searchParams,db.select({id:payrollPeriods.id,code:payrollPeriods.code,year:payrollPeriods.year,startDate:payrollPeriods.startDate,endDate:payrollPeriods.endDate}).from(payrollPeriods)]);
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const selection=selectAttendanceSourcePeriod(periods,params,today);
 return <AttendanceReviewPage key={`${selection.year}:${selection.periodId}`} periods={periods} year={selection.year} periodId={selection.periodId} today={today}/>;
}

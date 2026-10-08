"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { selectAttendanceSourcePeriod, type AttendanceSourcePeriod } from "@/lib/payroll/attendanceSourcePeriods";
import type { WorkBoard } from "@/lib/payroll/attendanceWorkbenchModel";
import { PayrollWorkspaceNav } from "../PayrollPageNav";
import { AttendanceWorkbench } from "./workbench";
import { AttendanceReadStatus, useAttendanceView } from "./read-view";
export function AttendanceReviewPage({periods,year,periodId,today}:{periods:AttendanceSourcePeriod[];year:number;periodId:string;today:string}) {
 const router=useRouter(),[changing,startChange]=useTransition();
 const board=useAttendanceView<WorkBoard>("workbench",periodId,!!periodId);
 const selected=selectAttendanceSourcePeriod(periods,{year:String(year),periodId},today);
 const years=[...new Set([year,...periods.map(period=>period.year)])].sort((a,b)=>b-a);
 function changePeriod(nextYear:number,nextPeriod:string){const url=new URL(location.href);url.searchParams.set("year",String(nextYear));url.searchParams.set("periodId",nextPeriod);for(const key of ["employeeId","day","sourceId","runId"])url.searchParams.delete(key);startChange(()=>router.replace(url.pathname+url.search+url.hash,{scroll:false}));}
 return <main className="mx-auto min-w-0 max-w-6xl space-y-4 p-3 sm:p-6">
  <PayrollWorkspaceNav activeSection="attendanceBatch" context={{periodId,year:String(year)}}/>
  <header><h1 className="text-2xl font-semibold">Batch changes & history</h1><p className="mt-2 text-sm text-muted-foreground">Review complete employee plans together, resume saved drafts or inspect earlier decisions. Routine attendance and schedule changes stay with the employee in Estimate.</p></header>
  <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
   <label className="text-sm">Payroll year<select className="mt-1 min-h-11 w-full rounded border bg-background p-2" value={year} disabled={changing} onChange={event=>{const next=selectAttendanceSourcePeriod(periods,{year:event.target.value},today);changePeriod(next.year,next.periodId);}}>{years.map(value=><option key={value}>{value}</option>)}</select></label>
   <label className="min-w-0 text-sm">Payroll period<select className="mt-1 min-h-11 w-full rounded border bg-background p-2" value={periodId} disabled={changing} onChange={event=>changePeriod(year,event.target.value)}>{selected.periods.map(period=><option key={period.id} value={period.id}>{period.code} · {period.startDate} – {period.endDate}</option>)}</select></label>
  </div>
  {changing&&<p role="status">Opening selected period…</p>}
  <AttendanceReadStatus {...board}/>{board.data&&<AttendanceWorkbench initial={board.data}/>}
  {!periodId&&<p>Select a payroll period to begin.</p>}
 </main>;
}

import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {AttendanceWorkbench} from "@/app/(ntg)/payroll/attendance-source/workbench";
import {PayrollArtifacts} from "@/app/(ntg)/payroll/outputs/PayrollArtifacts";
import {PaymentReview} from "@/app/(ntg)/payroll/outputs/PaymentReview";
import {batchReviewFixture} from "./attendanceTest/batchReviewFixture";
export const fixture=batchReviewFixture();
fixture.board.employees[0].days[0].records=fixture.board.employees[0].days[0].records.slice(1);
fixture.board.employees[0].days[0].suggestions=[];
fixture.board.employees[0].contextRecords=fixture.board.employees[0].days[0].records;
export const previewState={drafts:[] as typeof fixture.drafts,revision:0,approved:false,calls:[] as string[],interruptApproval:false,interruptSchedule:false};
function Preview(){
 const [key,setKey]=useState(0),[view,setView]=useState("Attendance");
 const artifacts=Array.from({length:277},(_,i)=>({id:`slip-${i}`,kind:"Payslip",status:"Published",fileName:`EX${String(i+1).padStart(5,'0')}-2026-09-B-Daily-payslip.pdf`,generatedAt:"2026-10-07T13:41:00Z",metadata:{employeeId:`example-${i}`,employeeName:`Employee Example ${i+1}`}}));
 return <main className="mx-auto min-w-0 max-w-6xl space-y-3 p-2 sm:p-6"><p className="rounded border bg-amber-100 p-3 text-sm">Fictional acceptance fixture. Real components; simulated server responses. No production connection.</p><div className="flex flex-wrap gap-2">{["Attendance","Outputs"].map(v=><button key={v} className="min-h-11 rounded border p-2" onClick={()=>setView(v)}>{v}</button>)}<button className="min-h-11 rounded border p-2" onClick={()=>{sessionStorage.removeItem(`integra-attendance-review:${fixture.board.period.id}`);sessionStorage.removeItem(`integra-bulk-days:${fixture.board.period.id}`);previewState.drafts=[];previewState.approved=false;setKey(k=>k+1);}}>Reset empty case</button><button className="min-h-11 rounded border p-2" onClick={()=>{previewState.interruptApproval=true;}}>Interrupt next approval response</button><button className="min-h-11 rounded border p-2" onClick={()=>{previewState.interruptSchedule=true;}}>Interrupt next schedule response</button></div>{view==="Attendance"?<AttendanceWorkbench key={key} initial={fixture.board}/>:<><PaymentReview runId="fictional-run" status="Posted" onGenerated={async()=>{}}/><PayrollArtifacts runId="fictional-run" artifacts={artifacts}/></>}</main>;
}
createRoot(document.getElementById("root")!).render(<Preview/>);

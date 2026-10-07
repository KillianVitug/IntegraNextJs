"use client";
import { useState } from "react";
import { PayrollDownloadLink } from "./PaymentReview";

type Artifact = {id:string;kind:string;status:string;fileName:string|null;generatedAt:string|null;metadata:Record<string,unknown>|null};
export function PayrollArtifacts({artifacts,runId}:{artifacts:Artifact[];runId:string|null}) {
 const [search,setSearch]=useState(""),[limit,setLimit]=useState(20);
 const payslips=artifacts.filter(a=>a.kind==="Payslip");
 const matching=payslips.filter(a=>`${a.fileName??""} ${a.metadata?.employeeName??""}`.toLowerCase().includes(search.toLowerCase()));
 function item(a:Artifact){return <li key={a.id} className="min-w-0 space-y-1 rounded border p-3 text-sm"><p className="font-semibold">{a.kind} · {a.status}</p><p className="break-all">{a.fileName??"Unnamed output"}</p>{a.generatedAt&&<p className="text-xs text-muted-foreground">{new Date(a.generatedAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"})}</p>}{runId&&["BankFile","CashPayrollList","Payslip"].includes(a.kind)&&<PayrollDownloadLink url={`/api/payroll/output?runId=${runId}&format=${a.kind==="Payslip"?"payslips":"payment"}&artifactId=${a.id}${a.kind==="Payslip"&&typeof a.metadata?.employeeId==="string"?`&employeeId=${a.metadata.employeeId}`:""}`}>Download {a.kind==="Payslip"?"payslip":"payment list"}</PayrollDownloadLink>}</li>;}
 return <section aria-label="Generated outputs" className="min-w-0 space-y-3 rounded-lg border p-4">
  <h2 className="text-lg font-semibold">Generated outputs</h2>
  <ul className="space-y-2">{artifacts.filter(a=>a.kind!=="Payslip").map(item)}</ul>
  {!!payslips.length&&<details><summary className="min-h-11 cursor-pointer py-3 font-semibold">Employee payslips · {payslips.length}</summary><p className="mb-2 text-sm">The full PDF above includes every employee. Find one payslip here.</p><label className="text-sm">Find payslip<input className="my-2 block min-h-11 w-full min-w-0 rounded border bg-background p-2" value={search} placeholder="Employee number or filename" onChange={e=>{setSearch(e.target.value);setLimit(20);}}/></label><p role="status" className="text-xs">Showing {Math.min(limit,matching.length)} of {matching.length}</p><ul className="my-2 space-y-2">{matching.slice(0,limit).map(item)}</ul>{matching.length>limit&&<button className="min-h-11 rounded border px-3" onClick={()=>setLimit(n=>n+20)}>Show 20 more payslips</button>}{!matching.length&&<p>No payslips match this search.</p>}</details>}
  {!artifacts.length&&<p className="text-sm">No outputs generated yet.</p>}
 </section>;
}

export function artifactKindLabel(kind:string) {return kind === "BankBatch" ? "Bank Batch" : kind === "CashBatch" ? "Cash Batch" : kind === "GLJournal" ? "GL Journal" : kind;}

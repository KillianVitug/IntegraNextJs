import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CalculationLines } from "@/app/(ntg)/payroll/provisional/calculation-lines";
import type { ProvisionalLine } from "@/lib/payroll/provisionalTypes";

// Fictional component fixture: no database, authentication or payroll actions.
export const sampleCalculationLines: ProvisionalLine[] = [
  {code:"1-100",description:"Regular Hours",lineType:"Earning",quantity:8,rate:75,amount:600,details:{scope:"day",workDate:"2026-10-08",quantityMinutes:480,quantityUnit:"hours",notes:[],formula:{quantityMinutes:480,hourlyRate:75}}},
  {code:"1-100",description:"Regular Hours",lineType:"Earning",quantity:7.67,rate:75,amount:575,details:{scope:"day",workDate:"2026-10-07",quantityMinutes:460,quantityUnit:"hours",notes:[],formula:{quantityMinutes:460,hourlyRate:75}}},
  {code:"6-302",description:"Tardiness",lineType:"Deduction",quantity:0.33,rate:0,amount:0,details:{scope:"day",workDate:"2026-10-07",quantityMinutes:20,quantityUnit:"hours",actualLateMinutes:20,penaltyMinutes:0,notes:["Already reflected in regular pay; no additional deduction."]}},
  {code:"1-200",description:"Overtime",lineType:"Earning",quantity:0.5,rate:93.75,amount:46.88,details:{scope:"day",workDate:"2026-10-08",quantityMinutes:30,quantityUnit:"hours",notes:["Approved overtime."],formula:{quantityMinutes:30,hourlyRate:93.75}}},
  {code:"SSS",description:"SSS Employee Share",lineType:"Deduction",amount:387.5,details:{scope:"period",startDate:"2026-10-01",endDate:"2026-10-15",notes:[]}},
  {code:"ADJ",description:"Manual adjustment",lineType:"Earning",amount:-25,details:{scope:"period",notes:["Administrator's saved amount."]}},
  {code:"SSS-ER",description:"SSS Employer Share",lineType:"Employer Contribution",amount:775,details:{scope:"period",notes:[]}},
];

function Preview() {
  const [width,setWidth]=useState(720), [before,setBefore]=useState(false), [forecast,setForecast]=useState(false), [empty,setEmpty]=useState(false), [opened,setOpened]=useState("");
  const lines = empty ? [] : forecast ? [...sampleCalculationLines,{...sampleCalculationLines[0],details:{...sampleCalculationLines[0].details!,workDate:"2026-10-10",projected:true}}] : sampleCalculationLines;
  return <main className="space-y-4 p-3">
    <header><h1 className="text-xl font-semibold">Calculation details · fictional verification</h1><p className="text-sm">Actual display component; no payroll or attendance changes.</p></header>
    <div className="flex flex-wrap gap-2">{[320,390,720].map(value=><button key={value} className="min-h-11 rounded border px-3" onClick={()=>setWidth(value)}>{value}px</button>)}<button className="min-h-11 rounded border px-3" onClick={()=>setBefore(value=>!value)}>{before?"Show new view":"Show previous view"}</button><button className="min-h-11 rounded border px-3" onClick={()=>setForecast(value=>!value)}>{forecast?"Recorded":"Forecast"}</button><button className="min-h-11 rounded border px-3" onClick={()=>setEmpty(value=>!value)}>{empty?"Show entries":"Empty example"}</button></div>
    <p role="status">{opened ? `Opened attendance for fictional employee on ${opened}` : "No attendance selected"}</p>
    <article aria-label="Calculation panel" style={{width,maxWidth:"100%"}} className="rounded-lg border p-3">
      <h2 className="mb-3 font-semibold">{forecast?"Forecast":"Recorded"} calculation and deductions</h2>
      {before ? <ul className="divide-y">{lines.map((line,index)=><li key={index} className="flex justify-between gap-4 py-2 text-sm"><span>{line.description}<small className="block text-muted-foreground">{line.code} · {line.lineType}{line.quantity!=null?` · ${line.quantity} × ₱${line.rate?.toFixed(2)}`:""}</small></span><span>₱{line.amount.toFixed(2)}</span></li>)}</ul> : <CalculationLines lines={lines} period={{startDate:"2026-10-01",endDate:"2026-10-15"}} asOfDate="2026-10-09" scenario={forecast?"forecast":"recorded"} availableWorkDates={["2026-10-07","2026-10-08","2026-10-10"]} onOpenDay={setOpened}/>}
    </article>
  </main>;
}
if (typeof document !== "undefined") createRoot(document.getElementById("root")!).render(<Preview/>);

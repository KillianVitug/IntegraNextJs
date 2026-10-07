"use client";
import { useEffect, useState } from "react";
export function CalculationStatus({startedAt,busy,checking=false,onCheck}:{startedAt:number;busy:boolean;checking?:boolean;onCheck:()=>void}) {
 const [elapsed,setElapsed]=useState(0);
 useEffect(()=>{const tick=()=>setElapsed(Math.max(0,Math.floor((Date.now()-startedAt)/1000)));tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);},[startedAt]);
 return <div className="space-y-2 rounded-lg border p-3 text-sm"><strong role="status">{checking?"Checking the saved calculation receipt…":busy?"Checking inputs, calculating payroll and saving the result…":"Calculation outcome needs checking"}</strong><p>{elapsed}s since this request began. Elapsed time is not a completion estimate. Your request is retained if you leave this page.</p>{!busy&&<button type="button" className="min-h-11 rounded border px-3 py-2 font-semibold" onClick={onCheck}>Check calculation status</button>}</div>;
}

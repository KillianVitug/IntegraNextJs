"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { payrollRead } from "@/lib/payroll/readClient";
export function useAttendanceView<T>(view:string,periodId:string,enabled:boolean,revision=0) {
 const [data,setData]=useState<T|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0);
 const retry=useCallback(()=>setAttempt(n=>n+1),[]);
 useEffect(()=>{
  if(!enabled)return;
  const controller=new AbortController();setLoading(true);setError("");
  payrollRead<T>(view,{periodId},controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:"Unable to load this view.");}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[view,periodId,enabled,revision,attempt]);
 return {data,error,loading,retry};
}
export function AttendanceReadStatus({error,loading,retry}:{error:string;loading:boolean;retry:()=>void}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(error)ref.current?.focus({preventScroll:true});},[error]);
 return error?<div ref={ref} role="alert" tabIndex={-1} className="my-3 rounded border border-red-400 bg-red-50 p-3 text-slate-900"><p>{error}</p><button className="mt-2 min-h-11 rounded border px-3 py-2 text-sm font-semibold" onClick={retry}>Retry loading this view</button></div>:loading?<p role="status" className="my-3 text-sm">Loading this view…</p>:null;
}

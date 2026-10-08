"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function AttendanceRouteRedirect() {
 const router=useRouter();
 useEffect(()=>{
  const url=new URL(window.location.href);
  const sourceAnchor=["#employee-matching","#obvious-duplicates","#duplicate-review-tools","#reconcile-title","#sync-history"].includes(url.hash);
  url.pathname=sourceAnchor?"/payroll/attendance-sources":"/payroll/attendance-batch";
  if(["#progress","#history","#progress-history"].includes(url.hash))url.searchParams.set("view","history");
  router.replace(url.pathname+url.search+url.hash);
 },[router]);
 return <p role="status" className="p-6">Opening attendance workspace…</p>;
}

/** Read requests bypass the Server Action mutation queue and never retry writes. */
export async function payrollRead<T>(view:string,params:Record<string,string>,signal?:AbortSignal):Promise<T> {
 const timeout=AbortSignal.timeout(30000);
 const response=await fetch(`/api/payroll/read?${new URLSearchParams({view,...params})}`,{
  cache:"no-store",credentials:"same-origin",signal:signal?AbortSignal.any([signal,timeout]):timeout,
 });
 if(!response.ok) {
  const body=await response.json().catch(()=>null);
  throw new Error(body?.error??"This view could not be loaded. Your inputs are retained. Try loading it again.");
 }
 return response.json() as Promise<T>;
}

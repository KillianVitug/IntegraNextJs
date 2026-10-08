import { findComputeReceipt } from "@/lib/payroll/computeReceipt";
import { getCurrentAuthContext, hasPermission } from "@/lib/auth/server";
import { AUTH_PERMISSIONS } from "@/lib/auth/permissions";
import { db } from "@/db";
import { desc, eq } from "drizzle-orm";
import { attendanceSourceRuns } from "@/db/attendanceSourceSchema";
import { loadWorkBoard, workEmployees, workbenchEnabled } from "@/lib/payroll/attendanceWorkbench";
import { loadWorkProgress } from "@/lib/payroll/attendanceWorkProgress";
import { loadAttendanceReadiness } from "@/lib/payroll/attendanceResolution";
import { loadMatchBoard } from "@/lib/payroll/attendanceIdentityWorkflow";
import { loadDuplicateBoard } from "@/lib/payroll/attendanceDuplicates";
import { preflightPayroll } from "@/lib/payroll/control";
import { attendanceSourceEnabled } from "@/lib/payroll/attendanceSourceSync";
import { PayrollValidationError } from "@/lib/payroll/validation";

export const dynamic="force-dynamic";
export const maxDuration=60;
const headers={"Cache-Control":"private, no-store"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request:Request) {
 const auth=await getCurrentAuthContext();
 if(!auth)return Response.json({error:"Sign in again to load payroll. Your draft is retained."},{status:401,headers});
 const params=new URL(request.url).searchParams,view=params.get("view"),periodId=params.get("periodId")??"";
 if(auth.role!=="ADMIN"||["preflight","compute-receipt"].includes(view??"")&&!hasPermission(auth,AUTH_PERMISSIONS.PAYROLL_COMPUTE))return Response.json({error:"You do not have access to this payroll view."},{status:403,headers});
 if(!uuid.test(periodId))return Response.json({error:"Select a valid payroll period."},{status:400,headers});
 if(!["preflight","compute-receipt"].includes(view??"")&&!attendanceSourceEnabled())return Response.json({error:"Attendance connection is disabled."},{status:404,headers});
 if(["workbench","progress","employee"].includes(view??"")&&!workbenchEnabled())return Response.json({error:"Attendance review is disabled."},{status:404,headers});
 try {
  let result:unknown;
  switch(view) {
   case "compute-receipt": {
    const group=params.get("group"),requestId=params.get("requestId")??"";
    if(!["Daily","Monthly"].includes(group??"")||!uuid.test(requestId))return Response.json({error:"Select a valid calculation request."},{status:400,headers});
    result=await findComputeReceipt(auth.accountId,{requestId,periodId,group:group as "Daily"|"Monthly",bypass:params.get("bypass")==="true"});break;
   }
   case "workbench": result=await loadWorkBoard(periodId);break;
   case "progress": result=await loadWorkProgress(periodId);break;
   case "employee": {
    const employeeId=params.get("employeeId")??"";
    if(!uuid.test(employeeId))return Response.json({error:"Select an employee."},{status:400,headers});
    result=(await workEmployees(periodId,db,undefined,undefined,employeeId))[0]??null;break;
   }
   case "readiness": result=await loadAttendanceReadiness(periodId);break;
   case "sync-history": result=await db.select({id:attendanceSourceRuns.id,state:attendanceSourceRuns.state,startedAt:attendanceSourceRuns.startedAt,completedAt:attendanceSourceRuns.completedAt,counts:attendanceSourceRuns.counts,error:attendanceSourceRuns.error}).from(attendanceSourceRuns).where(eq(attendanceSourceRuns.payrollPeriodId,periodId)).orderBy(desc(attendanceSourceRuns.startedAt)).limit(30);break;
   case "matching": result=await loadMatchBoard(db);break;
   case "duplicates": result=await loadDuplicateBoard(periodId);break;
   case "preflight":
    if(!["Daily","Monthly"].includes(params.get("group")??""))return Response.json({error:"Select a payroll group."},{status:400,headers});
    result=await preflightPayroll(periodId,{payrollGroup:params.get("group") as "Daily"|"Monthly",persist:false,bypassTemporaryReadinessCategories:params.get("bypass")==="true"});break;
   default:return Response.json({error:"Unknown payroll view."},{status:400,headers});
  }
  return Response.json(result,{headers});
 }catch(error) {
  return Response.json({error:error instanceof PayrollValidationError?error.message:"This payroll view could not be loaded. Your inputs are retained. Retry loading this view."},{status:503,headers});
 }
}

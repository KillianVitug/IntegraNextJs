import "server-only";
import { and, eq } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { adminAuditEvents } from "@/db/schema";
import { recordAdminAuditEvent } from "@/lib/admin";
import { PayrollValidationError } from "./validation";

export type ComputeRequest={requestId:string;periodId:string;group:"Daily"|"Monthly";bypass:boolean};
export function validateComputeRequest(request:ComputeRequest) {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.requestId))throw new PayrollValidationError("Invalid calculation request. Reload payroll.");
 return request;
}
export async function findComputeReceipt(actor:string,request:ComputeRequest,database:DbClient=db) {
 validateComputeRequest(request);
 const [row]=await database.select({details:adminAuditEvents.details}).from(adminAuditEvents).where(and(eq(adminAuditEvents.actorUserId,actor),eq(adminAuditEvents.action,"payroll.compute_receipt"),eq(adminAuditEvents.entityId,request.requestId))).limit(1);
 if(!row?.details)return null;
 const details=JSON.parse(row.details) as Record<string,unknown>;
 if(details.periodId!==request.periodId||details.group!==request.group||details.bypass!==request.bypass)throw new PayrollValidationError("This calculation request belongs to different payroll inputs. Check its saved result.");
 return {runId:String(details.runId),computedAt:String(details.computedAt),requestId:request.requestId};
}
export async function recordComputeReceipt(actor:string,request:ComputeRequest,runId:string,database:DbClient) {
 await recordAdminAuditEvent({actorUserId:actor,entityType:"payroll_calculation_request",entityId:request.requestId,action:"payroll.compute_receipt",details:{...request,runId,computedAt:new Date().toISOString()},database});
}

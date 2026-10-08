import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { payrollPeriods, adminAuditEvents } from "@/db/schema";
import { attendanceDuplicatePolicy as policies, attendanceDuplicateChecks as checks, attendanceResolutions as resolutions } from "@/db/attendanceSourceSchema";
import { duplicateCandidates, type DuplicateBoard, type DuplicatePolicy, type DuplicateMode } from "./attendanceDuplicateModel";
import { resolutionPeople } from "./attendanceResolution";
import { lockAttendancePayrollInput } from "./attendanceSourceGuard";
import { type SourcePunch } from "./attendanceSourceClient";
import { rejectAttendanceSourceMutation } from "./attendanceSourceReadOnly";
import { PayrollValidationError } from "./validation";

type Metadata={kept:SourcePunch;removed:SourcePunch[];automatic:boolean;ruleVersion:string;groupId:string;impactedPeriodIds:string[];undoOf?:string};
function fail(message:string):never { throw new PayrollValidationError(message); }
async function policy(database:DbClient):Promise<DuplicatePolicy> {
 const [row]=await database.select().from(policies).where(eq(policies.id,"global"));
 return {mode:(row?.mode==="Automatic"?"Suggest":row?.mode??"Suggest") as DuplicateMode,revision:row?.revision??"unconfigured",enabledAfter:row?.enabledAfter?.toISOString()??null};
}
export async function loadDuplicateBoard(periodId:string,database:DbClient=db):Promise<DuplicateBoard> {
 const [period]=await database.select().from(payrollPeriods).where(eq(payrollPeriods.id,periodId));if(!period)fail("Select a payroll period.");
 const settings=await policy(database),people=await resolutionPeople(database,{id:period.id,startDate:period.startDate,endDate:period.endDate});
 const history=await database.select().from(resolutions).where(and(eq(resolutions.payrollPeriodId,periodId),sql`${resolutions.duplicateMetadata} IS NOT NULL`)).orderBy(desc(resolutions.createdAt)).limit(100);
 const candidates=settings.mode==="Off"?[]:people.flatMap(p=>duplicateCandidates(p.records,period.startDate,period.endDate,settings,{verified:!!p.employeeId&&p.classification!=="TestOnly",conflictingDecision:!!p.resolution,version:p.version}));
 const outcomes=await database.select().from(checks).where(eq(checks.payrollPeriodId,periodId));
 for(const c of candidates){const check=outcomes.find(r=>r.keptEventId===c.id&&r.sourceVersion===c.version&&r.policyRevision===settings.revision);if(check)c.warnings.push(`Last automatic check: ${check.result}`);}
 return {policy:settings,candidates,history:history.map(r=>{const m=r.duplicateMetadata as Metadata;return {id:r.id,state:r.state,automatic:m.automatic,ruleVersion:m.ruleVersion,actor:r.reviewerUserId??r.actorUserId,groupId:m.groupId,restored:!!m.undoOf,reason:r.reason,kept:m.kept,removed:m.removed,createdAt:r.createdAt.toISOString(),result:r.result,canUndo:false};})};
}
export async function setDuplicatePolicy(tx:DbClient,actor:string,mode:DuplicateMode,revision:string,confirmed:boolean) {
 if(mode==="Automatic")rejectAttendanceSourceMutation();
 if(!["Off","Suggest"].includes(mode)||!confirmed)fail("Review and confirm the duplicate policy before saving.");
 await lockAttendancePayrollInput(tx);const before=await policy(tx);if(before.revision!==revision)fail("The policy changed. Refresh and review again.");
 const after={mode,revision:randomUUID(),enabledAfter:null,actorUserId:actor,updatedAt:new Date()};
 await tx.insert(policies).values({id:"global",...after}).onConflictDoUpdate({target:policies.id,set:after});
 await tx.insert(adminAuditEvents).values({actorUserId:actor,entityType:"attendance_duplicate_policy",entityId:"global",action:"attendance.duplicate_policy",details:JSON.stringify({before,after})});
}
/** Legacy source-void APIs are retired. Current day review creates local overrides. */
export async function approveDuplicateBatch(periodId:string,selection:{id:string;version:string}[],reason:string,confirmed:boolean,actor:string,automatic=false,database=db,fetcher:typeof fetch=fetch):Promise<{ids:string[];message:string}> {
 void [periodId,selection,reason,confirmed,actor,automatic,database,fetcher];
 rejectAttendanceSourceMutation();
}
export async function undoDuplicate(id:string,reason:string,actor:string,database=db,fetcher:typeof fetch=fetch):Promise<string> {
 void [id,reason,actor,database,fetcher];
 rejectAttendanceSourceMutation();
}
/** Retain imported original captures; automatic duplicate handling is suggestion-only. */
export async function processAutomaticDuplicates(periodId:string,actor:string,database=db,fetcher:typeof fetch=fetch) {
 void [periodId,actor,database,fetcher];
 return 0;
}

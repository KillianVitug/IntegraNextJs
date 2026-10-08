import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { workPlans, workBatches, workHistory, adjustmentCases } from "@/db/attendanceWorkbenchSchema";
import { authAccounts, authAccountPermissionGroups, authPermissionGroups, employees, employeesGeneralInfo } from "@/db/schema";
import { getAppRoleForGroups, getDefaultGroupForConfidentialityLevel, isAuthGroupKey } from "@/lib/auth/permissions";
import { classifyWorkPlans, type WorkDraft, type WorkProgress } from "./attendanceWorkbenchModel";

export async function loadWorkPlanViews(periodId:string,database:DbClient=db) {
 const [plans,batches,approvals]=await Promise.all([
  database.select().from(workPlans).where(eq(workPlans.periodId,periodId)).orderBy(desc(workPlans.updatedAt)),
  database.select().from(workBatches).where(eq(workBatches.periodId,periodId)),
  database.select({planId:workHistory.planId,at:workHistory.createdAt}).from(workHistory).innerJoin(workPlans,eq(workPlans.id,workHistory.planId)).where(and(eq(workPlans.periodId,periodId),eq(workHistory.action,"Approved"))).orderBy(desc(workHistory.createdAt)),
 ]);
 return classifyWorkPlans(plans.map(p=>{
  const cutover=(p.sourceResult as {readOnlyCutover?:{localApproved?:boolean}}|null)?.readOnlyCutover;
  // A retained historical request is audit evidence, not a local approval.
  const approved=cutover?cutover.localApproved===true:!!p.sourceRequest||["Approved","Applying","Sync pending","Resolved","Source conflict"].includes(p.state);
  return {id:p.id,batchId:p.batchId,revision:batches.find(b=>b.id===p.batchId)?.revision??0,state:p.state,draft:p.draft as WorkDraft,result:p.result,approved,approvedAt:approvals.find(a=>a.planId===p.id)?.at.toISOString(),updatedAt:p.updatedAt.toISOString()};
 }));
}

async function reviewOwners(database:DbClient) {
 const [accounts,assigned]=await Promise.all([
  database.select({id:authAccounts.id,name:employees.firstName,level:employeesGeneralInfo.confidentialityLevel}).from(authAccounts).innerJoin(employees,eq(authAccounts.employeeId,employees.id)).leftJoin(employeesGeneralInfo,eq(employeesGeneralInfo.employeeId,employees.id)).where(and(eq(authAccounts.status,"Active"),isNull(employees.deletedAt))),
  database.select({accountId:authAccountPermissionGroups.accountId,key:authPermissionGroups.key}).from(authAccountPermissionGroups).innerJoin(authPermissionGroups,eq(authPermissionGroups.id,authAccountPermissionGroups.groupId)),
 ]);
 return accounts.filter(a=>{
  const keys=assigned.filter(g=>g.accountId===a.id).map(g=>g.key).filter(isAuthGroupKey),fallback=getDefaultGroupForConfidentialityLevel(a.level);
  return getAppRoleForGroups(keys.length?keys:fallback?[fallback]:[])==="ADMIN";
 }).map(({id,name})=>({id,name}));
}

/** Progress reads never rebuild every employee's schedule and attendance. */
export async function loadWorkProgress(periodId:string,database:DbClient=db):Promise<WorkProgress> {
 const [plans,adjustments,history,owners]=await Promise.all([
  loadWorkPlanViews(periodId,database),
  database.select().from(adjustmentCases).where(eq(adjustmentCases.periodId,periodId)),
  database.select({id:workHistory.id,planId:workHistory.planId,action:workHistory.action,actor:workHistory.actor,at:workHistory.createdAt}).from(workHistory).innerJoin(workPlans,eq(workPlans.id,workHistory.planId)).where(eq(workPlans.periodId,periodId)).orderBy(desc(workHistory.createdAt)).limit(300),
  reviewOwners(database),
 ]);
 return {plans,owners,history:history.map(h=>({...h,at:h.at.toISOString()})),adjustments:adjustments.map(a=>({id:a.id,employeeId:a.employeeId,periodId:a.periodId,state:a.state,impact:a.impact,reference:a.adjustmentReference,conclusion:a.conclusion}))};
}

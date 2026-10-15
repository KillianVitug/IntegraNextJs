import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { applyScheduleOperationRequest, cancelScheduleOperationRequest, confirmScopedScheduleDays, mutatePeriodSchedule, readScheduleDayHistory, readScheduleDayOperations, readScheduleReceipt, readScheduleWorkspace, saveWeeklySchedules, submitScheduleDayOperation, type ScheduleActor } from "@/lib/scheduling/service";
import { emptySchedule, retainRestDesignation } from "@/lib/scheduling/model";
import { isResolvedScheduleRestDay, resolveEmployeeScheduleForDate } from "@/lib/payroll/scheduleResolver";
import { summarizeEmployeeDay, type ParsedAttendanceLog } from "@/lib/payroll/attendance";
import type { ScheduleDayOperationCommand, SchedulePeriodCommand } from "@/lib/scheduling/workspace-types";
import { freshScheduleDatabase } from "./attendanceTest/freshScheduleDatabase";

/** Actual service/storage paths on a new fictional in-memory database. No private or network data. */
async function main() {
  const {pg,database,client,transactional}=await freshScheduleDatabase();
  const checks:string[]=[];
  try {
    const [branch,other]=await database.insert(s.department).values([{code:"OPS",name:"Fictional operations"},{code:"OTHER",name:"Other fictional branch"}]).returning();
    const people=await database.insert(s.employees).values(["Alice","Bob","Carol","Dave","Erin","Manager","Admin","Outside"].map(name=>({employeeNo:`FIX-${name}`,firstName:name,lastName:"Fiction"}))).returning();
    const [alice,bob,carol,dave,erin,managerPerson,adminPerson,outside]=people;
    await database.insert(s.employeesGeneralInfo).values(people.map((person,index)=>({employeeId:person.id,departmentId:index<5?branch.id:other.id,dateHired:"2020-01-01",confidentialityLevel:"Rank and File" as const})));
    const [managerAccount,adminAccount]=await database.insert(s.authAccounts).values([managerPerson,adminPerson].map(person=>({employeeId:person.id,email:`${person.firstName}@example.invalid`,status:"Active" as const}))).returning();
    const groups=await database.insert(s.authPermissionGroups).values([{key:"MANAGER",name:"Manager"},{key:"SYSTEM_ADMIN",name:"System Admin"}]).returning();
    await database.insert(s.authAccountPermissionGroups).values([{accountId:managerAccount.id,groupId:groups[0].id},{accountId:adminAccount.id,groupId:groups[1].id}]);
    await database.insert(s.authManagerDepartments).values({accountId:managerAccount.id,departmentId:branch.id});
    const manager:ScheduleActor={userId:managerAccount.id,role:"MANAGER"},admin:ScheduleActor={userId:adminAccount.id,role:"ADMIN"};
    const [period]=await database.insert(s.payrollPeriods).values({code:"FIX-2098-A",year:2098,month:10,cycle:"A",payrollTerms:"Semi-Monthly",startDate:"2098-10-10",endDate:"2098-10-15",nominalPayDate:"2098-10-20",adjustedPayDate:"2098-10-20",status:"Open"}).returning();
    const [morning,late,long,night]=await database.insert(s.shiftTables).values([
      {code:"DAY",description:"Fictional day",regularStartTime:"08:00",regularEndTime:"16:00"},
      {code:"LATE",description:"Fictional late",regularStartTime:"12:00",regularEndTime:"20:00"},
      {code:"LONG",description:"Fictional long",regularStartTime:"08:00",regularEndTime:"18:00"},
      {code:"NIGHT",description:"Fictional night",regularStartTime:"22:00",regularEndTime:"06:00"},
    ].map(row=>({...row,calculationPolicy:"eight_hour_day" as const,punchPolicy:"outer" as const}))).returning();
    const day="2098-10-10",query={departmentId:branch.id,periodId:period.id};
    const periodInput=async(changes:SchedulePeriodCommand["changes"]):Promise<SchedulePeriodCommand>=>{
      const workspace=await readScheduleWorkspace(admin,query,client);
      return {requestId:randomUUID(),departmentId:branch.id,periodId:period.id,sourceDigest:workspace.sourceDigest,expectedDraftId:workspace.draft?.id??null,expectedDraftRevision:workspace.draft?.revision??null,changes};
    };
    await confirmScopedScheduleDays(admin,await periodInput([{employeeId:alice.id,day,value:String(morning.id)},{employeeId:bob.id,day,value:String(late.id)},{employeeId:carol.id,day,value:"rest"}]),transactional);
    const restReselect=await confirmScopedScheduleDays(manager,await periodInput([{employeeId:carol.id,day,value:"rest"}]),transactional);
    assert.equal(restReselect.outcome,"applied","Reselecting a nonworking rest day is not a rest-work request");
    const command=async(employeeId:string,operation:ScheduleDayOperationCommand["operation"],extras:Partial<ScheduleDayOperationCommand>={}):Promise<ScheduleDayOperationCommand>=>{
      const context=await readScheduleDayOperations(manager,{employeeId,day,periodId:period.id},client);
      return {requestId:randomUUID(),departmentId:branch.id,periodId:period.id,sourceDigest:context.sourceDigest,expectedDraftId:context.expectedDraftId,expectedDraftRevision:context.expectedDraftRevision,employeeId,day,operation,...extras};
    };
    const assignments=()=>database.select().from(s.employeeShiftAssignments).orderBy(s.employeeShiftAssignments.id);
    const aliceBefore=(await assignments()).filter(row=>row.employeeId===alice.id);
    const change=await command(alice.id,"adjust",{value:String(late.id)}),saved=await submitScheduleDayOperation(manager,change,transactional);
    assert.equal(saved.outcome,"applied");assert.equal(saved.changedCount,1);
    assert.deepEqual(await submitScheduleDayOperation(manager,change,transactional),saved);
    await assert.rejects(submitScheduleDayOperation(manager,{...change,note:"Changed request content"},transactional),/request ID/);
    let history=await readScheduleDayHistory(manager,{employeeId:alice.id,day,periodId:period.id},client);
    assert.equal(history.entries[0].actorName,"Manager Fiction");
    assert.equal(history.entries[0].actorRole,"Manager");assert.equal(history.entries[0].before.checkInTime?.slice(0,5),"08:00");assert.equal(history.entries[0].after.checkInTime?.slice(0,5),"12:00");
    assert.equal(history.entries[0].note,undefined);assert.equal(aliceBefore.length,1);
    checks.push("one-day save, immutable before/after/actor history, no mandatory note, request replay and changed-input rejection");

    const prior=await assignments();
    await assert.rejects(submitScheduleDayOperation(manager,await command(alice.id,"cover",{replacementEmployeeId:outside.id}),transactional),/unavailable/);
    assert.deepEqual(await assignments(),prior);
    const cover=await command(alice.id,"cover",{replacementEmployeeId:dave.id,note:"Cover colleague"});
    const coverReceipt=await submitScheduleDayOperation(manager,cover,transactional);
    assert.equal(coverReceipt.changedCount,1);assert.equal(coverReceipt.operation,"cover");
    assert.deepEqual((await assignments()).filter(row=>row.employeeId===alice.id),prior.filter(row=>row.employeeId===alice.id),"Coverage never rewrites the absent employee's assignment");
    assert.equal((await readScheduleDayHistory(manager,{employeeId:alice.id,day},client)).entries[0].operation,"cover");
    checks.push("out-of-scope pair rejection; coverage changes replacement only and links both histories");

    await confirmScopedScheduleDays(admin,await periodInput([{employeeId:bob.id,day,value:String(morning.id)}]),transactional);
    const beforeSwap=await assignments();
    const swap=await command(alice.id,"swap",{replacementEmployeeId:bob.id});
    await submitScheduleDayOperation(manager,swap,transactional);
    const afterSwap=await assignments();
    assert.equal(afterSwap.find(row=>row.employeeId===alice.id)!.checkInTime,beforeSwap.find(row=>row.employeeId===bob.id)!.checkInTime);
    assert.equal(afterSwap.find(row=>row.employeeId===bob.id)!.checkInTime,beforeSwap.find(row=>row.employeeId===alice.id)!.checkInTime);
    const stale=await command(alice.id,"adjust",{value:String(late.id)});
    await confirmScopedScheduleDays(admin,await periodInput([{employeeId:dave.id,day,value:String(morning.id)}]),transactional);
    await assert.rejects(submitScheduleDayOperation(manager,stale,transactional),/changed/);
    checks.push("atomic same-day swap and stale baseline refusal");

    const [leave]=await database.insert(s.employeesLeaveRecords).values({employeeId:alice.id,dateFiled:day,leaveStartDate:day,leaveEndDate:day,leaveType:"SL",noOfDays:"1.00",leaveStatus:"Approved",reason:"PRIVATE leave reason"}).returning();
    await submitScheduleDayOperation(manager,await command(alice.id,"cover",{replacementEmployeeId:dave.id}),transactional);
    await database.update(s.employeesLeaveRecords).set({employeeId:bob.id}).where(eq(s.employeesLeaveRecords.id,leave.id));
    const blockedPair=await assignments();
    await assert.rejects(submitScheduleDayOperation(manager,await command(alice.id,"swap",{replacementEmployeeId:bob.id}),transactional),/approved leave/);
    assert.deepEqual(await assignments(),blockedPair);
    await database.delete(s.employeesLeaveRecords).where(eq(s.employeesLeaveRecords.id,leave.id));
    checks.push("source leave survives coverage; replacement leave blocks both sides atomically");

    const [pendingLeave]=await database.insert(s.employeesLeaveRecords).values({employeeId:dave.id,dateFiled:day,leaveStartDate:day,leaveEndDate:day,leaveType:"SL",noOfDays:"1.00",leaveStatus:"Pending"}).returning();
    const transferRequest=await submitScheduleDayOperation(manager,await command(alice.id,"cover",{replacementEmployeeId:dave.id}),transactional);
    assert.equal(transferRequest.outcome,"pending-review","Coverage rechecks availability even when the replacement already has identical hours");
    await database.update(s.employeesGeneralInfo).set({departmentId:other.id}).where(eq(s.employeesGeneralInfo.employeeId,dave.id));
    const transferredHistory=await readScheduleDayHistory(manager,{employeeId:alice.id,day},client),transferredRequest=transferredHistory.requests.find(row=>row.id===transferRequest.requestId)!;
    assert.equal(transferredRequest.canCancel,false);assert.doesNotMatch(JSON.stringify(transferredRequest),/Dave|pending leave/i);assert.match(transferredRequest.reasons[0],/current branch scope/);
    await database.update(s.employeesGeneralInfo).set({departmentId:branch.id}).where(eq(s.employeesGeneralInfo.employeeId,dave.id));
    await cancelScheduleOperationRequest(manager,transferRequest.requestId,transactional);
    await database.delete(s.employeesLeaveRecords).where(eq(s.employeesLeaveRecords.id,pendingLeave.id));
    checks.push("identical-shift coverage still checks availability and transferred linked employee reasons are redacted");

    const [run]=await database.insert(s.payrollRuns).values({payrollPeriodId:period.id,runNumber:1,status:"Reviewed",inputSnapshot:{payrollGroup:"Daily"}}).returning();
    await database.insert(s.payrollRunEmployees).values({payrollRunId:run.id,employeeId:bob.id,employeeNoSnapshot:bob.employeeNo,employeeNameSnapshot:"Fictional reviewed employee"});
    const reviewedBefore=await assignments(),reviewedCommand=await command(bob.id,"adjust",{value:String(morning.id),note:"Optional reviewed context"});
    let pending=await submitScheduleDayOperation(manager,reviewedCommand,transactional);
    assert.equal(pending.outcome,"pending-review");assert.deepEqual(await assignments(),reviewedBefore);
    assert.equal((await database.select().from(s.payrollRuns))[0].status,"Reviewed");
    await assert.rejects(submitScheduleDayOperation(manager,await command(bob.id,"adjust",{value:String(morning.id)}),transactional),/pending schedule request/);
    assert.equal((await cancelScheduleOperationRequest(manager,pending.requestId,transactional)).outcome,"cancelled");
    assert.equal((await cancelScheduleOperationRequest(manager,pending.requestId,transactional)).outcome,"cancelled");
    const oldPath=await periodInput([{employeeId:bob.id,day,value:String(morning.id)}]);
    pending=await confirmScopedScheduleDays(manager,oldPath,transactional);assert.equal(pending.outcome,"pending-review");
    await assert.rejects(mutatePeriodSchedule(manager,await periodInput([{employeeId:bob.id,day,value:String(morning.id)}]),"confirmed",transactional),/already been reviewed/);
    await cancelScheduleOperationRequest(manager,pending.requestId,transactional);
    checks.push("reviewed manager edits are pending through both day endpoints; whole-period bypass blocked; cancel/retry and duplicate prevention");

    pending=await submitScheduleDayOperation(manager,await command(bob.id,"adjust",{value:String(morning.id)}),transactional);
    await confirmScopedScheduleDays(admin,await periodInput([{employeeId:bob.id,day,value:String(long.id)}]),transactional);
    const request=await database.query.managerScheduleChangeRequests.findFirst({where:eq(s.managerScheduleChangeRequests.id,pending.requestId)});
    await assert.rejects(database.transaction(tx=>applyScheduleOperationRequest(tx as unknown as typeof client,admin,request!)),/changed since this request/);
    await cancelScheduleOperationRequest(manager,pending.requestId,transactional);
    await database.update(s.payrollRuns).set({status:"Reviewed"}).where(eq(s.payrollRuns.id,run.id));
    pending=await submitScheduleDayOperation(manager,await command(bob.id,"adjust",{value:String(morning.id)}),transactional);
    const approve=async(id:string,options:Parameters<typeof applyScheduleOperationRequest>[3]={})=>database.transaction(async tx=>{
      const [row]=await tx.select().from(s.managerScheduleChangeRequests).where(eq(s.managerScheduleChangeRequests.id,id)).for("update");
      const result=await applyScheduleOperationRequest(tx as unknown as typeof client,admin,row,options);
      await tx.update(s.managerScheduleChangeRequests).set({status:"Approved",decidedByAccountId:admin.userId,decidedAt:new Date(),decisionNote:"PRIVATE ADMIN amount 999999"}).where(eq(s.managerScheduleChangeRequests.id,id));
      return result;
    });
    await approve(pending.requestId);
    assert.equal((await database.select().from(s.payrollRuns))[0].status,"Stale");
    assert.equal((await readScheduleReceipt(manager,pending.requestId,client))!.outcome,"approved");
    checks.push("Admin acceptance rejects stale proposed values and successful acceptance stales reviewed run without posting");

    const restBefore=await assignments(),restCommand=await command(alice.id,"cover",{replacementEmployeeId:carol.id});
    pending=await submitScheduleDayOperation(manager,restCommand,transactional);
    assert.equal(pending.outcome,"pending-review");assert.deepEqual(await assignments(),restBefore);
    await assert.rejects(approve(pending.requestId,{restWorkReviewed:true}),/evidence/);
    assert.deepEqual(await assignments(),restBefore);
    await approve(pending.requestId,{restWorkReviewed:true,restWorkBasis:"voluntary-written",restWorkEvidence:"Fictional written willingness reference QA-1"});
    const restAssignment=(await assignments()).find(row=>row.employeeId===carol.id)!;
    assert.equal(restAssignment.confirmedSchedule?.kind,"shift");assert.equal(restAssignment.confirmedSchedule?.designatedRestDay,true);
    const resolved=resolveEmployeeScheduleForDate({attendanceDate:day,assignments:[restAssignment],weeklyPatterns:[],legacyTimekeeping:null});
    assert.equal(isResolvedScheduleRestDay(resolved),true);assert.equal(resolved.shiftWindow.checkInTime?.slice(0,5),"08:00");
    const logs:ParsedAttendanceLog[]=[{direction:"IN",logTime:"08:00:00"},{direction:"OUT",logTime:"18:00:00"}].map((row,index)=>({...row,direction:row.direction as "IN"|"OUT",employeeNo:carol.employeeNo,logDate:day,loggedAt:new Date(`${day}T${row.logTime}+08:00`),sourceLine:index+1,rawText:"fictional"}));
    const summary=summarizeEmployeeDay(day,logs,resolved.shiftWindow);assert.equal(summary.isRestDay,true);assert.equal(summary.regularMinutes,0);assert.equal(summary.overtimeMinutes,120);
    const plain=retainRestDesignation(emptySchedule("unconfigured"),restAssignment.confirmedSchedule!);assert.notEqual(plain.designatedRestDay,true);
    const intermediate=retainRestDesignation(restAssignment.confirmedSchedule!,emptySchedule("unconfigured"));
    assert.equal(retainRestDesignation(intermediate,plain).designatedRestDay,true);
    checks.push("rest coverage requires specific evidence; approved work retains rest classification and two-hour OT; donor/intermediate bypass prevented");

    const restoreRest=await confirmScopedScheduleDays(manager,await periodInput([{employeeId:carol.id,day,value:"rest"}]),transactional);
    assert.equal(restoreRest.outcome,"applied","Restoring a nonworking rest day must not be treated as additional rest-day work");
    assert.equal((await assignments()).find(row=>row.employeeId===carol.id)!.confirmedSchedule?.kind,"rest");
    checks.push("reselecting and restoring a nonworking rest day does not require rest-work review");

    const safe=await readScheduleDayOperations(manager,{employeeId:carol.id,day},client);
    assert.doesNotMatch(JSON.stringify(safe),/PRIVATE ADMIN|999999|written willingness|passwordHash|@example/);
    await database.delete(s.authManagerDepartments).where(eq(s.authManagerDepartments.accountId,manager.userId));
    await assert.rejects(readScheduleDayHistory(manager,{employeeId:carol.id,day},client),/not assigned/);
    await assert.rejects(readScheduleReceipt(manager,pending.requestId,client),/scope/);
    await assert.rejects(submitScheduleDayOperation(manager,restCommand,transactional),/scope/);
    await database.insert(s.authManagerDepartments).values({accountId:manager.userId,departmentId:branch.id});
    checks.push("manager history/receipt projections omit private notes/evidence/emails and deny revoked scope including mutation replay");

    // A future adjacent shift belongs to another period; overlap checking still sees it.
    await database.insert(s.employeeShiftAssignments).values({employeeId:dave.id,shiftName:"Adjacent next day",effectiveFrom:"2098-10-11",effectiveTo:"2098-10-11",checkInTime:"05:00",checkOutTime:"13:00",hoursPerDay:"8.00",calculationPolicy:"eight_hour_day",punchPolicy:"outer"});
    await assert.rejects(submitScheduleDayOperation(manager,await command(dave.id,"adjust",{value:String(night.id)}),transactional),/overlap/);
    await database.update(s.payrollRuns).set({status:"Posted"}).where(eq(s.payrollRuns.id,run.id));
    await assert.rejects(submitScheduleDayOperation(manager,await command(bob.id,"adjust",{value:String(late.id)}),transactional),/Posted/);
    checks.push("overnight neighbor overlap and posted payroll are blocked");

    // An unconfirmed employee has no dated overrides to hide a reviewed weekly-default change.
    const [weeklyRun]=await database.insert(s.payrollRuns).values({payrollPeriodId:period.id,runNumber:2,status:"Reviewed",inputSnapshot:{payrollGroup:"Daily"}}).returning();
    await database.insert(s.payrollRunEmployees).values({payrollRunId:weeklyRun.id,employeeId:erin.id,employeeNoSnapshot:erin.employeeNo,employeeNameSnapshot:"Fictional weekly"});
    const ws=await readScheduleWorkspace(manager,query,client);
    await assert.rejects(saveWeeklySchedules(manager,{requestId:randomUUID(),departmentId:branch.id,sourceDigest:ws.weeklyDigest,effectiveFrom:day,effectiveTo:day,employeeIds:[erin.id],days:[{weekday:new Intl.DateTimeFormat("en-US",{timeZone:"UTC",weekday:"long"}).format(new Date(`${day}T12:00:00Z`)) as "Friday",value:String(morning.id)}]},transactional),/already been reviewed/);
    assert.equal((await database.select().from(s.employeeWeeklyShiftPatterns).where(eq(s.employeeWeeklyShiftPatterns.employeeId,erin.id))).length,0);
    checks.push("weekly-default reviewed bypass rolls back completely");

    // Cursor covers all durable revisions, with deterministic ties and own-note visibility only.
    const base=(await readScheduleDayHistory(manager,{employeeId:alice.id,day},client)).entries[0];
    await database.insert(s.scheduleDecisionRevisions).values(Array.from({length:23},(_,index)=>({requestId:randomUUID(),employeeId:alice.id,day,departmentId:branch.id,periodId:period.id,snapshot:base.after,previousSnapshot:base.before,defaultSnapshot:base.before,actorUserId:admin.userId,createdAt:new Date(Date.now()+index*1000)})));
    history=await readScheduleDayHistory(manager,{employeeId:alice.id,day},client);assert.equal(history.entries.length,20);assert.ok(history.nextCursor);
    const second=await readScheduleDayHistory(manager,{employeeId:alice.id,day,cursor:history.nextCursor!},client);
    assert.equal(new Set([...history.entries,...second.entries].map(row=>row.id)).size,history.entries.length+second.entries.length);
    checks.push("history pagination retains older entries without duplicate boundaries");
    console.log(JSON.stringify({ok:true,checks:checks.length,details:checks},null,2));
  } finally {await pg.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

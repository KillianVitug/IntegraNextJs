import "server-only";
import { assertNoConfirmedScheduleEdit } from "@/lib/scheduling/guards";
import { recordAdminAuditEvent } from "@/lib/admin";
import { shiftTableScheduleLabel } from "@/lib/scheduling/presentation";
import { buildShiftTableReadModel, buildShiftAssignmentSnapshotFromTable } from "@/lib/shifts";
import { upsertEmployeeShiftAssignmentSchema } from "@/zod-schemas/employeeShiftAssignment";
import { lockAttendancePayrollInput } from "./attendanceSourceGuard";
import { PayrollValidationError } from "./validation";
import { ensureNoShiftOverlap, getAffectedScheduleRange, getLatestImportedAttendanceDate, getRebuildRange, loadShiftTableForAssignment, lockShiftAssignmentContext, markAffectedShiftRunsStale, normalizeEffectiveTo, rebuildEmployeeAttendanceSummaries, withOvernightScheduleBoundary } from "@/app/actions/shiftAssignmentHelpers";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbClient } from "@/db";
import { adminAuditEvents, employees, employeesGeneralInfo, employeeShiftAssignments, employeeWeeklyShiftPatterns, employeeWeeklyShiftPatternDays, shiftTableBreaks, payrollPeriods, shiftTables } from "@/db/schema";
import { uniqueDayTargets } from "./attendanceStage6Model";

const date=z.string().regex(/^\d{4}-\d\d-\d\d$/).refine(value=>{const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;},"Invalid workday");
export const bulkScheduleInput=z.object({requestId:z.string().uuid(),periodId:z.string().uuid(),shiftTableId:z.number().int().positive(),targets:z.array(z.object({employeeId:z.string().uuid(),day:date})).min(1).max(100)});
export async function prepareBulkDaySchedules(database:DbClient,input:unknown) {
 const payload=bulkScheduleInput.parse(input),targets=uniqueDayTargets(payload.targets),ids=[...new Set(targets.map(t=>t.employeeId))];
 if(ids.length>20)throw new PayrollValidationError("Choose at most 20 employees for one schedule save.");
 const [periods,shifts,roster,assignments,patterns,patternDays,breaks]=await Promise.all([
  database.select().from(payrollPeriods).where(eq(payrollPeriods.id,payload.periodId)),
  database.select().from(shiftTables).where(eq(shiftTables.id,payload.shiftTableId)),
  database.select({employee:employees,info:employeesGeneralInfo}).from(employees).leftJoin(employeesGeneralInfo,eq(employeesGeneralInfo.employeeId,employees.id)).where(and(inArray(employees.id,ids),isNull(employees.deletedAt))),
  database.select().from(employeeShiftAssignments).where(inArray(employeeShiftAssignments.employeeId,ids)),
  database.select().from(employeeWeeklyShiftPatterns).where(inArray(employeeWeeklyShiftPatterns.employeeId,ids)),
  database.select({day:employeeWeeklyShiftPatternDays}).from(employeeWeeklyShiftPatternDays).innerJoin(employeeWeeklyShiftPatterns,eq(employeeWeeklyShiftPatterns.id,employeeWeeklyShiftPatternDays.patternId)).where(inArray(employeeWeeklyShiftPatterns.employeeId,ids)),
  database.select().from(shiftTableBreaks).where(eq(shiftTableBreaks.shiftTableId,payload.shiftTableId)),
 ]);
 const period=periods[0],shift=shifts[0];if(!period||!shift||shift.archivedAt)throw new PayrollValidationError("The payroll period or schedule is unavailable.");
 const rows=targets.map(target=>{
  const found=roster.find(r=>r.employee.id===target.employeeId);
  if(!found||target.day<period.startDate||target.day>period.endDate||found.info?.dateHired&&target.day<found.info.dateHired||found.info?.separationDate&&target.day>found.info.separationDate)throw new PayrollValidationError("A selected workday is outside this period or employee's employment dates.");
  const overlapping=assignments.filter(a=>a.employeeId===target.employeeId&&a.effectiveFrom<=target.day&&(!a.effectiveTo||a.effectiveTo>=target.day));
  if(overlapping.some(a=>a.effectiveFrom!==target.day||a.effectiveTo!==target.day))throw new PayrollValidationError(`${found.employee.employeeNo} · ${target.day} is covered by a longer date override. Edit that assignment explicitly; no dates were changed.`);
  if(overlapping.length>1)throw new PayrollValidationError("Conflicting date overrides need individual review.");
  return {...target,name:[found.employee.firstName,found.employee.lastName].filter(Boolean).join(' '),no:found.employee.employeeNo,existing:overlapping[0]??null};
 });
 const stable=<T extends {id:string|number}>(items:T[])=>[...items].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const digest=createHash('sha256').update(JSON.stringify({period,shift,targets,roster:roster.sort((a,b)=>a.employee.id.localeCompare(b.employee.id)),assignments:stable(assignments),patterns:stable(patterns),patternDays:stable(patternDays.map(row=>row.day)),breaks:stable(breaks)})).digest('hex');
 return {periodId:payload.periodId,shiftTableId:payload.shiftTableId,shiftLabel:shiftTableScheduleLabel(buildShiftTableReadModel({shiftTable:shift,breaks})),digest,rows};
}

export async function saveDateAssignment(tx:DbClient, actor:{userId:string}, payload:ReturnType<typeof upsertEmployeeShiftAssignmentSchema.parse>, rebuild=true) {
    await lockShiftAssignmentContext(tx, payload.employeeId);
    await assertNoConfirmedScheduleEdit(tx, {employeeId: payload.employeeId, startDate: payload.effectiveFrom, endDate: normalizeEffectiveTo(payload.effectiveTo)});

    const existingAssignment = payload.id
      ? await tx.query.employeeShiftAssignments.findFirst({
          where: eq(employeeShiftAssignments.id, payload.id),
        })
      : null;

    if (payload.id && !existingAssignment) {
      throw new PayrollValidationError("Shift assignment not found.");
    }

    if (existingAssignment && existingAssignment.employeeId !== payload.employeeId) {
      throw new PayrollValidationError("Shift assignment employee mismatch.");
    }
    if (existingAssignment) await assertNoConfirmedScheduleEdit(tx, {employeeId: payload.employeeId, startDate: existingAssignment.effectiveFrom, endDate: existingAssignment.effectiveTo});

    const selectedShiftTable = await loadShiftTableForAssignment(tx, payload.shiftTableId);
    const snapshot = buildShiftAssignmentSnapshotFromTable(selectedShiftTable);
    const effectiveTo = normalizeEffectiveTo(payload.effectiveTo);
    const normalizedPayload = {
      ...payload,
      effectiveTo,
    };

    await ensureNoShiftOverlap(tx, normalizedPayload);

    const values: typeof employeeShiftAssignments.$inferInsert = {
      employeeId: payload.employeeId,
      shiftTableId: payload.shiftTableId,
      shiftName: snapshot.shiftName,
      shiftCode: snapshot.shiftCode,
      shiftSchedule: payload.shiftSchedule ?? null,
      effectiveFrom: payload.effectiveFrom,
      effectiveTo,
      checkInTime: snapshot.checkInTime ?? selectedShiftTable.regularStartTime,
      checkOutTime: snapshot.checkOutTime ?? selectedShiftTable.regularEndTime,
      breakMinutes: snapshot.breakMinutes,
      paidBreakMinutes: snapshot.paidBreakMinutes,
      calculationPolicy: snapshot.calculationPolicy,
      punchPolicy: snapshot.punchPolicy,
      graceMinutes: payload.graceMinutes,
      restDay: payload.restDay ?? null,
      hoursPerDay: snapshot.hoursPerDay.toFixed(2),
      isFlexible: payload.isFlexible,
    };
    const staleRange = await withOvernightScheduleBoundary(tx,{employeeId:payload.employeeId,nextWindow:snapshot,removedAssignmentIds:existingAssignment?[existingAssignment.id]:[],range:getAffectedScheduleRange({
      existingRecord: existingAssignment,
      nextAssignment: {
        effectiveFrom: values.effectiveFrom,
        effectiveTo: values.effectiveTo ?? null,
      },
    })});

    if (!staleRange.startDate) {
      throw new PayrollValidationError("Unable to determine the affected shift-assignment date range.");
    }

    await markAffectedShiftRunsStale({
      tx,
      employeeId: payload.employeeId,
      startDate: staleRange.startDate,
      endDate: staleRange.endDate,
      actorUserId: actor.userId,
    });

    let assignmentId = payload.id ?? null;
    let action = "employee_shift_assignment.created";

    if (payload.id) {
      await tx
        .update(employeeShiftAssignments)
        .set({
          ...values,
          updatedAt: new Date(),
        })
        .where(eq(employeeShiftAssignments.id, payload.id));
      action = "employee_shift_assignment.updated";
    } else {
      const [created] = await tx
        .insert(employeeShiftAssignments)
        .values(values)
        .returning({ id: employeeShiftAssignments.id });
      assignmentId = created.id;
    }

    const latestImportedDate = await getLatestImportedAttendanceDate(tx, payload.employeeId);
    const rebuildRange = getRebuildRange({
      staleRange,
      latestImportedDate,
    });
    const rebuiltSummaryCount = rebuild && rebuildRange
      ? await rebuildEmployeeAttendanceSummaries({
          tx,
          actorUserId: actor.userId,
          employeeId: payload.employeeId,
          startDate: rebuildRange.startDate,
          endDate: rebuildRange.endDate,
        })
      : 0;

    await recordAdminAuditEvent({
      actorUserId: actor.userId,
      entityType: "employee_shift_assignment",
      entityId: assignmentId,
      action,
      database: tx,
      details: {
        employeeId: payload.employeeId,
        shiftTableId: payload.shiftTableId,
        shiftName: snapshot.shiftName,
        rebuiltSummaryCount,
        rebuildRange,
      },
    });

    return {
      message: payload.id ? "Shift override updated." : "Shift override created.",
      assignmentId,
      rebuiltSummaryCount,
      affectedRange: staleRange,
    };
}

export async function bulkScheduleReceipt(tx:DbClient,userId:string,requestId:string) {
 const [event]=await tx.select({details:adminAuditEvents.details}).from(adminAuditEvents).where(and(eq(adminAuditEvents.actorUserId,userId),eq(adminAuditEvents.action,"employee_shift_assignment.bulk_dates_saved"),eq(adminAuditEvents.entityId,requestId))).limit(1);
 if(!event?.details)return null;const details=JSON.parse(event.details) as Record<string,unknown>;
 return {saved:Number(details.saved),rebuiltSummaryCount:Number(details.rebuiltSummaryCount),requestContent:String(details.requestContent)};
}
export async function saveBulkDaySchedules(actor:{userId:string},input:unknown,digest:string,database:typeof db=db) {
 const payload=bulkScheduleInput.parse(input);
 const result=await database.transaction(async tx=>{
  await lockAttendancePayrollInput(tx);
  for(const employeeId of [...new Set(payload.targets.map(t=>t.employeeId))].sort())await lockShiftAssignmentContext(tx,employeeId);
  const requestContent=JSON.stringify(payload);
  const recorded=await bulkScheduleReceipt(tx,actor.userId,payload.requestId);
  if(recorded){if(recorded.requestContent!==requestContent)throw new PayrollValidationError("This schedule request ID was already used for different dates.");return recorded;}
  const preview=await prepareBulkDaySchedules(tx,payload);
  if(preview.digest!==digest)throw new PayrollValidationError("Schedules or employee details changed. Review the selected dates again; nothing was saved.");
  const affected=new Map<string,string[]>();
  for(const row of preview.rows){const saved=await saveDateAssignment(tx,actor,upsertEmployeeShiftAssignmentSchema.parse({id:row.existing?.id,employeeId:row.employeeId,shiftTableId:payload.shiftTableId,effectiveFrom:row.day,effectiveTo:row.day,graceMinutes:row.existing?.graceMinutes??0,restDay:row.existing?.restDay??null,isFlexible:row.existing?.isFlexible??false}),false);affected.set(row.employeeId,[...(affected.get(row.employeeId)??[]),saved.affectedRange.startDate??row.day,saved.affectedRange.endDate??row.day]);}
  let rebuiltSummaryCount=0;
  for(const employeeId of [...new Set(preview.rows.map(r=>r.employeeId))]){
   const days=affected.get(employeeId)!.sort();
   const latestImportedDate=await getLatestImportedAttendanceDate(tx,employeeId);
   const range=getRebuildRange({staleRange:{startDate:days[0],endDate:days.at(-1)!},latestImportedDate});
   if(range)rebuiltSummaryCount+=await rebuildEmployeeAttendanceSummaries({tx,actorUserId:actor.userId,employeeId,...range});
  }
  await recordAdminAuditEvent({actorUserId:actor.userId,entityType:"bulk_schedule_request",entityId:payload.requestId,action:"employee_shift_assignment.bulk_dates_saved",database:tx,details:{requestId:payload.requestId,requestContent,saved:preview.rows.length,targets:payload.targets,shiftTableId:payload.shiftTableId,reviewedDigest:digest,rebuiltSummaryCount}});
  return {saved:preview.rows.length,rebuiltSummaryCount};
 });
 return result;
}

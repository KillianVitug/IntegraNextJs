import assert from "node:assert/strict";
import { applyBatchNote, changeInputErrors, draftVersion, retainedDraftVersion, verificationIssues, type WorkChange, type WorkKind } from "@/lib/payroll/attendanceWorkbenchModel";
import { appendManualDraft, buildNoWorkDrafts, sourceDeliveryLabel } from "@/lib/payroll/attendanceStage6Model";
import { batchReviewFixture, completeChange } from "./attendanceTest/batchReviewFixture";

const {board,drafts}=batchReviewFixture(), employee=board.employees[0], original=drafts[0];
const draft={...original,reason:"",changes:original.changes.map(change=>({...change,reason:"",evidence:"",verified:false}))};
for(const kind of ["Direction","Time","Employee","Void","Restore","Manual","ConfirmSequence","NoAttendance","Exclude","Retain","UndoCapture","ReopenDay"] as WorkKind[]){
 const change=completeChange({kind,reason:"",evidence:"",verified:false,at:kind==="Time"||kind==="Manual"?"2026-09-30T08:00:00":undefined,targetEmployeeId:kind==="Employee"?board.employees[1].id:undefined});
 assert.deepEqual(verificationIssues(employee,draft,change,board.employees),[],`${kind}: blank notes/evidence and unchecked legacy flags do not block review`);
}
assert.deepEqual(changeInputErrors(draft,completeChange({reason:"x",evidence:"",verified:false})),[],"One-character notes are accepted without a minimum");
for(const patch of [{kind:"Manual",at:""},{kind:"Time",at:"2026-09-31T08:00"},{kind:"Direction",type:undefined},{kind:"Employee",targetEmployeeId:"missing"},{eventId:"missing"},{day:"2027-01-01"}] as Partial<WorkChange>[])assert.ok(verificationIssues(employee,draft,completeChange({...patch,reason:"",evidence:"",verified:false}),board.employees).length,"Actual correction errors remain blocking");
assert.ok(changeInputErrors(draft,completeChange({kind:"Manual",at:"2099-01-01T08:00"})).some(message=>message.includes("future")));
assert.ok(verificationIssues(employee,{...draft,rejected:true},draft.changes[0],board.employees).includes("Plan is rejected"));
assert.ok(verificationIssues(employee,{...draft,version:"old"},draft.changes[0],board.employees).some(message=>message.includes("Evidence changed")));
const changedEmployee={...employee,days:employee.days.map(day=>({...day,version:"changed"}))};
assert.equal(retainedDraftVersion(changedEmployee,draft.days,draft),draft.version,"Editing notes cannot rebase stale source revisions");
let id=0;const ids=()=>`simple-${++id}`;
const noWork=buildNoWorkDrafts([drafts[1]],board.employees,[{employeeId:employee.id,day:draft.days[0]}],"",ids);
assert.deepEqual(noWork[0],drafts[1],"Unrelated employee plans are retained exactly");
assert.ok(noWork[1].changes.every(change=>change.evidence===""&&change.reason===""&&!change.verified));
const manual=completeChange({id:"new-manual",kind:"Manual",eventId:undefined,at:"2026-09-30T08:00:00",reason:"",evidence:"",verified:false});
const next=appendManualDraft([drafts[1]],employee,manual,"");
assert.deepEqual(next[0],drafts[1]);assert.equal(next[1].changes.length,1);assert.equal(next[1].version,draftVersion(employee,next[1].days));
assert.equal(appendManualDraft(next,employee,manual,"")[1].changes.length,1,"Repeat review does not duplicate the added punch");
const noted=applyBatchNote([original,{...drafts[1],reason:""}],"optional context");
assert.deepEqual(noted[0],original,"Historical reason and evidence are preserved without mutation");
assert.equal(noted[1].reason,"optional context");assert.deepEqual(noted[1].changes,drafts[1].changes,"Notes do not manufacture evidence");
assert.equal(sourceDeliveryLabel({id:"p",batchId:"b",revision:1,state:"Resolved",draft,approved:true,result:"Local payroll override approved. Phone attendance is unchanged.",updatedAt:"2026-10-01T00:00:00Z"}),"Local payroll override approved");
console.log("PASS optional notes/no evidence, all correction kinds, value guards, stale/rejected protection, retained unrelated drafts and historical audit");

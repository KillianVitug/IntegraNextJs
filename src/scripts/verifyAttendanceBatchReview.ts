import assert from "node:assert/strict";
import { applyBatchEvidence, applyBatchDetails, changeInputErrors, draftVersion, retainedDraftVersion, reconcileDraftVerification, verificationIssues, verifyCompleteChanges, workDayRecords, type WorkKind } from "@/lib/payroll/attendanceWorkbenchModel";
import { batchReviewFixture, completeChange } from "./attendanceTest/batchReviewFixture";

const {board,drafts}=batchReviewFixture(),employees=board.employees,person=employees[0],draft=drafts[0];
const filled=applyBatchEvidence(drafts,"  Batch incident EX-202  ");
assert.equal(filled[0].changes[0].evidence,drafts[0].changes[0].evidence,"Individual evidence is retained");
assert.equal(filled[4].changes[1].evidence,"Batch incident EX-202","All employees and changes receive blank-only evidence");
assert.equal(drafts[1].changes[0].evidence,"","Pure update preserves previous draft");
const blankReasons=drafts.map(d=>({...d,reason:d.employeeId===person.id?"Individual reason":""}));
const shared=applyBatchDetails(blankReasons,"Batch reason","Batch evidence");
assert.equal(shared[0].reason,"Individual reason");assert.equal(shared[1].reason,"Batch reason");assert.equal(shared[0].changes[0].evidence,drafts[0].changes[0].evidence);
const reasonOnly=applyBatchDetails(blankReasons,"Reason only","");assert.equal(reasonOnly[1].changes[0].evidence,"");
const verified=verifyCompleteChanges(filled,employees);
assert.equal(verified.flatMap(d=>d.changes).filter(c=>c.verified).length,6);
assert.equal(verified[4].changes[1].verified,false,"Missing actual time is not verified");
for(const kind of ["Direction","Time","Employee","Void","Restore","Manual","ConfirmSequence","NoAttendance","Exclude","Retain","UndoCapture","ReopenDay"] as WorkKind[]){
 const c=completeChange({kind,at:kind==="Time"||kind==="Manual"?"2026-09-30T07:42:31.725":undefined,targetEmployeeId:kind==="Employee"?employees[1].id:undefined});
 assert.deepEqual(verificationIssues(person,draft,c,employees),[],`${kind} complete row can be attested`);
}
for(const patch of [{evidence:" "},{reason:"x"},{type:undefined},{kind:"Time" as const,at:undefined},{kind:"Manual" as const,at:"2026-09-31T08:00"},{kind:"Employee" as const,targetEmployeeId:"missing"},{eventId:"gone"},{day:"2026-10-01"}])assert.ok(verificationIssues(person,draft,completeChange(patch),employees).length);
assert.ok(changeInputErrors(draft,completeChange({at:"2099-09-30T08:00"})).some(x=>x.includes("future")));
assert.ok(changeInputErrors(draft,completeChange({kind:"Manual",at:"2026-10-03T08:00"})).some(x=>x.includes("outside")));
assert.ok(verificationIssues(person,{...draft,rejected:true},completeChange(),employees).includes("Plan is rejected"));
assert.ok(verificationIssues(person,{...draft,version:"old"},completeChange(),employees).some(x=>x.includes("Evidence changed")));
const afterReason=verified.map((d,i)=>i?d:{...d,reason:"Changed shared reason"});
assert.equal(reconcileDraftVerification(verified,afterReason,employees)[0].changes[0].verified,false);
const overridden=verified.map((d,i)=>i?d:{...d,changes:d.changes.map(c=>({...c,reason:"Specific reason"}))});
assert.equal(reconcileDraftVerification(overridden,overridden.map((d,i)=>i?d:{...d,reason:"New shared reason"}),employees)[0].changes[0].verified,true,"An unchanged effective override retains verification");
for(const patch of [{evidence:"New evidence"},{type:"OUT" as const},{reason:"New reason"},{at:"2026-09-30T09:00"}]){
 const next=verified.map((d,i)=>i?d:{...d,changes:d.changes.map(c=>({...c,...patch}))});
 assert.equal(reconcileDraftVerification(verified,next,employees)[0].changes[0].verified,false);
 assert.equal(reconcileDraftVerification(verified,next,employees)[1].changes[0].verified,true,"Other employee attestations remain");
}
assert.equal(reconcileDraftVerification(verified,verified.map((d,i)=>i?d:{...d,ownerId:"someone"}),employees)[0].changes[0].verified,true);
const stale=structuredClone(employees);stale[0].days[0].version="changed";
assert.equal(reconcileDraftVerification([],verified,stale)[0].changes[0].verified,false,"Restored drafts cannot retain stale attestations");
assert.equal(reconcileDraftVerification([],verified,employees)[0].changes[0].verified,true,"Unchanged draft survives reload");
assert.equal(retainedDraftVersion(stale[0],draft.days,draft),draft.version,"Editing the selection cannot rebase stale retained dates");
assert.equal(draftVersion(person,["2026-09-30","2026-09-30"]),draft.version);
const overnight=[{...person.days[0].records[0],type:"IN" as const,at:"2026-09-30T14:00:00Z"},{...person.days[0].records[1],at:"2026-09-30T22:00:00Z"}];
assert.equal(workDayRecords(overnight,"2026-09-30").length,2,"Next-period OUT retained");
assert.equal(workDayRecords(overnight,"2026-10-01").length,2,"Prior-period IN retained");
console.log("PASS: batch evidence, complete-only verification, all correction kinds, stale/rejected/invalid rows, effective reasons, edit/reset and overnight context");

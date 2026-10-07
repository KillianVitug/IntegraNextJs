import assert from "node:assert/strict";
import { classifyWorkPlans, isActiveWorkPlan, type WorkPlanView } from "@/lib/payroll/attendanceWorkbenchModel";
import { batchReviewFixture, completeChange } from "./attendanceTest/batchReviewFixture";
const draft=batchReviewFixture().drafts[0];
const pending:WorkPlanView={id:"old",batchId:"batch-1",revision:1,state:"Ready for approval",draft:{...draft,changes:[completeChange()]},result:null,updatedAt:"2026-10-06T04:22:00.000Z"};
const approved:WorkPlanView={...pending,id:"later",batchId:"batch-2",state:"Resolved",approved:true,approvedAt:"2026-10-06T04:50:00.000Z",updatedAt:"2026-10-06T04:54:00.000Z"};
assert.deepEqual(classifyWorkPlans([pending,approved])[0].supersededBy,["later"]);
assert.equal(isActiveWorkPlan(classifyWorkPlans([pending,approved])[0]),false);
assert.equal(isActiveWorkPlan(approved),false);
assert.equal(isActiveWorkPlan({...approved,state:"Sync pending"}),true,"Delivery failures remain active");
assert.equal(isActiveWorkPlan({...pending,state:"Rejected"}),true,"Rejected work remains visible");
for(const changed of [
 {...pending,updatedAt:"2026-10-06T05:00:00.000Z"},
 {...pending,draft:{...pending.draft,employeeId:"someone-else"}},
 {...pending,draft:{...pending.draft,undoOf:"prior-decision"}},
 {...pending,draft:{...pending.draft,incomingVersions:{"2026-09-30":"new"}}},
 {...pending,draft:{...pending.draft,changes:[...pending.draft.changes,completeChange({eventId:"other"})]}},
 {...pending,draft:{...pending.draft,changes:[completeChange({type:"OUT"})]}},
])assert.equal(classifyWorkPlans([changed,approved])[0].supersededBy,undefined,"Keep new intentions, partial overlap, different values and unrelated employees");
assert.equal(classifyWorkPlans([pending,{...approved,approvedAt:undefined}])[0].supersededBy,undefined,"Delivery timestamps do not substitute for approval evidence");
assert.equal(classifyWorkPlans([pending,{...approved,approved:false}])[0].supersededBy,undefined);
const manual={...pending,draft:{...draft,changes:[completeChange({kind:"Manual",at:"2026-09-30T08:00",eventId:undefined})]}};
assert.deepEqual(classifyWorkPlans([manual,{...approved,draft:{...manual.draft,changes:[completeChange({kind:"Manual",at:"2026-09-30T08:00:00",eventId:undefined})]}}])[0].supersededBy,["later"],"Equivalent exact manual times match");
assert.equal(pending.supersededBy,undefined,"Classification does not mutate stored history");
assert.equal(classifyWorkPlans([pending,approved,{...approved,id:"undo",approvedAt:"2026-10-06T06:00:00Z",draft:{...approved.draft,undoOf:approved.id}}])[0].supersededBy,undefined,"A later decision or Undo must not be hidden behind an earlier matching approval");
console.log("PASS Stage 2 exact-target superseded plans, partial batches, timing, delivery, identity and history preservation");

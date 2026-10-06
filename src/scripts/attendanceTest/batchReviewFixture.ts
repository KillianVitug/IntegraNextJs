import { draftVersion, type WorkBoard, type WorkChange, type WorkDraft, type WorkEmployee, type WorkRecord } from "@/lib/payroll/attendanceWorkbenchModel";

export function batchReviewFixture() {
 const employees:WorkEmployee[]=Array.from({length:5},(_,i)=>{
  const id=`fictional-${i}`,day="2026-09-30";
  const records:WorkRecord[]=[{id:`capture-${i}`,source:"API",employeeId:id,type:"OUT",at:"2026-09-29T23:42:31.725Z",originalAt:"2026-09-29T23:42:30.725Z",originalType:"OUT",status:"VALID",clockFlag:false},{id:`end-${i}`,source:"API",employeeId:id,type:"OUT",at:"2026-09-30T09:07:54.000Z",status:"VALID",clockFlag:false}];
  return {id,no:`EX00${i+1}`,name:["Ernesto Example","Maria Example","Paolo Example","Ana Example","Luis Example"][i],sourceIds:[`${i}`],mappingEvidence:{},hired:null,separated:null,contextRecords:records,days:[{day,schedule:{checkInTime:"08:00",checkOutTime:"17:00",hoursPerDay:8,breakMinutes:60},rest:false,leave:0,leaveEvidence:[],configuration:{},records,status:"Needs review",issues:["Missing IN or repeated OUT"],suggestions:[{label:"Review OUT → IN",explanation:"Verify the actual direction using evidence.",changes:[{kind:"Direction",eventId:records[0].id,type:"IN",day}]}],version:`fixture-v${i}`,resolved:false}]};
 });
 const drafts:WorkDraft[]=employees.map((p,i)=>({employeeId:p.id,days:["2026-09-30"],reason:"Supervisor confirmed the correction",ownerId:"",needed:i===4?"Confirm the actual missing time":"",rejected:false,version:draftVersion(p,["2026-09-30"]),changes:[{id:`change-${i}`,day:"2026-09-30",kind:"Direction",eventId:`capture-${i}`,type:"IN",reason:"",evidence:i===0?"Individual incident reference EX-101":"",verified:false}]}));
 drafts[4].changes.push({id:"manual-missing",day:"2026-09-30",kind:"Manual",type:"OUT",reason:"",evidence:"",verified:false});
 drafts[3].changes.push({id:"void-example",day:"2026-09-30",kind:"Void",eventId:"end-3",reason:"",evidence:"",verified:false});
 const board:WorkBoard={period:{id:"fictional-batch-period",code:"2026-09-B · Fictional example",startDate:"2026-09-16",endDate:"2026-09-30",posted:false},employees,plans:[],adjustments:[],owners:[{id:"fictional-admin",name:"Example administrator"}],statuses:{sync:"Up to date",review:"Needs review",delivery:"Up to date",dtr:"Refresh needed",payroll:"Draft — recompute explicitly"},enabled:true};
 return {board,drafts};
}
export const completeChange=(patch:Partial<WorkChange>={}):WorkChange=>({id:"test",day:"2026-09-30",kind:"Direction",eventId:"capture-0",type:"IN",evidence:"Fixture evidence",reason:"",verified:false,...patch});

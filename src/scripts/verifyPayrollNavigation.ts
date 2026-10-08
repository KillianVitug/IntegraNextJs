import assert from "node:assert/strict";
import { payrollContextHref, selectWorkspaceRun } from "../lib/payroll/navigation";

const query = new URLSearchParams({year:"2026",periodId:"period-a",group:"Monthly",runId:"monthly",departmentId:"45",employeeId:"employee-a",day:"2026-10-06",asOfDate:"2026-10-07",q:"Long employee & name",edit:"attendance",view:"history",returnTo:"/payroll/attendance-batch?recursive=1"});
const estimate = new URL(payrollContextHref("/payroll/provisional",query.toString()), "https://example.invalid");
assert.equal(estimate.searchParams.get("group"),"Monthly");
assert.equal(estimate.searchParams.get("employeeId"),"employee-a");
assert.equal(estimate.searchParams.get("day"),"2026-10-06");
assert.equal(estimate.searchParams.get("q"),"Long employee & name");
assert.equal(estimate.searchParams.get("asOfDate"),"2026-10-07");
assert.equal(estimate.searchParams.get("runId"),"monthly","A historical run remains selected when returning from its estimate");
for(const key of ["edit","view","returnTo"])assert.equal(estimate.searchParams.has(key),false,key);
const outputs = new URL(payrollContextHref("/payroll/outputs",query.toString(),{periodId:"period-b",runId:"new-run",group:"Daily",employeeId:undefined}),"https://example.invalid");
assert.equal(outputs.searchParams.get("periodId"),"period-b");assert.equal(outputs.searchParams.get("runId"),"new-run");assert.equal(outputs.searchParams.get("group"),"Daily");assert.equal(outputs.searchParams.get("employeeId"),"employee-a");assert.equal(outputs.searchParams.has("asOfDate"),false);
assert.equal(payrollContextHref("/payroll","",{periodId:"period-a",year:"2026",group:"Daily"}),"/payroll?periodId=period-a&year=2026&group=Daily");
assert.equal(payrollContextHref("/payroll","employeeId=&edit=schedule"),"/payroll");

const runs = [{id:"monthly",payrollPeriodId:"period-a",inputSnapshot:{payrollGroup:"Monthly"}}, {id:"daily-new",payrollPeriodId:"period-a",inputSnapshot:{payrollGroup:"Daily"}}, {id:"daily-old",payrollPeriodId:"period-a",inputSnapshot:{payrollGroup:"Daily"}}, {id:"other-period",payrollPeriodId:"period-b",inputSnapshot:{payrollGroup:"Daily"}}, {id:"legacy",payrollPeriodId:"period-a",inputSnapshot:null}];
assert.equal(selectWorkspaceRun(runs,"period-a","Daily","monthly")?.id,"daily-new","Wrong-group bookmarks cannot display Monthly under Daily");
assert.equal(selectWorkspaceRun(runs,"period-a","Daily","other-period")?.id,"daily-new");
assert.equal(selectWorkspaceRun(runs,"period-a","Daily","daily-old")?.id,"daily-old","A selected historical run is retained");
assert.equal(selectWorkspaceRun(runs,"period-a","Monthly","daily-new")?.id,"monthly");
assert.equal(selectWorkspaceRun(runs,"period-a","Daily","legacy")?.id,"legacy","Existing explicit legacy history remains readable");
assert.equal(selectWorkspaceRun(runs.filter(row=>row.id==="legacy"),"period-a","Daily"),null,"Legacy mixed runs are not silently selected as a new group");
assert.equal(selectWorkspaceRun(runs,"absent","Daily","monthly"),null);
console.log("PASS payroll navigation: context, editor isolation, explicit run/group protection and legacy history");

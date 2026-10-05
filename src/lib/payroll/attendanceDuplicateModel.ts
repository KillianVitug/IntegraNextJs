import { chronological, validateManualSequence } from "./attendanceResolutionModel";
import { manilaWallTime, type SourcePunch } from "./attendanceSourceClient";

export const DUPLICATE_RULE_VERSION = "same-direction-v1";
export const DUPLICATE_AUTO_MS = 60_000;
export const DUPLICATE_SUGGEST_MS = 300_000;
export type DuplicateMode = "Off" | "Suggest" | "Automatic";
export type DuplicatePolicy = { mode: DuplicateMode; revision: string; enabledAfter: string | null };
export type DuplicateCandidate = { id: string; sourceId: string; name: string; kept: SourcePunch; removed: SourcePunch[]; resultingSequence:SourcePunch[]; gapSeconds: number; warnings: string[]; eligible: boolean; canApprove:boolean; version: string };
export type DuplicateBoard = { policy: DuplicatePolicy; candidates: DuplicateCandidate[]; history: { id: string; state: string; automatic: boolean; restored?:boolean; ruleVersion:string; actor:string; groupId:string; reason: string; kept: SourcePunch; removed: SourcePunch[]; createdAt: string; result: string | null; canUndo: boolean }[] };

/** Anchored bursts never cross an intervening opposite punch or grow by rolling gaps. */
export function duplicateBursts<T extends { id: string; person: string; type: string; at: number }>(records: T[], windowMs = DUPLICATE_SUGGEST_MS) {
  const groups = new Map<string, T[]>(), result: { kept: T; removed: T[] }[] = [];
  for (const r of records) { const list = groups.get(r.person) ?? []; list.push(r); groups.set(r.person, list); }
  for (const list of groups.values()) {
    list.sort((a,b) => a.at-b.at || a.id.localeCompare(b.id));
    let i=0;
    while (i<list.length) {
      const kept=list[i++], removed:T[]=[];
      while(i<list.length && ["IN","OUT"].includes(kept.type) && list[i].type===kept.type && list[i].at-kept.at<=windowMs) removed.push(list[i++]);
      if(removed.length) result.push({kept,removed});
    }
  }
  return result;
}

export function duplicateCandidates(records: SourcePunch[], start: string, end: string, policy: DuplicatePolicy, options: { verified: boolean; conflictingDecision: boolean; version: string }) {
  const valid=records.filter(p=>p.status==="VALID").sort(chronological);
  return duplicateBursts(valid.map(p=>({id:p.eventId,person:p.employeeId,type:p.type,at:Date.parse(p.capturedAt),p}))).map(({kept,removed}): DuplicateCandidate => {
    const all=[kept,...removed].map(r=>r.p), warnings:string[]=[];
    const gap=removed.at(-1)!.at-kept.at;
    if(gap>DUPLICATE_AUTO_MS) warnings.push("Over 60 seconds: approval required.");
    if(all.some(p=>p.duplicateExcluded)) warnings.push("Previously restored: automatic handling is excluded.");
    if(!options.verified) warnings.push("Verify an active employee match first.");
    if(options.conflictingDecision) warnings.push("An existing attendance decision needs review.");
    if(all.some(p=>!p.deviceId) || all.some(p=>p.deviceId!==kept.p.deviceId)) warnings.push("Different or unknown phones: review the original evidence.");
    if(all.some(p=>p.branchId!==kept.p.branchId)) warnings.push("Different branches: review the original evidence.");
    if(all.some(p=>p.clockFlag || p.reviewFlags.includes("CLOSE_PUNCHES_ACROSS_PHONES"))) warnings.push("Clock or cross-phone warning requires review.");
    if(all.some(p=>p.correctionVersion!=="original" || p.reviewResolved)) warnings.push("Previously corrected or reviewed records require approval.");
    if(removed.some(p=>p.at===kept.at)) warnings.push("Identical capture times need evidence of which record to retain.");
    const treated=records.map(p=>removed.some(r=>r.id===p.eventId)?{...p,status:"VOID" as const}:p);
    if(validateManualSequence(treated,[],start,end)) warnings.push("The remaining sequence still needs review; no missing time will be invented.");
    if(!policy.enabledAfter || all.some(p=>Date.parse(p.capturedAt)<=Date.parse(policy.enabledAfter!))) warnings.push("Historical captures require approval.");
    const remaining=treated.filter(p=>p.status==="VALID").sort(chronological),position=remaining.findIndex(p=>p.eventId===kept.id);
    return {id:kept.id,sourceId:kept.person,name:kept.p.employeeName,kept:kept.p,removed:removed.map(r=>r.p),resultingSequence:remaining.slice(Math.max(0,position-1),position+2),gapSeconds:gap/1000,warnings,eligible:!warnings.length,canApprove:options.verified&&!options.conflictingDecision,version:options.version};
  }).filter(c=>[c.kept,...c.removed].some(p=>{const d=manilaWallTime(p.capturedAt).date;return d>=start&&d<=end;}));
}

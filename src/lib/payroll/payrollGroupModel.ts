export type PayrollGroup = "Daily" | "Monthly";
export type MonthlyPayoutHalf = "A" | "B";
export const payrollGroup = (salary: { monthlyRate?: string | number | null } | null | undefined): PayrollGroup => Number(salary?.monthlyRate ?? 0) > 0 ? "Monthly" : "Daily";
export const earningMonth = (period: { year: number; month: number }) => `${period.year}-${String(period.month).padStart(2,"0")}`;
export function monthRange(period: {year:number;month:number}) {
 const month=earningMonth(period);
 return {startDate:`${month}-01`,endDate:`${month}-${new Date(Date.UTC(period.year,period.month,0)).getUTCDate()}`};
}
export function runPayrollGroup(snapshot: Record<string,unknown> | null | undefined): PayrollGroup | "Legacy" {
 return snapshot?.payrollGroup === "Daily" || snapshot?.payrollGroup === "Monthly" ? snapshot.payrollGroup : "Legacy";
}
export type CreditLine={lineType:string;code:string;amount:number;sourceTable?:string|null;sourceId?:string|null};
export function payrollCreditKey(line:CreditLine) {
 return [line.lineType,line.code,...(line.sourceTable==="loan_installments"?[line.sourceTable,line.sourceId]:[])].join("|");
}
/** Subtract only already-posted amounts; an excess is disclosed, never recovered automatically. */
export function remainingMonthlyLines<T extends CreditLine>(lines:T[],paid:CreditLine[],regularPaid:number) {
 const credits=new Map<string,number>();
 const signedKey=(line:CreditLine)=>`${payrollCreditKey(line)}|${line.amount<0?"negative":"positive"}`;
 for(const line of paid){const key=signedKey(line);credits.set(key,(credits.get(key)??0)+Math.abs(line.amount));}
 credits.set("Earning|REG|positive",Math.max(0,regularPaid));
 let credited=0;
 // Explicit negative adjustments retain their sign. Posted negative lines credit
 // that adjustment, rather than silently deleting it or collecting it twice.
 const remaining=lines.map(line=>{const key=signedKey(line),amount=credits.get(key)??0,used=Math.min(Math.abs(line.amount),amount);credits.set(key,amount-used);credited+=used;const remainder=Math.max(0,Math.abs(line.amount)-used);return {...line,amount:remainder?Number((Math.sign(line.amount)*remainder).toFixed(2)):0};});
 return {lines:remaining,credited,excess:[...credits.entries()].filter(([key])=>key.endsWith("|positive")&&(key==="Earning|REG|positive"||lines.some(l=>signedKey(l)===key))).reduce((n,[,x])=>n+Math.max(0,x),0)};
}

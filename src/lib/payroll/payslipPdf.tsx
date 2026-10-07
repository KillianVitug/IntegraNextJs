import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { getPayrollRegister } from "./reports";
import { runPayrollGroup } from "./payrollGroupModel";

type Register = NonNullable<Awaited<ReturnType<typeof getPayrollRegister>>>;
const money = (value: string | number) => `PHP ${Number(value).toLocaleString("en-PH", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

export async function renderPayslips(run: Register, employeeId?: string) {
  const employees = run.employees.filter(employee => !employeeId || employee.employeeId === employeeId).sort((a,b) => a.employeeNoSnapshot.localeCompare(b.employeeNoSnapshot));
  if (!employees.length) throw new Error("Payslip not found.");
  const final = run.status === "Posted";
  return renderToBuffer(<Document title={`${run.payrollPeriod?.code} ${runPayrollGroup(run.inputSnapshot)} payslips`}>
    {employees.map(employee => <Page key={employee.id} size="A4" style={{padding: 32, fontFamily: "Helvetica", fontSize: 10, color: "#13263c"}}>
      <Text style={{fontSize: 18, marginBottom: 8}}>Integra payroll payslip</Text>
      <Text style={{fontSize: 12, marginBottom: 12}}>{final ? "POSTED" : `PREVIEW — ${run.status.toUpperCase()}`} | {run.payrollPeriod?.code} | {runPayrollGroup(run.inputSnapshot)} | Run #{run.runNumber}</Text>
      <Text style={{fontSize: 14, marginBottom: 5}}>{employee.employeeNameSnapshot}</Text>
      <Text>{employee.employeeNoSnapshot}</Text>
      <Text style={{marginTop: 8}}>Earning dates: {run.payrollPeriod?.startDate} to {run.payrollPeriod?.endDate}</Text>
      <Text>Payout date: {run.payrollPeriod?.adjustedPayDate}</Text>
      {["Earning", "Deduction", "Employer Contribution"].filter(type => employee.lines.some(line => line.lineType === type && Number(line.amount) !== 0)).map(type => <View key={type} style={{marginTop: 18}}>
        <Text style={{fontSize: 12, marginBottom: 8}}>{type === "Earning" ? "Earnings" : type === "Deduction" ? "Deductions" : "Employer contributions (not deducted from net pay)"}</Text>
        {employee.lines.filter(line => line.lineType === type && Number(line.amount) !== 0).map(line => <View key={line.id} wrap={false} style={{flexDirection: "row", borderBottomWidth: 0.4, borderBottomColor: "#d4dce5", paddingVertical: 5}}>
          <Text style={{width: "70%"}}>{line.code} — {line.description}{line.quantity ? ` (quantity ${line.quantity})` : ""}</Text>
          <Text style={{width: "30%", textAlign: "right"}}>{money(line.amount)}</Text>
        </View>)}
      </View>)}
      <View wrap={false} style={{marginTop: 20, padding: 12, backgroundColor: "#eff4fa"}}>
        <Text>Gross: {money(employee.grossPay)}</Text>
        <Text>Deductions: {money(employee.totalDeductions)}</Text>
        <Text style={{fontSize: 13, marginTop: 6}}>Calculated net: {money(employee.netPay)}</Text>
        <Text>Payment amount: {money(Math.max(0, Number(employee.netPay)))}</Text>
        {Number(employee.netPay) < 0 && <Text style={{marginTop: 8}}>Deduction shortfall: {money(-Number(employee.netPay))}. No transfer. Administrator follow-up required; no automatic future recovery.</Text>}
        {Number(employee.grossPay) === 0 && <Text style={{marginTop: 8}}>No work / earnings recorded — zero payment.</Text>}
      </View>
      <Text style={{marginTop: 16, fontSize: 9}}>{final ? "Payroll record; not proof of a bank transfer." : "Review copy. This payroll has not been posted; amounts may change."}</Text>
      <Text style={{position: "absolute", bottom: 20, left: 32, fontSize: 8}}>{run.id} | {employee.employeeNoSnapshot}</Text>
    </Page>)}
  </Document>);
}

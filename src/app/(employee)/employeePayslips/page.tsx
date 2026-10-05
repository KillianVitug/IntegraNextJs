import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireEmployee } from "@/lib/auth/server";
import { getPublishedEmployeePayslips } from "@/lib/payroll/control";

export const metadata = {
  title: "Employee Payslips",
};

function formatMoney(value: string | number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(value ?? 0));
}

function formatLineQuantity(value: string | number | null | undefined) {
  if (value == null) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toFixed(2).replace(/\.00$/, "");
}

function getLineSection(lineType: string) {
  if (lineType === "Earning") return "Earnings";
  if (lineType === "Deduction") return "Deductions";
  if (lineType === "Employer Contribution") return "Employer Contributions";
  return "Information";
}

export default async function EmployeePayslipsPage() {
  const auth = await requireEmployee({ redirectTo: "/" });
  const payslips = await getPublishedEmployeePayslips(auth.employeeId);

  return (
    <div className="mx-auto max-w-6xl space-y-4 py-4">
      <Card>
        <CardHeader>
          <CardTitle>Published Payslips</CardTitle>
          <CardDescription>
            Payslips become visible here after payroll publishes them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {payslips.map(({ publication, runEmployee, run, period, lines }) => {
              const groupedLines = lines.reduce(
                (groups, line) => {
                  groups[getLineSection(line.lineType)].push(line);
                  return groups;
                },
                {
                  Earnings: [],
                  Deductions: [],
                  "Employer Contributions": [],
                  Information: [],
                } as Record<string, typeof lines>
              );

              return (
                <details
                  key={publication.id}
                  className="rounded-md border bg-background"
                >
                  <summary className="grid cursor-pointer gap-3 p-4 text-sm md:grid-cols-[1fr_120px_repeat(3,140px)] md:items-center">
                    <div>
                      <div className="font-semibold">{period.code}</div>
                      <div className="text-muted-foreground">
                        {period.startDate} to {period.endDate}
                      </div>
                    </div>
                    <div>{period.adjustedPayDate}</div>
                    <div className="text-right">
                      <div className="text-muted-foreground">Gross</div>
                      <div className="font-medium">
                        {formatMoney(runEmployee.grossPay)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-muted-foreground">Deductions</div>
                      <div className="font-medium">
                        {formatMoney(runEmployee.totalDeductions)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-muted-foreground">Net</div>
                      <div className="font-semibold">
                        {formatMoney(runEmployee.netPay)}
                      </div>
                    </div>
                  </summary>

                  <div className="space-y-4 border-t p-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <div className="rounded-md border p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Taxable Pay
                        </div>
                        <div className="mt-1 font-semibold">
                          {formatMoney(runEmployee.taxablePay)}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Non-Taxable Pay
                        </div>
                        <div className="mt-1 font-semibold">
                          {formatMoney(runEmployee.nonTaxablePay)}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Employee Contributions
                        </div>
                        <div className="mt-1 font-semibold">
                          {formatMoney(runEmployee.employeeContributions)}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs uppercase text-muted-foreground">
                          Employer Contributions
                        </div>
                        <div className="mt-1 font-semibold">
                          {formatMoney(runEmployee.employerContributions)}
                        </div>
                      </div>
                    </div>

                    {Object.entries(groupedLines).map(([section, sectionLines]) =>
                      sectionLines.length > 0 ? (
                        <div key={section} className="space-y-2">
                          <h3 className="text-sm font-semibold">{section}</h3>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Code</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead>Qty</TableHead>
                                <TableHead>Rate</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {sectionLines.map((line) => (
                                <TableRow key={line.id}>
                                  <TableCell className="font-medium">
                                    {line.code}
                                  </TableCell>
                                  <TableCell>
                                    <div>{line.description}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {line.taxable ? "Taxable" : "Non-taxable"}
                                      {line.month13thEligible
                                        ? " | 13th-month eligible"
                                        : ""}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    {formatLineQuantity(line.quantity)}
                                  </TableCell>
                                  <TableCell>
                                    {line.rate ? formatMoney(line.rate) : "-"}
                                  </TableCell>
                                  <TableCell className="text-right font-medium">
                                    {formatMoney(line.amount)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : null
                    )}

                    <div className="text-xs text-muted-foreground">
                      Run #{run.runNumber} | {run.status}
                    </div>
                  </div>
                </details>
              );
            })}
            {payslips.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                No published payslips yet.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

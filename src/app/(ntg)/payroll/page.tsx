import { renderPayrollWorkspacePage } from "./page-loader";

export const metadata = {
  title: "Payroll Workspace",
};

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  return renderPayrollWorkspacePage({
    activeSection: "run",
    searchParams,
  });
}

import { notFound, redirect } from "next/navigation";
import { renderPayrollWorkspacePage } from "../page-loader";
import { PAYROLL_ROUTE_SECTIONS } from "../sections";

export const metadata = {
  title: "Payroll Workspace",
};

export default async function PayrollSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const { section } = await params;
  if (section === "attendance-imports") {
    const search = await searchParams;
    const query = new URLSearchParams(Object.entries(search).filter((entry): entry is [string, string] => entry[1] !== undefined));
    redirect(`/payroll/attendance-details?${query}`);
  }
  const activeSection = PAYROLL_ROUTE_SECTIONS[section];

  if (!activeSection) {
    notFound();
  }

  return renderPayrollWorkspacePage({
    activeSection,
    searchParams,
  });
}

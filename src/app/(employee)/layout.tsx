import { EmployeeHeader } from "@/components/EmployeeHeader";
import { requireEmployee } from "@/lib/auth/server";
import { connection } from "next/server";

export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  await requireEmployee({ redirectTo: "/" });

  return (
    <div className="w-full">
      <EmployeeHeader />
      <div className="px-4 py-2">{children}</div>
    </div>
  );
}

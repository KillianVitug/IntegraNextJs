import { Header } from '@/components/Header';
import { PageShell } from '@/components/layout/page-layout';
import { requireAdmin } from '@/lib/auth/server';
import { connection } from 'next/server';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  await requireAdmin({ redirectTo: '/' });

  return (
    <div className="w-full">
      <Header />
      {process.env.NEXT_PUBLIC_PAYROLL_ACCEPTANCE === "true" && <p className="bg-amber-100 p-3 text-center text-sm font-semibold">LOCAL ACCEPTANCE COPY · Restored database · No production payroll or attendance delivery</p>}
      <main className="min-h-[calc(100vh-3rem)]">
        <PageShell size="full">{children}</PageShell>
      </main>
    </div>
  );
}

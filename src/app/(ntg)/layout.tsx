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
      <main className="min-h-[calc(100vh-3rem)]">
        <PageShell size="full">{children}</PageShell>
      </main>
    </div>
  );
}

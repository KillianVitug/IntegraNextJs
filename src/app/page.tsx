import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/auth/AuthPanel";
import { getCurrentAuthContext, getRedirectForRole } from "@/lib/auth/server";

export default async function Home() {
  const auth = await getCurrentAuthContext();

  if (auth) {
    redirect(getRedirectForRole(auth.role));
  }

  return (
    <div className="min-h-screen bg-black bg-login-img bg-cover bg-center">
      <main className="mx-auto grid min-h-screen max-w-6xl items-center gap-8 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_30rem]">
        <section className="rounded-[2rem] border border-white/15 bg-white/10 p-8 text-white shadow-2xl backdrop-blur lg:p-12">
          <div className="space-y-6">
            <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-4 py-1 text-sm uppercase tracking-[0.24em] text-white/80">
              Integra HRMS
            </div>
            <div className="space-y-4">
              <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
                Integra
              </h1>
              <p className="max-w-xl text-base text-white/80 sm:text-lg">
                Centralize HR operations, employee records, payroll workspaces,
                and leave administration in a single system with controlled
                employee access and administrator-managed account setup.
              </p>
            </div>
            <div className="grid gap-3 text-sm text-white/80 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/15 bg-black/20 p-4">
                Employee accounts are claimed only from existing Rank and File
                records.
              </div>
              <div className="rounded-2xl border border-white/15 bg-black/20 p-4">
                Admin access is created only by authorized administrators with
                fixed confidentiality levels.
              </div>
            </div>
          </div>
        </section>

        <AuthPanel />
      </main>
    </div>
  );
}

import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/auth/AuthPanel";
import { getCurrentAuthContext, getRedirectForRole } from "@/lib/auth/server";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ loginStatus?: string }>;
}) {
  const params = await searchParams;
  const auth = await getCurrentAuthContext();

  if (auth) {
    redirect(getRedirectForRole(auth.role));
  }

  return (
    <div className="min-h-[100svh] bg-black bg-login-img bg-cover bg-center">
      <main className="mx-auto flex min-h-[100svh] w-full max-w-6xl flex-col justify-center gap-4 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),1rem)] sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_30rem] lg:items-center lg:gap-8 lg:py-10">
        <AuthPanel
          loginMessage={
            params.loginStatus === "invalid"
              ? "Invalid email or password."
              : null
          }
        />

        <section className="order-last rounded-lg border border-white/15 bg-slate-950/55 p-4 text-white shadow-2xl backdrop-blur sm:p-6 lg:order-first lg:rounded-lg lg:p-10">
          <div className="space-y-4 lg:space-y-6">
            <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-white/80 sm:text-sm sm:tracking-[0.24em]">
              Integra HRMS
            </div>
            <div className="space-y-2 sm:space-y-3">
              <h1 className="text-3xl font-bold tracking-tight sm:text-5xl lg:text-7xl">
                Integra
              </h1>
              <p className="max-w-xl text-sm leading-6 text-white/80 sm:text-base lg:text-lg">
                Centralize HR operations, employee records, payroll workspaces,
                and leave administration in a single system with controlled
                employee access and administrator-managed account setup.
              </p>
            </div>
            <div className="grid gap-2 text-xs leading-5 text-white/80 sm:grid-cols-2 sm:text-sm">
              <div className="rounded-md border border-white/15 bg-black/20 p-3 sm:p-4">
                Employee accounts are claimed only from existing Rank and File
                records.
              </div>
              <div className="rounded-md border border-white/15 bg-black/20 p-3 sm:p-4">
                Admin access is created only by authorized administrators with
                fixed confidentiality levels.
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

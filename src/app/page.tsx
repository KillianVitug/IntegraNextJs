// import Link from "next/link";
import { LoginLink } from "@kinde-oss/kinde-auth-nextjs/components";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="bg-black bg-login-img bg-cover bg-center">
      <main className="flex flex-col justify-center text-center max-w-5xl mx-auto h-dvh">
        <div className="flex flex-col gap-6 p-12 rounded-xl bg-white/90 w-4/5 sm:max-w-96 mx-auto text-black sm:text-2xl">
          <h1 className="text-7xl font-bold">Integra</h1>
          <Button asChild>
            <LoginLink className="bg-login-img bg-cover bg-center text-white w-full rounded">
              Login
            </LoginLink>
            </Button>
        </div>
      </main>
    </div>
  );
}

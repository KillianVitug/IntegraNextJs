import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { authAccounts } from "@/db/schema";
import {
  createSession,
  findAuthAccountByEmail,
  getRedirectForRole,
  getRoleForAccount,
} from "@/lib/auth/server";
import { normalizeEmail, verifyPassword } from "@/lib/auth/crypto";

function redirectToInvalidLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  url.searchParams.set("loginStatus", "invalid");

  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const rawEmail = formData.get("email");
    const rawPassword = formData.get("password");

    if (typeof rawEmail !== "string" || typeof rawPassword !== "string") {
      return redirectToInvalidLogin(request);
    }

    const email = normalizeEmail(rawEmail);
    const password = rawPassword;

    if (!email || !password) {
      return redirectToInvalidLogin(request);
    }

    const account = await findAuthAccountByEmail(email);

    if (
      !account ||
      account.status !== "Active" ||
      account.mustSetPassword ||
      !account.passwordHash
    ) {
      return redirectToInvalidLogin(request);
    }

    const isValidPassword = await verifyPassword(password, account.passwordHash);
    if (!isValidPassword) {
      return redirectToInvalidLogin(request);
    }

    const role = await getRoleForAccount(account.id);
    if (!role) {
      return redirectToInvalidLogin(request);
    }

    await db
      .update(authAccounts)
      .set({
        lastLoginAt: new Date(),
      })
      .where(eq(authAccounts.id, account.id));

    await createSession(account.id);

    return NextResponse.redirect(new URL(getRedirectForRole(role), request.url), 303);
  } catch (error) {
    console.error(error);
    return redirectToInvalidLogin(request);
  }
}

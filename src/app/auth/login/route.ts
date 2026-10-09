import { NextRequest, NextResponse } from "next/server";
import {
  getRedirectForRole,
  signInWithPassword,
} from "@/lib/auth/server";
import { normalizeEmail } from "@/lib/auth/crypto";
import {
  buildRequestHostUrl,
  redirectToRequestHost,
} from "@/lib/http/redirect";

function redirectToInvalidLogin(request: NextRequest) {
  return redirectToRequestHost(request, "/", { loginStatus: "invalid" });
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

    const result = await signInWithPassword(email, password, false);
    if (!result) {
      return redirectToInvalidLogin(request);
    }

    return NextResponse.redirect(
      buildRequestHostUrl(request, getRedirectForRole(result.role)),
      303,
    );
  } catch (error) {
    console.error(error);
    return redirectToInvalidLogin(request);
  }
}

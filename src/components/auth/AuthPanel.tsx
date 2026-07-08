"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  forgotPasswordAction,
  passwordLoginAction,
  registerEmployeeAction,
  setPasswordAction,
} from "@/app/actions/authAction";
import { initialAuthActionState } from "@/lib/auth/action-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthView = "login" | "claim";

function SubmitButton({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}

function Message({
  status,
  message,
}: {
  status: "idle" | "success" | "error";
  message: string | null;
}) {
  if (!message) {
    return null;
  }

  return (
    <p
      className={`text-sm ${
        status === "error" ? "text-destructive" : "text-emerald-700"
      }`}
    >
      {message}
    </p>
  );
}

export function AuthPanel() {
  const [view, setView] = useState<AuthView>("login");
  const [passwordSetup, setPasswordSetup] = useState<{
    email: string;
    token: string;
  } | null>(null);

  const [passwordLoginState, passwordLoginFormAction] = useActionState(
    passwordLoginAction,
    initialAuthActionState,
  );
  const [registerEmployeeState, registerEmployeeFormAction] = useActionState(
    registerEmployeeAction,
    initialAuthActionState,
  );
  const [forgotPasswordState, forgotPasswordFormAction] = useActionState(
    forgotPasswordAction,
    initialAuthActionState,
  );
  const [setPasswordState, setPasswordFormAction] = useActionState(
    setPasswordAction,
    initialAuthActionState,
  );

  useEffect(() => {
    if (passwordLoginState.passwordSetup) {
      setPasswordSetup(passwordLoginState.passwordSetup);
      setView("login");
    }
  }, [passwordLoginState.passwordSetup]);

  useEffect(() => {
    if (registerEmployeeState.status === "success") {
      setView("login");
    }
  }, [registerEmployeeState.status]);

  return (
    <section className="rounded-[2rem] border border-white/60 bg-white/95 p-6 shadow-2xl backdrop-blur md:p-8">
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.28em] text-slate-500">
            Secure Access
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
            Login and registration
          </h2>
          <p className="text-sm text-slate-600">
            Employees can claim existing Rank and File records. Admin access is
            created only by System Admins.
          </p>
        </div>

        <div className="grid grid-cols-2 rounded-full bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setView("login");
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              view === "login"
                ? "bg-slate-950 text-white"
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => {
              setView("claim");
              setPasswordSetup(null);
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              view === "claim"
                ? "bg-slate-950 text-white"
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            Claim Account
          </button>
        </div>

        {passwordSetup ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">
                Set permanent password
              </h3>
              <p className="text-sm text-slate-600">
                Your temporary password was accepted. Choose a permanent
                password to finish signing in.
              </p>
            </div>
            <form action={setPasswordFormAction} className="space-y-4">
              <input type="hidden" name="email" value={passwordSetup.email} />
              <input
                type="hidden"
                name="setupToken"
                value={passwordSetup.token}
              />
              <div className="space-y-2">
                <Label htmlFor="new-password">Permanent password</Label>
                <Input
                  id="new-password"
                  name="password"
                  type="password"
                  placeholder="At least 5 characters"
                  minLength={5}
                  required
                />
                {setPasswordState.fieldErrors?.password?.[0] ? (
                  <p className="text-sm text-destructive">
                    {setPasswordState.fieldErrors.password[0]}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  placeholder="Repeat the password"
                  minLength={5}
                  required
                />
                {setPasswordState.fieldErrors?.confirmPassword?.[0] ? (
                  <p className="text-sm text-destructive">
                    {setPasswordState.fieldErrors.confirmPassword[0]}
                  </p>
                ) : null}
              </div>
              <Message
                status={setPasswordState.status}
                message={setPasswordState.message}
              />
              <SubmitButton
                idleLabel="Save password and continue"
                pendingLabel="Saving password..."
              />
            </form>
          </div>
        ) : view === "login" ? (
          <div className="space-y-5">
            <form action={passwordLoginFormAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  placeholder="name@company.com"
                  required
                />
                {passwordLoginState.fieldErrors?.email?.[0] ? (
                  <p className="text-sm text-destructive">
                    {passwordLoginState.fieldErrors.email[0]}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  name="password"
                  type="password"
                  placeholder="Enter your password"
                  required
                />
              </div>
              <Message
                status={passwordLoginState.status}
                message={passwordLoginState.message}
              />
              <SubmitButton idleLabel="Login" pendingLabel="Signing in..." />
            </form>

            <form action={forgotPasswordFormAction} className="space-y-3 border-t pt-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Forgot password</Label>
                <Input
                  id="forgot-email"
                  name="email"
                  type="email"
                  placeholder="name@company.com"
                  required
                />
              </div>
              <Message
                status={forgotPasswordState.status}
                message={forgotPasswordState.message}
              />
              <SubmitButton idleLabel="Request reset" pendingLabel="Requesting..." />
            </form>

            {/* TEMP_DISABLED_NO_DOMAIN:
            <div className="grid grid-cols-2 rounded-full bg-slate-100 p-1">
              <button type="button">Password</button>
              <button type="button">Onboarding OTP</button>
            </div>
            <form action={requestOtpFormAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp-email">Email</Label>
                <Input id="otp-email" name="email" type="email" required />
              </div>
              <SubmitButton
                idleLabel="Send onboarding code"
                pendingLabel="Sending code..."
              />
            </form>
            */}
          </div>
        ) : (
          <div className="space-y-5">
            <form action={registerEmployeeFormAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="employee-register-email">Employee email</Label>
                <Input
                  id="employee-register-email"
                  name="email"
                  type="email"
                  placeholder="name@company.com"
                  required
                />
                {registerEmployeeState.fieldErrors?.email?.[0] ? (
                  <p className="text-sm text-destructive">
                    {registerEmployeeState.fieldErrors.email[0]}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="employee-register-password">Password</Label>
                <Input
                  id="employee-register-password"
                  name="password"
                  type="password"
                  placeholder="At least 5 characters"
                  required
                />
                {registerEmployeeState.fieldErrors?.password?.[0] ? (
                  <p className="text-sm text-destructive">
                    {registerEmployeeState.fieldErrors.password[0]}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="employee-register-confirm-password">
                  Confirm password
                </Label>
                <Input
                  id="employee-register-confirm-password"
                  name="confirmPassword"
                  type="password"
                  placeholder="Repeat the password"
                  required
                />
                {registerEmployeeState.fieldErrors?.confirmPassword?.[0] ? (
                  <p className="text-sm text-destructive">
                    {registerEmployeeState.fieldErrors.confirmPassword[0]}
                  </p>
                ) : null}
              </div>
              <p className="text-sm text-slate-600">
                Employees do not choose confidentiality. The account can only
                be claimed if the email already belongs to a Rank and File
                employee record.
              </p>
              <Message
                status={registerEmployeeState.status}
                message={registerEmployeeState.message}
              />
              <SubmitButton
                idleLabel="Claim employee account"
                pendingLabel="Creating account..."
              />
            </form>

            {/* TEMP_DISABLED_NO_DOMAIN:
            <div className="grid grid-cols-2 rounded-full bg-slate-100 p-1">
              <button type="button">Employee</button>
              <button type="button">Admin</button>
            </div>
            <form action={registerAdminFormAction} className="space-y-4">
              <Input name="inviteCode" />
              <Input name="firstName" />
              <Input name="lastName" />
              <Input name="email" type="email" />
            </form>
            */}
          </div>
        )}

        {/* TEMP_DISABLED_NO_DOMAIN:
        {onboardingEmail ? (
          <div className="space-y-4">
            <form action={verifyOtpFormAction}>
              <input type="hidden" name="email" value={onboardingEmail} />
              <Input name="otp" />
            </form>
            <form action={requestOtpFormAction}>
              <input type="hidden" name="email" value={onboardingEmail} />
            </form>
          </div>
        ) : null}
        */}
      </div>
    </section>
  );
}

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { authConfig, getMailConfig } from "@/lib/auth/config";

type MailArgs = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

let transportPromise: Promise<Transporter> | null = null;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function resetTransporterCache() {
  transportPromise = null;
}

async function getTransporter() {
  if (!transportPromise) {
    const mailConfig = getMailConfig();
    const transporter = nodemailer.createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
      secure: mailConfig.secure,
      auth: {
        user: mailConfig.user,
        pass: mailConfig.pass,
      },
    });

    transportPromise = transporter.verify().then(
      () => transporter,
      (error: unknown) => {
        resetTransporterCache();
        throw new Error(`SMTP verification failed: ${getErrorMessage(error)}`);
      },
    );
  }

  return transportPromise;
}

async function sendMail(args: MailArgs) {
  try {
    const transporter = await getTransporter();
    const mailConfig = getMailConfig();

    await transporter.sendMail({
      from: `"${mailConfig.fromName}" <${mailConfig.fromEmail}>`,
      replyTo: mailConfig.replyTo ?? undefined,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    });
  } catch (error) {
    resetTransporterCache();
    throw new Error(`SMTP send failed: ${getErrorMessage(error)}`);
  }
}

export async function sendOtpEmail(args: { email: string; otp: string }) {
  const minutes = authConfig.otpTtlMinutes;

  await sendMail({
    to: args.email,
    subject: "Your Integra one-time password",
    text: [
      "Mahalo,",
      "",
      `Your Integra one-time password is ${args.otp}.`,
      `It expires in ${minutes} minutes.`,
      "",
      "If you did not request this code, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
        <p>Mahalo,</p>
        <p>Your Integra one-time password is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 0.3rem; margin: 16px 0;">
          ${args.otp}
        </p>
        <p>It expires in ${minutes} minutes.</p>
        <p style="color: #475569;">If you did not request this code, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendAdminInviteEmail(args: {
  email: string;
  inviteCode: string;
  confidentialityLevel: "Supervisory" | "Managerial";
}) {
  await sendMail({
    to: args.email,
    subject: "Your Integra admin invite",
    text: [
      "Mahalo,",
      "",
      `Your Integra admin invite code is ${args.inviteCode}.`,
      `This invite is locked to the ${args.confidentialityLevel} confidentiality level.`,
      "",
      "Use this code on the registration form at the application root URL.",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6;">
        <p>Mahalo,</p>
        <p>Your Integra admin invite code is:</p>
        <p style="font-size: 24px; font-weight: 700; letter-spacing: 0.18rem; margin: 16px 0;">
          ${args.inviteCode}
        </p>
        <p>This invite is locked to the <strong>${args.confidentialityLevel}</strong> confidentiality level.</p>
        <p>Use this code on the registration form at the application root URL.</p>
      </div>
    `,
  });
}

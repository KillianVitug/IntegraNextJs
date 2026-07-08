import { and, eq, isNull } from "drizzle-orm";
import { db, type DbClient } from "../../db";
import { authEmailOtps } from "../../db/schema";
import { authConfig } from "./config";
import { createOtpCode, hashValue } from "./crypto";
import { sendOtpEmail } from "./mailer";

type OnboardingOtpRecord = {
  id: string;
  otp: string;
  expiresAt: Date;
};

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export async function createOnboardingOtpRecordTx(
  tx: DbClient,
  accountId: string,
): Promise<OnboardingOtpRecord> {
  const otp = createOtpCode();
  const expiresAt = addMinutes(new Date(), authConfig.otpTtlMinutes);

  await tx
    .delete(authEmailOtps)
    .where(
      and(
        eq(authEmailOtps.accountId, accountId),
        eq(authEmailOtps.purpose, "Onboarding"),
        isNull(authEmailOtps.consumedAt),
      ),
    );

  const [record] = await tx
    .insert(authEmailOtps)
    .values({
      accountId,
      purpose: "Onboarding",
      otpHash: hashValue(otp),
      expiresAt,
      maxAttempts: 5,
    })
    .returning({ id: authEmailOtps.id });

  return {
    id: record.id,
    otp,
    expiresAt,
  };
}

export async function createOnboardingOtpRecord(accountId: string) {
  return db.transaction((tx) => createOnboardingOtpRecordTx(tx, accountId));
}

export async function deliverOnboardingOtpEmail(email: string, otp: string) {
  await sendOtpEmail({ email, otp });
}

export async function issueOnboardingOtp(accountId: string, email: string) {
  const otpRecord = await createOnboardingOtpRecord(accountId);

  try {
    await deliverOnboardingOtpEmail(email, otpRecord.otp);
  } catch (error) {
    await db.delete(authEmailOtps).where(eq(authEmailOtps.id, otpRecord.id));
    throw error;
  }
}

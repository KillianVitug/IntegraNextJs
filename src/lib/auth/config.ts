const DEFAULT_SESSION_COOKIE_NAME = "integra_session";
const DEFAULT_SESSION_TTL_DAYS = 30;
const DEFAULT_OTP_TTL_MINUTES = 10;
const DEFAULT_SETUP_TTL_MINUTES = 15;
const DEFAULT_TEMP_PASSWORD_REVEAL_TTL_DAYS = 7;
const PLACEHOLDER_PREFIXES = ["REPLACE_WITH_", "CHANGE_ME_", "<"];
const PLACEHOLDER_SUBSTRINGS = ["@yourdomain.com", "@example.com"];

function parseInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null) return fallback;

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return fallback;
}

function isPlaceholderValue(value: string | undefined) {
  if (!value) {
    return true;
  }

  return (
    PLACEHOLDER_PREFIXES.some((prefix) => value.startsWith(prefix)) ||
    PLACEHOLDER_SUBSTRINGS.some((part) => value.includes(part))
  );
}

function requireMailEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || isPlaceholderValue(value)) {
    throw new Error(
      `${name} is required for SMTP mail delivery. Update your SMTP settings in .env.local.`,
    );
  }

  return value;
}

function getOptionalMailEnv(name: string) {
  const value = process.env[name]?.trim();

  if (isPlaceholderValue(value)) {
    return null;
  }

  return value;
}

export const authConfig = {
  sessionCookieName:
    process.env.AUTH_SESSION_COOKIE_NAME?.trim() || DEFAULT_SESSION_COOKIE_NAME,
  sessionTtlDays: parseInteger(
    process.env.AUTH_SESSION_TTL_DAYS,
    DEFAULT_SESSION_TTL_DAYS,
  ),
  otpTtlMinutes: parseInteger(
    process.env.AUTH_OTP_TTL_MINUTES,
    DEFAULT_OTP_TTL_MINUTES,
  ),
  setupTtlMinutes: parseInteger(
    process.env.AUTH_SETUP_TTL_MINUTES,
    DEFAULT_SETUP_TTL_MINUTES,
  ),
  tempPasswordRevealTtlDays: parseInteger(
    process.env.AUTH_TEMP_PASSWORD_REVEAL_TTL_DAYS,
    DEFAULT_TEMP_PASSWORD_REVEAL_TTL_DAYS,
  ),
  secureCookies: process.env.NODE_ENV === "production",
};

export function getTempPasswordRevealKey() {
  const rawKey = process.env.AUTH_TEMP_PASSWORD_REVEAL_KEY?.trim();

  if (!rawKey || isPlaceholderValue(rawKey)) {
    throw new Error(
      "AUTH_TEMP_PASSWORD_REVEAL_KEY is required to encrypt temporary password reveals. Set it to a base64-encoded 32-byte key in .env.local.",
    );
  }

  const key = Buffer.from(rawKey, "base64");
  if (key.byteLength !== 32) {
    throw new Error(
      "AUTH_TEMP_PASSWORD_REVEAL_KEY must decode to exactly 32 bytes.",
    );
  }

  return key;
}

export function getMailConfig() {
  const port = parseInteger(process.env.SMTP_PORT, 587);

  return {
    host: requireMailEnv("SMTP_HOST"),
    port,
    secure: parseBoolean(process.env.SMTP_SECURE, port === 465),
    user: requireMailEnv("SMTP_USER"),
    pass: requireMailEnv("SMTP_PASS"),
    fromEmail: requireMailEnv("MAIL_FROM_EMAIL"),
    fromName: process.env.MAIL_FROM_NAME?.trim() || "Mahalo",
    replyTo: getOptionalMailEnv("MAIL_REPLY_TO"),
  };
}

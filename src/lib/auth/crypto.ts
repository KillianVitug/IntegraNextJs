import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { argon2id } from "@noble/hashes/argon2";

const ARGON_MEMORY_KIB = 19_456;
const ARGON_ITERATIONS = 2;
const ARGON_PARALLELISM = 1;
const ARGON_DK_LEN = 32;
const ARGON_VERSION = 19;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeOptionalEmail(email: string | null | undefined) {
  const trimmed = email?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function createInviteCode() {
  const raw = randomBytes(12).toString("hex").toUpperCase();
  return raw.match(/.{1,4}/g)?.join("-") ?? raw;
}

export function createTemporaryPassword() {
  return randomBytes(18).toString("base64url");
}

export function encryptSecret(value: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(args: {
  encryptedValue: string;
  iv: string;
  authTag: string;
  key: Buffer;
}) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    args.key,
    Buffer.from(args.iv, "base64"),
  );

  decipher.setAuthTag(Buffer.from(args.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(args.encryptedValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function base64UrlToBuffer(value: string) {
  return Buffer.from(value, "base64url");
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = argon2id(password, salt, {
    t: ARGON_ITERATIONS,
    m: ARGON_MEMORY_KIB,
    p: ARGON_PARALLELISM,
    dkLen: ARGON_DK_LEN,
    maxmem: 64 * 1024 * 1024,
  });

  return [
    "argon2id",
    `v=${ARGON_VERSION}`,
    `m=${ARGON_MEMORY_KIB},t=${ARGON_ITERATIONS},p=${ARGON_PARALLELISM}`,
    Buffer.from(salt).toString("base64url"),
    Buffer.from(hash).toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, versionPart, paramsPart, saltPart, hashPart] =
    storedHash.split("$");

  if (
    algorithm !== "argon2id" ||
    versionPart !== `v=${ARGON_VERSION}` ||
    !paramsPart ||
    !saltPart ||
    !hashPart
  ) {
    return false;
  }

  const params = Object.fromEntries(
    paramsPart.split(",").map((entry) => {
      const [key, value] = entry.split("=");
      return [key, Number.parseInt(value ?? "", 10)];
    }),
  );

  const salt = base64UrlToBuffer(saltPart);
  const expectedHash = base64UrlToBuffer(hashPart);
  const actualHash = Buffer.from(
    argon2id(password, salt, {
      t: params.t,
      m: params.m,
      p: params.p,
      dkLen: expectedHash.byteLength,
      maxmem: 64 * 1024 * 1024,
    }),
  );

  if (actualHash.byteLength !== expectedHash.byteLength) {
    return false;
  }

  return timingSafeEqual(actualHash, expectedHash);
}

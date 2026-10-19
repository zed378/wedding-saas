import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
} from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, desc } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";

import { ENV } from "../../../config/config.module";
import type { Env } from "../../../config/env.schema";
import { DB, type Database } from "../../../infra/db/client";
import { userMfaFactors, userRecoveryCodes, users } from "../../../infra/db/schema/users";
import {
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
} from "../../../http/errors";
import { logSecurityEvent } from "../../../shared/logging/logger";

// Base32 alphabet for RFC 3548 / 4648
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_CHARS.indexOf(cleaned[i]!);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** RFC 6238 TOTP computation using HMAC-SHA1 */
export function computeTotp(secretBase32: string, timestampSeconds: number, stepSeconds = 30): string {
  const secretBytes = base32Decode(secretBase32);
  const counter = Math.floor(timestampSeconds / stepSeconds);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", secretBytes).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const codeInt =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const token = (codeInt % 1_000_000).toString().padStart(6, "0");
  return token;
}

export function verifyTotpCode(
  secretBase32: string,
  candidateCode: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  stepSeconds = 30,
): boolean {
  if (!/^\d{6}$/.test(candidateCode)) return false;

  // Check current counter and ±1 step (30s drift window)
  for (const drift of [0, -1, 1]) {
    const code = computeTotp(secretBase32, nowSeconds + drift * stepSeconds, stepSeconds);
    if (code === candidateCode) return true;
  }
  return false;
}

export interface MfaSetupResult {
  secret: string;
  qrUri: string;
  recoveryCodes: string[];
}

export interface StepUpTokenPayload {
  userId: string;
  role: string;
  purpose: "step_up";
}

@Injectable()
export class MfaService {
  private readonly encryptionKey: Buffer;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {
    // Derive a fixed 256-bit AES key from JWT_SIGNING_KEY for MFA secret encryption at rest
    this.encryptionKey = createHash("sha256")
      .update(`${this.env.JWT_SIGNING_KEY}:mfa-encryption`)
      .digest();
  }

  /** Application-layer AES-256-GCM encryption of secret at rest */
  encryptSecret(secret: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Stored layout: [12 bytes IV] + [16 bytes AuthTag] + [Ciphertext]
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  /** Application-layer AES-256-GCM decryption */
  decryptSecret(encryptedBuffer: Buffer): string {
    if (encryptedBuffer.length < 28) {
      throw new Error("Invalid encrypted secret payload");
    }

    const iv = encryptedBuffer.subarray(0, 12);
    const authTag = encryptedBuffer.subarray(12, 28);
    const ciphertext = encryptedBuffer.subarray(28);

    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  }

  /** Check if user has an active confirmed MFA factor */
  async hasConfirmedFactor(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: userMfaFactors.id })
      .from(userMfaFactors)
      .where(
        and(
          eq(userMfaFactors.userId, userId),
          eq(userMfaFactors.type, "totp"),
          isNull(userMfaFactors.confirmedAt) ? undefined : undefined,
        ),
      );

    const confirmed = rows.some(() => true); // check confirmation in query
    const factor = await this.db
      .select({ id: userMfaFactors.id, confirmedAt: userMfaFactors.confirmedAt })
      .from(userMfaFactors)
      .where(and(eq(userMfaFactors.userId, userId), eq(userMfaFactors.type, "totp")))
      .limit(1);

    return factor.length > 0 && factor[0]!.confirmedAt !== null;
  }

  /** Generate 8 single-use recovery codes */
  generateRecoveryCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const part1 = randomBytes(2).toString("hex").toUpperCase();
      const part2 = randomBytes(2).toString("hex").toUpperCase();
      codes.push(`${part1}-${part2}`);
    }
    return codes;
  }

  hashRecoveryCode(code: string): string {
    return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
  }

  /** Start TOTP setup / enrollment */
  async setupTotp(userId: string, email: string): Promise<MfaSetupResult> {
    // Generate 20-byte base32 secret (160-bit RFC 6238)
    const secretRaw = randomBytes(20);
    const secretBase32 = base32Encode(secretRaw);

    const encrypted = this.encryptSecret(secretBase32);

    // Remove any previously unconfirmed factor for this user
    await this.db
      .delete(userMfaFactors)
      .where(
        and(
          eq(userMfaFactors.userId, userId),
          eq(userMfaFactors.type, "totp"),
          isNull(userMfaFactors.confirmedAt),
        ),
      );

    // Insert new unconfirmed factor
    await this.db.insert(userMfaFactors).values({
      userId,
      type: "totp",
      secretEncrypted: encrypted,
      label: "Authenticator App",
      confirmedAt: null,
    });

    const qrUri = `otpauth://totp/Vizunicum:${encodeURIComponent(email)}?secret=${secretBase32}&issuer=Vizunicum&algorithm=SHA1&digits=6&period=30`;
    const recoveryCodes = this.generateRecoveryCodes();

    return {
      secret: secretBase32,
      qrUri,
      recoveryCodes,
    };
  }

  /** Confirm enrollment with first valid code */
  async confirmTotp(userId: string, code: string, recoveryCodes: string[]): Promise<boolean> {
    // Find unconfirmed factor
    const factors = await this.db
      .select({
        id: userMfaFactors.id,
        secretEncrypted: userMfaFactors.secretEncrypted,
      })
      .from(userMfaFactors)
      .where(
        and(
          eq(userMfaFactors.userId, userId),
          eq(userMfaFactors.type, "totp"),
          isNull(userMfaFactors.confirmedAt),
        ),
      )
      .orderBy(desc(userMfaFactors.createdAt))
      .limit(1);

    if (factors.length === 0) {
      throw new ValidationError(
        [{ field: "code", message: "Tidak ada sesi pendaftaran 2FA yang aktif." }],
        "Tidak ada sesi pendaftaran 2FA aktif.",
      );
    }

    const factor = factors[0]!;
    const secretBase32 = this.decryptSecret(Buffer.from(factor.secretEncrypted));

    const isValid = verifyTotpCode(secretBase32, code.trim());
    if (!isValid) {
      logSecurityEvent("auth.mfa_confirm_failed", { user_id: userId });
      throw new ValidationError(
        [{ field: "code", message: "Kode 2FA tidak valid. Periksa jam perangkat Anda." }],
        "Kode 2FA tidak valid.",
      );
    }

    // Mark factor confirmed
    await this.db
      .update(userMfaFactors)
      .set({ confirmedAt: new Date(), lastUsedAt: new Date() })
      .where(eq(userMfaFactors.id, factor.id));

    // Clear old recovery codes if any, and insert new hashed ones
    await this.db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));

    for (const recCode of recoveryCodes) {
      await this.db.insert(userRecoveryCodes).values({
        userId,
        codeHash: this.hashRecoveryCode(recCode),
        usedAt: null,
      });
    }

    logSecurityEvent("auth.mfa_enrolled", { user_id: userId, type: "totp" });
    return true;
  }

  /** Verify TOTP code or single-use recovery code during login challenge */
  async verifyCodeOrRecovery(
    userId: string,
    candidate: { code?: string | undefined; recoveryCode?: string | undefined },
  ): Promise<{ success: boolean; usedRecoveryCode: boolean }> {
    // 1. Try TOTP code if provided
    if (candidate.code) {
      const factors = await this.db
        .select({
          id: userMfaFactors.id,
          secretEncrypted: userMfaFactors.secretEncrypted,
          confirmedAt: userMfaFactors.confirmedAt,
        })
        .from(userMfaFactors)
        .where(
          and(
            eq(userMfaFactors.userId, userId),
            eq(userMfaFactors.type, "totp"),
          ),
        )
        .limit(1);

      const factor = factors[0];
      if (factor && factor.confirmedAt) {
        const secretBase32 = this.decryptSecret(Buffer.from(factor.secretEncrypted));
        const ok = verifyTotpCode(secretBase32, candidate.code.trim());
        if (ok) {
          await this.db
            .update(userMfaFactors)
            .set({ lastUsedAt: new Date() })
            .where(eq(userMfaFactors.id, factor.id));
          return { success: true, usedRecoveryCode: false };
        }
      }
    }

    // 2. Try Recovery Code if provided
    if (candidate.recoveryCode) {
      const hash = this.hashRecoveryCode(candidate.recoveryCode);
      const rows = await this.db
        .select({ id: userRecoveryCodes.id })
        .from(userRecoveryCodes)
        .where(
          and(
            eq(userRecoveryCodes.userId, userId),
            eq(userRecoveryCodes.codeHash, hash),
            isNull(userRecoveryCodes.usedAt),
          ),
        )
        .limit(1);

      if (rows.length > 0) {
        // Mark recovery code as used (single-use)
        await this.db
          .update(userRecoveryCodes)
          .set({ usedAt: new Date() })
          .where(eq(userRecoveryCodes.id, rows[0]!.id));

        logSecurityEvent("auth.recovery_code_used", { user_id: userId });
        return { success: true, usedRecoveryCode: true };
      }
    }

    logSecurityEvent("auth.mfa_verify_failed", { user_id: userId });
    return { success: false, usedRecoveryCode: false };
  }

  /** Issue a signed 5-minute MFA ticket for login challenge / setup */
  async signMfaTicket(
    userId: string,
    email: string,
    role: string,
    purpose: "challenge" | "setup",
  ): Promise<string> {
    const key = new TextEncoder().encode(this.env.JWT_SIGNING_KEY);
    const now = Math.floor(Date.now() / 1000);

    return new SignJWT({
      email,
      role,
      purpose,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer("wedding-invitation")
      .setAudience("wedding-invitation-mfa")
      .setIssuedAt(now)
      .setExpirationTime(now + 5 * 60) // 5 minutes validity
      .sign(key);
  }

  /** Verify MFA ticket */
  async verifyMfaTicket(
    ticket: string,
    expectedPurpose: "challenge" | "setup",
  ): Promise<{ userId: string; email: string; role: string }> {
    try {
      const key = new TextEncoder().encode(this.env.JWT_SIGNING_KEY);
      const { payload } = await jwtVerify(ticket, key, {
        algorithms: ["HS256"],
        issuer: "wedding-invitation",
        audience: "wedding-invitation-mfa",
      });

      if (payload.purpose !== expectedPurpose) {
        throw new UnauthenticatedError("Tiket MFA tidak sesuai.");
      }

      return {
        userId: payload.sub as string,
        email: payload.email as string,
        role: payload.role as string,
      };
    } catch {
      throw new UnauthenticatedError("Tiket MFA tidak valid atau telah kedaluwarsa.");
    }
  }

  /** Issue a 10-minute Step-Up re-auth token for sensitive actions */
  async signStepUpToken(userId: string, role: string): Promise<string> {
    const key = new TextEncoder().encode(this.env.JWT_SIGNING_KEY);
    const now = Math.floor(Date.now() / 1000);

    return new SignJWT({
      role,
      purpose: "step_up",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer("wedding-invitation")
      .setAudience("wedding-invitation-stepup")
      .setIssuedAt(now)
      .setExpirationTime(now + 10 * 60) // 10 minutes max for step-up
      .sign(key);
  }

  /** Verify Step-Up token */
  async verifyStepUpToken(token: string, userId: string): Promise<boolean> {
    try {
      const key = new TextEncoder().encode(this.env.JWT_SIGNING_KEY);
      const { payload } = await jwtVerify(token, key, {
        algorithms: ["HS256"],
        issuer: "wedding-invitation",
        audience: "wedding-invitation-stepup",
      });

      return payload.sub === userId && payload.purpose === "step_up";
    } catch {
      return false;
    }
  }
}

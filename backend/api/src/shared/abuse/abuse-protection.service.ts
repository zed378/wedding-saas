import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";

import { BusinessRuleError } from "../../http/errors";
import { RATE_LIMIT_REDIS } from "../rate-limit/rate-limiter";
import { metrics } from "../metrics/metrics";
import { TurnstileService } from "./turnstile.service";
import { ProfanityService } from "./profanity.service";

export const SUBMISSION_WINDOW_SECONDS = 600; // 10 minutes
export const SUBMISSION_THRESHOLD = 20; // 20 requests in 10 minutes (OQ-14)
export const CAPTCHA_ACTIVE_SECONDS = 1800; // 30 minutes active duration

/**
 * P4-05 — Layered abuse protection & adaptive CAPTCHA governor.
 * Keeps CAPTCHA invisible for normal guests, activates automatically under traffic flood.
 */
@Injectable()
export class AbuseProtectionService {
  constructor(
    @Inject(RATE_LIMIT_REDIS) private readonly redis: Redis,
    private readonly turnstile: TurnstileService,
    private readonly profanity: ProfanityService,
  ) {}

  /** Key storing the active CAPTCHA flag for a slug. */
  private captchaKey(slug: string): string {
    return `abuse:captcha:${slug}`;
  }

  /** Key storing the rolling submission timestamps for a slug. */
  private submissionsKey(slug: string): string {
    return `abuse:submissions:${slug}`;
  }

  /**
   * Check whether CAPTCHA is currently required for submissions on this slug.
   */
  async isCaptchaRequired(slug: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(this.captchaKey(slug));
      return exists > 0;
    } catch {
      return false; // Fail open on Redis read error to avoid locking out normal wedding guests
    }
  }

  /**
   * Record a submission attempt and trigger adaptive CAPTCHA if traffic exceeds threshold.
   */
  async recordSubmissionAttempt(
    slug: string,
  ): Promise<{ count: number; captchaActivated: boolean }> {
    const now = Date.now();
    const windowMs = SUBMISSION_WINDOW_SECONDS * 1000;
    const key = this.submissionsKey(slug);

    try {
      // 1. Drop timestamps older than the sliding window
      await this.redis.zremrangebyscore(key, "-inf", now - windowMs);

      // 2. Add current timestamp
      const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
      await this.redis.zadd(key, now, member);
      await this.redis.pexpire(key, windowMs);

      // 3. Count remaining attempts in window
      const count = await this.redis.zcard(key);

      // 4. If count crosses threshold, activate CAPTCHA mode
      let captchaActivated = false;
      if (count >= SUBMISSION_THRESHOLD) {
        const alreadyActive = await this.isCaptchaRequired(slug);
        if (!alreadyActive) {
          await this.activateCaptcha(slug, CAPTCHA_ACTIVE_SECONDS);
          captchaActivated = true;
        }
      }

      return { count, captchaActivated };
    } catch {
      return { count: 1, captchaActivated: false };
    }
  }

  /**
   * Manually or automatically activate CAPTCHA challenge mode for a slug.
   */
  async activateCaptcha(
    slug: string,
    durationSeconds = CAPTCHA_ACTIVE_SECONDS,
  ): Promise<void> {
    try {
      await this.redis.set(this.captchaKey(slug), "1", "EX", durationSeconds);
      metrics.abuseCaptchaActivations.inc({ trigger: "rate_flood" });
    } catch {
      // ignore Redis write error
    }
  }

  /**
   * Deactivate CAPTCHA challenge mode for a slug.
   */
  async deactivateCaptcha(slug: string): Promise<void> {
    try {
      await this.redis.del(this.captchaKey(slug), this.submissionsKey(slug));
    } catch {
      // ignore
    }
  }

  /**
   * Enforce CAPTCHA check if active for the slug.
   * Throws BusinessRuleError('CAPTCHA_REQUIRED' | 'CAPTCHA_INVALID') if verification fails.
   */
  async verifySubmission(
    slug: string,
    captchaToken: string | undefined,
    clientIp: string,
  ): Promise<void> {
    // 1. Check if CAPTCHA challenge is currently active
    const required = await this.isCaptchaRequired(slug);

    // 2. Track attempt in velocity window
    await this.recordSubmissionAttempt(slug);

    if (!required) {
      // Happy path for normal wedding guests: zero challenge required
      return;
    }

    // 3. CAPTCHA is required: validate token presence
    if (!captchaToken || !captchaToken.trim()) {
      metrics.abuseCaptchaVerifications.inc({ result: "missing" });
      throw new BusinessRuleError(
        "CAPTCHA_REQUIRED",
        "Verifikasi keamanan diperlukan. Silakan selesaikan CAPTCHA.",
      );
    }

    // 4. Verify token with Cloudflare Turnstile
    const valid = await this.turnstile.verify(captchaToken, clientIp);
    if (!valid) {
      throw new BusinessRuleError(
        "CAPTCHA_INVALID",
        "Verifikasi CAPTCHA gagal. Silakan coba lagi.",
      );
    }
  }

  /**
   * Check for profanity in submitted text.
   */
  async containsProfanity(
    text: string | null | undefined,
    surface: "guestbook" | "rsvp",
  ): Promise<boolean> {
    return this.profanity.containsProfanity(text, surface);
  }
}

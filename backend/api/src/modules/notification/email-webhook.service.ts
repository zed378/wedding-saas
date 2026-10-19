import { Inject, Injectable, BadRequestException } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { DB, type Database } from "../../infra/db/client";
import { emailBounces } from "../../infra/db/schema/users";
import { logger } from "../../shared/logging/logger";
import { metrics } from "../../shared/metrics/metrics";

export type NormalizedBounceType = "hard_bounce" | "soft_bounce" | "complaint" | "delivered" | "other";

export interface EmailWebhookResult {
  readonly received: boolean;
  readonly provider: string;
  readonly type: NormalizedBounceType;
  readonly email?: string | undefined;
  readonly suppressed: boolean;
}

/**
 * `P4-08` — Email Delivery & Bounce Webhook Service (`docs/BACKEND/07`, `docs/DEVOPS/07`).
 *
 * Ingests delivery notifications, hard bounces, and spam complaints from email providers
 * (e.g. Resend, mock). Hard bounces and complaints are stored in `email_bounces` to permanently
 * suppress dead addresses, preventing degradation of domain sender reputation.
 */
@Injectable()
export class EmailWebhookService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async handle(
    provider: string,
    payload: unknown,
  ): Promise<EmailWebhookResult> {
    if (!payload || typeof payload !== "object") {
      throw new BadRequestException("Invalid webhook payload");
    }

    const p = payload as Record<string, unknown>;
    const normalizedProvider = provider.toLowerCase().trim();

    // Parse event type and email from provider payload
    const rawType = String(p["type"] ?? p["event"] ?? "").toLowerCase();
    const dataObj = (p["data"] && typeof p["data"] === "object" ? p["data"] : p) as Record<string, unknown>;

    let email = "";
    if (typeof dataObj["to"] === "string") {
      email = dataObj["to"];
    } else if (Array.isArray(dataObj["to"]) && dataObj["to"].length > 0) {
      email = String(dataObj["to"][0]);
    } else if (typeof dataObj["email"] === "string") {
      email = dataObj["email"];
    } else if (typeof p["email"] === "string") {
      email = String(p["email"]);
    }

    email = email.toLowerCase().trim();

    // Map to normalized bounce type
    let bounceType: NormalizedBounceType = "other";
    if (rawType.includes("complaint") || rawType === "email.complained") {
      bounceType = "complaint";
    } else if (
      rawType.includes("hard") ||
      rawType === "email.bounced" ||
      rawType === "bounced"
    ) {
      bounceType = "hard_bounce";
    } else if (rawType.includes("soft") || rawType.includes("transient")) {
      bounceType = "soft_bounce";
    } else if (rawType === "email.delivered" || rawType === "delivered") {
      bounceType = "delivered";
    }

    const providerEmailId = typeof dataObj["email_id"] === "string"
      ? dataObj["email_id"]
      : typeof dataObj["id"] === "string"
        ? dataObj["id"]
        : undefined;

    const message = typeof dataObj["message"] === "string"
      ? dataObj["message"]
      : typeof (dataObj["bounce"] as any)?.message === "string"
        ? (dataObj["bounce"] as any).message
        : undefined;

    // Track delivery and bounce metrics
    metrics.emailBounces.inc({
      provider: normalizedProvider,
      type: bounceType,
    });

    const isSuppressed = bounceType === "hard_bounce" || bounceType === "complaint";

    if (isSuppressed && email) {
      await this.db
        .insert(emailBounces)
        .values({
          email,
          bounceType,
          message: message ? message.slice(0, 1000) : null,
          provider: normalizedProvider,
          providerEmailId: providerEmailId ?? null,
        })
        .onConflictDoNothing();

      logger.warn(
        {
          context: {
            provider: normalizedProvider,
            email,
            bounce_type: bounceType,
            email_id: providerEmailId,
          },
        },
        "recorded email bounce/complaint; address permanently suppressed",
      );
    } else {
      logger.info(
        {
          context: {
            provider: normalizedProvider,
            email,
            type: bounceType,
          },
        },
        "processed email delivery notification",
      );
    }

    return {
      received: true,
      provider: normalizedProvider,
      type: bounceType,
      email: email || undefined,
      suppressed: isSuppressed,
    };
  }
}

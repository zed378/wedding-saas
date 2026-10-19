import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";

import { ok } from "../../http/envelope";
import { EmailBounceService } from "./email-bounce.service";
import { logger } from "../../shared/logging/logger";

interface ResendWebhookPayload {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    bounce?: {
      message?: string;
      type?: string;
    };
    complaint?: {
      message?: string;
    };
  };
}

interface GenericBouncePayload {
  event?: string;
  email?: string;
  type?: "hard_bounce" | "complaint" | "transient";
  message?: string;
}

/**
 * `P4-08` — `POST /api/webhooks/email/:provider`.
 *
 * Receives delivery status webhooks from email providers (e.g. Resend, SES).
 * Unauthenticated and exempt from rate limiting because it is an external callback surface
 * (`EXEMPT_PATH_PREFIXES` in policies.ts).
 *
 * Processes hard bounces and spam complaints to automatically suppress dead addresses,
 * protecting domain reputation and satisfying deliverability monitoring obligations.
 */
@Controller("api/webhooks/email")
export class EmailWebhookController {
  constructor(private readonly bounceService: EmailBounceService) {}

  @Post(":provider")
  @HttpCode(200)
  async receive(
    @Param("provider") provider: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const raw = (body ?? {}) as Record<string, unknown>;

    // 1. Resend webhook format: { type: "email.bounced" | "email.complained" | "email.delivered", data: { ... } }
    if (typeof raw["type"] === "string" && raw["type"].startsWith("email.")) {
      const payload = raw as ResendWebhookPayload;
      const eventType = payload.type;
      const data = payload.data;
      const recipients = data?.to ?? [];

      logger.info(
        { context: { event: "email_webhook.received", provider, type: eventType } },
        "processing email provider webhook",
      );

      if (eventType === "email.bounced") {
        const bounceSubType = data?.bounce?.type ?? "hard_bounce";
        const isHard = bounceSubType.toLowerCase().includes("hard") || bounceSubType === "suppressed";
        const message = data?.bounce?.message ?? "Delivery bounced by recipient mailserver";

        if (isHard) {
          for (const recipient of recipients) {
            await this.bounceService.recordBounce({
              email: recipient,
              bounceType: "hard_bounce",
              message,
              provider,
              providerEmailId: data?.email_id,
            });
          }
        }
      } else if (eventType === "email.complained") {
        for (const recipient of recipients) {
          await this.bounceService.recordBounce({
            email: recipient,
            bounceType: "complaint",
            message: data?.complaint?.message ?? "Recipient marked message as spam",
            provider,
            providerEmailId: data?.email_id,
          });
        }
      }

      return ok({ received: true });
    }

    // 2. Generic / simulated bounce webhook format (for testing and direct provider callbacks)
    const generic = raw as GenericBouncePayload;
    if (generic.event === "bounce" || generic.type === "hard_bounce") {
      if (generic.email) {
        await this.bounceService.recordBounce({
          email: generic.email,
          bounceType: generic.type ?? "hard_bounce",
          message: generic.message ?? "Simulated email bounce",
          provider,
        });
      }
    } else if (generic.event === "complaint" || generic.type === "complaint") {
      if (generic.email) {
        await this.bounceService.recordBounce({
          email: generic.email,
          bounceType: "complaint",
          message: generic.message ?? "Simulated spam complaint",
          provider,
        });
      }
    }

    return ok({ received: true });
  }
}

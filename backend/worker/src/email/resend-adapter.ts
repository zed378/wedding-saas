import type { EmailMessage, EmailPort, EmailSendResult } from "./email-port.js";
import { logger } from "../logger.js";

export interface ResendEmailConfig {
  readonly apiKey: string;
  readonly defaultFrom: string;
  readonly endpoint?: string;
}

export class ResendEmailError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "ResendEmailError";
  }
}

/**
 * Resend API adapter (P4-06, ADR-013).
 *
 * Calls Resend via HTTPS using native fetch.
 * Translates errors so BullMQ retry policy can back off on 429/5xx and fail closed on invalid recipient.
 */
export class ResendEmailAdapter implements EmailPort {
  private readonly endpoint: string;

  constructor(private readonly config: ResendEmailConfig) {
    this.endpoint = config.endpoint ?? "https://api.resend.com/emails";
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const from = message.from ?? this.config.defaultFrom;
    const body: Record<string, unknown> = {
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    };

    if (message.replyTo) {
      body.reply_to = message.replyTo;
    }

    if (message.headers) {
      body.headers = message.headers;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "MomenBahagia-Worker/1.0",
    };

    if (message.idempotencyKey) {
      headers["Idempotency-Key"] = message.idempotencyKey;
    }

    logger.debug(
      {
        context: {
          event: "email.sending",
          recipient: message.to,
          subject: message.subject,
          from,
        },
      },
      "dispatching email via Resend",
    );

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (networkError) {
      logger.error(
        { err: networkError, context: { recipient: message.to } },
        "Resend network failure",
      );
      throw new ResendEmailError(
        `Failed to reach Resend API: ${networkError instanceof Error ? networkError.message : String(networkError)}`,
      );
    }

    if (!response.ok) {
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        errorData = await response.text();
      }

      logger.warn(
        {
          context: {
            status: response.status,
            recipient: message.to,
            error: errorData,
          },
        },
        "Resend API error response",
      );

      throw new ResendEmailError(
        `Resend API error ${response.status}: ${JSON.stringify(errorData)}`,
        response.status,
        errorData,
      );
    }

    const json = (await response.json()) as { id?: string };
    const id = json.id ?? `resend-${Date.now()}`;

    logger.info(
      {
        context: {
          event: "email.sent",
          recipient: message.to,
          message_id: id,
        },
      },
      "email dispatched successfully",
    );

    return {
      id,
      status: "sent",
    };
  }
}

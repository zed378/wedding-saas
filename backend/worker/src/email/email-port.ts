/**
 * EmailPort and contract definitions (P4-06, ADR-013).
 */

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly from?: string;
  readonly replyTo?: string;
  readonly headers?: Record<string, string>;
  readonly idempotencyKey?: string;
}

export interface EmailSendResult {
  readonly id: string;
  readonly status: "sent" | "simulated";
}

export interface EmailPort {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/**
 * EmailPort and contract definitions (P4-06, ADR-013).
 */

export interface EmailAttachment {
  readonly filename: string;
  readonly content: Buffer | string;
  readonly contentType?: string;
}

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly from?: string | undefined;
  readonly replyTo?: string | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly attachments?: readonly EmailAttachment[] | undefined;
}

export interface EmailSendResult {
  readonly id: string;
  readonly status: "sent" | "simulated";
}

export interface EmailPort {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

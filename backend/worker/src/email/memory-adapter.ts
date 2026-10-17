import type { EmailMessage, EmailPort, EmailSendResult } from "./email-port.js";

/**
 * In-memory email adapter for unit and integration testing (P4-06).
 */
export class MemoryEmailAdapter implements EmailPort {
  private readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.sent.push(message);
    return {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: "simulated",
    };
  }

  getSent(): readonly EmailMessage[] {
    return [...this.sent];
  }

  findSentTo(email: string): readonly EmailMessage[] {
    const target = email.toLowerCase();
    return this.sent.filter((m) => m.to.toLowerCase() === target);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

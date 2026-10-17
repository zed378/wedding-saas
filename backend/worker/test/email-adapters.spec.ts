import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  MemoryEmailAdapter,
  ResendEmailAdapter,
  ResendEmailError,
} from "../src/email/index.js";

describe("Email Adapters (P4-06)", () => {
  describe("MemoryEmailAdapter", () => {
    it("records sent messages and allows filtering and clearing", async () => {
      const adapter = new MemoryEmailAdapter();

      expect(adapter.getSent()).toHaveLength(0);

      const res1 = await adapter.send({
        to: "user1@example.com",
        subject: "Selamat Datang",
        html: "<p>Halo</p>",
        text: "Halo",
      });

      expect(res1.status).toBe("simulated");
      expect(res1.id).toMatch(/^mem-/);

      await adapter.send({
        to: "user2@example.com",
        subject: "Reset Password",
        html: "<p>Reset</p>",
        text: "Reset",
      });

      expect(adapter.getSent()).toHaveLength(2);
      expect(adapter.findSentTo("user1@example.com")).toHaveLength(1);
      expect(adapter.findSentTo("USER1@EXAMPLE.COM")).toHaveLength(1);
      expect(adapter.findSentTo("nobody@example.com")).toHaveLength(0);

      adapter.clear();
      expect(adapter.getSent()).toHaveLength(0);
    });
  });

  describe("ResendEmailAdapter", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("successfully sends email via Resend API", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "resend-msg-12345" }),
      });
      global.fetch = mockFetch;

      const adapter = new ResendEmailAdapter({
        apiKey: "re_test_key_123",
        defaultFrom: "Momen Bahagia <halo@momenbahagia.id>",
      });

      const result = await adapter.send({
        to: "recipient@example.com",
        subject: "Verifikasi Email",
        html: "<p>Klik tautan ini</p>",
        text: "Klik tautan ini",
        idempotencyKey: "idem-key-1",
      });

      expect(result.id).toBe("resend-msg-12345");
      expect(result.status).toBe("sent");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0] as [string, any];
      expect(url).toBe("https://api.resend.com/emails");
      expect(options.method).toBe("POST");
      expect(options.headers["Authorization"]).toBe("Bearer re_test_key_123");
      expect(options.headers["Idempotency-Key"]).toBe("idem-key-1");

      const body = JSON.parse(options.body as string);
      expect(body.from).toBe("Momen Bahagia <halo@momenbahagia.id>");
      expect(body.to).toEqual(["recipient@example.com"]);
      expect(body.subject).toBe("Verifikasi Email");
    });

    it("throws ResendEmailError on API error (e.g. 429 rate limit)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ statusCode: 429, message: "Too many requests" }),
      });

      const adapter = new ResendEmailAdapter({
        apiKey: "re_test_key_123",
        defaultFrom: "Momen Bahagia <halo@momenbahagia.id>",
      });

      await expect(
        adapter.send({
          to: "recipient@example.com",
          subject: "Test",
          html: "<p>Test</p>",
          text: "Test",
        }),
      ).rejects.toThrow(ResendEmailError);
    });

    it("throws ResendEmailError on network failure", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const adapter = new ResendEmailAdapter({
        apiKey: "re_test_key_123",
        defaultFrom: "Momen Bahagia <halo@momenbahagia.id>",
      });

      await expect(
        adapter.send({
          to: "recipient@example.com",
          subject: "Test",
          html: "<p>Test</p>",
          text: "Test",
        }),
      ).rejects.toThrow(/Failed to reach Resend API/);
    });

    it("serializes attachments with base64 encoding to Resend API", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "resend-msg-att-1" }),
      });
      global.fetch = mockFetch;

      const adapter = new ResendEmailAdapter({
        apiKey: "re_test_key_123",
        defaultFrom: "Momen Bahagia <halo@momenbahagia.id>",
      });

      const buffer = Buffer.from("Invoice PDF Content");
      await adapter.send({
        to: "buyer@example.com",
        subject: "Invoice",
        html: "<p>Invoice attached</p>",
        text: "Invoice attached",
        attachments: [
          {
            filename: "invoice.pdf",
            content: buffer,
            contentType: "application/pdf",
          },
        ],
      });

      const [, options] = mockFetch.mock.calls[0] as [string, any];
      const body = JSON.parse(options.body as string);
      expect(body.attachments).toBeDefined();
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].filename).toBe("invoice.pdf");
      expect(body.attachments[0].content).toBe(buffer.toString("base64"));
      expect(body.attachments[0].content_type).toBe("application/pdf");
    });
  });
});

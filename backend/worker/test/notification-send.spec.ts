import { describe, expect, it, vi } from "vitest";
import type { Pool as PgPool } from "pg";
import { makeNotificationSendHandler } from "../src/handlers/notification-send.handler.js";
import { MemoryEmailAdapter } from "../src/email/index.js";
import type { WorkerEnv } from "../src/env.js";

function createMockEnv(): WorkerEnv {
  return {
    appEnv: "test",
    redisUrl: "redis://localhost:6379",
    databaseUrl: "postgres://localhost/test",
    appOrigin: "https://momenbahagia.id",
    publicInviteOrigin: "https://undangan.momenbahagia.id",
    email: {
      from: "Momen Bahagia <halo@momenbahagia.id>",
    },
    storage: {
      endpoint: "http://localhost:9000",
      accessKeyId: "test",
      secretAccessKey: "test",
      buckets: {
        "user-media": "user-media",
        "template-assets": "template-assets",
        staging: "staging",
      },
    },
    clamav: undefined,
  };
}

describe("Notification Send Handler (P4-06)", () => {
  const dummyContext = {
    jobName: "notification.send",
    attempt: 1,
    requestId: "req-123",
  };

  it("handles email_verification and dispatches email with token link", async () => {
    const memoryEmail = new MemoryEmailAdapter();
    const mockPg = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("FROM users")) {
          return {
            rows: [
              {
                email: "budi@example.com",
                full_name: "Budi Pratama",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as PgPool;

    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: createMockEnv(),
    });

    await handler(
      {
        template: "email_verification",
        userId: "user-1",
        token: "tok-verify-123",
      },
      dummyContext,
    );

    const sent = memoryEmail.getSent();
    expect(sent).toHaveLength(1);
    const first = sent[0]!;
    expect(first.to).toBe("budi@example.com");
    expect(first.subject).toContain("Verifikasi");
    expect(first.html).toContain(
      "https://momenbahagia.id/auth/verify-email?token=tok-verify-123",
    );
  });

  it("handles password_reset and dispatches reset email", async () => {
    const memoryEmail = new MemoryEmailAdapter();
    const mockPg = {
      query: vi.fn().mockResolvedValue({
        rows: [{ email: "siti@example.com", full_name: "Siti Rahma" }],
      }),
    } as unknown as PgPool;

    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: createMockEnv(),
    });

    await handler(
      {
        template: "password_reset",
        userId: "user-2",
        token: "reset-xyz-789",
      },
      dummyContext,
    );

    const sent = memoryEmail.getSent();
    expect(sent).toHaveLength(1);
    const first = sent[0]!;
    expect(first.to).toBe("siti@example.com");
    expect(first.subject).toContain("Atur Ulang Kata Sandi");
    expect(first.html).toContain(
      "https://momenbahagia.id/auth/reset-password?token=reset-xyz-789",
    );
  });

  it("handles password_changed as non-opt-outable security email", async () => {
    const memoryEmail = new MemoryEmailAdapter();
    const mockPg = {
      query: vi.fn().mockResolvedValue({
        rows: [{ email: "siti@example.com", full_name: "Siti Rahma" }],
      }),
    } as unknown as PgPool;

    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: createMockEnv(),
    });

    await handler(
      {
        template: "password_changed",
        userId: "user-2",
      },
      dummyContext,
    );

    const sent = memoryEmail.getSent();
    expect(sent).toHaveLength(1);
    const first = sent[0]!;
    expect(first.to).toBe("siti@example.com");
    expect(first.subject).toContain("Kata Sandi Berhasil Diubah");
  });

  it("handles bank_account_changed as non-opt-outable security notice", async () => {
    const memoryEmail = new MemoryEmailAdapter();
    const mockPg = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "inv-1",
            internal_name: "Maya & Dimas Wedding",
            slug: "maya-dimas",
            user_id: "user-3",
            email: "dimas@example.com",
            full_name: "Dimas Anggara",
          },
        ],
      }),
    } as unknown as PgPool;

    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: createMockEnv(),
    });

    await handler(
      {
        template: "bank_account_changed",
        userId: "user-3",
        invitationId: "inv-1",
        change: "changed",
        accountNumberMasked: "•••• 4321",
        providerName: "Bank Mandiri",
      },
      dummyContext,
    );

    const sent = memoryEmail.getSent();
    expect(sent).toHaveLength(1);
    const first = sent[0]!;
    expect(first.to).toBe("dimas@example.com");
    expect(first.subject).toContain("Peringatan Keamanan");
    expect(first.html).toContain("Bank Mandiri");
    expect(first.html).toContain("•••• 4321");
  });

  it("handles order_paid with formatted amount and invoice URL", async () => {
    const memoryEmail = new MemoryEmailAdapter();
    const mockPg = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "ord-12345678-abcd",
            amount_total: "149000",
            package_name: "Paket Premium",
            user_id: "user-4",
            email: "maya@example.com",
            full_name: "Maya Putri",
            invitation_title: "Maya & Dimas",
          },
        ],
      }),
    } as unknown as PgPool;

    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: createMockEnv(),
    });

    await handler(
      {
        template: "order_paid",
        orderId: "ord-12345678-abcd",
      },
      dummyContext,
    );

    const sent = memoryEmail.getSent();
    expect(sent).toHaveLength(1);
    const first = sent[0]!;
    expect(first.to).toBe("maya@example.com");
    expect(first.subject).toContain("Pembayaran Berhasil");
    expect(first.html).toContain("ORD-1234");
    expect(first.html).toContain("Rp 149.000");
    expect(first.html).toContain(
      "https://momenbahagia.id/api/orders/ord-12345678-abcd/invoice",
    );
  });

  it("handles rsvp_submitted when user allows email notifications", async () => {
    const memoryEmail = new MemoryEmailAdapter();
    const mockPg = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("FROM invitations")) {
          return {
            rows: [
              {
                id: "inv-1",
                internal_name: "Pernikahan Maya & Dimas",
                user_id: "user-3",
                email: "dimas@example.com",
                full_name: "Dimas Anggara",
              },
            ],
          };
        }
        if (sql.includes("FROM user_notification_preferences")) {
          return {
            rows: [{ rsvp_email: true, guestbook_email: true }],
          };
        }
        return { rows: [] };
      }),
    } as unknown as PgPool;

    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: createMockEnv(),
    });

    await handler(
      {
        template: "rsvp_submitted",
        invitationId: "inv-1",
        guestName: "Ahmad Dahlan",
        attendanceStatus: "attending",
        guestCount: 2,
      },
      dummyContext,
    );

    const sent = memoryEmail.getSent();
    expect(sent).toHaveLength(1);
    const first = sent[0]!;
    expect(first.to).toBe("dimas@example.com");
    expect(first.subject).toContain(
      "Konfirmasi Kehadiran Baru dari Ahmad Dahlan",
    );
  });

  it("skips rsvp_submitted when user opted out of RSVP emails", async () => {
    const memoryEmail = new MemoryEmailAdapter();
    const mockPg = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("FROM invitations")) {
          return {
            rows: [
              {
                id: "inv-1",
                internal_name: "Pernikahan Maya & Dimas",
                user_id: "user-3",
                email: "dimas@example.com",
                full_name: "Dimas Anggara",
              },
            ],
          };
        }
        if (sql.includes("FROM user_notification_preferences")) {
          return {
            rows: [{ rsvp_email: false, guestbook_email: true }],
          };
        }
        return { rows: [] };
      }),
    } as unknown as PgPool;

    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: createMockEnv(),
    });

    await handler(
      {
        template: "rsvp_submitted",
        invitationId: "inv-1",
        guestName: "Ahmad Dahlan",
        attendanceStatus: "attending",
        guestCount: 2,
      },
      dummyContext,
    );

    const sent = memoryEmail.getSent();
    expect(sent).toHaveLength(0);
  });

  it("skips guestbook_submitted when user opted out of guestbook emails", async () => {
    const memoryEmail = new MemoryEmailAdapter();
    const mockPg = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("FROM invitations")) {
          return {
            rows: [
              {
                id: "inv-1",
                internal_name: "Pernikahan Maya & Dimas",
                user_id: "user-3",
                email: "dimas@example.com",
                full_name: "Dimas Anggara",
              },
            ],
          };
        }
        if (sql.includes("FROM user_notification_preferences")) {
          return {
            rows: [{ rsvp_email: true, guestbook_email: false }],
          };
        }
        return { rows: [] };
      }),
    } as unknown as PgPool;

    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: createMockEnv(),
    });

    await handler(
      {
        template: "guestbook_submitted",
        invitationId: "inv-1",
        guestName: "Fitri Handayani",
        status: "approved",
        message: "Selamat!",
      },
      dummyContext,
    );

    const sent = memoryEmail.getSent();
    expect(sent).toHaveLength(0);
  });

  it("handles order_paid with invoice PDF attachment when invoice is available", async () => {
    const memoryEmail = new MemoryEmailAdapter();
    const pdfBuffer = Buffer.from("%PDF-1.4 mock invoice binary");
    const mockPg = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("FROM orders")) {
          return {
            rows: [
              {
                id: "ord-87654321-wxyz",
                amount_total: "199000",
                package_name: "Paket Eksklusif",
                user_id: "user-4",
                email: "maya@example.com",
                full_name: "Maya Putri",
                invitation_title: "Maya & Dimas",
              },
            ],
          };
        }
        if (sql.includes("FROM invoices")) {
          return {
            rows: [
              {
                number: "INV-202610-87654321",
                pdf: pdfBuffer,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as PgPool;

    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: createMockEnv(),
    });

    await handler(
      {
        template: "order_paid",
        orderId: "ord-87654321-wxyz",
      },
      dummyContext,
    );

    const sent = memoryEmail.getSent();
    expect(sent).toHaveLength(1);
    const first = sent[0]!;
    expect(first.to).toBe("maya@example.com");
    expect(first.attachments).toBeDefined();
    expect(first.attachments).toHaveLength(1);
    expect(first.attachments![0]!.filename).toBe("INV-202610-87654321.pdf");
    expect(first.attachments![0]!.contentType).toBe("application/pdf");
    expect(first.attachments![0]!.content).toEqual(pdfBuffer);
  });

  it("handles invitation_expiry_reminder with days remaining and actionable renewal link", async () => {
    const memoryEmail = new MemoryEmailAdapter();
    const mockPg = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("FROM invitations")) {
          return {
            rows: [
              {
                id: "inv-remind-1",
                internal_name: "Pernikahan Sarah & Rizky",
                slug: "sarah-rizky",
                expiry_date: "2026-10-24",
                user_id: "user-5",
                email: "sarah@example.com",
                full_name: "Sarah Amalia",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as PgPool;

    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: createMockEnv(),
    });

    await handler(
      {
        template: "invitation_expiry_reminder",
        invitationId: "inv-remind-1",
        daysRemaining: 7,
      },
      dummyContext,
    );

    const sent = memoryEmail.getSent();
    expect(sent).toHaveLength(1);
    const first = sent[0]!;
    expect(first.to).toBe("sarah@example.com");
    expect(first.subject).toContain("Pengingat: Masa Aktif Undangan");
    expect(first.subject).toContain("7 Hari");
    expect(first.html).toContain("Sarah &amp; Rizky");
    expect(first.html).toContain(
      "https://momenbahagia.id/dashboard/invitations/inv-remind-1/renew",
    );
    expect(first.html).toContain(
      "https://undangan.momenbahagia.id/sarah-rizky",
    );
  });

  it("handles invitation_retention_warning with warning number and deletion countdown", async () => {
    const memoryEmail = new MemoryEmailAdapter();
    const mockPg = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("FROM invitations")) {
          return {
            rows: [
              {
                id: "inv-warn-1",
                internal_name: "Pernikahan Sarah & Rizky",
                slug: "sarah-rizky",
                expiry_date: "2026-08-01",
                user_id: "user-5",
                email: "sarah@example.com",
                full_name: "Sarah Amalia",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as PgPool;

    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: createMockEnv(),
    });

    await handler(
      {
        template: "invitation_retention_warning",
        invitationId: "inv-warn-1",
        warningNumber: 2,
        daysRemainingUntilDeletion: 30,
      },
      dummyContext,
    );

    const sent = memoryEmail.getSent();
    expect(sent).toHaveLength(1);
    const first = sent[0]!;
    expect(first.to).toBe("sarah@example.com");
    expect(first.subject).toContain("30 Hari Tersisa");
    expect(first.html).toContain("Pemberitahuan ke-2");
    expect(first.html).toContain(
      "https://momenbahagia.id/dashboard/invitations/inv-warn-1/renew",
    );
  });

  it("handles order_refunded with refund amount and reason", async () => {
    const memoryEmail = new MemoryEmailAdapter();
    const mockPg = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("FROM orders")) {
          return {
            rows: [
              {
                id: "ord-ref-9999",
                amount_total: "149000",
                package_name: "Paket Premium",
                user_id: "user-5",
                email: "sarah@example.com",
                full_name: "Sarah Amalia",
                invitation_title: "Sarah & Rizky",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as PgPool;

    const handler = makeNotificationSendHandler({
      pg: mockPg,
      emailPort: memoryEmail,
      env: createMockEnv(),
    });

    await handler(
      {
        template: "order_refunded",
        orderId: "ord-ref-9999",
        reason: "Permintaan pembatalan pernikahan",
      },
      dummyContext,
    );

    const sent = memoryEmail.getSent();
    expect(sent).toHaveLength(1);
    const first = sent[0]!;
    expect(first.to).toBe("sarah@example.com");
    expect(first.subject).toContain("Pengembalian Dana Berhasil Diproses");
    expect(first.html).toContain("Rp 149.000");
    expect(first.html).toContain("Permintaan pembatalan pernikahan");
    expect(first.html).toContain("https://momenbahagia.id/dashboard/orders");
  });
});

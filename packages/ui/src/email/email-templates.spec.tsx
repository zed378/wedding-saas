import { describe, expect, it } from "vitest";
import { renderEmail } from "./index.js";

describe("Email Templates & Rendering (P4-06)", () => {
  it("renders EmailVerificationEmail with DOCTYPE, html and plaintext", () => {
    const rendered = renderEmail("email_verification", {
      recipientName: "Budi Pratama",
      verificationUrl: "https://momenbahagia.id/verify?token=xyz123",
    });

    expect(rendered.subject).toContain("Verifikasi");
    expect(rendered.html).toMatch(/^<!DOCTYPE html>/i);
    expect(rendered.html).toContain("Budi Pratama");
    expect(rendered.html).toContain(
      "https://momenbahagia.id/verify?token=xyz123",
    );
    expect(rendered.text).toContain("Budi Pratama");
    expect(rendered.text).toContain(
      "https://momenbahagia.id/verify?token=xyz123",
    );
    expect(rendered.text).not.toContain("<table");
  });

  it("renders PasswordResetEmail with expiry warning", () => {
    const rendered = renderEmail("password_reset", {
      recipientName: "Siti Rahma",
      resetUrl: "https://momenbahagia.id/reset?token=abc",
      expiresInMinutes: 30,
    });

    expect(rendered.subject).toContain("Atur Ulang Kata Sandi");
    expect(rendered.html).toContain("30 menit");
    expect(rendered.text).toContain("30 menit");
  });

  it("renders PasswordChangedEmail as a security notification", () => {
    const rendered = renderEmail("password_changed", {
      recipientName: "Siti Rahma",
      changedAt: "17 Oktober 2026 14:00 WIB",
      supportUrl: "https://momenbahagia.id/support",
    });

    expect(rendered.subject).toContain("Kata Sandi Berhasil Diubah");
    expect(rendered.html).toContain("Pemberitahuan Keamanan");
    expect(rendered.html).toContain("17 Oktober 2026 14:00 WIB");
    expect(rendered.text).toContain("segera hubungi tim bantuan");
  });

  it("renders ExistingAccountRegistrationEmail safely without revealing sensitive info", () => {
    const rendered = renderEmail("registration_attempt_existing_account", {
      recipientName: "Andi Wijaya",
      loginUrl: "https://momenbahagia.id/login",
      resetUrl: "https://momenbahagia.id/forgot-password",
    });

    expect(rendered.subject).toContain("Upaya Pendaftaran");
    expect(rendered.html).toContain("https://momenbahagia.id/login");
    expect(rendered.html).toContain("https://momenbahagia.id/forgot-password");
  });

  it("renders AccountDeletionRequestedEmail with warning of live invitations", () => {
    const rendered = renderEmail("account_deletion_requested", {
      recipientName: "Rian Hidayat",
      liveInvitations: 2,
    });

    expect(rendered.subject).toContain("Permintaan Penghapusan Akun");
    expect(rendered.html).toContain("2 undangan yang aktif");
  });

  it("renders OrderPaidEmail with payment details and invoice", () => {
    const rendered = renderEmail("order_paid", {
      recipientName: "Maya Putri",
      orderNumber: "INV-202610-0012",
      packageName: "Paket Premium",
      amountFormatted: "Rp 149.000",
      invoiceUrl: "https://momenbahagia.id/invoices/inv-0012.pdf",
      invitationTitle: "Pernikahan Maya & Dimas",
      dashboardUrl: "https://momenbahagia.id/dashboard/orders",
    });

    expect(rendered.subject).toContain("Pembayaran Berhasil");
    expect(rendered.html).toContain("INV-202610-0012");
    expect(rendered.html).toContain("Paket Premium");
    expect(rendered.html).toContain("Rp 149.000");
    expect(rendered.html).toContain("Faktur Pembayaran");
  });

  it("renders BankAccountChangedEmail with security banner and masked account", () => {
    const rendered = renderEmail("bank_account_changed", {
      recipientName: "Dimas Anggara",
      invitationTitle: "Pernikahan Maya & Dimas",
      changeType: "changed",
      providerName: "Bank Central Asia (BCA)",
      accountNumberMasked: "•••• 5678",
      changedAt: "17 Oktober 2026 21:30 WIB",
      dashboardUrl: "https://momenbahagia.id/dashboard/invitations/123/gift",
    });

    expect(rendered.subject).toContain(
      "Peringatan Keamanan: Perubahan Rekening",
    );
    expect(rendered.html).toContain("Pemberitahuan Keamanan");
    expect(rendered.html).toContain("Bank Central Asia (BCA)");
    expect(rendered.html).toContain("•••• 5678");
  });

  it("renders InvitationPublishedEmail with public link and expiry date", () => {
    const rendered = renderEmail("invitation_published", {
      recipientName: "Maya & Dimas",
      invitationTitle: "Pernikahan Maya & Dimas",
      publicUrl: "https://maya-dimas.momenbahagia.id",
      expiryDate: "17 April 2027",
    });

    expect(rendered.subject).toContain("Telah Tayang");
    expect(rendered.html).toContain("https://maya-dimas.momenbahagia.id");
    expect(rendered.html).toContain("17 April 2027");
  });

  it("renders InvitationExpiredEmail with renewal link", () => {
    const rendered = renderEmail("invitation_expired", {
      recipientName: "Maya & Dimas",
      invitationTitle: "Pernikahan Maya & Dimas",
      renewalUrl: "https://momenbahagia.id/dashboard/renew",
      expiredDate: "17 Oktober 2026",
    });

    expect(rendered.subject).toContain("Telah Berakhir");
    expect(rendered.html).toContain("Perpanjang Masa Aktif");
  });

  it("renders RsvpSubmittedEmail with attendee status and count", () => {
    const rendered = renderEmail("rsvp_submitted", {
      recipientName: "Maya & Dimas",
      invitationTitle: "Pernikahan Maya & Dimas",
      guestName: "Ahmad Dahlan",
      attendanceStatus: "attending",
      guestCount: 2,
      dashboardUrl: "https://momenbahagia.id/dashboard/rsvp",
    });

    expect(rendered.subject).toContain(
      "Konfirmasi Kehadiran Baru dari Ahmad Dahlan",
    );
    expect(rendered.html).toContain("Akan Hadir");
    expect(rendered.html).toContain("2 orang");
  });

  it("renders GuestbookSubmittedEmail with message preview and moderation note", () => {
    const rendered = renderEmail("guestbook_submitted", {
      recipientName: "Maya & Dimas",
      invitationTitle: "Pernikahan Maya & Dimas",
      guestName: "Fitri Handayani",
      message: "Selamat menempuh hidup baru semoga sakinah mawaddah warahmah!",
      status: "pending",
      moderationUrl: "https://momenbahagia.id/dashboard/guestbook",
    });

    expect(rendered.subject).toContain(
      "Ucapan Buku Tamu Baru dari Fitri Handayani",
    );
    expect(rendered.html).toContain(
      "Catatan: Pesan ini memerlukan persetujuan",
    );
    expect(rendered.html).toContain("Selamat menempuh hidup baru");
  });

  it("renders InvitationExpiryReminderEmail with days remaining and actionable renewal link", () => {
    const rendered = renderEmail("invitation_expiry_reminder", {
      recipientName: "Bambang & Anisa",
      invitationTitle: "Pernikahan Bambang & Anisa",
      daysRemaining: 7,
      expiryDateFormatted: "24 Oktober 2026",
      renewalUrl: "https://momenbahagia.id/dashboard/invitations/inv-123/renew",
      publicUrl: "https://bambang-anisa.momenbahagia.id",
    });

    expect(rendered.subject).toContain("Pengingat: Masa Aktif Undangan");
    expect(rendered.subject).toContain("7 Hari");
    expect(rendered.html).toContain("7 hari");
    expect(rendered.html).toContain("24 Oktober 2026");
    expect(rendered.html).toContain(
      "https://momenbahagia.id/dashboard/invitations/inv-123/renew",
    );
    expect(rendered.html).toContain("https://bambang-anisa.momenbahagia.id");
  });

  it("renders InvitationRetentionWarningEmail with warning number and deletion countdown", () => {
    const rendered = renderEmail("invitation_retention_warning", {
      recipientName: "Bambang & Anisa",
      invitationTitle: "Pernikahan Bambang & Anisa",
      warningNumber: 1,
      daysRemainingUntilDeletion: 60,
      deletionDateFormatted: "15 Desember 2026",
      renewalUrl: "https://momenbahagia.id/dashboard/invitations/inv-123/renew",
      dashboardUrl: "https://momenbahagia.id/dashboard",
    });

    expect(rendered.subject).toContain(
      "Peringatan Penghapusan Data Undangan: 60 Hari Tersisa",
    );
    expect(rendered.html).toContain("Pemberitahuan ke-1");
    expect(rendered.html).toContain("60 hari");
    expect(rendered.html).toContain("15 Desember 2026");
    expect(rendered.html).toContain("Perpanjang &amp; Pulihkan Undangan");
    expect(rendered.text).toContain("Perpanjang & Pulihkan Undangan");
  });

  it("renders OrderRefundedEmail with refund amount and optional reason", () => {
    const rendered = renderEmail("order_refunded", {
      recipientName: "Bambang Sudirman",
      orderNumber: "ORD-98765432",
      invitationTitle: "Pernikahan Bambang & Anisa",
      amountFormatted: "Rp 149.000",
      reason: "Permintaan pembatalan sebelum acara",
      dashboardUrl: "https://momenbahagia.id/dashboard/orders",
      supportUrl: "https://momenbahagia.id/support",
    });

    expect(rendered.subject).toContain(
      "Pengembalian Dana Berhasil Diproses — Pesanan #ORD-98765432",
    );
    expect(rendered.html).toContain("Rp 149.000");
    expect(rendered.html).toContain("Permintaan pembatalan sebelum acara");
    expect(rendered.html).toContain("https://momenbahagia.id/dashboard/orders");
  });

  it("renders gracefully with very long names and missing optional fields", () => {
    const veryLongName =
      "Raden Mas Panji Sosrokartono Jayadiningrat Kusumabrata Mangunkusumo Yudhanegara Sastrodiningrat";
    const rendered = renderEmail("order_paid", {
      recipientName: veryLongName,
      orderNumber: "ORD-00000001",
      packageName: "Paket Silver",
      amountFormatted: "Rp 99.000",
      dashboardUrl: "https://momenbahagia.id/dashboard",
      // optional fields omitted: invoiceUrl, invitationTitle, previewText, preferencesUrl
    });

    expect(rendered.html).toContain(veryLongName);
    expect(rendered.html).toContain("Rp 99.000");
    expect(rendered.html).toContain("ORD-00000001");
  });

  it("renders RsvpDailyDigestEmail with summary stats and recent guests table", () => {
    const rendered = renderEmail("rsvp_daily_digest", {
      recipientName: "Budi & Siti",
      invitationTitle: "Pernikahan Budi & Siti",
      dateFormatted: "17 Oktober 2026",
      totalResponsesToday: 15,
      attendingCount: 12,
      notAttendingCount: 2,
      maybeCount: 1,
      recentGuests: [
        {
          guestName: "Ahmad Fauzi",
          attendanceStatus: "attending",
          guestCount: 2,
        },
        {
          guestName: "Citra Lestari",
          attendanceStatus: "not_attending",
          guestCount: 1,
        },
      ],
      dashboardUrl: "https://momenbahagia.id/dashboard/invitations/123/rsvp",
      preferencesUrl: "https://momenbahagia.id/settings/notifications",
    });

    expect(rendered.subject).toContain("Ringkasan RSVP Harian");
    expect(rendered.subject).toContain("Pernikahan Budi & Siti");
    expect(rendered.html).toContain("15 konfirmasi");
    expect(rendered.html).toContain("Ahmad Fauzi");
    expect(rendered.html).toContain("Hadir");
    expect(rendered.html).toContain("Citra Lestari");
    expect(rendered.html).toContain("Tidak Hadir");
    expect(rendered.html).toContain("https://momenbahagia.id/settings/notifications");
    expect(rendered.text).toContain("15 konfirmasi");
  });

  it("throws error for unknown template key", () => {
    expect(() => {
      // @ts-expect-error test invalid key
      renderEmail("unknown_key", {});
    }).toThrow(/Unknown email template/);
  });
});

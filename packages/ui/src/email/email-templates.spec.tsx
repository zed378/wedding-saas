import { describe, expect, it } from "vitest";
import {
  renderEmail,
} from "./index.js";

describe("Email Templates & Rendering (P4-06)", () => {
  it("renders EmailVerificationEmail with DOCTYPE, html and plaintext", () => {
    const rendered = renderEmail("email_verification", {
      recipientName: "Budi Pratama",
      verificationUrl: "https://momenbahagia.id/verify?token=xyz123",
    });

    expect(rendered.subject).toContain("Verifikasi");
    expect(rendered.html).toMatch(/^<!DOCTYPE html>/i);
    expect(rendered.html).toContain("Budi Pratama");
    expect(rendered.html).toContain("https://momenbahagia.id/verify?token=xyz123");
    expect(rendered.text).toContain("Budi Pratama");
    expect(rendered.text).toContain("https://momenbahagia.id/verify?token=xyz123");
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

    expect(rendered.subject).toContain("Peringatan Keamanan: Perubahan Rekening");
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

    expect(rendered.subject).toContain("Konfirmasi Kehadiran Baru dari Ahmad Dahlan");
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

    expect(rendered.subject).toContain("Ucapan Buku Tamu Baru dari Fitri Handayani");
    expect(rendered.html).toContain("Catatan: Pesan ini memerlukan persetujuan");
    expect(rendered.html).toContain("Selamat menempuh hidup baru");
  });

  it("throws error for unknown template key", () => {
    expect(() => {
      // @ts-expect-error test invalid key
      renderEmail("unknown_key", {});
    }).toThrow(/Unknown email template/);
  });
});

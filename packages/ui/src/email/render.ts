import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  EmailTemplateKey,
  RenderedEmail,
  EmailVerificationProps,
  PasswordResetProps,
  PasswordChangedProps,
  ExistingAccountRegistrationProps,
  AccountDeletionRequestedProps,
  OrderPaidProps,
  BankAccountChangedProps,
  InvitationPublishedProps,
  InvitationExpiredProps,
  RsvpSubmittedProps,
  GuestbookSubmittedProps,
  InvitationExpiryReminderProps,
  InvitationRetentionWarningProps,
  OrderRefundedProps,
} from "./types.js";
import {
  EmailVerificationEmail,
  PasswordResetEmail,
  PasswordChangedEmail,
  ExistingAccountRegistrationEmail,
  AccountDeletionRequestedEmail,
  OrderPaidEmail,
  BankAccountChangedEmail,
  InvitationPublishedEmail,
  InvitationExpiredEmail,
  RsvpSubmittedEmail,
  GuestbookSubmittedEmail,
  InvitationExpiryReminderEmail,
  InvitationRetentionWarningEmail,
  OrderRefundedEmail,
} from "./templates.js";

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Render an email template by key and typed props (P4-06).
 * Returns subject, html (with DOCTYPE), and clean text version.
 */
export function renderEmail(
  template: "email_verification",
  props: EmailVerificationProps,
): RenderedEmail;
export function renderEmail(
  template: "password_reset",
  props: PasswordResetProps,
): RenderedEmail;
export function renderEmail(
  template: "password_changed",
  props: PasswordChangedProps,
): RenderedEmail;
export function renderEmail(
  template: "registration_attempt_existing_account",
  props: ExistingAccountRegistrationProps,
): RenderedEmail;
export function renderEmail(
  template: "account_deletion_requested",
  props: AccountDeletionRequestedProps,
): RenderedEmail;
export function renderEmail(
  template: "order_paid",
  props: OrderPaidProps,
): RenderedEmail;
export function renderEmail(
  template: "bank_account_changed",
  props: BankAccountChangedProps,
): RenderedEmail;
export function renderEmail(
  template: "invitation_published",
  props: InvitationPublishedProps,
): RenderedEmail;
export function renderEmail(
  template: "invitation_expired",
  props: InvitationExpiredProps,
): RenderedEmail;
export function renderEmail(
  template: "rsvp_submitted",
  props: RsvpSubmittedProps,
): RenderedEmail;
export function renderEmail(
  template: "guestbook_submitted",
  props: GuestbookSubmittedProps,
): RenderedEmail;
export function renderEmail(
  template: "invitation_expiry_reminder",
  props: InvitationExpiryReminderProps,
): RenderedEmail;
export function renderEmail(
  template: "invitation_retention_warning",
  props: InvitationRetentionWarningProps,
): RenderedEmail;
export function renderEmail(
  template: "order_refunded",
  props: OrderRefundedProps,
): RenderedEmail;
export function renderEmail(
  template: EmailTemplateKey,
  props: unknown,
): RenderedEmail {
  let element: React.JSX.Element;
  let subject: string;

  switch (template) {
    case "email_verification": {
      const p = props as unknown as EmailVerificationProps;
      element = React.createElement(EmailVerificationEmail, p);
      subject = "Verifikasi Alamat Email Anda — Momen Bahagia";
      break;
    }
    case "password_reset": {
      const p = props as unknown as PasswordResetProps;
      element = React.createElement(PasswordResetEmail, p);
      subject = "Atur Ulang Kata Sandi Akun Momen Bahagia";
      break;
    }
    case "password_changed": {
      const p = props as unknown as PasswordChangedProps;
      element = React.createElement(PasswordChangedEmail, p);
      subject = "Keamanan Akun: Kata Sandi Berhasil Diubah";
      break;
    }
    case "registration_attempt_existing_account": {
      const p = props as unknown as ExistingAccountRegistrationProps;
      element = React.createElement(ExistingAccountRegistrationEmail, p);
      subject = "Pemberitahuan: Upaya Pendaftaran Akun Momen Bahagia";
      break;
    }
    case "account_deletion_requested": {
      const p = props as unknown as AccountDeletionRequestedProps;
      element = React.createElement(AccountDeletionRequestedEmail, p);
      subject = "Konfirmasi Permintaan Penghapusan Akun Momen Bahagia";
      break;
    }
    case "order_paid": {
      const p = props as unknown as OrderPaidProps;
      element = React.createElement(OrderPaidEmail, p);
      subject = `Pembayaran Berhasil — Pesanan #${p.orderNumber}`;
      break;
    }
    case "bank_account_changed": {
      const p = props as unknown as BankAccountChangedProps;
      element = React.createElement(BankAccountChangedEmail, p);
      subject = `Peringatan Keamanan: Perubahan Rekening Undangan "${p.invitationTitle}"`;
      break;
    }
    case "invitation_published": {
      const p = props as unknown as InvitationPublishedProps;
      element = React.createElement(InvitationPublishedEmail, p);
      subject = `Selamat! Undangan "${p.invitationTitle}" Telah Tayang`;
      break;
    }
    case "invitation_expired": {
      const p = props as unknown as InvitationExpiredProps;
      element = React.createElement(InvitationExpiredEmail, p);
      subject = `Masa Aktif Undangan "${p.invitationTitle}" Telah Berakhir`;
      break;
    }
    case "invitation_expiry_reminder": {
      const p = props as unknown as InvitationExpiryReminderProps;
      element = React.createElement(InvitationExpiryReminderEmail, p);
      subject = `Pengingat: Masa Aktif Undangan "${p.invitationTitle}" Berakhir dalam ${p.daysRemaining} Hari`;
      break;
    }
    case "invitation_retention_warning": {
      const p = props as unknown as InvitationRetentionWarningProps;
      element = React.createElement(InvitationRetentionWarningEmail, p);
      subject = `Peringatan Penghapusan Data Undangan: ${p.daysRemainingUntilDeletion} Hari Tersisa`;
      break;
    }
    case "order_refunded": {
      const p = props as unknown as OrderRefundedProps;
      element = React.createElement(OrderRefundedEmail, p);
      subject = `Pengembalian Dana Berhasil Diproses — Pesanan #${p.orderNumber}`;
      break;
    }
    case "rsvp_submitted": {
      const p = props as unknown as RsvpSubmittedProps;
      element = React.createElement(RsvpSubmittedEmail, p);
      subject = `Konfirmasi Kehadiran Baru dari ${p.guestName} ("${p.invitationTitle}")`;
      break;
    }
    case "guestbook_submitted": {
      const p = props as unknown as GuestbookSubmittedProps;
      element = React.createElement(GuestbookSubmittedEmail, p);
      subject = `Ucapan Buku Tamu Baru dari ${p.guestName} ("${p.invitationTitle}")`;
      break;
    }
    default: {
      const exhaustiveCheck: never = template;
      throw new Error(`Unknown email template: ${exhaustiveCheck}`);
    }
  }

  const markup = renderToStaticMarkup(element);
  const html = `<!DOCTYPE html>\n${markup}`;
  const text = stripHtml(markup);

  return { subject, html, text };
}

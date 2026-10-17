#!/usr/bin/env node

/**
 * CLI tool to render and preview transactional email templates locally (P4-06).
 *
 * Usage:
 *   node scripts/preview-email.mjs [template_name]
 *
 * Example:
 *   node scripts/preview-email.mjs order_paid
 *   node scripts/preview-email.mjs rsvp_submitted
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// Dynamic import from compiled @wi/ui
const uiPath = path.resolve(rootDir, "packages/ui/dist/email/index.js");
if (!fs.existsSync(uiPath)) {
  console.error("Error: @wi/ui is not built yet. Run 'pnpm --filter @wi/ui build' first.");
  process.exit(1);
}

const { renderEmail } = await import(`file://${uiPath}`);

const sampleProps = {
  email_verification: {
    recipientName: "Budi Pratama",
    verificationUrl: "https://momenbahagia.id/auth/verify-email?token=preview_token_123",
  },
  password_reset: {
    recipientName: "Siti Rahma",
    resetUrl: "https://momenbahagia.id/auth/reset-password?token=preview_reset_456",
    expiresInMinutes: 60,
  },
  password_changed: {
    recipientName: "Siti Rahma",
    changedAt: "17 Oktober 2026 21:00 WIB",
    supportUrl: "https://momenbahagia.id/support",
  },
  registration_attempt_existing_account: {
    recipientName: "Andi Wijaya",
    loginUrl: "https://momenbahagia.id/auth/login",
    resetUrl: "https://momenbahagia.id/auth/forgot-password",
  },
  account_deletion_requested: {
    recipientName: "Rian Hidayat",
    liveInvitations: 2,
    supportUrl: "https://momenbahagia.id/support",
  },
  order_paid: {
    recipientName: "Maya Putri",
    orderNumber: "INV-202610-0012",
    packageName: "Paket Premium (12 Bulan)",
    amountFormatted: "Rp 149.000",
    invoiceUrl: "https://momenbahagia.id/api/orders/ord-123/invoice",
    invitationTitle: "Pernikahan Maya & Dimas",
    dashboardUrl: "https://momenbahagia.id/dashboard/orders",
  },
  bank_account_changed: {
    recipientName: "Dimas Anggara",
    invitationTitle: "Pernikahan Maya & Dimas",
    changeType: "changed",
    providerName: "Bank Central Asia (BCA)",
    accountNumberMasked: "•••• 5678",
    changedAt: "17 Oktober 2026 21:30 WIB",
    dashboardUrl: "https://momenbahagia.id/dashboard/invitations/inv-1/gift",
  },
  invitation_published: {
    recipientName: "Maya & Dimas",
    invitationTitle: "Pernikahan Maya & Dimas",
    publicUrl: "https://maya-dimas.momenbahagia.id",
    expiryDate: "17 April 2027",
    isTrial: false,
  },
  invitation_expired: {
    recipientName: "Maya & Dimas",
    invitationTitle: "Pernikahan Maya & Dimas",
    renewalUrl: "https://momenbahagia.id/dashboard/invitations/inv-1/renew",
    expiredDate: "17 Oktober 2026",
  },
  invitation_expiry_reminder: {
    recipientName: "Maya & Dimas",
    invitationTitle: "Pernikahan Maya & Dimas",
    daysRemaining: 7,
    expiryDateFormatted: "24 Oktober 2026",
    renewalUrl: "https://momenbahagia.id/dashboard/invitations/inv-1/renew",
    publicUrl: "https://undangan.momenbahagia.id/maya-dimas",
  },
  invitation_retention_warning: {
    recipientName: "Maya & Dimas",
    invitationTitle: "Pernikahan Maya & Dimas",
    warningNumber: 1,
    daysRemainingUntilDeletion: 60,
    deletionDateFormatted: "16 Desember 2026",
    renewalUrl: "https://momenbahagia.id/dashboard/invitations/inv-1/renew",
    dashboardUrl: "https://momenbahagia.id/dashboard",
  },
  order_refunded: {
    recipientName: "Maya Putri",
    orderNumber: "ORD-202610-0042",
    invitationTitle: "Pernikahan Maya & Dimas",
    amountFormatted: "Rp 149.000",
    reason: "Permintaan pembatalan sebelum publish",
    supportUrl: "https://momenbahagia.id/support",
    dashboardUrl: "https://momenbahagia.id/dashboard/orders",
  },
  rsvp_submitted: {
    recipientName: "Maya & Dimas",
    invitationTitle: "Pernikahan Maya & Dimas",
    guestName: "Ahmad Dahlan",
    attendanceStatus: "attending",
    guestCount: 2,
    dashboardUrl: "https://momenbahagia.id/dashboard/invitations/inv-1/rsvp",
    preferencesUrl: "https://momenbahagia.id/dashboard/settings/notifications",
  },
  guestbook_submitted: {
    recipientName: "Maya & Dimas",
    invitationTitle: "Pernikahan Maya & Dimas",
    guestName: "Fitri Handayani",
    message: "Selamat menempuh hidup baru semoga sakinah mawaddah warahmah dan selalu dalam lindungan-Nya!",
    status: "pending",
    moderationUrl: "https://momenbahagia.id/dashboard/invitations/inv-1/guestbook",
    preferencesUrl: "https://momenbahagia.id/dashboard/settings/notifications",
  },
};

const templateArg = process.argv[2];
const templatesToRender = templateArg ? [templateArg] : Object.keys(sampleProps);

const outDir = path.resolve(rootDir, ".email-previews");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log(`Rendering email preview(s)...`);

for (const tmpl of templatesToRender) {
  const props = sampleProps[tmpl];
  if (!props) {
    console.error(`Unknown template: "${tmpl}". Available: ${Object.keys(sampleProps).join(", ")}`);
    process.exit(1);
  }

  const rendered = renderEmail(tmpl, props);
  const outPath = path.resolve(outDir, `${tmpl}.html`);
  fs.writeFileSync(outPath, rendered.html, "utf8");

  console.log(`\n========================================`);
  console.log(`Template : ${tmpl}`);
  console.log(`Subject  : ${rendered.subject}`);
  console.log(`File     : ${outPath}`);
  console.log(`---------------- Plaintext -------------`);
  console.log(rendered.text.slice(0, 300) + (rendered.text.length > 300 ? "\n..." : ""));
}

console.log(`\nPreviews written to: ${outDir}`);

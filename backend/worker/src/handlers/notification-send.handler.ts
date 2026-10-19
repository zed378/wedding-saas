import { Pool as PgPool } from "pg";
import { renderEmail } from "@wi/ui/email";
import type { Handler, JobContext } from "../runner.js";
import type { EmailPort } from "../email/email-port.js";
import type { WorkerEnv } from "../env.js";
import { logger } from "../logger.js";
import type { NotificationJobPayload } from "./notification-send.types.js";

export interface NotificationHandlerDeps {
  readonly pg: PgPool;
  readonly emailPort: EmailPort;
  readonly env: WorkerEnv;
}

interface UserRow {
  email: string;
  full_name: string;
}

interface UserPrefsRow {
  rsvp_email: boolean;
  rsvp_digest: boolean;
  guestbook_email: boolean;
}

interface InvitationOwnerRow {
  id: string;
  internal_name: string | null;
  slug: string | null;
  expiry_date: string | null;
  user_id: string;
  email: string;
  full_name: string;
}

interface OrderRow {
  id: string;
  amount_total: string | number;
  package_name: string;
  user_id: string;
  email: string;
  full_name: string;
  invitation_title: string | null;
}

function formatRupiah(amount: number | string | bigint): string {
  const num = typeof amount === "bigint" ? Number(amount) : Number(amount);
  return `Rp ${num.toLocaleString("id-ID")}`;
}

function formatDateId(dateVal: string | Date | null | undefined): string {
  if (!dateVal) return "Belum ditentukan";
  const d = typeof dateVal === "string" ? new Date(dateVal) : dateVal;
  if (isNaN(d.getTime())) return String(dateVal);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTimeWib(dateVal: Date = new Date()): string {
  return (
    dateVal.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta",
    }) + " WIB"
  );
}

/**
 * Worker handler for `notification.send` job (P4-06).
 *
 * Implements centralized transactional email dispatch per ADR-001, ADR-013, and ADR-025.
 * Enforces preference opt-out for RSVP and Guestbook notifications, while guaranteeing
 * security and account lifecycle emails are strictly non-opt-outable.
 */
export function makeNotificationSendHandler(
  deps: NotificationHandlerDeps,
): Handler<NotificationJobPayload> {
  const { pg, env } = deps;

  // P4-08: Dead-address suppression. Hard bounces and complaints are permanently suppressed.
  const emailPort: EmailPort = {
    async send(message) {
      const normalizedEmail = message.to.toLowerCase().trim();
      const bounceRes = await pg.query<{ id: string }>(
        "SELECT id FROM email_bounces WHERE email = $1 AND bounce_type IN ('hard_bounce', 'complaint') LIMIT 1",
        [normalizedEmail],
      );
      if ((bounceRes.rowCount ?? 0) > 0) {
        logger.warn(
          { context: { to: message.to, subject: message.subject } },
          "email dispatch suppressed due to prior hard bounce or complaint",
        );
        return { id: "suppressed-bounce", status: "simulated" };
      }
      return deps.emailPort.send(message);
    },
  };

  async function fetchUser(userId: string): Promise<UserRow | null> {
    const res = await pg.query<UserRow>(
      "SELECT email, full_name FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
      [userId],
    );
    return res.rows[0] ?? null;
  }

  async function fetchUserPrefs(userId: string): Promise<UserPrefsRow> {
    const res = await pg.query<UserPrefsRow>(
      "SELECT rsvp_email, rsvp_digest, guestbook_email FROM user_notification_preferences WHERE user_id = $1 LIMIT 1",
      [userId],
    );
    if (!res.rows[0]) {
      return { rsvp_email: true, rsvp_digest: false, guestbook_email: true };
    }
    return res.rows[0];
  }

  async function fetchInvitationOwner(
    invitationId: string,
  ): Promise<InvitationOwnerRow | null> {
    const res = await pg.query<InvitationOwnerRow>(
      `SELECT i.id, i.internal_name, i.slug, i.expiry_date, u.id as user_id, u.email, u.full_name
       FROM invitations i
       JOIN users u ON u.id = i.owner_id
       WHERE i.id = $1 AND u.deleted_at IS NULL
       LIMIT 1`,
      [invitationId],
    );
    return res.rows[0] ?? null;
  }

  async function fetchOrderDetails(orderId: string): Promise<OrderRow | null> {
    const res = await pg.query<OrderRow>(
      `SELECT o.id, o.amount_total, p.name as package_name, u.id as user_id, u.email, u.full_name, i.internal_name as invitation_title
       FROM orders o
       JOIN users u ON u.id = o.user_id
       JOIN packages p ON p.id = o.package_id
       LEFT JOIN invitations i ON i.id = o.invitation_id
       WHERE o.id = $1 AND u.deleted_at IS NULL
       LIMIT 1`,
      [orderId],
    );
    return res.rows[0] ?? null;
  }

  async function fetchInvoice(
    orderId: string,
  ): Promise<{ number: string; pdf: Buffer } | null> {
    const res = await pg.query<{ number: string; pdf: Buffer }>(
      "SELECT number, pdf FROM invoices WHERE order_id = $1 LIMIT 1",
      [orderId],
    );
    return res.rows[0] ?? null;
  }

  return async (
    data: NotificationJobPayload,
    context: JobContext,
  ): Promise<void> => {
    logger.debug(
      {
        context: { event: "notification.processing", template: data.template },
      },
      "handling notification.send",
    );

    const appOrigin = env.appOrigin.replace(/\/$/, "");
    const publicOrigin = env.publicInviteOrigin.replace(/\/$/, "");

    switch (data.template) {
      case "email_verification": {
        const user = await fetchUser(data.userId);
        if (!user) {
          logger.warn(
            { context: { user_id: data.userId, template: data.template } },
            "user not found for email_verification, skipping",
          );
          return;
        }

        const verificationUrl = `${appOrigin}/auth/verify-email?token=${encodeURIComponent(data.token)}`;
        const rendered = renderEmail("email_verification", {
          recipientName: user.full_name,
          verificationUrl,
        });

        await emailPort.send({
          to: user.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: `verification:${data.userId}:${context.attempt}`,
        });
        break;
      }

      case "password_reset": {
        const user = await fetchUser(data.userId);
        if (!user) {
          logger.warn(
            { context: { user_id: data.userId, template: data.template } },
            "user not found for password_reset, skipping",
          );
          return;
        }

        const resetUrl = `${appOrigin}/auth/reset-password?token=${encodeURIComponent(data.token)}`;
        const rendered = renderEmail("password_reset", {
          recipientName: user.full_name,
          resetUrl,
          expiresInMinutes: 60,
        });

        await emailPort.send({
          to: user.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: `pw-reset:${data.userId}:${context.attempt}`,
        });
        break;
      }

      case "password_changed": {
        // Security notification: non-opt-outable (ADR-025)
        const user = await fetchUser(data.userId);
        if (!user) {
          logger.warn(
            { context: { user_id: data.userId, template: data.template } },
            "user not found for password_changed, skipping",
          );
          return;
        }

        const rendered = renderEmail("password_changed", {
          recipientName: user.full_name,
          changedAt: formatDateTimeWib(new Date()),
          supportUrl: `${appOrigin}/support`,
        });

        await emailPort.send({
          to: user.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: `pw-changed:${data.userId}:${context.attempt}`,
        });
        break;
      }

      case "registration_attempt_existing_account": {
        const user = await fetchUser(data.userId);
        if (!user) return;

        const rendered = renderEmail("registration_attempt_existing_account", {
          recipientName: user.full_name,
          loginUrl: `${appOrigin}/auth/login`,
          resetUrl: `${appOrigin}/auth/forgot-password`,
        });

        await emailPort.send({
          to: user.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        break;
      }

      case "account_deletion_requested": {
        const user = await fetchUser(data.userId);
        if (!user) return;

        const rendered = renderEmail("account_deletion_requested", {
          recipientName: user.full_name,
          liveInvitations: data.liveInvitations,
          supportUrl: `${appOrigin}/support`,
        });

        await emailPort.send({
          to: user.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        break;
      }

      case "order_paid": {
        const order = await fetchOrderDetails(data.orderId);
        if (!order) {
          logger.warn(
            { context: { order_id: data.orderId, template: data.template } },
            "order not found for order_paid email, skipping",
          );
          return;
        }

        const invoice = await fetchInvoice(data.orderId);
        const attachments = invoice
          ? [
              {
                filename: `${invoice.number}.pdf`,
                content: invoice.pdf,
                contentType: "application/pdf",
              },
            ]
          : undefined;

        const rendered = renderEmail("order_paid", {
          recipientName: order.full_name,
          orderNumber: order.id.slice(0, 8).toUpperCase(),
          packageName: order.package_name,
          amountFormatted: formatRupiah(order.amount_total),
          invoiceUrl: `${appOrigin}/api/orders/${order.id}/invoice`,
          invitationTitle: order.invitation_title ?? undefined,
          dashboardUrl: `${appOrigin}/dashboard/orders`,
        });

        await emailPort.send({
          to: order.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: `order-paid:${order.id}:${context.attempt}`,
          ...(attachments ? { attachments } : {}),
        });
        break;
      }

      case "bank_account_changed": {
        // Security notification: non-opt-outable (docs/PLAN/13, ADR-025)
        const owner = await fetchInvitationOwner(data.invitationId);
        if (!owner) {
          logger.warn(
            {
              context: {
                invitation_id: data.invitationId,
                template: data.template,
              },
            },
            "invitation not found for bank_account_changed, skipping",
          );
          return;
        }

        const rendered = renderEmail("bank_account_changed", {
          recipientName: owner.full_name,
          invitationTitle: owner.internal_name ?? "Undangan Pernikahan",
          changeType: data.change,
          providerName: data.providerName,
          accountNumberMasked: data.accountNumberMasked,
          changedAt: formatDateTimeWib(new Date()),
          dashboardUrl: `${appOrigin}/dashboard/invitations/${data.invitationId}/gift`,
        });

        await emailPort.send({
          to: owner.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        break;
      }

      case "invitation_published": {
        const owner = await fetchInvitationOwner(data.invitationId);
        if (!owner) return;

        const publicUrl = owner.slug
          ? `${publicOrigin}/${owner.slug}`
          : publicOrigin;
        const rendered = renderEmail("invitation_published", {
          recipientName: owner.full_name,
          invitationTitle: owner.internal_name ?? "Undangan Pernikahan",
          publicUrl,
          expiryDate: formatDateId(owner.expiry_date),
          isTrial: data.trial,
        });

        await emailPort.send({
          to: owner.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        break;
      }

      case "invitation_expired": {
        const owner = await fetchInvitationOwner(data.invitationId);
        if (!owner) return;

        const rendered = renderEmail("invitation_expired", {
          recipientName: owner.full_name,
          invitationTitle: owner.internal_name ?? "Undangan Pernikahan",
          renewalUrl: `${appOrigin}/dashboard/invitations/${data.invitationId}/renew`,
          expiredDate: formatDateId(owner.expiry_date ?? new Date()),
        });

        await emailPort.send({
          to: owner.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        break;
      }

      case "invitation_expiry_reminder": {
        const owner = await fetchInvitationOwner(data.invitationId);
        if (!owner) {
          logger.warn(
            {
              context: {
                invitation_id: data.invitationId,
                template: data.template,
              },
            },
            "invitation not found for invitation_expiry_reminder, skipping",
          );
          return;
        }

        const publicUrl = owner.slug
          ? `${publicOrigin}/${owner.slug}`
          : undefined;
        const renewalUrl = `${appOrigin}/dashboard/invitations/${data.invitationId}/renew`;
        const rendered = renderEmail("invitation_expiry_reminder", {
          recipientName: owner.full_name,
          invitationTitle: owner.internal_name ?? "Undangan Pernikahan",
          daysRemaining: data.daysRemaining,
          expiryDateFormatted: formatDateId(owner.expiry_date),
          renewalUrl,
          publicUrl,
        });

        await emailPort.send({
          to: owner.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: `expiry-reminder:${data.daysRemaining}:${owner.id}:${owner.expiry_date}:${context.attempt}`,
        });
        break;
      }

      case "invitation_retention_warning": {
        const owner = await fetchInvitationOwner(data.invitationId);
        if (!owner) {
          logger.warn(
            {
              context: {
                invitation_id: data.invitationId,
                template: data.template,
              },
            },
            "invitation not found for invitation_retention_warning, skipping",
          );
          return;
        }

        // BR-9.1: deletion occurs 90 days after expiry.
        const expiryDate = owner.expiry_date
          ? new Date(owner.expiry_date)
          : new Date();
        const deletionDate = new Date(
          expiryDate.getTime() + 90 * 24 * 60 * 60 * 1000,
        );
        const renewalUrl = `${appOrigin}/dashboard/invitations/${data.invitationId}/renew`;
        const dashboardUrl = `${appOrigin}/dashboard`;

        const rendered = renderEmail("invitation_retention_warning", {
          recipientName: owner.full_name,
          invitationTitle: owner.internal_name ?? "Undangan Pernikahan",
          warningNumber: data.warningNumber,
          daysRemainingUntilDeletion: data.daysRemainingUntilDeletion,
          deletionDateFormatted: formatDateId(deletionDate),
          renewalUrl,
          dashboardUrl,
        });

        await emailPort.send({
          to: owner.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: `retention-warning:${data.warningNumber}:${owner.id}:${context.attempt}`,
        });
        break;
      }

      case "order_refunded": {
        const order = await fetchOrderDetails(data.orderId);
        if (!order) {
          logger.warn(
            { context: { order_id: data.orderId, template: data.template } },
            "order not found for order_refunded email, skipping",
          );
          return;
        }

        const rendered = renderEmail("order_refunded", {
          recipientName: order.full_name,
          orderNumber: order.id.slice(0, 8).toUpperCase(),
          invitationTitle: order.invitation_title ?? undefined,
          amountFormatted: formatRupiah(order.amount_total),
          reason: data.reason,
          supportUrl: `${appOrigin}/support`,
          dashboardUrl: `${appOrigin}/dashboard/orders`,
        });

        await emailPort.send({
          to: order.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: `order-refunded:${order.id}:${context.attempt}`,
        });
        break;
      }

      case "rsvp_submitted": {
        const owner = await fetchInvitationOwner(data.invitationId);
        if (!owner) return;

        // Honor user preferences
        const prefs = await fetchUserPrefs(owner.user_id);
        if (!prefs.rsvp_email) {
          logger.info(
            { context: { user_id: owner.user_id, template: data.template } },
            "RSVP notification skipped per user preference",
          );
          return;
        }

        if (prefs.rsvp_digest) {
          logger.info(
            {
              context: {
                user_id: owner.user_id,
                invitation_id: data.invitationId,
                template: data.template,
              },
            },
            "RSVP notification deferred to daily digest",
          );
          return;
        }

        const rendered = renderEmail("rsvp_submitted", {
          recipientName: owner.full_name,
          invitationTitle: owner.internal_name ?? "Undangan Pernikahan",
          guestName: data.guestName,
          attendanceStatus: data.attendanceStatus,
          guestCount: data.guestCount,
          dashboardUrl: `${appOrigin}/dashboard/invitations/${data.invitationId}/rsvp`,
          preferencesUrl: `${appOrigin}/dashboard/settings/notifications`,
        });

        await emailPort.send({
          to: owner.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        break;
      }

      case "rsvp_daily_digest": {
        const rendered = renderEmail("rsvp_daily_digest", {
          recipientName: data.recipientName,
          invitationTitle: data.invitationTitle,
          dateFormatted: data.dateFormatted,
          totalResponsesToday: data.totalResponsesToday,
          attendingCount: data.attendingCount,
          notAttendingCount: data.notAttendingCount,
          maybeCount: data.maybeCount,
          recentGuests: data.recentGuests,
          dashboardUrl: `${appOrigin}/dashboard/invitations/${data.invitationId}/rsvp`,
          preferencesUrl: `${appOrigin}/dashboard/settings/notifications`,
        });

        await emailPort.send({
          to: data.recipientEmail,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: `rsvp-daily-digest:${data.invitationId}:${data.dateFormatted}:${context.attempt}`,
        });
        break;
      }

      case "guestbook_submitted": {
        const owner = await fetchInvitationOwner(data.invitationId);
        if (!owner) return;

        // Honor user preferences
        const prefs = await fetchUserPrefs(owner.user_id);
        if (!prefs.guestbook_email) {
          logger.info(
            { context: { user_id: owner.user_id, template: data.template } },
            "guestbook notification skipped per user preference",
          );
          return;
        }

        let messageText = data.message ?? "";
        if (!messageText && data.guestbookId) {
          const res = await pg.query<{ message: string }>(
            "SELECT message FROM invitation_guestbook WHERE id = $1 LIMIT 1",
            [data.guestbookId],
          );
          messageText = res.rows[0]?.message ?? "";
        }

        const rendered = renderEmail("guestbook_submitted", {
          recipientName: owner.full_name,
          invitationTitle: owner.internal_name ?? "Undangan Pernikahan",
          guestName: data.guestName,
          message: messageText,
          status: data.status,
          moderationUrl: `${appOrigin}/dashboard/invitations/${data.invitationId}/guestbook`,
          preferencesUrl: `${appOrigin}/dashboard/settings/notifications`,
        });

        await emailPort.send({
          to: owner.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        break;
      }

      default: {
        const exhaustiveCheck: never = data;
        logger.error(
          { context: { payload: exhaustiveCheck } },
          "unhandled notification template in worker",
        );
      }
    }
  };
}

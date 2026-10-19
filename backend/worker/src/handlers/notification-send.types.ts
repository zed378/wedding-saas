/**
 * Typed payloads for the `notification.send` BullMQ job (P4-06).
 */

export interface EmailVerificationPayload {
  readonly template: "email_verification";
  readonly userId: string;
  readonly token: string;
}

export interface PasswordResetPayload {
  readonly template: "password_reset";
  readonly userId: string;
  readonly token: string;
}

export interface PasswordChangedPayload {
  readonly template: "password_changed";
  readonly userId: string;
}

export interface RegistrationAttemptExistingAccountPayload {
  readonly template: "registration_attempt_existing_account";
  readonly userId: string;
}

export interface AccountDeletionRequestedPayload {
  readonly template: "account_deletion_requested";
  readonly userId: string;
  readonly liveInvitations: number;
}

export interface OrderPaidPayload {
  readonly template: "order_paid";
  readonly orderId: string;
}

export interface BankAccountChangedPayload {
  readonly template: "bank_account_changed";
  readonly userId: string;
  readonly invitationId: string;
  readonly change: "added" | "changed" | "removed";
  readonly accountNumberMasked: string;
  readonly providerName: string;
}

export interface InvitationPublishedPayload {
  readonly template: "invitation_published";
  readonly invitationId: string;
  readonly trial?: boolean;
}

export interface InvitationExpiredPayload {
  readonly template: "invitation_expired";
  readonly invitationId: string;
}

export interface RsvpSubmittedPayload {
  readonly template: "rsvp_submitted";
  readonly invitationId: string;
  readonly rsvpId?: string;
  readonly guestName: string;
  readonly attendanceStatus: "attending" | "not_attending" | "maybe";
  readonly guestCount: number;
}

export interface GuestbookSubmittedPayload {
  readonly template: "guestbook_submitted";
  readonly invitationId: string;
  readonly guestbookId?: string;
  readonly guestName: string;
  readonly status: "pending" | "approved";
  readonly message?: string;
}

export interface InvitationExpiryReminderPayload {
  readonly template: "invitation_expiry_reminder";
  readonly invitationId: string;
  readonly daysRemaining: number;
}

export interface InvitationRetentionWarningPayload {
  readonly template: "invitation_retention_warning";
  readonly invitationId: string;
  readonly warningNumber: 1 | 2 | 3;
  readonly daysRemainingUntilDeletion: number;
}

export interface OrderRefundedPayload {
  readonly template: "order_refunded";
  readonly orderId: string;
  readonly reason?: string;
}

export interface RsvpDailyDigestPayload {
  readonly template: "rsvp_daily_digest";
  readonly invitationId: string;
  readonly recipientEmail: string;
  readonly recipientName: string;
  readonly invitationTitle: string;
  readonly dateFormatted: string;
  readonly totalResponsesToday: number;
  readonly attendingCount: number;
  readonly notAttendingCount: number;
  readonly maybeCount: number;
  readonly recentGuests: readonly {
    readonly guestName: string;
    readonly attendanceStatus: "attending" | "not_attending" | "maybe";
    readonly guestCount: number;
  }[];
}

export type NotificationJobPayload =
  | EmailVerificationPayload
  | PasswordResetPayload
  | PasswordChangedPayload
  | RegistrationAttemptExistingAccountPayload
  | AccountDeletionRequestedPayload
  | OrderPaidPayload
  | BankAccountChangedPayload
  | InvitationPublishedPayload
  | InvitationExpiredPayload
  | InvitationExpiryReminderPayload
  | InvitationRetentionWarningPayload
  | OrderRefundedPayload
  | RsvpSubmittedPayload
  | RsvpDailyDigestPayload
  | GuestbookSubmittedPayload;

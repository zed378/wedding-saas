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
  | RsvpSubmittedPayload
  | GuestbookSubmittedPayload;

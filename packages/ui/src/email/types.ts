/**
 * Email template prop types and render signatures (P4-06).
 */

export interface BaseEmailProps {
  readonly previewText?: string | undefined;
  readonly unsubscribeUrl?: string | undefined;
  readonly preferencesUrl?: string | undefined;
}

export interface EmailVerificationProps extends BaseEmailProps {
  readonly recipientName: string;
  readonly verificationUrl: string;
}

export interface PasswordResetProps extends BaseEmailProps {
  readonly recipientName: string;
  readonly resetUrl: string;
  readonly expiresInMinutes?: number | undefined;
}

export interface PasswordChangedProps extends BaseEmailProps {
  readonly recipientName: string;
  readonly changedAt: string;
  readonly supportUrl?: string | undefined;
}

export interface ExistingAccountRegistrationProps extends BaseEmailProps {
  readonly recipientName: string;
  readonly loginUrl: string;
  readonly resetUrl: string;
}

export interface AccountDeletionRequestedProps extends BaseEmailProps {
  readonly recipientName: string;
  readonly liveInvitations: number;
  readonly supportUrl?: string | undefined;
}

export interface OrderPaidProps extends BaseEmailProps {
  readonly recipientName: string;
  readonly orderNumber: string;
  readonly packageName: string;
  readonly amountFormatted: string;
  readonly invoiceUrl?: string | undefined;
  readonly invitationTitle?: string | undefined;
  readonly dashboardUrl: string;
}

export interface BankAccountChangedProps extends BaseEmailProps {
  readonly recipientName: string;
  readonly invitationTitle: string;
  readonly changeType: "added" | "changed" | "removed";
  readonly providerName: string;
  readonly accountNumberMasked: string;
  readonly changedAt: string;
  readonly dashboardUrl: string;
}

export interface InvitationPublishedProps extends BaseEmailProps {
  readonly recipientName: string;
  readonly invitationTitle: string;
  readonly publicUrl: string;
  readonly expiryDate: string;
  readonly isTrial?: boolean | undefined;
}

export interface InvitationExpiredProps extends BaseEmailProps {
  readonly recipientName: string;
  readonly invitationTitle: string;
  readonly renewalUrl: string;
  readonly expiredDate: string;
}

export interface RsvpSubmittedProps extends BaseEmailProps {
  readonly recipientName: string;
  readonly invitationTitle: string;
  readonly guestName: string;
  readonly attendanceStatus: "attending" | "not_attending" | "maybe";
  readonly guestCount: number;
  readonly dashboardUrl: string;
}

export interface GuestbookSubmittedProps extends BaseEmailProps {
  readonly recipientName: string;
  readonly invitationTitle: string;
  readonly guestName: string;
  readonly message: string;
  readonly status: "approved" | "pending";
  readonly moderationUrl: string;
}

export type EmailTemplateKey =
  | "email_verification"
  | "password_reset"
  | "password_changed"
  | "registration_attempt_existing_account"
  | "account_deletion_requested"
  | "order_paid"
  | "bank_account_changed"
  | "invitation_published"
  | "invitation_expired"
  | "rsvp_submitted"
  | "guestbook_submitted";

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

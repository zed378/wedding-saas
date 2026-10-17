import React from "react";
import { EmailLayout, EmailButton } from "./layout.js";
import type {
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
} from "./types.js";

export function EmailVerificationEmail(props: EmailVerificationProps): React.JSX.Element {
  return (
    <EmailLayout title="Verifikasi Alamat Email Anda" previewText="Selesaikan pendaftaran akun Momen Bahagia Anda">
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 16px 0", color: "#1e1b4b" }}>
        Verifikasi Email Anda
      </h1>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Halo <strong>{props.recipientName}</strong>,
      </p>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 20px 0" }}>
        Terima kasih telah bergabung di Momen Bahagia. Klik tombol di bawah untuk memverifikasi alamat email Anda dan mengaktifkan akun:
      </p>
      <EmailButton href={props.verificationUrl}>Verifikasi Email Saya</EmailButton>
      <p style={{ fontSize: "13px", lineHeight: "20px", color: "#64748b", margin: "24px 0 0 0" }}>
        Atau salin tautan berikut ke peramban Anda:<br />
        <a href={props.verificationUrl} style={{ color: "#4f46e5", wordBreak: "break-all" }}>
          {props.verificationUrl}
        </a>
      </p>
    </EmailLayout>
  );
}

export function PasswordResetEmail(props: PasswordResetProps): React.JSX.Element {
  const expiry = props.expiresInMinutes ?? 60;
  return (
    <EmailLayout title="Atur Ulang Kata Sandi" previewText="Permintaan atur ulang kata sandi akun Momen Bahagia">
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 16px 0", color: "#1e1b4b" }}>
        Atur Ulang Kata Sandi
      </h1>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Halo <strong>{props.recipientName}</strong>,
      </p>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 20px 0" }}>
        Kami menerima permintaan untuk mengatur ulang kata sandi akun Momen Bahagia Anda. Tautan ini berlaku selama {expiry} menit:
      </p>
      <EmailButton href={props.resetUrl}>Atur Ulang Kata Sandi</EmailButton>
      <p style={{ fontSize: "13px", lineHeight: "20px", color: "#64748b", margin: "24px 0 0 0" }}>
        Jika Anda tidak meminta perubahan kata sandi ini, abaikan email ini. Akun Anda tetap aman.
      </p>
    </EmailLayout>
  );
}

export function PasswordChangedEmail(props: PasswordChangedProps): React.JSX.Element {
  return (
    <EmailLayout title="Kata Sandi Berhasil Diubah" previewText="Keamanan akun: kata sandi Anda berhasil diperbarui">
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 16px 0", color: "#1e1b4b" }}>
        Pemberitahuan Keamanan Akun
      </h1>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Halo <strong>{props.recipientName}</strong>,
      </p>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Kata sandi untuk akun Momen Bahagia Anda telah berhasil diubah pada <strong>{props.changedAt}</strong>. Sesi perangkat lain telah dinonaktifkan demi keamanan.
      </p>
      <div style={{ backgroundColor: "#fef2f2", borderLeft: "4px solid #ef4444", padding: "12px 16px", borderRadius: "4px", margin: "20px 0" }}>
        <p style={{ fontSize: "13px", lineHeight: "18px", color: "#991b1b", margin: 0 }}>
          <strong>Penting:</strong> Jika Anda tidak melakukan perubahan ini, segera hubungi tim bantuan kami untuk mengamankan akun Anda.
        </p>
      </div>
      {props.supportUrl ? (
        <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
          Bantuan: <a href={props.supportUrl}>{props.supportUrl}</a>
        </p>
      ) : null}
    </EmailLayout>
  );
}

export function ExistingAccountRegistrationEmail(props: ExistingAccountRegistrationProps): React.JSX.Element {
  return (
    <EmailLayout title="Pemberitahuan Pendaftaran Akun" previewText="Alamat email Anda telah terdaftar di Momen Bahagia">
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 16px 0", color: "#1e1b4b" }}>
        Email Sudah Terdaftar
      </h1>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Halo <strong>{props.recipientName}</strong>,
      </p>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 20px 0" }}>
        Seseorang mencoba mendaftar akun baru di Momen Bahagia menggunakan alamat email ini. Karena akun sudah terdaftar, pendaftaran baru tidak dibuat.
      </p>
      <EmailButton href={props.loginUrl}>Masuk ke Akun Anda</EmailButton>
      <p style={{ fontSize: "13px", lineHeight: "20px", color: "#64748b", margin: "20px 0 0 0" }}>
        Lupa kata sandi Anda? <a href={props.resetUrl} style={{ color: "#4f46e5" }}>Atur ulang kata sandi di sini</a>.
      </p>
    </EmailLayout>
  );
}

export function AccountDeletionRequestedEmail(props: AccountDeletionRequestedProps): React.JSX.Element {
  return (
    <EmailLayout title="Permintaan Penghapusan Akun" previewText="Permintaan penghapusan akun Momen Bahagia telah diterima">
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 16px 0", color: "#dc2626" }}>
        Penghapusan Akun Diproses
      </h1>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Halo <strong>{props.recipientName}</strong>,
      </p>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Kami telah menerima permintaan untuk menghapus akun Momen Bahagia Anda. Sesi login telah dicabut, dan {props.liveInvitations} undangan yang aktif akan dinonaktifkan sesuai kebijakan retensi data.
      </p>
      <p style={{ fontSize: "13px", lineHeight: "20px", color: "#64748b", margin: "20px 0 0 0" }}>
        Jika Anda tidak bermaksud menghapus akun Anda, harap segera hubungi tim bantuan sebelum data dihapus permanen.
      </p>
    </EmailLayout>
  );
}

export function OrderPaidEmail(props: OrderPaidProps): React.JSX.Element {
  return (
    <EmailLayout title={`Pembayaran Berhasil — Pesanan #${props.orderNumber}`} previewText="Konfirmasi pembayaran pesanan Momen Bahagia">
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 16px 0", color: "#1e1b4b" }}>
        Pembayaran Berhasil Diterima
      </h1>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Halo <strong>{props.recipientName}</strong>,
      </p>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 20px 0" }}>
        Terima kasih! Pembayaran untuk pesanan Anda telah berhasil diverifikasi:
      </p>
      <table width="100%" style={{ backgroundColor: "#f8fafc", borderRadius: "8px", padding: "16px", marginBottom: "20px" }}>
        <tbody>
          <tr>
            <td style={{ fontSize: "13px", color: "#64748b", padding: "4px 0" }}>Nomor Pesanan:</td>
            <td style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b", textAlign: "right" }}>#{props.orderNumber}</td>
          </tr>
          <tr>
            <td style={{ fontSize: "13px", color: "#64748b", padding: "4px 0" }}>Paket Layanan:</td>
            <td style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b", textAlign: "right" }}>{props.packageName}</td>
          </tr>
          {props.invitationTitle ? (
            <tr>
              <td style={{ fontSize: "13px", color: "#64748b", padding: "4px 0" }}>Undangan:</td>
              <td style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b", textAlign: "right" }}>{props.invitationTitle}</td>
            </tr>
          ) : null}
          <tr>
            <td style={{ fontSize: "13px", color: "#64748b", padding: "4px 0" }}>Total Pembayaran:</td>
            <td style={{ fontSize: "14px", fontWeight: 700, color: "#4f46e5", textAlign: "right" }}>{props.amountFormatted}</td>
          </tr>
        </tbody>
      </table>
      <EmailButton href={props.dashboardUrl}>Buka Dashboard</EmailButton>
      {props.invoiceUrl ? (
        <p style={{ fontSize: "13px", color: "#64748b", margin: "16px 0 0 0" }}>
          Unduh tanda terima/faktur: <a href={props.invoiceUrl}>Faktur Pembayaran</a>
        </p>
      ) : null}
    </EmailLayout>
  );
}

export function BankAccountChangedEmail(props: BankAccountChangedProps): React.JSX.Element {
  const changeLabels = {
    added: "ditambahkan",
    changed: "diperbarui",
    removed: "dihapus",
  };
  return (
    <EmailLayout title="Peringatan Keamanan: Rekening Hadiah Diubah" previewText="Pemberitahuan perubahan rekening pada undangan digital yang aktif">
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 16px 0", color: "#dc2626" }}>
        Perubahan Rekening Hadiah
      </h1>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Halo <strong>{props.recipientName}</strong>,
      </p>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Informasi rekening hadiah pada undangan publik <strong>{props.invitationTitle}</strong> telah{" "}
        <strong>{changeLabels[props.changeType]}</strong> pada <strong>{props.changedAt}</strong>:
      </p>
      <div style={{ backgroundColor: "#f8fafc", padding: "12px 16px", borderRadius: "6px", marginBottom: "20px" }}>
        <p style={{ margin: 0, fontSize: "14px", color: "#1e293b" }}>
          Bank / Dompet: <strong>{props.providerName}</strong><br />
          Nomor Rekening: <strong>{props.accountNumberMasked}</strong>
        </p>
      </div>
      <div style={{ backgroundColor: "#fef3c7", borderLeft: "4px solid #f59e0b", padding: "12px 16px", borderRadius: "4px", marginBottom: "24px" }}>
        <p style={{ margin: 0, fontSize: "13px", color: "#92400e", lineHeight: "18px" }}>
          <strong>Pemberitahuan Keamanan:</strong> Rekening pada undangan yang sudah dipublikasikan adalah tujuan transfer tamu Anda. Jika Anda tidak merasa melakukan perubahan ini, segera amankan akun Anda di dashboard.
        </p>
      </div>
      <EmailButton href={props.dashboardUrl}>Periksa di Dashboard</EmailButton>
    </EmailLayout>
  );
}

export function InvitationPublishedEmail(props: InvitationPublishedProps): React.JSX.Element {
  return (
    <EmailLayout title={`Undangan "${props.invitationTitle}" Berhasil Diterbitkan`} previewText="Undangan pernikahan Anda telah tayang dan siap dibagikan">
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 16px 0", color: "#1e1b4b" }}>
        Undangan Anda Telah Tayang!
      </h1>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Halo <strong>{props.recipientName}</strong>,
      </p>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 20px 0" }}>
        Selamat! Undangan digital <strong>{props.invitationTitle}</strong> sudah resmi terbit {props.isTrial ? "(Mode Percobaan)" : ""} dan dapat diakses oleh seluruh tamu undangan hingga <strong>{props.expiryDate}</strong>.
      </p>
      <EmailButton href={props.publicUrl}>Buka Undangan Digital</EmailButton>
      <p style={{ fontSize: "13px", lineHeight: "20px", color: "#64748b", margin: "20px 0 0 0" }}>
        Tautan undangan Anda:<br />
        <a href={props.publicUrl} style={{ color: "#4f46e5" }}>{props.publicUrl}</a>
      </p>
    </EmailLayout>
  );
}

export function InvitationExpiredEmail(props: InvitationExpiredProps): React.JSX.Element {
  return (
    <EmailLayout title={`Masa Aktif Undangan "${props.invitationTitle}" Telah Berakhir`} previewText="Informasi masa berlaku undangan pernikahan digital">
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 16px 0", color: "#1e1b4b" }}>
        Masa Aktif Undangan Berakhir
      </h1>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Halo <strong>{props.recipientName}</strong>,
      </p>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 20px 0" }}>
        Masa aktif publikasi untuk undangan <strong>{props.invitationTitle}</strong> telah berakhir pada <strong>{props.expiredDate}</strong>. Halaman publik saat ini menampilkan informasi penutupan.
      </p>
      <EmailButton href={props.renewalUrl}>Perpanjang Masa Aktif</EmailButton>
    </EmailLayout>
  );
}

export function RsvpSubmittedEmail(props: RsvpSubmittedProps): React.JSX.Element {
  const statusLabels = {
    attending: "Akan Hadir",
    not_attending: "Tidak Hadir",
    maybe: "Belum Pasti",
  };
  return (
    <EmailLayout title={`Konfirmasi Kehadiran Baru: ${props.guestName}`} preferencesUrl={props.preferencesUrl} previewText={`Konfirmasi RSVP baru dari ${props.guestName}`}>
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 16px 0", color: "#1e1b4b" }}>
        Konfirmasi Kehadiran Baru
      </h1>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Halo <strong>{props.recipientName}</strong>,
      </p>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 20px 0" }}>
        Tamu undangan baru saja mengirimkan konfirmasi kehadiran untuk <strong>{props.invitationTitle}</strong>:
      </p>
      <div style={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "16px", marginBottom: "24px" }}>
        <p style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#334155" }}>
          Nama Tamu: <strong>{props.guestName}</strong>
        </p>
        <p style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#334155" }}>
          Status Kehadiran: <strong>{statusLabels[props.attendanceStatus]}</strong>
        </p>
        <p style={{ margin: 0, fontSize: "14px", color: "#334155" }}>
          Jumlah Orang: <strong>{props.guestCount} orang</strong>
        </p>
      </div>
      <EmailButton href={props.dashboardUrl}>Lihat Daftar Kehadiran</EmailButton>
    </EmailLayout>
  );
}

export function GuestbookSubmittedEmail(props: GuestbookSubmittedProps): React.JSX.Element {
  return (
    <EmailLayout title={`Ucapan Buku Tamu Baru dari ${props.guestName}`} preferencesUrl={props.preferencesUrl} previewText={`Ucapan buku tamu baru dari ${props.guestName}`}>
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 16px 0", color: "#1e1b4b" }}>
        Ucapan Buku Tamu Baru
      </h1>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        Halo <strong>{props.recipientName}</strong>,
      </p>
      <p style={{ fontSize: "15px", lineHeight: "24px", color: "#334155", margin: "0 0 16px 0" }}>
        <strong>{props.guestName}</strong> telah menuliskan ucapan dan doa untuk pernikahan Anda pada <strong>{props.invitationTitle}</strong>:
      </p>
      <div style={{ backgroundColor: "#f8fafc", borderLeft: "4px solid #4f46e5", padding: "14px 18px", fontStyle: "italic", color: "#1e293b", margin: "16px 0 20px 0", borderRadius: "0 8px 8px 0" }}>
        "{props.message}"
      </div>
      {props.status === "pending" ? (
        <p style={{ fontSize: "13px", color: "#d97706", fontWeight: 500, margin: "0 0 16px 0" }}>
          Catatan: Pesan ini memerlukan persetujuan Anda sebelum tampil pada halaman publik.
        </p>
      ) : null}
      <EmailButton href={props.moderationUrl}>Buka Buku Tamu</EmailButton>
    </EmailLayout>
  );
}

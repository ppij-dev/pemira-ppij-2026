/**
 * Empat templat email (design.md keputusan 10; specs/instance-settings):
 * Tes Email, Undangan Admin Voting, Bukti Suara, Pengingat.
 * Satu templat untuk satu orang, Bahasa Indonesia, nada ramah/membantu/mengamankan,
 * tanpa emoji dan tanpa tanda seru. Semua templat memakai layout di layout.ts.
 */
import { emailButton, escapeHtml, renderLayout } from "./layout";
import type { EmailLayoutInput } from "./layout";

export type EmailBranding = {
  /** Nama chapter, contoh: PPI Okayama. */
  siteName: string;
  /** URL logo PNG 192x192 hasil unggahan Identitas. */
  logoUrl: string;
  /** Situs organisasi yang dipakai sebagai tautan footer. */
  websiteUrl: string;
  /** Dasar URL situs pemilu, contoh: https://pemilu.ppiokayama.jp */
  baseUrl: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

/** Waktu selalu dalam JST dengan format Indonesia, contoh: 5 Des 2026, 14.00 JST. */
function formatJst(date: Date): string {
  const tanggal = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Tokyo",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const jam = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Tokyo",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${tanggal}, ${jam} JST`;
}

/** Paragraf bergaya seragam; dipakai semua templat agar ukuran HTML tetap kecil. */
function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;">${escapeHtml(text)}</p>`;
}

function render(branding: EmailBranding, electionTitle: string, contentHtml: string): string {
  const input: EmailLayoutInput = {
    siteName: branding.siteName,
    logoUrl: branding.logoUrl,
    electionTitle,
    websiteUrl: branding.websiteUrl,
    contentHtml,
  };
  return renderLayout(input);
}

/** Judul surat: judul pemilihan bila sudah diisi, bila belum nama chapter. */
function judulSurat(branding: EmailBranding, electionTitle: string): string {
  return electionTitle || branding.siteName;
}

/** Templat 1: Tes Email dari tombol "Kirim Email Tes" di Pengaturan. */
export function testEmailTemplate(branding: EmailBranding): RenderedEmail {
  const paragraphs = [
    "Halo Admin Voting,",
    "Ini email percobaan dari Pengaturan, bagian Email. Jika Anda menerima email ini, pengaturan pengirim sudah benar dan siap dipakai.",
    "Selanjutnya email Undangan Admin Voting, Bukti Suara, dan Pengingat dikirim dari alamat ini, satu email untuk satu orang.",
  ];
  return {
    subject: `Tes Email dari ${branding.siteName}`,
    html: render(branding, "", paragraphs.map(paragraph).join("")),
    text: paragraphs.join("\n\n"),
  };
}

export type AdminInvitationInput = {
  branding: EmailBranding;
  recipientName: string;
  electionTitle: string;
  /** Tautan undangan sekali pakai yang berlaku 72 jam. */
  inviteUrl: string;
  expiresAt: Date;
};

/** Templat 2: Undangan Admin Voting. */
export function adminInvitationTemplate(input: AdminInvitationInput): RenderedEmail {
  const { branding, recipientName, inviteUrl, expiresAt } = input;
  const judul = judulSurat(branding, input.electionTitle);
  const opening = [
    `Halo ${recipientName},`,
    `Anda diundang menjadi Admin Voting pada ${judul}. Sebagai Admin Voting Anda dapat menyiapkan kandidat, menjadwalkan pemilihan, dan melihat hasilnya.`,
    `Tautan ini berlaku sampai ${formatJst(expiresAt)} dan hanya bisa dipakai satu kali.`,
  ];
  const closing =
    "Jika Anda tidak mengenali undangan ini, abaikan email ini dan jangan teruskan tautannya kepada siapa pun.";
  const contentHtml =
    opening.map(paragraph).join("") +
    emailButton(inviteUrl, "Buka Undangan") +
    paragraph(closing);
  const text = [...opening, `Buka tautan berikut: ${inviteUrl}`, closing].join("\n\n");
  return {
    subject: `Undangan Admin Voting ${judul}`,
    html: render(branding, input.electionTitle, contentHtml),
    text,
  };
}

export type ReceiptInput = {
  branding: EmailBranding;
  recipientName: string;
  electionTitle: string;
  /** Kode bukti suara, format XXXX-XXXX-XXXX-XXXX. */
  receiptCode: string;
};

/** Templat 3: Bukti Suara, berisi kode dan tombol ke halaman pemeriksaan. */
export function receiptTemplate(input: ReceiptInput): RenderedEmail {
  const { branding, recipientName, receiptCode } = input;
  const judul = judulSurat(branding, input.electionTitle);
  const checkUrl = `${branding.baseUrl}/surat-suara`;
  const codeHtml =
    `<p style="margin:16px 0;">` +
    `<span style="display:inline-block;padding:12px 20px;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;font-family:Consolas,'Courier New',monospace;font-size:20px;letter-spacing:2px;color:#18181b;">` +
    `${escapeHtml(receiptCode)}</span></p>`;
  const contentHtml =
    paragraph(`Halo ${recipientName},`) +
    paragraph(`Terima kasih sudah memilih pada ${judul}. Berikut kode bukti suara Anda.`) +
    codeHtml +
    paragraph(
      "Kode ini hanya Anda yang memiliki. Simpan email ini agar Anda bisa memastikan suara Anda masuk ke hitungan.",
    ) +
    paragraph(
      "Sistem tidak menyimpan data yang menghubungkan nama Anda dengan pilihan Anda.",
    ) +
    emailButton(checkUrl, "Cek Bukti Suara") +
    paragraph(`Untuk memeriksa, buka halaman Bukti Suara dan tulis kode di atas, atau buka ${checkUrl}.`);
  const text = [
    `Halo ${recipientName},`,
    `Terima kasih sudah memilih pada ${judul}. Berikut kode bukti suara Anda.`,
    receiptCode,
    "Kode ini hanya Anda yang memiliki. Simpan email ini agar Anda bisa memastikan suara Anda masuk ke hitungan.",
    `Cek bukti suara: ${checkUrl}`,
  ].join("\n\n");
  return {
    subject: `Bukti Suara untuk ${judul}`,
    html: render(branding, input.electionTitle, contentHtml),
    text,
  };
}

export type ReminderInput = {
  branding: EmailBranding;
  recipientName: string;
  electionTitle: string;
  /** Batas waktu pemilihan, ditampilkan dalam JST. */
  closesAt: Date;
};

/** Templat 4: Pengingat untuk Pemilih yang belum memilih, maksimal sekali per 24 jam. */
export function reminderTemplate(input: ReminderInput): RenderedEmail {
  const { branding, recipientName, closesAt } = input;
  const judul = judulSurat(branding, input.electionTitle);
  const opening = [
    `Halo ${recipientName},`,
    `Anda terdaftar sebagai Pemilih pada ${judul} dan sampai saat ini belum memilih.`,
    `Pemilihan ditutup pada ${formatJst(closesAt)}. Memilih hanya butuh beberapa menit.`,
  ];
  const closing =
    "Suara Anda dijaga rahasia: sistem tidak menyimpan data yang menghubungkan nama Anda dengan pilihan Anda.";
  const contentHtml =
    opening.map(paragraph).join("") +
    emailButton(branding.baseUrl, "Pilih Sekarang") +
    paragraph(closing);
  const text = [...opening, `Buka tautan berikut: ${branding.baseUrl}`, closing].join("\n\n");
  return {
    subject: `Pengingat: gunakan hak pilih Anda pada ${judul}`,
    html: render(branding, input.electionTitle, contentHtml),
    text,
  };
}

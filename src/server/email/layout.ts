/**
 * Layout HTML tunggal untuk keempat templat email (design.md keputusan 10).
 * Dibangun dengan tabel dan gaya inline agar tampil benar di klien email lama,
 * tanpa pixel pelacak. Logo memakai URL PNG 192x192 yang ditampilkan 64 px.
 * Ukuran hasil render dijaga di bawah 20 KB per email (lihat test/email.test.ts).
 */

const FONT = "-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
const BODY_STYLE = `font-family:${FONT};font-size:15px;line-height:24px;color:#3f3f46;`;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Tombol berbentuk tabel: tetap bisa diklik meski klien email membuang elemen lain. */
export function emailButton(url: string, label: string): string {
  const href = escapeHtml(url);
  const text = escapeHtml(label);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 12px;">` +
    `<tr><td style="background:#0f766e;border-radius:8px;">` +
    `<a href="${href}" style="display:inline-block;padding:12px 24px;font-family:${FONT};` +
    `font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${text}</a>` +
    `</td></tr></table>`
  );
}

export type EmailLayoutInput = {
  /** Nama chapter, contoh: PPI Okayama. */
  siteName: string;
  /** URL logo PNG 192x192; kosong berarti tanpa logo. */
  logoUrl: string;
  /** Judul pemilihan; kosong berarti memakai nama chapter. */
  electionTitle: string;
  /** Situs organisasi untuk footer; kosong berarti footer tanpa tautan. */
  websiteUrl: string;
  /** Isi email berupa HTML siap tampil (teks di dalamnya sudah di-escape). */
  contentHtml: string;
};

export function renderLayout(input: EmailLayoutInput): string {
  const siteName = escapeHtml(input.siteName || "Pemilu");
  const title = escapeHtml(input.electionTitle || input.siteName || "Pemilu");
  const logo = input.logoUrl
    ? `<tr><td style="padding:32px 32px 0;">` +
      `<img src="${escapeHtml(input.logoUrl)}" width="64" height="64" alt="${siteName}" ` +
      `style="display:block;width:64px;height:64px;border:0;border-radius:8px;"></td></tr>`
    : "";
  let footerHost = "";
  if (input.websiteUrl) {
    try {
      footerHost = new URL(input.websiteUrl).host;
    } catch {
      footerHost = input.websiteUrl.replace(/^https?:\/\//, "");
    }
    footerHost = escapeHtml(footerHost);
  }
  const footerLine = input.websiteUrl
    ? `<a href="${escapeHtml(input.websiteUrl)}" style="color:#71717a;text-decoration:none;">` +
      `${siteName} &#183; ${footerHost}</a>`
    : siteName;
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
${logo}<tr><td style="padding:24px 32px 0;font-family:${FONT};font-size:19px;line-height:27px;font-weight:700;color:#18181b;">${title}</td></tr>
<tr><td style="padding:12px 32px 4px;${BODY_STYLE}">${input.contentHtml}</td></tr>
<tr><td style="padding:24px 32px 28px;border-top:1px solid #e4e4e7;font-family:${FONT};font-size:13px;line-height:20px;color:#71717a;">${footerLine}<br>Email ini dikirim otomatis oleh situs pemilihan dan tidak perlu dibalas.</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

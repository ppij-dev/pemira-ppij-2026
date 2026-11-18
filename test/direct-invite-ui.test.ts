import { describe, expect, it } from "vitest";
import adminPage from "../src/pages/admin/undangan.astro?raw";
import welcomePage from "../src/pages/undangan/[kode].astro?raw";
import ballotPage from "../src/pages/undangan/[kode]/surat-suara.astro?raw";
import layout from "../src/layouts/AdminLayout.astro?raw";
import { VOTE_CHOICES, VOTE_CHOICE_LABELS } from "../src/server/voting/choice";
import { DIRECT_INVITE_BATCH_MAX } from "../src/server/direct/create";

// Halaman memakai aturan yang sama dengan server: batas batch dari konstanta,
// tiga jawaban mode kandidat tunggal, dan endpoint yang benar. Perilaku tombol
// diuji di peramban (screenshot), di sini hanya isi sumber halaman.
describe("Undangan Pemilih: tabel, filter dan unduhan", () => {
  it("memakai kolom dan label status yang disepakati", () => {
    for (const header of ["Link", "Dibuat Pada", "Oleh", "Status"]) {
      expect(adminPage).toContain(`>${header}</th>`);
    }
    for (const label of ["Belum Dipakai", "Sudah Dipakai", "Dibatalkan"]) {
      expect(adminPage).toContain(label);
    }
    // Link ditempatkan sebelum Dibuat Pada.
    expect(adminPage.indexOf(">Link</th>")).toBeLessThan(adminPage.indexOf(">Dibuat Pada</th>"));
  });

  it("membatasi batch pada konstanta server dan menaruh halaman di navigasi", () => {
    expect(adminPage).toContain(`max="${DIRECT_INVITE_BATCH_MAX}"`);
    expect(adminPage).toContain(`min="1"`);
    expect(layout).toContain('href: "/admin/undangan"');
    expect(layout).toContain('label: "Undangan"');
  });

  it("menyediakan filter status dan pencarian referensi di peramban", () => {
    expect(adminPage).toContain('id="status-filter"');
    expect(adminPage).toContain('<option value="semua">Semua status</option>');
    for (const value of ["belum", "dipakai", "dibatalkan"]) {
      expect(adminPage).toContain(`<option value="${value}">`);
    }
    expect(adminPage).toContain('id="reference-search"');
    expect(adminPage).toContain("row.reference.toUpperCase().includes(needle)");
    expect(adminPage).toContain("Tidak ada undangan yang cocok dengan filter ini.");
  });

  it("membangun .xlsx di peramban dari pustaka yang dibundel, tanpa CDN", () => {
    expect(adminPage).toContain('from "write-excel-file/browser"');
    expect(adminPage).toContain("writeExcelFile(data).toFile(\"undangan-pemilih.xlsx\")");
    expect(adminPage).not.toMatch(/https?:\/\/[^"']*\.(js|mjs)/);
    expect(adminPage).not.toContain("<script src=");
    // Kolom unduhan sesuai keputusan pemilik, termasuk kolom khusus tautan terpakai.
    for (const header of ["Link", "Referensi", "Dibuat Pada", "Oleh", "Status", "Dipakai Pada", "Nama", "Email", "Korda/Komsat"]) {
      expect(adminPage).toContain(`"${header}"`);
    }
  });

  it("menyalin dan membatalkan lewat endpoint admin yang sama dengan server", () => {
    expect(adminPage).toContain('data-copy');
    expect(adminPage).toContain('fetch(`/api/admin/undangan/${cancelId}`, { method: "DELETE"');
    expect(adminPage).toContain('fetch("/api/admin/undangan"');
    expect(adminPage).toContain("window.confirm(`Batalkan tautan ${row.reference}? Hak pilih berkurang satu.`)");
    // Tautan penuh hanya ditampilkan bila server mengirimkannya (baris belum dipakai).
    expect(adminPage).toContain("if (row.link) {");
    expect(adminPage).toContain("Tautan hanya tersedia sebelum dipakai.");
    // Tidak ada polling: hanya pemuatan awal dan muat ulang setelah aksi.
    expect(adminPage).not.toContain("setInterval");
  });

  it("menonaktifkan pembuatan dan pembatalan setelah pemungutan suara ditutup", () => {
    expect(adminPage).toContain('const closed = stage === "closed" || stage === "published";');
    expect(adminPage).toContain("generateButton.disabled = closed;");
    expect(adminPage).toContain("Tautan tidak dapat dibuat atau dibatalkan setelah pemungutan suara ditutup.");
  });

  it("menampilkan catatan hasil, filter kosong dan jendela tutup lewat atribut hidden", () => {
    // Catatan ini dulu membawa kelas utilitas `hidden` di markup, sehingga menghapus
    // atribut hidden di skrip tidak pernah memunculkannya (selalu display: none).
    const ids = ["generate-result", "window-note", "undangan-filtered"];
    for (const id of ids) {
      const tag = adminPage.match(new RegExp(`<p id="${id}"[^>]*>`))?.[0];
      expect(tag, `tag ${id} harus ada`).toBeTruthy();
      const classes = (tag!.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);
      expect(classes, `kelas ${id} tidak boleh memakai utilitas hidden`).not.toContain("hidden");
      expect(/(^|\s)hidden(?=\s|>)/.test(tag!), `atribut hidden pada ${id}`).toBe(true);
    }
    // Skrip tetap menggerakkan atribut hidden (bukan kelas) untuk ketiganya.
    expect(adminPage).toContain("result.hidden = false;");
    expect(adminPage).toContain("result.hidden = true;");
    expect(adminPage).toContain("filtered.hidden = rows.length === 0 || shown.length !== 0;");
    expect(adminPage).toContain("windowNote.hidden = !closed;");
  });
});

describe("Halaman undangan publik", () => {
  it("menyapa, menyebut jadwal, dan menawarkan profil kandidat", () => {
    expect(welcomePage).toContain("Selamat datang di Pemilihan Umum");
    expect(welcomePage).toContain("Lihat profil kandidat");
    expect(welcomePage).toContain('href="/kandidat"');
    expect(welcomePage).toContain("Pemungutan suara belum dibuka");
    expect(welcomePage).toContain("Pemungutan suara telah ditutup");
    expect(welcomePage).toContain("Hasil sudah diumumkan");
  });

  it("menampilkan pesan untuk tautan dipakai, dibatalkan dan tidak dikenal", () => {
    expect(welcomePage).toContain("Tautan ini sudah dipakai");
    expect(welcomePage).toContain("Tautan ini dibatalkan");
    expect(welcomePage).toContain("Tautan tidak ditemukan");
    expect(welcomePage).toContain('if (view.outcome === "unknown") Astro.response.status = 404;');
  });

  it("meminta Nama, Email dan Korda/Komsat dari daftar unit portal, tanpa teks bebas", () => {
    expect(welcomePage).toContain('id="claim-name"');
    expect(welcomePage).toContain('id="claim-email"');
    expect(welcomePage).toContain("<select");
    expect(welcomePage).toContain("loadInviteUnits(bindings.DB, scopeRow?.value ?? \"\")");
    expect(welcomePage).toContain("unitPathLabel(unit.path, names)");
    expect(welcomePage).toContain("Daftar korda/komsat belum tersedia");
    expect(welcomePage).toContain('fetch("/api/undangan/klaim"');
    expect(welcomePage).toContain("consumeOpenLimit");
  });

  it("memakai surat suara, lembar konfirmasi dan kode bukti yang sama di halaman ballot", () => {
    expect(ballotPage).toContain('fetch("/api/undangan/suara"');
    expect(ballotPage).toContain("Konfirmasi pilihan");
    expect(ballotPage).toContain("Ketik nama panggilan kandidat");
    expect(ballotPage).toContain("receipt_code");
    expect(ballotPage).toContain('openInviteSession(cookie, bindings.APP_MASTER_KEY)');
    for (const choice of VOTE_CHOICES) {
      expect(ballotPage).toContain(`value: "${choice}", label: "${VOTE_CHOICE_LABELS[choice]}"`);
    }
    expect(ballotPage).toContain("/surat-suara#");
    expect(ballotPage).toContain("Sesi undangan tidak ditemukan");
  });
});

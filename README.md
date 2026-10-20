# ppij-election-system

Self-installable, publicly verifiable e-voting system for PPI Jepang (PPIJ Pusat, Korda, and Komsat).
Built with **Hono + Astro** and designed to fork and self-host on **Cloudflare Workers / Pages, D1, and R2**.

> **Penting — Konfigurasi SSO OneLogin:**
> **Kontak PPIJ Portal admin untuk meminta realm config untuk service** (`client_id`, `client_secret`, dan scope Korda/Komsat untuk pemilihan Anda).

## Versi 1.0 (MVP lokal) vs 1.1

**1.0** berjalan lokal sepenuhnya: bootstrap manual oleh operator, sinkronisasi daftar pemilih lewat
Service API (lokal: fixture deterministik), pemungutan suara rahasia, bukti suara berbasis hash,
hasil tingkat korda, dan jejak audit berantai. **Belum ada** push Wrangler, email keluar, wizard
`/setup`, unggah logo/foto, peta wilayah, atau editor kandidat kaya — semuanya direncanakan untuk
perubahan 1.1 berikutnya.

## Mulai cepat (operator, 1.0)

> Tombol *Deploy to Cloudflare* dan wizard `/setup` adalah fase 2 (1.1). Pada 1.0, pemasangan
> dilakukan operator lewat konfigurasi dan perintah bootstrap.

1. Pasang dependensi dan siapkan basis data lokal:

   ```bash
   npm install
   npm run dev      # server pengembangan (Miniflare: D1 & R2 lokal)
   ```

2. Terapkan migrasi D1 (`wrangler d1 migrations apply DB --remote` saat ke Cloudflare; lokal otomatis
   di Miniflare).
3. Isi konfigurasi dan rahasia (lokal: `.dev.vars` dari `.dev.vars.example`): issuer & klien One Login,
   endpoint & klien Service API, cakupan, base URL, nama situs, aset logo lokal, dan `APP_MASTER_KEY`
   (32 byte acak, misalnya `openssl rand -base64 32`). Jangan mengandalkan variabel lingkungan sesi lain;
   setiap proses membawa konfigurasinya sendiri.
4. Jalankan perintah bootstrap operator yang aman diulang (dokumen lengkap menyusul di tugas 2.1) dengan
   `member_id` Admin Voting pertama. Sebelum bootstrap selesai, halaman publik/API menjawab 503 dan
   `/setup` menjawab 404. Setelah selesai, `/setup` 404 selamanya; perubahan lewat Pengaturan.

Pengembangan lokal (Node.js 22.12+):

```bash
npm run dev      # server pengembangan
npm run check    # astro check + tsc --noEmit
npm test         # Vitest di dalam Miniflare (workerd)
npm run e2e      # Playwright; jalankan `npx playwright install` lebih dulu
npm run deploy   # migrasi D1 + wrangler deploy (fase rilis, bukan siklus lokal 1.0)
```

Pengujian identitas lokal memakai Keycloak hang milik `ppij-identity` di `127.0.0.1:38180` dengan
realm/klien uji terpisah — jangan menyalakan/mematikan stack bersama itu, dan jangan mengubah realm
`ppij`. Data Pemilih lokal memakai fixture HTTP Service API deterministik.


## Fitur Utama (1.0)

- **Bootstrap operator sekali jalan**: migrasi D1 + konfigurasi/rahasia + perintah bootstrap aman diulang dengan `member_id` Admin Voting pertama. Sebelum itu, halaman publik menjawab 503; `/setup` 404. (Wizard peramban dan tombol Deploy menyusul di 1.1.)
- **Peran**:
  - **Admin Voting**: panitia pemilihan. Semua Admin Voting punya hak yang sama; admin pertama hasil bootstrap diberi label *Technical Admin*.
  - **Pemilih**: anggota yang tercantum pada daftar pemilih yang dibekukan saat *Kunci & Jadwalkan* **dan** saat memilih masuk lewat One Login paling lama 10 menit dengan keanggotaan aktif di cakupan situs. Anggota yang baru aktif setelah penguncian tidak bisa memilih pada pemilihan ini.
  - **Admin Portal** adalah admin portal keanggotaan PPIJ, bukan admin situs ini.
- **Daftar pemilih dari Service API**: sinkron manual saat Draf, lalu sinkron final yang membekukan daftar saat *Kunci & Jadwalkan*. Di 1.0 lokal, Service API dipalsukan fixture deterministik; nomor telepon/email tidak pernah diminta atau disimpan.
- **Satu suara, rahasia, dan bisa dicek**: pemilih mengetik nama panggilan kandidat (misal `Budi`) untuk konfirmasi. Setiap anggota hanya bisa memilih sekali. Bukti suara berupa kode 26 karakter Crockford; hanya hash SHA-256 yang disimpan, dan papan bukti publik pasca penutupan menampilkan hash — kode asli tidak pernah dikirim ke server.
- **Dasbor panitia**: hitung mundur, perolehan suara keseluruhan, tabel hasil tingkat korda (korda dengan kurang dari 10 suara tidak dirinci), statistik pemilih berbasis daftar beku, dan cek kecocokan jumlah suara. Data diperbarui dengan tombol *Muat Ulang Data*.
- **Audit berantai hash**: setiap aksi Admin Voting, pemilih, dan sistem tercatat append-only; integritas rantai bisa diperiksa, dan hash audit saat penutupan ditampilkan di papan bukti.

Ditunda ke 1.1: email keluar (pengingat, undangan, bukti suara), wizard `/setup` + tombol Deploy, editor kandidat kaya (CKEditor/foto/video), peta wilayah + rincian komsat, unggah/krop logo, filter & ekspor CSV audit.

## Jika semua Admin Voting kehilangan akses

Pemilik akun Cloudflare dapat membuat tautan undangan Admin Voting baru dengan satu perintah Wrangler (perintah pemulihan di dokumentasikan pada tugas 2.3; lihat halaman bantuan di situs setelah tugas itu selesai).

## Dokumentasi & Spesifikasi

Spesifikasi sistem dikelola menggunakan OpenSpec di direktori `openspec/`. Lihat `AGENTS.md` untuk panduan kontribusi dan aturan arsitektur.

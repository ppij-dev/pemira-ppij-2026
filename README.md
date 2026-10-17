# ppij-election-system

Self-installable, publicly verifiable e-voting system for PPI Jepang (PPIJ Pusat, Korda, and Komsat).
Built with **Hono + Astro** and designed to fork and self-host on **Cloudflare Workers / Pages, D1, and R2**.

> **Penting — Konfigurasi SSO OneLogin:**
> **Kontak PPIJ Portal admin untuk meminta realm config untuk service** (`client_id`, `client_secret`, dan scope Korda/Komsat untuk pemilihan Anda).

## Fitur Utama

- **Pasang sekali, tanpa perintah terminal**: tekan tombol *Deploy to Cloudflare*, lalu buka `/setup` di alamat `.pages.dev` / `.workers.dev` dalam 60 menit. Atur koneksi PPIJ One Login, cakupan (nasional, korda, atau komsat), Service API, domain, dan email. Langkah terakhir: masuk dengan akun anggota aktif dari cakupan tersebut. Setelah selesai, `/setup` hilang.
- **Peran**:
  - **Admin Voting**: panitia pemilihan. Semua Admin Voting punya hak yang sama; pemasang situs diberi label *Technical Admin*.
  - **Pemilih**: anggota yang, saat memilih, tercatat aktif di cakupan situs menurut PPIJ One Login. Anggota yang baru aktif selama masa pemilihan juga bisa memilih.
  - **Admin Portal** adalah admin portal keanggotaan PPIJ, bukan admin situs ini.
- **Satu suara, rahasia, dan bisa dicek**: pemilih mengetik nama panggilan kandidat (misal `Budi`) untuk konfirmasi. Setiap anggota hanya bisa memilih sekali. Kode bukti suara membuktikan surat suara masuk kotak tanpa membuka pilihannya.
- **Dasbor panitia**: hitung mundur, peta wilayah, perolehan suara, statistik pemilih, dan cek kecocokan jumlah suara. Data diperbarui dengan tombol *Muat Ulang Data*.
- **Pengingat**: tautan WhatsApp per pemilih, atau email pengingat bila tidak ada nomor telepon. Tidak ada email massal.

## Jika semua Admin Voting kehilangan akses

Pemilik akun Cloudflare dapat membuat tautan undangan Admin Voting baru dengan satu perintah Wrangler (lihat halaman bantuan di situs).

## Dokumentasi & Spesifikasi

Spesifikasi sistem dikelola menggunakan OpenSpec di direktori `openspec/`. Lihat `AGENTS.md` untuk panduan kontribusi dan aturan arsitektur.

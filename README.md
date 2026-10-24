# ppij-election-system

Self-installable, publicly verifiable e-voting system for PPI Jepang (PPIJ Pusat, Korda, and Komsat).
Built with **Hono + Astro** and designed to fork and self-host on **Cloudflare Workers / Pages and D1**.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ppij-dev/ppij-election-system)

> **Penting — Konfigurasi SSO OneLogin:**
> **Kontak PPIJ Portal admin untuk meminta realm config untuk service** (`client_id`, `client_secret`, dan scope Korda/Komsat untuk pemilihan Anda).

## Versi 1.0 vs 1.1

**1.0** mendukung latihan (*rehearsal*) lokal secara penuh serta deployment produksi ke Cloudflare melalui tombol *Deploy to Cloudflare* atau impor repositori di dasbor dengan bootstrap operator jarak jauh (`--remote`). Fitur 1.0 mencakup autentikasi OIDC OneLogin, sinkronisasi daftar pemilih Service API, pemungutan suara rahasia, bukti suara berbasis hash Crockford, hasil agregat tingkat korda, dan jejak audit berantai append-only. **Fitur yang ditunda ke 1.1**: pengiriman email keluar (pengingat, undangan, bukti suara), wizard peramban `/setup`, unggah dan pemotongan logo lewat peramban, visualisasi peta wilayah dan rincian komsat, editor kandidat kaya (CKEditor/foto/video; memerlukan keputusan penyimpanan karena Cloudflare R2 membutuhkan paket berbayar), serta filter dan ekspor CSV audit.

Panduan visual ada di [`design/DESIGN.md`](design/DESIGN.md). Saat `npm run dev` berjalan, buka `/dev/design-system/` untuk kitchen sink serta contoh alur pemilih, Admin Voting, hasil, dan bukti. Semua contoh memakai data fiktif, tidak memanggil API, dan tidak tersedia pada build produksi.

## Pemasangan ke Cloudflare (untuk Korda / Komsat)

Terdapat dua jalur pemasangan ke Cloudflare:

### Jalur A: Tombol Deploy to Cloudflare (disarankan untuk repo baru)

Klik tombol **Deploy to Cloudflare** di bagian atas README ini. Alur resmi Cloudflare:
1. Mengkloning repositori ini ke akun GitHub/GitLab pengguna.
2. Meminta input 3 rahasia (`ONELOGIN_CLIENT_SECRET`, `SERVICE_API_CLIENT_SECRET`, `APP_MASTER_KEY`) yang diambil dari `.dev.vars.example` dalam keadaan terselubung (masked).
3. Menampilkan variabel non-rahasia dari blok `vars` di `wrangler.jsonc` untuk diatur nilainya.
4. Membuat dan menghubungkan basis data D1 (`DB`) baru secara otomatis dengan ID baru yang ditulis ke `wrangler.jsonc` pada klon repositori (hanya D1 yang di-provisioning; binding bawaan KV sesi dan Cloudflare Images dinonaktifkan di `astro.config.mjs` karena aplikasi menggunakan cookie tersegel dan aset gambar statis).
5. Membangun dan merilis worker via Cloudflare Workers Builds. Skrip `deploy` di `package.json` otomatis menjalankan `wrangler d1 migrations apply DB --remote` sebelum deploy worker.

*(Catatan verifikasi: Alur di atas dirancang sesuai dokumentasi resmi Cloudflare Deploy Buttons. Perilaku provisioning otomatis D1 beserta penulisan ulang ID-nya, rendering visual formulir prompt di antarmuka dasbor Cloudflare, dan pembuatan relasi fork GitHub tercatat sebagai unverified di `docs/deploy-button.md` karena belum diuji langsung pada akun Cloudflare aktif.)*

### Jalur B: Fork manual lalu "Import repository" di dasbor Cloudflare (Workers Builds)

Jika Anda melakukan fork manual di GitHub lalu memilih **Import a repository** di dasbor Cloudflare (Workers & Pages > Create application > Workers Builds):
1. Dasbor Cloudflare **tidak** menampilkan prompt rahasia dari `.dev.vars.example` dan **tidak** membuat basis data D1 baru secara otomatis.
2. Anda harus membuat basis data D1 secara manual melalui dasbor Cloudflare atau CLI (`npx wrangler d1 create <nama_db>`).
3. Sesuaikan `wrangler.jsonc` di fork Anda: isi `database_id` dan `database_name` dengan basis data yang telah Anda buat, serta sesuaikan nilai `vars` (`SITE_BASE_URL`, `SITE_SCOPE`, `SITE_NAME`, dll.). Commit dan push ke fork Anda.
4. Masukkan 3 rahasia secara manual di dasbor Cloudflare (**Settings > Variables and Secrets**) atau melalui terminal menggunakan `npx wrangler secret put <NAMA_SECRET>`.
5. Perhatikan bahwa konfigurasi bawaan Workers Builds menyetel perintah Deploy ke `npx wrangler deploy` (bukan `npm run deploy`). Migrasi D1 **tidak** akan berjalan otomatis kecuali Anda mengubah perintah Deploy di pengaturan build Cloudflare menjadi `npm run deploy` atau menjalankan migrasi secara manual via CLI (`npx wrangler d1 migrations apply DB --remote`).

### Checklist wajib setelah deploy (kedua jalur)

Setelah aplikasi berhasil ter-deploy ke Cloudflare, operator masih **wajib** menyelesaikan langkah-langkah berikut secara berurutan sebelum sistem dapat dipakai:

1. **Pastikan 3 rahasia telah tersimpan**:
   Pastikan rahasia `ONELOGIN_CLIENT_SECRET`, `SERVICE_API_CLIENT_SECRET`, dan `APP_MASTER_KEY` sudah terpasang. Pada Jalur A, rahasia ini dimasukkan saat alur deploy button; pada Jalur B (atau jika terlewat pada Jalur A), masukkan rahasia di dasbor Cloudflare (**Settings > Variables and Secrets**) atau melalui CLI (`npx wrangler secret put <NAMA_SECRET>`).
2. **Hubungkan domain kustom (custom domain) SEBELUM bootstrap**:
   Hubungkan nama domain produksi cabang Anda di dasbor Cloudflare (**Settings > Domains & Routes**) sebelum menjalankan perintah bootstrap. Langkah ini sangat krusial karena nilai `SITE_BASE_URL` akan disimpan secara permanen ke tabel `system_config` di D1 saat proses bootstrap.
3. **Daftarkan Redirect URI OIDC di PPIJ OneLogin**:
   Pastikan Redirect URI pada konfigurasi client OneLogin PPIJ Portal diatur persis ke `<SITE_BASE_URL>/api/auth/callback` (sesuai domain kustom di atas). Jika URI tidak cocok persis, proses sign-in pemilih dan admin akan ditolak oleh OneLogin.
4. **Pastikan migrasi basis data telah berjalan**:
   Skrip `deploy` di `package.json` (`wrangler d1 migrations apply DB --remote && wrangler deploy`) secara bawaan menerapkan migrasi skema D1 saat rilis jika perintah Deploy disetel ke `npm run deploy`. Pada Jalur B yang menggunakan bawaan `npx wrangler deploy`, atau jika migrasi belum pernah berjalan, jalankan migrasi secara mandiri:
   ```bash
   npx wrangler d1 migrations apply DB --remote
   ```
5. **Jalankan bootstrap operator jarak jauh untuk Admin Voting pertama**:
   Situs baru berada dalam status uninitialized (halaman publik dan API menjawab status HTTP 503; `/setup` selalu 404). Tidak ada pengguna yang dapat masuk sebagai admin sebelum bootstrap selesai. Operator wajib menjalankan satu kali perintah bootstrap remote dari terminal lokal:
   ```bash
   npm run bootstrap -- --remote --database <nama_d1_atau_binding_DB> <member_id>
   ```
   > **Peringatan penting untuk bootstrap jarak jauh:** Skrip CLI secara otomatis membaca berkas `.dev.vars` jika berkas tersebut ada di direktori kerja lokal. Environment variable di shell mengesampingkan (menimpa) isi `.dev.vars`. Operator wajib mengekspor variabel environment produksi di shell (`SITE_BASE_URL`, `SITE_SCOPE`, `SITE_NAME`, `SITE_LOGO_PATH`, `ONELOGIN_ISSUER`, `ONELOGIN_CLIENT_ID`, `SERVICE_API_URL`, `SERVICE_API_CLIENT_ID`, dan ketiga rahasia) agar nilai lokal (seperti `http://localhost:4321`) tidak masuk ke D1 produksi.
   >
   > **Wajib jalankan dengan opsi `--dry-run` terlebih dahulu** untuk memeriksa baris pernyataan SQL sebelum dieksekusi:
   > ```bash
   > npm run bootstrap -- --remote --database <nama_d1_atau_binding_DB> --dry-run <member_id>
   > ```
   > Periksa dengan teliti baris `site_base_url`, `site_scope`, dan `site_logo_path` pada keluaran dry-run untuk memastikan nilainya telah benar sesuai konfigurasi produksi cabang Anda.

## Mulai cepat (operator, 1.0)

> Wizard peramban `/setup` adalah fitur 1.1. Pada 1.0, pemasangan dilakukan lewat tombol
> *Deploy to Cloudflare* (atau fork manual) dan inisialisasi dilakukan operator melalui konfigurasi dan perintah bootstrap.

1. Pasang dependensi dan siapkan basis data lokal:

   ```bash
   npm install
   npm run dev      # server pengembangan (Miniflare: D1 lokal)
   ```

2. Terapkan migrasi D1 (`npx wrangler d1 migrations apply DB --local` untuk Miniflare;
   gunakan `--remote` hanya saat operator memang menyiapkan lingkungan Cloudflare).
3. Siapkan konfigurasi lingkungan:
   - **Pengembangan lokal (Miniflare & bootstrap lokal)**: Salin `.dev.vars.local.example` ke
     `.dev.vars` dan lengkapi nilainya. Berkas ini memuat seluruh konfigurasi wajib (baik variabel
     publik seperti `SITE_BASE_URL=http://localhost:4321` maupun rahasia) sehingga skrip bootstrap
     lokal dapat membaca seluruh kunci.
   - **Deploy to Cloudflare button & Cloudflare deployment**: Hanya rahasia sejati (`ONELOGIN_CLIENT_SECRET`,
     `SERVICE_API_CLIENT_SECRET`, `APP_MASTER_KEY`) yang dicantumkan di `.dev.vars.example` dan
     diminta dengan input terselubung (dimask) saat deploy. Pengaturan non-rahasia (`ONELOGIN_ISSUER`,
     `ONELOGIN_CLIENT_ID`, `SERVICE_API_URL`, `SERVICE_API_CLIENT_ID`, `SITE_SCOPE`, `SITE_BASE_URL`,
     `SITE_NAME`, `SITE_LOGO_PATH`) dikelola sebagai plain text pada blok `vars` di `wrangler.jsonc`.
     Berkas `wrangler.jsonc` adalah *source of truth* untuk konfigurasi Workers (lihat dokumentasi Cloudflare:
     <https://developers.cloudflare.com/workers/wrangler/configuration/>). Nilai non-rahasia harus disesuaikan
     langsung di `wrangler.jsonc` pada fork repositori Anda lalu di-commit dan di-push ke Git; pengubahan nilai
     pada dasbor Cloudflare akan tertimpa pada build atau deployment berikutnya. Pengecualian: `SITE_LOGO_PATH`
     disimpan ke tabel `system_config` di D1 saat proses bootstrap berjalan, dan mengubah `vars.SITE_LOGO_PATH`
     di `wrangler.jsonc` setelah bootstrap tidak memiliki efek; perubahan logo setelah bootstrap dilakukan melalui
     perintah UPDATE pada D1. Hanya ketiga rahasia yang dikelola melalui dasbor rahasia Cloudflare.
   - Konfigurasi wajib: `ONELOGIN_ISSUER`, `ONELOGIN_CLIENT_ID`, `ONELOGIN_CLIENT_SECRET`,
     `SERVICE_API_URL`, `SERVICE_API_CLIENT_ID`, `SERVICE_API_CLIENT_SECRET`, `SITE_SCOPE`,
     `SITE_BASE_URL`, `SITE_NAME`, dan `APP_MASTER_KEY`. `SITE_LOGO_PATH` opsional (default `/pemira-2026-logo.png`, logo Pemira 2026 bawaan).
     - `SITE_SCOPE`: wajib berupa format jalur grup diawali `/` tanpa spasi (contoh: `/ppij/okayama` atau `/ppij`),
       sesuai dengan klaim `affiliation` pada token OneLogin.
     - `SITE_LOGO_PATH`: jalur logo publik di aset statis lokal (default `/pemira-2026-logo.png`, logo Pemira 2026 bawaan). Jalur wajib berupa path absolut satu-asal (diawali `/`, bukan `//`,
       tanpa skema, tanpa spasi, ekstensi `.svg`, `.png`, `.webp`, `.jpg`, atau `.jpeg`). Tipe favicon diturunkan otomatis
       dari ekstensi. Nilai default lama `/logo.svg` dan `/ppi-okayama-logo.webp` otomatis diarahkan ke logo Pemira 2026
       saat runtime. Seperti `SITE_BASE_URL` dan `SITE_SCOPE`, `system_config` di D1 adalah sumber kebenaran saat runtime.
       Jika logo diubah setelah bootstrap, perbarui tabel `system_config` di D1:
       ```bash
       # Miniflare lokal:
       npx wrangler d1 execute DB --local --command "UPDATE system_config SET value = '/ppi-okayama-logo.webp' WHERE key = 'site_logo_path';"

       # Cloudflare D1 jarak jauh (nama basis data atau binding DB adalah argumen posisional):
       npx wrangler d1 execute <nama_d1_atau_binding_DB> --remote --command "UPDATE system_config SET value = '/ppi-okayama-logo.webp' WHERE key = 'site_logo_path';"
       ```
     - `SERVICE_API_URL`: hanya origin tanpa path (contoh: `https://service-api.example`), karena klien internal
       menggunakan path absolut `/v1/service`.
   - Kunci master dibuat dengan `openssl rand -base64 32`. Jangan masukkan nilai rahasia ke D1 atau commit `.dev.vars`.
4. Jalankan perintah bootstrap (setelah migrasi) dengan `member_id` Admin Voting pertama:

   Untuk D1 lokal (pengembangan/Miniflare):

   ```bash
   npm run bootstrap -- <member_id>
   ```

   Untuk D1 jarak jauh (Cloudflare / produksi):
   Prasyarat: operator telah masuk ke akun Cloudflare (`npx wrangler login`) dan nama basis data D1 diketahui (mis. dari `wrangler.jsonc`).

   > **Peringatan penting untuk bootstrap jarak jauh:** Skrip CLI secara otomatis membaca berkas `.dev.vars` jika ada di direktori kerja. Jika `.dev.vars` memuat nilai lokal (misal `SITE_BASE_URL=http://localhost:4321`), nilai lokal tersebut akan tertulis ke tabel `system_config` pada D1 produksi! Nilai produksi harus diekspor di shell environment (environment variable shell mengesampingkan `.dev.vars`) dan harus sama persis dengan `vars` di `wrangler.jsonc`. Fallback default `SITE_LOGO_PATH` adalah `/pemira-2026-logo.png` (jika tidak diekspor, skrip membaca `.dev.vars` lalu environment). Selalu jalankan dengan `--dry-run` terlebih dahulu untuk memeriksa baris `site_base_url`, `site_scope`, dan `site_logo_path` sebelum eksekusi ke D1 produksi.

   ```bash
   npm run bootstrap -- --remote --database <nama_d1> <member_id>
   ```

   Gunakan opsi `--dry-run` untuk mencetak pernyataan SQL tanpa mengeksekusinya:

   ```bash
   npm run bootstrap -- --remote --database <nama_d1> --dry-run <member_id>
   ```

   Perintah memakai D1 lokal Miniflare atau Cloudflare D1 jarak jauh via `wrangler d1 execute --remote`; jalankan setelah
   migrasi selesai. Bootstrap aman diulang (idempoten): hanya satu pemilihan Draf dibuat dan
   admin pertama tidak diganti. Jika situs sudah terinisialisasi, perintah keluar tanpa perubahan. Jika terdapat
   data admin tanpa status terinisialisasi, perintah dibatalkan agar basis data diperiksa operator. Konfigurasi
   wajib yang hilang membatalkan perintah. Sebelum bootstrap selesai, halaman publik/API
   menjawab 503; `/setup` serta `/api/setup/*` selalu 404. Bootstrap tidak membuat sesi login:
   admin tetap harus masuk lewat One Login dengan afiliasi ACTIVE di dalam cakupan situs.
Pengembangan lokal (Node.js 22.12+):

```bash
npm run dev      # server pengembangan
npm run check    # astro check + tsc --noEmit
npm test         # Vitest di dalam Miniflare (workerd)
npm run e2e      # Playwright; jalankan `npx playwright install` lebih dulu
npm run deploy   # migrasi D1 + wrangler deploy
```

Pengujian identitas lokal memakai Keycloak hang milik `ppij-identity` di `127.0.0.1:38180` dengan
realm/klien uji terpisah — jangan menyalakan/mematikan stack bersama itu, dan jangan mengubah realm
`ppij`. Data Pemilih lokal memakai fixture HTTP Service API deterministik.

## Memperbarui dari main

Ketika repositori hulu (`upstream`) merilis perbaikan atau fitur baru, cabang dapat memperbarui repositorinya dengan panduan berikut:

1. **Jalur fork GitHub asli**:
   Jika Anda membuat repositori melalui fitur Fork di GitHub, Anda dapat menggunakan tombol **Sync fork** pada antarmuka web GitHub, atau melalui terminal:
   ```bash
   git remote add upstream https://github.com/ppij-dev/ppij-election-system.git
   git fetch upstream
   git merge upstream/main
   ```
2. **Klon dari tombol Deploy to Cloudflare**:
   Berdasarkan dokumentasi Cloudflare, tombol deploy mengkloning repositori ke akun Git pengguna. Apakah kloning tersebut mempertahankan relasi fork GitHub atau berupa repositori mandiri berstatus *unverified* (belum diverifikasi di akun nyata). Oleh karena itu, tambahkan remote `upstream` manual seperti pada perintah di atas untuk menarik pembaruan dari repositori utama.
3. **Pembaruan berbasis tag rilis (Sangat Disarankan)**:
   Daripada melakukan merge commit branch `main` sembarangan, sangat disarankan memperbarui kode berdasarkan tag rilis stabil dari repositori hulu:
   ```bash
   git remote add upstream https://github.com/ppij-dev/ppij-election-system.git
   git fetch upstream --tags
   git merge v1.0.1
   ```
4. **Resolusi konflik pada `wrangler.jsonc`**:
   Berkas `wrangler.jsonc` adalah berkas yang diubah oleh setiap cabang (memuat ID dan nama D1 serta nilai `vars` spesifik cabang). Saat melakukan merge dari `upstream`, konflik pada berkas ini sangat wajar terjadi. Selesaikan konflik dengan tetap mempertahankan nilai konfigurasi dan resource milik cabang Anda.
5. **Penerapan migrasi skema baru**:
   Migrasi D1 baru akan diterapkan secara otomatis saat kode hasil penggabungan di-push ke branch utama repositori Anda **hanya jika** perintah Deploy di pengaturan build Cloudflare disetel ke `npm run deploy` (yang mengeksekusi `wrangler d1 migrations apply DB --remote && wrangler deploy`). Jika menggunakan perintah deploy bawaan Cloudflare (`npx wrangler deploy`), migrasi tidak akan berjalan otomatis; operator wajib menjalankan `npx wrangler d1 migrations apply DB --remote` secara manual.
6. **Aturan pembekuan (Freeze Rule) dan Deploy Otomatis**:
   **PENTING: Setiap push ke branch utama (`main`) pada repositori fork/klon cabang Anda akan langsung memicu proses build dan deploy otomatis seketika melalui Cloudflare Workers Builds.**
   Oleh karena itu, **dilarang keras melakukan merge atau push ke branch utama antara tahapan *Kunci & Jadwalkan* hingga hasil pemilihan dipublikasikan (*Diumumkan*)**. Mengubah kode atau skema saat pemungutan suara atau perhitungan suara sedang berlangsung berisiko merusak integritas pemilihan atau audit. Merge pembaruan hanya boleh dilakukan di luar jendela pembekuan (setelah pemilihan tuntas).

## Fitur Utama (1.0)

- **Bootstrap operator sekali jalan**: migrasi D1 + konfigurasi/rahasia + perintah bootstrap aman diulang dengan `member_id` Admin Voting pertama. Sebelum itu, halaman publik menjawab 503; `/setup` 404. (Wizard peramban `/setup` menyusul di 1.1.)
- **Peran**:
  - **Admin Voting**: panitia pemilihan. Semua Admin Voting punya hak yang sama; admin pertama hasil bootstrap diberi label *Technical Admin*.
  - **Pemilih**: anggota yang tercantum pada daftar pemilih yang dibekukan saat *Kunci & Jadwalkan* **dan** saat memilih masuk lewat One Login paling lama 10 menit dengan keanggotaan aktif di cakupan situs. Anggota yang baru aktif setelah penguncian tidak bisa memilih pada pemilihan ini.
  - **Admin Portal** adalah admin portal keanggotaan PPIJ, bukan admin situs ini.
- **Daftar pemilih dari Service API**: sinkron manual saat Draf, lalu sinkron final yang membekukan daftar saat *Kunci & Jadwalkan*. Di 1.0 lokal, Service API dipalsukan fixture deterministik; nomor telepon/email tidak pernah diminta atau disimpan.
- **Satu suara, rahasia, dan bisa dicek**: pemilih mengetik nama panggilan kandidat (misal `Budi`) untuk konfirmasi. Setiap anggota hanya bisa memilih sekali. Bukti suara berupa kode 26 karakter Crockford; hanya hash SHA-256 yang disimpan, dan papan bukti publik pasca penutupan menampilkan hash — kode asli tidak pernah dikirim ke server.
- **Dasbor panitia**: hitung mundur, perolehan suara keseluruhan, tabel hasil tingkat korda (korda dengan kurang dari 10 suara tidak dirinci), statistik pemilih berbasis daftar beku, dan cek kecocokan jumlah suara. Data diperbarui dengan tombol *Muat Ulang Data*.
- **Audit berantai hash**: setiap aksi Admin Voting, pemilih, dan sistem tercatat append-only; integritas rantai bisa diperiksa, dan hash audit saat penutupan ditampilkan di papan bukti.

- **Foto kandidat dan logo sebagai aset statis**: Pada versi 1.0, seluruh kandidat menampilkan gambar placeholder bersama `/placeholder-candidate.png` (tidak ada kolom atau input foto di antarmuka web maupun API kandidat). Foto per-kandidat ditunda ke versi 1.1 (memerlukan kolom foto yang terhubung serta keputusan penyimpanan media kaya karena Cloudflare R2 memerlukan akun/paket berbayar). Hanya logo situs yang dapat dikonfigurasi melalui variabel `SITE_LOGO_PATH` menggunakan berkas di bawah direktori `public/` dengan jalur absolut satu-asal diawali `/` (default: `/pemira-2026-logo.png`; nilai lama `/logo.svg` dan `/ppi-okayama-logo.webp` otomatis diarahkan ke logo Pemira 2026).

- **Mode Pratinjau (khusus fork ini)**: saat dicentang pada formulir Jadwal di `/admin/pemilihan`, keanggotaan aktif dalam cakupan diverifikasi langsung dari klaim One Login saat pemilih masuk — pemilih terdaftar otomatis ke daftar dan dapat langsung memilih, tanpa daftar beku dan tanpa sinkronisasi Service API. Kunci & Jadwalkan juga melewati sinkronisasi final dan mengizinkan waktu mulai saat ini. Untuk uji coba dan pratinjau; matikan centang untuk pemilihan resmi yang mengikuti alur daftar beku penuh.
- **Tanpa paksaan masuk ulang (khusus fork ini)**: aturan "sesi segar 10 menit" dari hulu tidak diterapkan — sesi sah (maksimum 7 hari) cukup untuk memilih di semua mode, sehingga pemilih tidak menerima kartu "Masuk ulang" di tengah pratinjau. Bukti suara, batas satu suara per anggota, dan audit berantai tidak berubah.

Ditunda ke 1.1: email keluar (pengingat, undangan, bukti suara), wizard `/setup`, editor kandidat kaya dan unggah media (CKEditor/foto/video; membutuhkan keputusan penyimpanan terpisah karena Cloudflare R2 memerlukan akun/paket berbayar), peta wilayah + rincian komsat, unggah/krop logo lewat peramban, filter & ekspor CSV audit.

## Jika semua Admin Voting kehilangan akses

Pemilik akun Cloudflare dapat membuat tautan undangan satu-kali (berlaku 72 jam) untuk `member_id` anggota aktif dan dalam cakupan:

```bash
  npm run recovery-invite -- <member_id>
```

> Catatan: Batasan ini hanya berlaku untuk `npm run recovery-invite` (skrip `scripts/recovery-invite.mjs` saat ini menolak flag `--remote`; pemulihan akses jarak jauh menyusul di fase berikutnya). Untuk inisialisasi awal sistem, perintah bootstrap jarak jauh `npm run bootstrap -- --remote` telah didukung penuh.

Anggota harus masih ACTIVE, berada di dalam cakupan situs, dan bukan kandidat. Perintah tidak mengirim email. Bagikan tautan yang dicetak hanya kepada anggota tersebut: undangan terikat ke `member_id` dan ditolak bila diteruskan.

## Dokumentasi & Spesifikasi

Spesifikasi sistem dikelola menggunakan OpenSpec di direktori `openspec/`. Lihat `AGENTS.md` untuk panduan kontribusi dan aturan arsitektur.

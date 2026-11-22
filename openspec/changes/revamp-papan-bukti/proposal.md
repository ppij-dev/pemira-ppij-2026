# Proposal: Revamp Papan Bukti menjadi ringkasan + daftar terpisah

## Why

Owner feedback (2026-11-22): hari ini `/papan-bukti` menaruh beberapa angka dan
pemeriksaan kode di atas, lalu satu daftar panjang tanpa akhir berisi setiap hash kode
bukti (ratusan baris di ponsel). Owner ingin papan menjadi halaman ringkasan yang jelas:
kartu statistik penutupan, pemeriksaan mandiri kode bukti yang menonjol, penjelasan
singkat berbahasa Indonesia, dan tautan ke halaman daftar hash yang baru.

## What Changes

- **`/papan-bukti` menjadi ringkasan.** Kartu statistik: Hak pilih (angka tersimpan saat
  penutupan atau angka beku), Suara masuk, Partisipasi %, dan Surat suara di kotak
  (jumlah surat suara) dibandingkan Partisipasi dengan keterangan sesuai/tidak sesuai.
  Waktu penutupan dan hash snapshot penutupan ditampilkan pendek dengan tombol salin
  (hash penuh yang disalin). Pemeriksaan "Cek kode bukti" tetap menonjol dan tetap
  berjalan di peramban: hash dihitung lokal, kode mentah tidak pernah dikirim ke server
  (aturan keras 3). Tautan jelas "Lihat semua kode bukti (n)" menuju halaman daftar.
  Keadaan sebelum Ditutup tetap: papan menyatakan dibuka setelah pemungutan suara
  selesai.
- **Halaman baru `/papan-bukti/daftar`.** Daftar hash lengkap, dipaginasi 100 hash per
  halaman, dengan kotak cari awalan hash yang menyaring lokal di peramban. Monospace dan
  terbaca di ponsel 390 px. Tombol "Kembali ke Papan Bukti". Sumber data dan aturan
  ketersediaan sama dengan hari ini (GET `/api/votes/board`); tidak ada data baru.
- **API diperluas secara kompatibel.** `/api/votes/board` tetap mengirim semua medan lama
  (`receipt_hashes`, `participation_count`, `ballot_count`, `closing_snapshot_hash`,
  `updated_at`) dan menambah `hak_pilih`, `hak_pilih_source`, `turnout_percentage`,
  `closed_at` untuk ringkasan. Hak pilih tetap lewat penyelesai tunggal
  (`resolveHakPilih`), jadi tidak ada konsumen yang melihat "Ditutup tapi belum
  disimpan".
- **Segel hasil tetap.** Tidak ada angka pilihan kandidat di kedua halaman sebelum
  Diumumkan. Setelah Diumumkan papan hanya menambah tautan ke `/hasil`, bukan angkanya.
- **Bahasa.** Penjelasan singkat per angka dan satu bagian "Kenapa papan ini bisa
  dipercaya": nada ramah, membantu, aman; tanpa emoji; ikon Tabler saja.

## Impact

- Affected specs: `public-site` (papan bukti publik).
- Affected code: `src/server/voting/board.ts` (payload), `src/pages/papan-bukti.astro`
  (ditulis ulang), `src/pages/papan-bukti/daftar.astro` (baru), `src/lib/receiptBoard.ts`
  (baru; logika murni cari/paginasi/normalisasi), `src/layouts/Base.astro` (sorot nav
  Beranda untuk /papan-bukti/daftar), `test/receipt-board.test.ts`,
  `test/papan-bukti-ui.test.ts` (baru). Tidak ada migrasi dan tidak ada perubahan skema.
- Tidak menyentuh `src/server/results/recap.ts`, `src/pages/admin/rekap.astro`, atau
  pengujiannya (pekerjaan benang lain).

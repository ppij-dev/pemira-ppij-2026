# Tasks: Revamp Papan Bukti

Spec source of truth: `specs/public-site/spec.md` of this change. No migration.

## 1. API

- [x] 1.1 Extend `test/receipt-board.test.ts`: board payload keeps the old contract and
      adds `hak_pilih`, `hak_pilih_source`, `turnout_percentage`, `closed_at`; no choice
      words in the body.
- [x] 1.2 Implement in `src/server/voting/board.ts` (`PublicBoard`, resolve Hak pilih via
      `resolveHakPilih`, closed_at from `closed_early_at ?? closes_at`).

## 2. Halaman ringkasan

- [x] 2.1 Rewrite `src/pages/papan-bukti.astro`: empat kartu statistik, kesesuaian kotak
      vs partisipasi, waktu penutupan, hash snapshot pendek + salin, tautan daftar dengan
      jumlah, pemeriksaan kode lokal, penjelasan singkat, keadaan belum dibuka, tautan
      `/hasil` hanya setelah Diumumkan.
- [x] 2.2 Page-source tests in `test/papan-bukti-ui.test.ts` (statistik, kesesuaian,
      salin, tautan daftar, cek lokal, belum dibuka, segel).

## 3. Halaman daftar

- [x] 3.1 Add `src/lib/receiptBoard.ts` (ukuran halaman 100, saring awalan, jepit,
      potong, normalisasi kode, hash kode) with unit tests.
- [x] 3.2 Add `src/pages/papan-bukti/daftar.astro` (paginasi, kotak cari lokal, monospace
      390 px, Kembali ke Papan Bukti, gerbang ketersediaan sama) with page-source tests.

## 4. Verifikasi

- [x] 4.1 `tsc --noEmit`, `astro check`, focused tests, full `vitest run`.
- [x] 4.2 `wrangler dev` dengan D1 lokal terisi (`scripts/seed-rekap-demo.mjs`), uji
      pemeriksaan kode ujung-ke-ujung dengan kode yang diketahui, tangkapan layar dua
      halaman pada 1650×962 dan 390 px.

# Spec Delta: Papan Bukti ringkasan dan daftar kode bukti

## Purpose

Keputusan owner (2026-11-22): papan bukti publik menjadi halaman ringkasan penutupan,
dan daftar hash kode bukti pindah ke halaman tersendiri yang dipaginasi dan bisa dicari.
Aturan keras 3 dan segel hasil (2026-11-21) tidak berubah. Ini memperjelas requirement
papan bukti pada `add-election-mvp` (public-site).

## ADDED Requirements

### Requirement: Papan Bukti adalah halaman ringkasan setelah Ditutup

Halaman `/papan-bukti` SHALL menampilkan, setelah pemungutan suara Ditutup atau
Diumumkan: Hak pilih (angka tersimpan penutupan atau angka beku), Suara masuk,
Partisipasi persen, Surat suara di kotak dibandingkan Partisipasi dengan keterangan
sesuai atau tidak sesuai, waktu penutupan, dan hash snapshot penutupan (pendek, dengan
salin hash penuh). Sebelum Ditutup halaman SHALL menyatakan papan dibuka setelah
pemungutan suara selesai.

#### Scenario: Ringkasan tampil setelah Ditutup

- **WHEN** pengunjung membuka `/papan-bukti` pada tahap Ditutup atau Diumumkan
- **THEN** kartu statistik, waktu penutupan, hash snapshot pendek dengan tombol salin,
  dan tautan "Lihat semua kode bukti (n)" tampil tanpa JavaScript

#### Scenario: Belum dibuka sebelum Ditutup

- **WHEN** pengunjung membuka `/papan-bukti` sebelum pemungutan suara Ditutup
- **THEN** halaman menyatakan papan bukti diterbitkan setelah pemungutan suara ditutup
  dan tidak ada angka papan yang tampil

### Requirement: Pemeriksaan kode bukti tetap lokal di peramban

Halaman papan SHALL menyediakan pemeriksaan mandiri kode bukti yang menormalisasi dan
meng-hash kode di peramban lalu mencocokkannya dengan daftar hash, tanpa pernah
mengirim kode mentah ke server.

#### Scenario: Kode yang sah ditemukan tanpa dikirim

- **WHEN** Pemilih memasukkan kode buktinya (dengan pemisah atau alias Crockford) dan
  memeriksa
- **THEN** peramban menormalisasi kode, menghitung SHA-256 lokal, mencocokkannya dengan
  daftar hash, dan hanya permintaan `GET /api/votes/board` yang terjadi

### Requirement: Daftar hash lengkap pada halaman terpisah

`/papan-bukti/daftar` SHALL menampilkan seluruh hash kode bukti dari sumber data yang
sama (`GET /api/votes/board`), dipaginasi 100 hash per halaman, dengan pencarian awalan
hash yang disaring lokal di peramban, teks monospace terbaca pada ponsel 390 px, dan
tautan "Kembali ke Papan Bukti". Ketersediaannya mengikuti aturan papan yang sama.

#### Scenario: Paginasi dan pencarian lokal

- **WHEN** pengunjung mengetik awalan hash atau berpindah halaman pada daftar
- **THEN** penyaringan dan pemotongan terjadi di peramban tanpa permintaan server baru

### Requirement: Segel hasil di papan

Papan dan daftar SHALL NOT menampilkan angka pilihan kandidat pada tahap mana pun
sebelum Diumumkan. Setelah Diumumkan papan MAY menautkan `/hasil`, sebagai tautan saja.

#### Scenario: Tidak ada angka pilihan

- **WHEN** papan atau daftar dirender pada tahap Ditutup
- **THEN** tidak ada angka Setuju, Tidak Setuju, Abstain, atau perolehan kandidat, dan
  tidak ada permintaan payload hasil

#### Scenario: Tautan hasil setelah Diumumkan

- **WHEN** tahap sudah Diumumkan
- **THEN** papan menampilkan tautan menuju `/hasil` tanpa mengutip angka pilihannya

### Requirement: API papan diperluas secara kompatibel

`GET /api/votes/board` SHALL tetap mengirim `receipt_hashes`, `participation_count`,
`ballot_count`, `closing_snapshot_hash`, `updated_at`, dan MAY menambah `hak_pilih`,
`hak_pilih_source`, `turnout_percentage`, `closed_at`. Hak pilih SHALL lewat penyelesai
tunggal yang sama dengan hasil dan turnout.

#### Scenario: Kontrak lama utuh

- **WHEN** konsumen lama membaca papan setelah Ditutup
- **THEN** semua medan lama ada dengan arti yang sama, dan medan baru murni tambahan

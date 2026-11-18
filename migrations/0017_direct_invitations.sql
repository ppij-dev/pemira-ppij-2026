-- Undangan Langsung (keputusan pemilik 2026-11-19): Admin Voting membuat tautan
-- undangan bagi anggota yang tidak punya akun portal. Sistem mempercayai tautan:
-- panitia memeriksa duplikat sendiri, tidak ada pemeriksaan otomatis terhadap
-- Hak pilih. Setiap tautan yang belum dibatalkan menambah 1 Hak pilih.
--   token_hash = SHA-256 kode ternormalisasi, untuk pencarian saat tautan dibuka
--   token_enc  = kode disegel APP_MASTER_KEY, agar Admin Voting bisa menyalin lagi
--                sampai tautan dipakai atau dibatalkan
--   reference  = 6 karakter Crockford (bukan kredensial), nama baris di tabel & audit
-- Tabel ini sengaja berbeda dari `invitations` (undangan Admin Voting).
CREATE TABLE direct_invitations (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  token_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  claimed_at TEXT,
  claim_id TEXT,
  guest_name TEXT,
  guest_email TEXT,
  komsat_path TEXT,
  used_at TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancelled_by_name TEXT
);
CREATE INDEX idx_direct_invitations_status ON direct_invitations(used_at, cancelled_at);

-- Mode kandidat tunggal punya tiga jawaban: setuju, tidak_setuju dan abstain
-- (keputusan owner 2026-11-16, menggantikan "tanpa Abstain" W7 Q37). Nilai NULL
-- tetap dipakai surat suara multi-kandidat, yang tidak punya Abstain.
--
-- SQLite tidak bisa mengubah CHECK pada kolom yang sudah ada, dan 0012 mungkin
-- sudah diterapkan di suatu lingkungan sehingga tidak pernah diedit. Tabel
-- ballots dibangun ulang: tabel baru dengan kolom yang sama dan CHECK yang
-- diperlebar, salin baris lama apa adanya, hapus tabel lama, ganti nama, lalu
-- buat ulang dua indeks. Tidak ada tabel lain yang merujuk ballots.
--
-- Kerahasiaan surat suara tidak berubah: tetap WITHOUT ROWID, ID acak, tanpa
-- kolom anggota dan tanpa kolom waktu, receipt_hash tetap UNIQUE. Isi kolom
-- choice hanya dibaca sebagai agregat (GROUP BY choice).
CREATE TABLE ballots_new (
  id TEXT PRIMARY KEY,
  election_id INTEGER NOT NULL REFERENCES elections(id),
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  komsat_path TEXT NOT NULL,
  receipt_hash TEXT NOT NULL UNIQUE,
  is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
  choice TEXT CHECK (choice IN ('setuju', 'tidak_setuju', 'abstain'))
) WITHOUT ROWID;
INSERT INTO ballots_new (id, election_id, candidate_id, komsat_path, receipt_hash, is_test, choice)
  SELECT id, election_id, candidate_id, komsat_path, receipt_hash, is_test, choice FROM ballots;
DROP TABLE ballots;
ALTER TABLE ballots_new RENAME TO ballots;
CREATE INDEX idx_ballots_election_komsat ON ballots(election_id, komsat_path);
CREATE INDEX idx_ballots_election_candidate ON ballots(election_id, candidate_id);

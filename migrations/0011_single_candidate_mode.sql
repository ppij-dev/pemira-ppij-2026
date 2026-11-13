-- Mode kandidat tunggal: satu saklar Draf di Pengaturan (halaman Persiapan
-- Pemilihan) untuk pemilihan yang hanya menampilkan satu kandidat.
--   0 = mode mati (pemilihan multi-kandidat, 2-10 kandidat seperti biasa)
--   1 = mode hidup (Kunci & Jadwalkan menuntut tepat 1 kandidat dan surat suara
--       meminta Setuju / Tidak Setuju / Abstain)
-- Hanya dapat diubah selama Draf dan dibekukan saat Kunci & Jadwalkan (nilai
-- bekunya dicatat pada detail entri audit "Pemilihan dikunci"), mengikuti pola
-- preview_mode di 0006_preview_mode.sql.
ALTER TABLE elections ADD COLUMN single_candidate_mode INTEGER NOT NULL DEFAULT 0 CHECK (single_candidate_mode IN (0, 1));

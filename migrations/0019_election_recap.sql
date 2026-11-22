-- Rekapitulasi Suara (keputusan pemilik Q232–Q234, 2026-11-22): satu tindakan
-- Admin Voting sekali jalan setelah pemungutan suara ditutup, menggantikan
-- Hitung Abstain. Tindakan ini menyimpan angka Pemilih yang tidak memilih
-- sebagai Abstain dan menandai rekap selesai, membuka segel angka pilihan
-- bagi Admin Voting, dan menjadi gerbang Umumkan Hasil.
--   recap_at            = waktu rekap dijalankan (NULL = belum direkap)
--   recap_abstain_count = angka tidak memilih (Hak pilih dikurangi partisipasi)
--                         yang disimpan sebagai Abstain saat rekap dijalankan
-- Kolom mengikuti pola abstain_counted_* di 0014 - hanya angka agregat, tidak
-- pernah per orang. Kembali ke Draf mengosongkannya seperti kolom abstain.
ALTER TABLE elections ADD COLUMN recap_at TEXT;
ALTER TABLE elections ADD COLUMN recap_abstain_count INTEGER CHECK (recap_abstain_count IS NULL OR recap_abstain_count >= 0);

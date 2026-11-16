-- Hitung Abstain (keputusan pemilik 2026-11-16, Q193): anggota Hak pilih yang
-- tidak memilih baru ditambahkan ke Abstain setelah Admin Voting menekan
-- "Hitung Abstain" secara manual, bukan otomatis. Hanya berlaku pada mode
-- kandidat tunggal dan hanya setelah pemungutan suara ditutup.
--   abstain_counted_at    = waktu aksi dijalankan (NULL = belum dijalankan)
--   abstain_counted_count = jumlah tidak memilih (Hak pilih beku dikurangi
--                           partisipasi) yang disimpan saat aksi dijalankan
-- Hanya angka agregat, tidak pernah per orang. Dijalankan sekali dan tidak
-- dapat dibatalkan, mengikuti pola kolom closing_snapshot_* di
-- 0005_closing_snapshot.sql.
ALTER TABLE elections ADD COLUMN abstain_counted_at TEXT;
ALTER TABLE elections ADD COLUMN abstain_counted_count INTEGER CHECK (abstain_counted_count IS NULL OR abstain_counted_count >= 0);

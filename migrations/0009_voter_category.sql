-- Kategori keanggotaan AD/ART dari Service API (anggota.dasar):
--   BIASA       = Anggota Biasa, satu-satunya yang berhak memilih
--   LUAR_BIASA  = Anggota Luar Biasa
--   NULL        = portal belum menentukan kategori (member_category null)
-- Baris roll lama belum punya kategori. Kunci & Jadwalkan membangun ulang roll
-- dari portal dan "Perbarui Nama & Kategori dari Portal" menyegarkan baris lama.
ALTER TABLE voters ADD COLUMN category TEXT;

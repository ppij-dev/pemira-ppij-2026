-- Hak pilih dari Service API (anggota.dasar, field can_vote: true/false/null).
-- Sumber kebenaran kelayakan roll: Pemira tidak menurunkan ulang ACTIVE+BIASA.
--   1    = portal menyatakan boleh memilih
--   0    = portal menyatakan tidak boleh memilih
--   NULL = portal belum menentukan (blokir sampai portal menetapkan)
-- Kategori tetap disimpan di voters.category untuk tampilan saja. Baris roll
-- lama belum punya nilai. Kunci & Jadwalkan membangun ulang roll dari portal
-- dan "Perbarui Nama & Kategori dari Portal" menyegarkan baris lama.
ALTER TABLE voters ADD COLUMN can_vote INTEGER;

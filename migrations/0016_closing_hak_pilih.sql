-- Hak pilih akhir untuk mode "Tidak Membekukan DPT": keduanya NULL sampai
-- pemungutan suara ditutup dan pembacaan pertama setelahnya menetapkan angka
-- live Hak pilih beserta waktunya (tidak ada cron, tahap dihitung dari jam).
-- Tidak pernah ditulis saat saklar mati: Hak pilih tetap dari frozen_hak_pilih.
ALTER TABLE elections ADD COLUMN closing_hak_pilih INTEGER;
ALTER TABLE elections ADD COLUMN closing_hak_pilih_at TEXT;

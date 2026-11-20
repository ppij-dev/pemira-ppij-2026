-- Portal kampanye kandidat (keputusan pemilik 2026-11-20): satu tautan https://
-- opsional ke halaman kampanye tim kandidat, tampil tersemat di halaman profil.
-- Kolom ini hanya menyimpan alamat. Isi halaman tetap milik situs kandidat.
-- NULL berarti tidak ada portal, jadi profil kandidat lama tidak berubah.
-- Bentuk tautan (https saja, tanpa kredensial, maksimal 300 karakter) diperiksa
-- di server agar pesan penolakannya jelas, bukan lewat CHECK.
ALTER TABLE candidates ADD COLUMN campaign_url TEXT;

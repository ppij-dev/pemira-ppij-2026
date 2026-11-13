-- Jawaban surat suara untuk mode kandidat tunggal: setuju / tidak_setuju /
-- abstain. NULL untuk surat suara multi-kandidat biasa (perilaku lama tidak
-- berubah, tidak ada baris lama yang perlu diisi ulang).
--
-- Kerahasiaan surat suara tetap utuh: kolom ini adalah isi surat suara, bukan
-- identitas pemilih. Tidak ada rujukan anggota, tidak ada kolom waktu, urutan
-- acak, dan ballots tetap WITHOUT ROWID serta ditulis dalam satu batch bersama
-- baris participation tanpa penghubung. Nilai choice hanya dibaca sebagai
-- agregat (GROUP BY choice), tidak pernah per surat suara.
ALTER TABLE ballots ADD COLUMN choice TEXT CHECK (choice IN ('setuju', 'tidak_setuju', 'abstain'));
